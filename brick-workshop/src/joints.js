import { getConnections, getInstanceMatrix, getLocalBodyBounds, transformPoint3 } from './model.js';

const AXES = new Set(['x', 'y', 'z']);
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const finite = n => typeof n === 'number' && Number.isFinite(n);
const clean = n => Math.abs(n) < 1e-12 ? 0 : n;

function multiply(a, b) {
  const out = Array(16).fill(0);
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) {
    for (let k = 0; k < 4; k++) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
    out[col * 4 + row] = clean(out[col * 4 + row]);
  }
  return out;
}

function aroundPivot(joint, angle) {
  const a = angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const m = [...IDENTITY];
  if (joint.axis === 'x') { m[5] = c; m[6] = s; m[9] = -s; m[10] = c; }
  if (joint.axis === 'y') { m[0] = c; m[2] = -s; m[8] = s; m[10] = c; }
  if (joint.axis === 'z') { m[0] = c; m[1] = s; m[4] = -s; m[5] = c; }
  const moved = transformPoint3(m, joint.pivot);
  for (let i = 0; i < 3; i++) m[12 + i] = joint.pivot[i] - moved[i];
  return m;
}

function quaternion(m) {
  const m11 = m[0], m12 = m[4], m13 = m[8], m21 = m[1], m22 = m[5], m23 = m[9], m31 = m[2], m32 = m[6], m33 = m[10];
  const trace = m11 + m22 + m33;
  let x, y, z, w;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s; x = (m32 - m23) * s; y = (m13 - m31) * s; z = (m21 - m12) * s;
  } else if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    w = (m32 - m23) / s; x = 0.25 * s; y = (m12 + m21) / s; z = (m13 + m31) / s;
  } else if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    w = (m13 - m31) / s; x = (m12 + m21) / s; y = 0.25 * s; z = (m23 + m32) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
    w = (m21 - m12) / s; x = (m13 + m31) / s; y = (m23 + m32) / s; z = 0.25 * s;
  }
  return [x, y, z, w].map(clean);
}

/** Fixed stud connections form rigid clusters; only joints connect those clusters. */
export function getJointGroups(parts, joints = []) {
  const parent = new Map(parts.map(p => [p.id, p.id]));
  const find = id => {
    while (parent.get(id) !== id) { parent.set(id, parent.get(parent.get(id))); id = parent.get(id); }
    return id;
  };
  for (const { a, b } of getConnections(parts)) parent.set(find(a), find(b));
  const clustered = new Map();
  for (const part of parts) {
    const root = find(part.id);
    if (!clustered.has(root)) clustered.set(root, []);
    clustered.get(root).push(part.id);
  }
  const groups = [...clustered.values()].map(ids => { const partIds = ids.sort(); return { id: partIds[0], partIds }; });
  const partToGroup = new Map(groups.flatMap(group => group.partIds.map(id => [id, group.id])));
  const edges = joints.map(joint => ({ joint, parentGroupId: partToGroup.get(joint.parentPartId), childGroupId: partToGroup.get(joint.childPartId) }));
  return { groups, partToGroup, edges };
}

export function validateJoints(parts, joints = []) {
  if (!Array.isArray(joints) || joints.length > 200) throw new Error('关节列表无效，最多支持 200 个关节');
  const partIds = new Set(parts.map(p => p.id)), ids = new Set();
  const normalized = joints.map(joint => {
    if (!joint || typeof joint !== 'object' || typeof joint.id !== 'string' || !joint.id || joint.id.length > 100 || ids.has(joint.id)) throw new Error('关节 ID 缺失或重复');
    ids.add(joint.id);
    if (!partIds.has(joint.parentPartId) || !partIds.has(joint.childPartId)) throw new Error('关节引用了不存在的零件');
    if (joint.parentPartId === joint.childPartId) throw new Error('关节两侧必须是不同的零件');
    if (!Array.isArray(joint.pivot) || joint.pivot.length !== 3 || !joint.pivot.every(n => finite(n) && Math.abs(n) <= 200)) throw new Error('关节中心必须包含三个有限坐标');
    if (!AXES.has(joint.axis)) throw new Error('关节轴必须是 x、y 或 z');
    if (!['min', 'max', 'angleA', 'angleB'].every(key => finite(joint[key]))) throw new Error('关节角度参数必须是有限数字');
    if (joint.min < -360 || joint.max > 360 || joint.min > joint.max || [joint.angleA, joint.angleB].some(n => n < joint.min || n > joint.max)) throw new Error('关节角度超出限位范围');
    if (joint.name !== undefined && (typeof joint.name !== 'string' || joint.name.length > 80)) throw new Error('关节名称过长或无效');
    return {
      id: joint.id, parentPartId: joint.parentPartId, childPartId: joint.childPartId,
      pivot: [...joint.pivot], axis: joint.axis, min: joint.min, max: joint.max,
      angleA: joint.angleA, angleB: joint.angleB, ...(joint.name !== undefined ? { name: joint.name } : {}),
    };
  });
  const { groups, edges } = getJointGroups(parts, normalized);
  const incoming = new Map(), children = new Map(groups.map(g => [g.id, []]));
  for (const edge of edges) {
    if (edge.parentGroupId === edge.childGroupId) throw new Error('这两个零件已在同一刚性组件内，请在独立组件间建立关节');
    if (incoming.has(edge.childGroupId)) throw new Error('一个活动组件只能有一个父关节，当前连接会形成活动闭环或多父连接');
    incoming.set(edge.childGroupId, edge.parentGroupId);
    children.get(edge.parentGroupId).push(edge.childGroupId);
  }
  const visiting = new Set(), visited = new Set();
  const visit = id => {
    if (visiting.has(id)) throw new Error('活动关节不能形成循环闭环');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const child of children.get(id)) visit(child);
    visiting.delete(id); visited.add(id);
  };
  groups.forEach(group => visit(group.id));
  return normalized;
}

export function validateJointCreation(parts, joints, candidate) {
  try {
    const next = validateJoints(parts, [...joints, candidate]);
    return { valid: true, joint: next[next.length - 1] };
  } catch (error) { return { valid: false, error: error.message }; }
}

/** Pivots and axes are in the saved build pose; ancestor transforms carry both. */
export function evaluatePose(parts, joints = [], t = 0) {
  if (!finite(t)) throw new Error('动作进度必须是有限数字');
  const normalized = validateJoints(parts, joints);
  const { groups, edges, partToGroup } = getJointGroups(parts, normalized);
  const progress = Math.min(1, Math.max(0, t));
  const incoming = new Set(edges.map(e => e.childGroupId));
  const children = new Map(groups.map(g => [g.id, []]));
  edges.forEach(edge => children.get(edge.parentGroupId).push(edge));
  const motions = new Map();
  const visit = (groupId, motion) => {
    motions.set(groupId, motion);
    for (const edge of children.get(groupId)) {
      const angle = edge.joint.angleA + (edge.joint.angleB - edge.joint.angleA) * progress;
      visit(edge.childGroupId, multiply(motion, aroundPivot(edge.joint, angle)));
    }
  };
  groups.filter(g => !incoming.has(g.id)).forEach(g => visit(g.id, IDENTITY));
  return new Map(parts.map(part => {
    const matrix = multiply(motions.get(partToGroup.get(part.id)) ?? IDENTITY, getInstanceMatrix(part));
    return [part.id, { position: matrix.slice(12, 15), quaternion: quaternion(matrix), matrix }];
  }));
}

/** Conservative body-box overlap warnings only; no swept-path/mesh solver. */
export function getPoseCollisions(parts, transforms) {
  const boxes = parts.map(part => {
    const [min, max] = getLocalBodyBounds(part.partId);
    const matrix = transforms.get(part.id)?.matrix ?? getInstanceMatrix(part);
    const corners = [0, 1].flatMap(ix => [0, 1].flatMap(iy => [0, 1].map(iz => transformPoint3(matrix, [ix ? max[0] : min[0], iy ? max[1] : min[1], iz ? max[2] : min[2]]))));
    return { part, min: [0, 1, 2].map(i => Math.min(...corners.map(p => p[i]))), max: [0, 1, 2].map(i => Math.max(...corners.map(p => p[i]))) };
  });
  const overlaps = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.part.allowOverlap || b.part.allowOverlap) continue;
    if ([0, 1, 2].every(axis => Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]) > 1e-5)) overlaps.push({ a: a.part.id, b: b.part.id, kind: 'bounds' });
  }
  return overlaps;
}
