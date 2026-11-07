import realCatalogue from '../public/assets/catalog-data.json' with { type: 'json' };
import { mechanicalMetadata } from './mechanical-catalog.js';

// Dimensions use one stud pitch; instance y is the bottom surface.
export const CATEGORIES = [
  { id: 'all', name: '全部零件' },
  { id: 'bricks', name: '基础砖' },
  { id: 'plates', name: '薄板' },
  { id: 'tiles', name: '光面与格栅' },
  { id: 'slopes', name: '斜坡与曲面' },
  { id: 'technic', name: '机械孔梁' },
  { id: 'pins', name: '销与十字轴' },
  { id: 'hinges', name: '铰链' },
  { id: 'clips', name: '夹扣与支架' },
  { id: 'joints', name: '球形关节' },
  { id: 'rounds', name: '圆形件与座舱' },
];

export const COLORS = [
  { id: 'graphite', name: '机械灰', hex: '#515962' },
  { id: 'silver', name: '浅石灰', hex: '#abb2b8' },
  { id: 'ivory', name: '象牙白', hex: '#eee9dd' },
  { id: 'gold', name: '琥珀黄', hex: '#dba635' },
  { id: 'blue', name: '连接蓝', hex: '#3e73b7' },
  { id: 'red', name: '砖红', hex: '#b85244' },
  { id: 'green', name: '松绿', hex: '#577866' },
  { id: 'black', name: '炭黑', hex: '#272c31' },
];

const part = (id, name, category, width, depth, height, shape, extra = {}) => ({
  id, name, category, width, depth, height, shape,
  studs: !['tile', 'slope', 'canopy'].includes(shape),
  weight: +(width * depth * height * 0.72).toFixed(1),
  description: '上下凸点连接；可自由组合、拆卸与换色。',
  ...extra,
});

export const LEGACY_PARTS = [
  part('brick11', '方砖 1 × 1', 'bricks', 1, 1, 1.2, 'brick'),
  part('brick12', '长砖 1 × 2', 'bricks', 1, 2, 1.2, 'brick'),
  part('brick22', '方砖 2 × 2', 'bricks', 2, 2, 1.2, 'brick'),
  part('brick24', '长砖 2 × 4', 'bricks', 2, 4, 1.2, 'brick'),
  part('brick14', '长砖 1 × 4', 'bricks', 1, 4, 1.2, 'brick'),
  part('brick16', '长砖 1 × 6', 'bricks', 1, 6, 1.2, 'brick'),
  part('plate12', '薄板 1 × 2', 'plates', 1, 2, 0.4, 'plate'),
  part('plate22', '薄板 2 × 2', 'plates', 2, 2, 0.4, 'plate'),
  part('plate24', '薄板 2 × 4', 'plates', 2, 4, 0.4, 'plate'),
  part('plate26', '薄板 2 × 6', 'plates', 2, 6, 0.4, 'plate'),
  part('plate28', '薄板 2 × 8', 'plates', 2, 8, 0.4, 'plate'),
  part('plate48', '大薄板 4 × 8', 'plates', 4, 8, 0.4, 'plate'),
  part('tile12', '光面板 1 × 2', 'plates', 1, 2, 0.4, 'tile', { description: '光滑顶面；底面可连接，上方不提供凸点连接。' }),
  part('tile22', '光面板 2 × 2', 'plates', 2, 2, 0.4, 'tile', { description: '光滑顶面；底面可连接，上方不提供凸点连接。' }),
  part('tile14', '光面板 1 × 4', 'plates', 1, 4, 0.4, 'tile', { description: '光滑顶面；底面可连接，上方不提供凸点连接。' }),
  part('slope22', '斜坡砖 2 × 2', 'shapes', 2, 2, 1.2, 'slope', { description: '用于机头和外壳；斜面不提供凸点连接。' }),
  part('slope24', '长斜坡 2 × 4', 'shapes', 2, 4, 1.2, 'slope', { description: '长斜面外形；底面与其他积木连接。' }),
  part('wedge24', '楔形板 2 × 4', 'shapes', 2, 4, 0.4, 'wedge', {
    polygon: [[-1, -2], [1, 2], [-1, 2]],
    footprint: [[0, 1], [0, 2], [0, 3], [1, 3]],
    description: '三角楔形薄板，适合尾翼和尖角轮廓。',
  }),
  part('wing46', '机翼板 4 × 6', 'shapes', 4, 6, 0.4, 'wing', {
    polygon: [[-2, -3], [-1, -3], [2, 3], [-2, 3]],
    footprint: [[0, 0], [0, 1], [0, 2], [1, 2], [0, 3], [1, 3], [0, 4], [1, 4], [2, 4], [0, 5], [1, 5], [2, 5]],
    description: '带凸点的梯形翼板；本阶段用于自由造型。',
  }),
  part('canopy24', '透明座舱 2 × 4', 'shapes', 2, 4, 1.2, 'canopy', {
    transparent: true, description: '透明琥珀色座舱；底面连接，不提供顶面凸点。',
  }),
  part('beam16', '孔梁 1 × 6', 'structure', 1, 6, 1.2, 'beam', {
    description: '侧面孔洞与顶部凸点；本阶段通过上下凸点固定连接。',
  }),
  part('lbeam33', 'L 型梁 3 × 3', 'structure', 3, 3, 1.2, 'lbeam', {
    footprint: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]],
    weight: 4.3, description: '直角轮廓，凹口可容纳其他零件。',
  }),
  part('round11', '圆柱砖 1 × 1', 'structure', 1, 1, 1.2, 'round'),
  part('round22', '圆柱砖 2 × 2', 'structure', 2, 2, 1.2, 'round'),
];

const HEIGHTS = { '3005': 1.2, '3004': 1.2, '3001': 1.2, '3024': 0.4, '3023': 0.4, '3022': 0.4, '3020': 0.4, '3710': 0.4, '3034': 0.4, '3036': 0.4, '3070b': 0.4, '3069b': 0.4, '2431': 0.4, '2412b': 0.4, '3039': 1.2, '3040b': 1.2, '3700': 1.2, '3701': 1.2, '4070': 1.2, '3062b': 1.2, '6141': 0.4, '98138': 0.4 };
const FULL_STUDS = new Set(['3005', '3004', '3001', '3024', '3023', '3022', '3020', '3710', '3034', '3036', '3700', '3701', '3062b', '6141', '4070']);
const BOTTOM_ONLY = new Set(['3070b', '3069b', '2431', '2412b', '54200', '98138']);

const boxHull = (min, max) => [0, 1].flatMap(x => [0, 1].flatMap(y => [0, 1].map(z => [x ? max[0] : min[0], y ? max[1] : min[1], z ? max[2] : min[2]])));
const profileHull = (width, profile) => [-width / 2, width / 2].flatMap(x => profile.map(([z, y]) => [x, y, z]));
const roundHull = (radius, minY, maxY) => [minY, maxY].flatMap(y => Array.from({ length: 16 }, (_, i) => [radius * Math.cos(i * Math.PI / 8), y, radius * Math.sin(i * Math.PI / 8)]));

// Positions below are LDraw datums in LDU, before the export's centring/grounding.
// They describe only standard stud clutch; pin, hinge, clip and ball interfaces remain manual.
const row = (xs = [-10, 10], y = 0, z = 0, normal) => xs.map(x => ({ position: [x, y, z], ...(normal ? { normal } : {}) }));
const plateLayout = (xs = [-10, 10], z = 0) => ({ studs: row(xs, 0, z), sockets: row(xs, 8, z) });
const STANDARD_LAYOUTS = {
  '3937': { sockets: row([-10, 10], 24) },
  '3938': { studs: row() }, // Its lower hinge housing is not a pair of brick sockets.
  '2429': plateLayout([-30, -10], 10),
  '2430': plateLayout([10, 30], 10),
  '60470b': plateLayout(),
  '60478': plateLayout(),
  '99207': { ...plateLayout(), studs: [...row(), ...row([-10, 10], -2, -14, [0, 0, 1]), ...row([-10, 10], -22, -14, [0, 0, 1])] },
  '44728': { ...plateLayout(), studs: [...row(), ...row([-10, 10], 10, -14, [0, 0, 1]), ...row([-10, 10], 30, -14, [0, 0, 1])] },
  '14417': plateLayout(),
  '14418': plateLayout(),
  '14704': plateLayout(),
  '4740': { studs: row([0]), sockets: row([0], 8) },
  '11477': { sockets: [{ position: [0, 0, -10] }, { position: [0, -8, 10] }] },
};
const MANUAL_MECHANICAL = new Set(['3937', '3938', '2429', '2430', '60470b', '60478', '99207', '44728', '14417', '14418', '14704']);
const fromLDraw = (record, [x, y, z]) => [x / 20 + record.sourceOriginInGame[0], -y / 20 + record.sourceOriginInGame[1], -z / 20 + record.sourceOriginInGame[2]];
const rawBox = (record, min, max) => boxHull(min, max).map(p => fromLDraw(record, p));

function standardConnectors(id, record) {
  const layout = STANDARD_LAYOUTS[id];
  if (!layout) return [];
  return [['stud', layout.studs], ['socket', layout.sockets]].flatMap(([type, points]) => (points ?? []).map(c => ({
    type, position: fromLDraw(record, c.position), normal: c.normal ?? (type === 'stud' ? [0, 1, 0] : [0, -1, 0]),
  })));
}

function curvedRoof(minZ, maxZ, bottom, height) {
  // 11477.dat's exported 48/1-8cyli roof. Tangents enclose the curved surface,
  // while separate front/rear hulls preserve its two different underside datums.
  const tangent = z => {
    const root = Math.sqrt(2 - ((z + 1) / 2) ** 2), slope = -1.448595 * (z + 1) / (4 * root);
    // LDraw's rounded primitive samples differ from the analytic arc by up to .000125 stud.
    return { z, slope, intercept: -1.2486 + 1.448595 * root + .0002 - slope * z };
  };
  const lines = Array.from({ length: 9 }, (_, i) => tangent(minZ + (maxZ - minZ) * i / 8));
  const roof = [[minZ, lines[0].slope * minZ + lines[0].intercept]];
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1], b = lines[i], z = (b.intercept - a.intercept) / (a.slope - b.slope);
    roof.push([z, a.slope * z + a.intercept]);
  }
  const last = lines.at(-1);
  roof.push([maxZ, last.slope * maxZ + last.intercept]);
  return profileHull(1, [[minZ, bottom], [maxZ, bottom], ...roof.reverse().map(([z, y]) => [z, Math.min(height, y)])]);
}

function auditedCollisionHulls(id, record, height) {
  if (id === '3937') return [boxHull(record.bbox[0], [record.width / 2, height, record.depth / 2])];
  if (id === '3938') return [boxHull([-1, .69, -.5], [1, .8, .5]), boxHull([-1, 0, -.3], [1, .7, .3])];
  if (id === '2429' || id === '2430') {
    const range = id === '2429' ? [-40, 0] : [0, 40];
    return [rawBox(record, [range[0], 0, 0], [range[1], 8, 20]), rawBox(record, [-8, 0, -8], [8, 8, 8])];
  }
  if (id === '60470b') {
    const front = record.sourceOriginInGame[2] + .5;
    return [rawBox(record, [-20, 0, -10], [20, 8, 10]), ...[-.5, .5].map(x => boxHull([x - .2, 0, front], [x + .2, record.meshHeight, record.depth / 2]))];
  }
  if (id === '60478') {
    return [rawBox(record, [-20, 0, -10], [20, 8, 10]), rawBox(record, [20, -4, -10], [36, 8, 10])];
  }
  if (id === '99207' || id === '44728') {
    const range = id === '99207' ? [-32, 0] : [8, 40];
    return [rawBox(record, [-20, 0, -14], [20, 8, 10]), rawBox(record, [-20, range[0], -14], [20, range[1], -10])];
  }
  if (id === '14417') {
    return [rawBox(record, [-20, 0, -10], [20, 8, 10]), rawBox(record, [-8, -4, -28], [8, 12, -10])];
  }
  if (id === '14418' || id === '14704') {
    const extension = id === '14418' ? [[20, -3.75, -10], [35, 11.75, 10]] : [[-10, -3.75, -25], [10, 11.75, -10]];
    return [rawBox(record, [-20, 0, -10], [20, 8, 10]), rawBox(record, ...extension)];
  }
  if (id === '4740') {
    return [[[1, 0], [1, .12], [.8, .235], [.6, .315], [.3, .4]].flatMap(([radius, y]) => roundHull(radius, y, y).slice(0, 16))];
  }
  if (id === '11477') return [curvedRoof(-1, 0, .4, height), curvedRoof(0, 1, 0, height)];
  if (id === '3039' || id === '3040b') {
    // LDraw s/3039s01 and s/3040s01: rear flat to z=0, front roof ends 4 LDU above the base.
    return [profileHull(record.width, [[-1, 0], [1, 0], [1, .2], [0, height], [-1, height]])];
  }
  if (id === '54200') {
    // 54200.dat sloped face: raw (y,z)=(-4,-10)..(-13.6,6), flattened top at y=-15.6.
    return [profileHull(record.width, [[-.5, 0], [.5, 0], [.5, .2], [-.4666666667, height], [-.5, height]])];
  }
  if (id === '4070') {
    // The recessed side-stud seat is at raw z=-6; only the bottom 4 LDU projects to z=-10.
    return [boxHull([-.5, 0, -.5], [.5, .2, .5]), boxHull([-.5, .2, -.5], [.5, height, .3])];
  }
  if (id === '3062b' || id === '6141') {
    // Their lower open tube is 16 LDU across; the upper outer wall is 20 LDU across.
    return [roundHull(.4, 0, .25), roundHull(.5, .25, height)];
  }
  if (id === '98138') return [roundHull(.5, 0, height)];
  return undefined;
}

function realPart(record) {
  const ldrawId = String(record.ldrawId ?? record.id);
  let height = HEIGHTS[ldrawId] ?? (record.height > 0 ? record.height : record.meshHeight);
  if (![record.width, record.depth, height].every(n => Number.isFinite(n) && n > 0)) throw new Error(`零件 ${ldrawId} 尺寸无效`);
  const mechanical = mechanicalMetadata(record);
  const collisionHulls = mechanical?.collisionHulls ?? auditedCollisionHulls(ldrawId, record, height);
  const vertices = STANDARD_LAYOUTS[ldrawId] ? collisionHulls.flat() : null;
  const bodyBounds = vertices ? [0, 1].map(end => [0, 1, 2].map(axis => (end ? Math.max : Math.min)(...vertices.map(p => p[axis])))) : [[-record.width / 2, 0, -record.depth / 2], [record.width / 2, height, record.depth / 2]];
  if (vertices) height = bodyBounds[1][1];
  const connectors = [], footprint = [];
  const isSlopeStud = ldrawId === '3039' || ldrawId === '3040b';
  const gridLayout = FULL_STUDS.has(ldrawId) || BOTTOM_ONLY.has(ldrawId) || isSlopeStud;
  const documented = gridLayout || !!STANDARD_LAYOUTS[ldrawId];
  if (gridLayout) {
    for (let iz = 0; iz < Math.round(record.depth); iz++) for (let ix = 0; ix < Math.round(record.width); ix++) {
      const x = ix - (Math.round(record.width) - 1) / 2, z = iz - (Math.round(record.depth) - 1) / 2;
      footprint.push([ix, iz]);
      connectors.push({ type: 'socket', position: [x, 0, z], normal: [0, -1, 0] });
      // Slopes 3039/3040b have studs only on their rear row, not on the slanted surface.
      if (FULL_STUDS.has(ldrawId) || (isSlopeStud && iz === 0)) connectors.push({ type: 'stud', position: [x, height, z], normal: [0, 1, 0] });
    }
  }
  connectors.push(...standardConnectors(ldrawId, record));
  // LDraw 4070's side stud is recessed: raw (0,10,-6) LDU, normal -Z.
  if (ldrawId === '4070') connectors.push({ type: 'stud', position: [0, 0.7, 0.3], normal: [0, 0, 1] });
  return {
    ...record, id: record.templateId ?? `ld_${ldrawId}`, ldrawId, shape: 'ldraw', ldrawShape: record.shape,
    height, nominalHeight: height, studHeight: connectors.some(c => c.type === 'stud') ? 0.2 : 0,
    bodyBounds, connectors, footprint, studs: connectors.some(c => c.type === 'stud'),
    collisionHulls,
    weight: +(Math.max(0.1, record.width * record.depth * height * 0.72)).toFixed(1),
    description: `${record.description ?? record.name} · ${documented ? '已标注标准凸点与底部接口' : mechanical?.mechanicalConnectionStatus === 'audited-pin-layout' ? '已标注真实销孔接口' : '机械接口请自由定位或手动连接关节'}${MANUAL_MECHANICAL.has(ldrawId) ? '；铰链、夹扣及球窝仍需手动连接关节' : ''}${documented && mechanical?.mechanicalConnectionStatus === 'audited-pin-layout' ? '；侧面圆孔可接机械销' : ''}`,
    connectionStatus: documented ? 'audited-stud-layout' : 'manual-mechanical',
    ...(MANUAL_MECHANICAL.has(ldrawId) ? { mechanicalConnectionStatus: 'manual' } : {}),
    ...(mechanical ?? {}),
  };
}

export const PARTS = realCatalogue.parts.map(realPart);
export const ASSET_MANIFEST = { glb: realCatalogue.glb, unit: realCatalogue.unit };
const aliases = { brick11: ['3005', 0], brick12: ['3004', 90], brick24: ['3001', 90], plate12: ['3023', 90], plate22: ['3022', 0], plate24: ['3020', 90], plate28: ['3034', 90], tile12: ['3069b', 90], tile14: ['2431', 90], slope22: ['3039', 0], round11: ['3062b', 0] };
const canonicalParts = new Map(PARTS.map(p => [p.ldrawId, p]));
for (const legacy of LEGACY_PARTS) {
  legacy.legacy = true;
  if (aliases[legacy.id]) {
    const [ldrawId, assetRotation] = aliases[legacy.id];
    Object.assign(legacy, { ldrawId, nodeName: `part_${ldrawId}`, glb: realCatalogue.glb, assetRotation });
    const canonical = canonicalParts.get(ldrawId), radians = assetRotation * Math.PI / 180;
    const rotate = ([x, y, z]) => [Math.cos(radians) * x + Math.sin(radians) * z, y, -Math.sin(radians) * x + Math.cos(radians) * z].map(n => Math.abs(n) < 1e-12 ? 0 : +n.toFixed(12));
    const corners = boxHull(...canonical.bbox).map(rotate);
    legacy.bbox = [0, 1].map(end => [0, 1, 2].map(axis => (end ? Math.max : Math.min)(...corners.map(p => p[axis]))));
    legacy.connectors = canonical.connectors.map(c => ({ ...c, position: rotate(c.position), normal: rotate(c.normal) }));
    legacy.collisionHulls = canonical.collisionHulls?.map(hull => hull.map(rotate));
    legacy.studHeight = canonical.studHeight;
    legacy.connectionStatus = canonical.connectionStatus;
  }
}
const hiddenWings = ['43722', '43723'].map(ldrawId => realPart({ id: ldrawId, templateId: `ld_${ldrawId}`, ldrawId, name: `楔形翼板 ${ldrawId}`, category: 'slopes', width: 2, depth: 3, height: 0.4, meshHeight: 0.6, nodeName: `part_${ldrawId}`, glb: '/assets/demo-parts.glb', shape: 'wing' }));
const byId = new Map([...LEGACY_PARTS, ...PARTS, ...hiddenWings].map(p => [p.id, p]));
export const getPart = id => byId.get(id);

/** Register only bundled asset metadata, never document-provided definitions. */
export function registerPartMetadata(records) {
  for (const record of records) {
    const id = String(record.ldrawId ?? record.id);
    if (!/^[a-z0-9_-]+$/i.test(id)) throw new Error('内置零件编号无效');
    const next = realPart(record);
    byId.set(next.id, next);
  }
}

export function getFootprint(partOrId) {
  const p = typeof partOrId === 'string' ? getPart(partOrId) : partOrId;
  if (!p) throw new Error('未知零件');
  return p.footprint ?? Array.from({ length: p.width * p.depth }, (_, i) => [i % p.width, Math.floor(i / p.width)]);
}
