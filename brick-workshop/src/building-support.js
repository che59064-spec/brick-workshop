import { canPlace, getBounds, getConnections, getInstanceMatrix, instancesOverlap } from './model.js';

const EPS = 1e-5, DROP = .001;

function boundsDistance(a, b) {
  return Math.hypot(...['X', 'Y', 'Z'].map(axis => Math.max(0, a[`min${axis}`] - b[`max${axis}`], b[`min${axis}`] - a[`max${axis}`])));
}

function nearbyJoint(joint, bounds) {
  const a = bounds.get(joint.parentPartId), b = bounds.get(joint.childPartId);
  return !!a && !!b && boundsDistance(a, b) <= .3 + EPS;
}

/** Stud mates carry in both directions; loose support requires body contact, not a stud cap. */
export function analyzeSupport(parts, joints = []) {
  const strict = parts.map(part => ({ ...part, allowOverlap: false }));
  const bounds = strict.map(part => getBounds(part, true));
  const edges = new Map(parts.map(part => [part.id, new Set()]));
  const supportedIds = new Set(parts.filter((_, i) => Math.abs(bounds[i].minY) <= EPS).map(part => part.id));
  const connect = (a, b) => { if (edges.has(a) && edges.has(b)) edges.get(a).add(b); };
  for (const { a, b } of getConnections(strict)) { connect(a, b); connect(b, a); }

  for (let i = 0; i < strict.length; i++) {
    const upper = strict[i], a = bounds[i], lowered = { ...upper, y: upper.y - DROP };
    if (supportedIds.has(upper.id)) continue;
    for (let j = 0; j < strict.length; j++) {
      if (i === j) continue;
      const lower = strict[j], b = bounds[j];
      if (edges.get(lower.id).has(upper.id)) continue;
      if (Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) <= EPS || Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ) <= EPS
        || a.maxY - DROP <= b.minY + EPS || a.minY - DROP >= b.maxY - EPS) continue;
      if (canPlace(upper, [lower]) && instancesOverlap(lowered, lower, false)) connect(lower.id, upper.id);
    }
  }

  const byId = new Map(parts.map((part, i) => [part.id, bounds[i]]));
  for (const joint of joints) {
    if (nearbyJoint(joint, byId)) {
      connect(joint.parentPartId, joint.childPartId); connect(joint.childPartId, joint.parentPartId);
    }
  }
  const queue = [...supportedIds];
  for (let i = 0; i < queue.length; i++) for (const id of edges.get(queue[i])) {
    if (!supportedIds.has(id)) { supportedIds.add(id); queue.push(id); }
  }
  return { supportedIds, unsupportedIds: new Set(parts.filter(part => !supportedIds.has(part.id)).map(part => part.id)) };
}

function geometryChanged(before, after) {
  if (!before || before.partId !== after.partId) return true;
  const matrix = getInstanceMatrix(before), next = getInstanceMatrix(after);
  return matrix.some((value, i) => !Number.isFinite(next[i]) || Math.abs(value - next[i]) > 1e-7);
}

const jointLinks = joints => JSON.stringify(joints.map(joint => [joint.parentPartId, joint.childPartId].sort()).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));

/** Accept old unsupported drafts while preventing new floating parts or newly broken supports. */
export function checkBuildChange(before, after) {
  try {
    const oldParts = before.parts, parts = after.parts;
    const oldById = new Map(oldParts.map(part => [part.id, part]));
    const moved = parts.filter(part => geometryChanged(oldById.get(part.id), part));
    const movedIds = new Set(moved.map(part => part.id));
    for (const part of parts) {
      if ((movedIds.has(part.id) || !!part.allowOverlap !== !!oldById.get(part.id)?.allowOverlap) && !canPlace(part, parts, part.id)) {
        return { valid: false, reason: '零件发生重叠、穿过地面或超出工作范围。' };
      }
    }
    const oldJoints = before.joints ?? [], joints = after.joints ?? [];
    if (!moved.length && oldParts.length === parts.length && jointLinks(oldJoints) === jointLinks(joints)) return { valid: true, reason: '' };
    const current = analyzeSupport(parts, joints);
    if (moved.some(part => !current.supportedIds.has(part.id))) return { valid: false, reason: '此处没有地面、有效连接或已支撑的表面承托。' };
    const previous = analyzeSupport(oldParts, oldJoints);
    if (parts.some(part => previous.supportedIds.has(part.id) && !current.supportedIds.has(part.id))) {
      return { valid: false, reason: '操作会让其他积木悬空，请先拆下或移动上层组件。' };
    }
    return { valid: true, reason: '' };
  } catch (error) { return { valid: false, reason: error.message || '无法检查零件的支撑关系。' }; }
}

/** Lower the selected fixed/jointed component as one edit, preserving loose surface-supported parts. */
export function getComponentIds(doc, selectedId) {
  if (!doc.parts.some(part => part.id === selectedId)) return new Set();
  const bounds = new Map(doc.parts.map(part => [part.id, getBounds(part, true)]));
  const edges = new Map(doc.parts.map(part => [part.id, new Set()]));
  const connect = (a, b) => { edges.get(a).add(b); edges.get(b).add(a); };
  for (const { a, b } of getConnections(doc.parts)) connect(a, b);
  for (const joint of doc.joints ?? []) if (nearbyJoint(joint, bounds)) connect(joint.parentPartId, joint.childPartId);
  const component = new Set([selectedId]), queue = [selectedId];
  for (let i = 0; i < queue.length; i++) for (const id of edges.get(queue[i])) {
    if (!component.has(id)) { component.add(id); queue.push(id); }
  }
  return component;
}

export function translateComponent(doc, component, delta) {
  const shifted=(value,axis)=>{const next=value+delta[axis];return Math.abs(next)<1e-10?0:+next.toFixed(6);};
  return {
    ...doc,
    parts:doc.parts.map(part=>component.has(part.id)?{...part,x:shifted(part.x,0),y:shifted(part.y,1),z:shifted(part.z,2)}:part),
    joints:(doc.joints??[]).map(joint=>component.has(joint.parentPartId)&&component.has(joint.childPartId)?{...joint,pivot:joint.pivot.map(shifted)}:joint),
  };
}

export function groundComponent(doc, selectedId) {
  const component=getComponentIds(doc,selectedId);
  if (!component.size) throw new Error('请先选择需要落地的积木。');
  const bounds = new Map(doc.parts.map(part => [part.id, getBounds(part, true)]));
  const queue=[...component];
  const delta = -Math.min(...queue.map(id => bounds.get(id).minY));
  const next=translateComponent(doc,component,[0,delta,0]);
  const result = checkBuildChange(doc, next);
  if (!result.valid) throw new Error(`无法将组件落地：${result.reason}`);
  return next;
}
