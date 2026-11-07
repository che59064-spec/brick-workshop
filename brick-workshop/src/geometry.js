import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getFootprint } from './catalog.js';
import { createAssetMesh } from './assets.js';

// Shared shapes survive part deletion; each instance owns its materials.
const geometryCache = new Map();
const CLEARANCE = 0.04;

function cached(key, make) {
  if (!geometryCache.has(key)) geometryCache.set(key, make());
  return geometryCache.get(key);
}

function merged(shapes) {
  const normalized = shapes.map(shape => {
    const geometry = shape.index ? shape.toNonIndexed() : shape;
    if (geometry !== shape) shape.dispose();
    return geometry;
  });
  const result = mergeGeometries(normalized, false);
  for (const geometry of normalized) geometry.dispose();
  if (!result) throw new Error('无法创建积木几何');
  result.computeBoundingBox();
  result.computeBoundingSphere();
  return result;
}

function box(width, height, depth, x = 0, y = 0, z = 0, radius = 0.04) {
  return new RoundedBoxGeometry(width, height, depth, 2, Math.min(radius, width / 4, height / 4, depth / 4))
    .translate(x, y, z);
}

function roundedRectangle(width, depth, radius = 0.045) {
  const shape = new THREE.Shape();
  const x = -width / 2, z = -depth / 2;
  const r = Math.min(radius, width / 4, depth / 4);
  shape.moveTo(x + r, z);
  shape.lineTo(x + width - r, z);
  shape.quadraticCurveTo(x + width, z, x + width, z + r);
  shape.lineTo(x + width, z + depth - r);
  shape.quadraticCurveTo(x + width, z + depth, x + width - r, z + depth);
  shape.lineTo(x + r, z + depth);
  shape.quadraticCurveTo(x, z + depth, x, z + depth - r);
  shape.lineTo(x, z + r);
  shape.quadraticCurveTo(x, z, x + r, z);
  shape.closePath();
  return shape;
}

function extrudeUp(shape, height, y = 0, bevel = 0.018) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, height - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelSegments: 2,
    steps: 1,
    bevelSize: bevel,
    bevelThickness: bevel,
    curveSegments: 16,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y + bevel, 0);
  return geometry;
}

function studGeometry() {
  return cached('stud', () => new THREE.LatheGeometry([
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.272, 0),
    new THREE.Vector2(0.295, 0.022),
    new THREE.Vector2(0.295, 0.146),
    new THREE.Vector2(0.278, 0.17),
    new THREE.Vector2(0, 0.17),
  ], 28));
}

function studsFor(def) {
  if (def.studs === false) return [];
  return getFootprint(def).map(([ix, iz]) => studGeometry().clone().translate(
    ix - (def.width - 1) / 2,
    def.height - 0.003,
    iz - (def.depth - 1) / 2,
  ));
}

function hollowBrick(def) {
  const { width, depth, height } = def;
  const topThickness = Math.min(0.16, height / 2);
  const wall = 0.115;
  const shell = roundedRectangle(width - 0.08, depth - 0.08);
  const inside = roundedRectangle(width - 0.08 - wall * 2, depth - 0.08 - wall * 2, 0.035);
  shell.holes.push(new THREE.Path(inside.getPoints(5).reverse()));
  const shapes = [
    extrudeUp(shell, height - topThickness + 0.03, 0, 0.015),
    box(width - CLEARANCE, topThickness, depth - CLEARANCE, 0, height - topThickness / 2, 0),
  ];
  if (width > 1 && depth > 1) {
    const tube = new THREE.Shape();
    tube.absarc(0, 0, 0.325, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, 0.235, 0, Math.PI * 2, true);
    tube.holes.push(hole);
    const tubeGeometry = extrudeUp(tube, height - topThickness + 0.015, 0.025, 0.008);
    for (let x = 1; x < width; x++) {
      for (let z = 1; z < depth; z++) {
        shapes.push(tubeGeometry.clone().translate(x - width / 2, 0, z - depth / 2));
      }
    }
    tubeGeometry.dispose();
  }
  return shapes;
}

function polygonShape(points) {
  // Shape's second axis becomes -z after the upward extrusion rotation.
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
  shape.closePath();
  return shape;
}

function footprintOutline(def) {
  const cells = getFootprint(def);
  const occupied = new Set(cells.map(([x, z]) => `${x},${z}`));
  const edges = new Map();
  const add = (x1, z1, x2, z2) => edges.set(`${x1},${z1}`, [x2, z2]);
  for (const [x, z] of cells) {
    if (!occupied.has(`${x},${z - 1}`)) add(x, z, x + 1, z);
    if (!occupied.has(`${x + 1},${z}`)) add(x + 1, z, x + 1, z + 1);
    if (!occupied.has(`${x},${z + 1}`)) add(x + 1, z + 1, x, z + 1);
    if (!occupied.has(`${x - 1},${z}`)) add(x, z + 1, x, z);
  }
  const first = [...edges.keys()][0];
  let key = first;
  const result = [];
  do {
    const [x, z] = key.split(',').map(Number);
    result.push([(x - def.width / 2) * 0.98, (z - def.depth / 2) * 0.98]);
    const next = edges.get(key);
    if (!next) throw new Error('零件轮廓不连续');
    key = next.join(',');
  } while (key !== first && result.length <= edges.size);
  return result;
}

function beamGeometry(def) {
  const length = Math.max(def.width, def.depth);
  const thickness = Math.min(def.width, def.depth);
  const profile = roundedRectangle(length - 0.08, def.height - 0.04, 0.12);
  for (let i = 0; i < length; i++) {
    const hole = new THREE.Path();
    hole.absarc(i - (length - 1) / 2, 0, 0.245, 0, Math.PI * 2, true);
    profile.holes.push(hole);
  }
  const geometry = new THREE.ExtrudeGeometry(profile, {
    depth: thickness - 0.08,
    bevelEnabled: true,
    bevelSize: 0.018,
    bevelThickness: 0.018,
    bevelSegments: 2,
    curveSegments: 20,
  });
  geometry.translate(0, def.height / 2, -(thickness - 0.08) / 2);
  if (def.depth > def.width) geometry.rotateY(Math.PI / 2);
  return geometry;
}

function slopeGeometry(def, bottom = 0, top = def.height, inset = 0.04) {
  const width = def.width - inset;
  const depth = def.depth - inset;
  const bevel = 0.02;
  const low = bottom + Math.min(0.28, (top - bottom) * 0.25);
  const profile = new THREE.Shape();
  profile.moveTo(-depth / 2, bottom + bevel);
  profile.lineTo(depth / 2, bottom + bevel);
  profile.lineTo(depth / 2, top - bevel);
  profile.lineTo(-depth / 2, low);
  profile.closePath();
  const geometry = new THREE.ExtrudeGeometry(profile, {
    depth: width - bevel * 2,
    bevelEnabled: true,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 2,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -(width - bevel * 2) / 2);
  geometry.rotateY(-Math.PI / 2);
  return geometry;
}

function solidGeometry(def) {
  return cached(`part:${def.id}`, () => {
    let shapes;
    switch (def.shape) {
      case 'lbeam':
        shapes = [extrudeUp(polygonShape(footprintOutline(def)), def.height, 0, 0.015)];
        break;
      case 'wing':
      case 'wedge':
        shapes = [extrudeUp(polygonShape(def.polygon.map(([x, z]) => [x * 0.985, z * 0.99])), def.height)];
        break;
      case 'slope':
        shapes = [slopeGeometry(def)];
        break;
      case 'beam':
        shapes = [beamGeometry(def)];
        break;
      case 'round': {
        const shape = new THREE.Shape();
        shape.absarc(0, 0, Math.min(def.width, def.depth) / 2 - 0.04, 0, Math.PI * 2, false);
        const hole = new THREE.Path();
        hole.absarc(0, 0, Math.min(def.width, def.depth) / 2 - 0.17, 0, Math.PI * 2, true);
        shape.holes.push(hole);
        shapes = [
          extrudeUp(shape, def.height - 0.1),
          new THREE.CylinderGeometry(Math.min(def.width, def.depth) / 2 - 0.025, Math.min(def.width, def.depth) / 2 - 0.025, 0.15, 40).translate(0, def.height - 0.075, 0),
        ];
        break;
      }
      default:
        shapes = hollowBrick(def);
    }
    return merged([...shapes, ...studsFor(def)]);
  });
}

function plastic(color) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.31,
    metalness: 0.035,
    clearcoat: 0.28,
    clearcoatRoughness: 0.32,
    envMapIntensity: 0.7,
  });
}

function addMesh(group, geometry, material) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

export function createPartMesh(def, color = '#515962', options = {}) {
  const imported = createAssetMesh(def, color);
  const group = imported ?? new THREE.Group();
  group.name = def.name;
  group.userData.definition = def;
  group.userData.isPart = true;
  if (imported) {
    // Geometries come from the Blender library, shared across independent pieces.
  } else if (def.shape === 'canopy') {
    const frame = cached(`frame:${def.id}`, () => merged([
      box(def.width - CLEARANCE, 0.14, def.depth - CLEARANCE, 0, 0.07, 0),
      box(0.075, 0.17, def.depth - 0.12, -def.width / 2 + 0.07, 0.17, 0, 0.015),
      box(0.075, 0.17, def.depth - 0.12, def.width / 2 - 0.07, 0.17, 0, 0.015),
    ]));
    addMesh(group, frame, plastic(color));
    const glass = new THREE.MeshPhysicalMaterial({
      color: options.glassColor ?? '#e2b74c', roughness: 0.12, metalness: 0,
      transparent: true, opacity: 0.68, transmission: 0.2,
      thickness: 0.2, ior: 1.46, clearcoat: 0.8,
      depthWrite: false,
    });
    addMesh(group, cached(`glass:${def.id}`, () => slopeGeometry(def, 0.15, def.height, 0.15)), glass);
  } else {
    addMesh(group, solidGeometry(def), plastic(color));
  }
  group.traverse(object => {
    if (!object.isMesh) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.userData.original = {
      color: material.color.clone(), opacity: material.opacity,
      transparent: material.transparent, depthWrite: material.depthWrite,
    };
  });
  setPartAppearance(group, { ghost: !!options.ghost, valid: options.valid !== false, selected: !!options.selected });
  return group;
}

export function setPartAppearance(group, { selected = false, ghost = false, valid = true } = {}) {
  group.traverse(object => {
    if (!object.isMesh) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      const original = material.userData.original;
      if (!original) continue;
    material.color.copy(original.color);
    material.opacity = ghost ? 0.44 : original.opacity;
    material.transparent = ghost || original.transparent;
    material.depthWrite = ghost ? false : original.depthWrite;
    material.emissive?.set(ghost ? (valid ? '#0a84ff' : '#ff453a') : selected ? '#0a84ff' : '#000000');
    material.emissiveIntensity = ghost ? 0.38 : selected ? 0.16 : 0;
    if (ghost) material.color.set(valid ? '#78b8f8' : '#ed8b79');
    }
    object.castShadow = !ghost;
  });
  group.userData.appearance = { selected, ghost, valid };
}

export function disposePartMesh(group) {
  if (group.userData.disposed) return;
  const materials = new Set();
  group.traverse(object => {
    if (object.isMesh) {
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    }
  });
  for (const material of materials) material.dispose();
  group.userData.disposed = true;
  group.clear();
}
