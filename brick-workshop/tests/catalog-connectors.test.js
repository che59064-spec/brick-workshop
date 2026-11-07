import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { Vector3, Matrix4, Raycaster, DoubleSide, Quaternion, Euler } from 'three';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PARTS, LEGACY_PARTS, getPart } from '../src/catalog.js';
import { getConnectionPoints, getBounds, canPlace, getConnections } from '../src/model.js';

const library = fileURLToPath(new URL('../../blender/ldraw/', import.meta.url));
const sources = new Map();
const recordById = new Map(JSON.parse(readFileSync(new URL('../public/assets/catalog-data.json', import.meta.url), 'utf8')).parts.map(p => [p.id, p]));
const meshBytes = readFileSync(new URL('../public/assets/parts.glb', import.meta.url));
const meshes = new GLTFLoader().parseAsync(meshBytes.buffer.slice(meshBytes.byteOffset, meshBytes.byteOffset + meshBytes.byteLength), '');
const round = value => Math.abs(value) < 1e-7 ? 0 : +value.toFixed(6);
const ordered = points => points.map(p => ({ position: p.position.map(round), normal: p.normal.map(round) })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const specialtyIds = ['3937', '3938', '2429', '2430', '60470b', '60478', '99207', '44728', '14417', '14418', '14704', '4740', '11477'];

function sourcePath(name, parent = '') {
  const path = name.replace(/\\/g, '/');
  const options = [resolve(library, 'parts', path), resolve(library, 'p', path), resolve(dirname(parent || library), path)];
  const found = options.find(existsSync);
  assert.ok(found, `Missing bundled LDraw source ${name}`);
  return found;
}

// Follow the actual LDraw subpart transforms, stopping at standard solid/hollow stud datums.
function ldrawPrimitives(id, primitivePattern) {
  const studs = [];
  function walk(path, transform = new Matrix4()) {
    if (!sources.has(path)) sources.set(path, readFileSync(path, 'utf8'));
    for (const line of sources.get(path).split(/\r?\n/)) {
      const cells = line.trim().split(/\s+/);
      if (cells[0] !== '1') continue;
      const n = cells.slice(2, 14).map(Number), name = cells.slice(14).join(' ');
      const local = new Matrix4().set(n[3], n[4], n[5], n[0], n[6], n[7], n[8], n[1], n[9], n[10], n[11], n[2], 0, 0, 0, 1);
      const world = transform.clone().multiply(local);
      if (primitivePattern.test(name)) {
        const origin = new Vector3().applyMatrix4(world), normal = new Vector3(0, -1, 0).transformDirection(world);
        const offset = recordById.get(id).sourceOriginInGame;
        studs.push({ position: [origin.x / 20 + offset[0], -origin.y / 20 + offset[1], -origin.z / 20 + offset[2]], normal: [normal.x, -normal.y, -normal.z],
          basisLengths: [0, 1, 2].map(axis => new Vector3().setFromMatrixColumn(world, axis).length() / 20) });
      } else walk(sourcePath(name, path), world);
    }
  }
  walk(sourcePath(`${id}.dat`));
  return studs;
}
const ldrawStuds = id => ldrawPrimitives(id, /^(stud|stud2|stud2a)\.dat$/i);

test('audited stud points and directions match bundled LDraw subpart transforms', () => {
  for (const id of ['3005', '3004', '3001', '3024', '3023', '3020', '3039', '3040b', '4070', '3062b', '6141', '3700', '3701', ...specialtyIds]) {
    const actual = getPart(`ld_${id}`).connectors.filter(c => c.type === 'stud');
    assert.deepEqual(ordered(actual), ordered(ldrawStuds(id)), `Stud datum mismatch on ${id}`);
  }
  for (const id of ['2412b', '54200', '98138']) {
    assert.equal(ldrawStuds(id).length, 0, `Source ${id} has no top stud`);
    assert.equal(getPart(`ld_${id}`).connectors.filter(c => c.type === 'stud').length, 0);
  }
});

test('audited bottom sockets leave a full stud-height cavity in the actual Blender mesh', async () => {
  const gltf = await meshes;
  gltf.scene.updateMatrixWorld(true);
  const ray = new Raycaster();
  for (const id of ['3005', '3004', '3024', '3023', '3039', '3040b', '4070', '3062b', '6141', '2412b', '54200']) {
    const mesh = gltf.scene.getObjectByName(`part_${id}`);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.side = DoubleSide;
    for (const socket of getPart(`ld_${id}`).connectors.filter(c => c.type === 'socket')) {
      for (const [x, z] of [[0, 0], [.19, 0], [-.19, 0], [0, .19], [0, -.19]]) {
        const origin = new Vector3(socket.position[0] + x, socket.position[1] - .01, socket.position[2] + z);
        ray.set(origin, new Vector3(0, 1, 0));
        const hit = ray.intersectObject(mesh, false)[0];
        assert.ok(!hit || hit.distance >= .19, `${id} socket at ${socket.position} collides before a 0.18-stud insertion: ${hit?.distance}`);
      }
    }
  }
});

function withinStud(point, definition) {
  return definition.connectors.filter(c => c.type === 'stud').some(c => {
    const delta = point.clone().sub(new Vector3(...c.position)), normal = new Vector3(...c.normal);
    const axial = delta.dot(normal), radial = delta.clone().addScaledVector(normal, -axial).length();
    return axial >= -1e-4 && axial <= definition.studHeight + 1e-4 && radial <= .301;
  });
}

function withinCompressedFrictionRib(point, definition) {
  const fit = definition.collisionFit;
  if (!fit?.frictionCompression) return false;
  const radial = Math.hypot(point.y - definition.sourceOriginInGame[1], point.z);
  return radial > fit.nominalShaftRadius && radial <= fit.nominalShaftRadius + fit.frictionCompression
    && fit.compressedShaftIntervals.some(([low, high]) => point.x >= low - 1e-5 && point.x <= high + 1e-5);
}

test('audited collision hulls contain exported body surfaces while leaving studs separate', async () => {
  const gltf = await meshes;
  for (const definition of PARTS.filter(p => p.collisionHulls)) {
    const hulls = definition.collisionHulls.map(points => { const hull = new ConvexHull().setFromPoints(points.map(p => new Vector3(...p))); hull.tolerance = 1e-4; return hull; });
    const mesh = gltf.scene.getObjectByName(`part_${definition.ldrawId}`), positions = mesh.geometry.attributes.position;
    const outside = [];
    for (let i = 0; i < positions.count; i++) {
      const point = new Vector3().fromBufferAttribute(positions, i);
      if (!withinStud(point, definition) && !withinCompressedFrictionRib(point, definition) && !hulls.some(hull => hull.containsPoint(point))) outside.push(point.toArray());
    }
    assert.equal(outside.length, 0, `${definition.id} omits real body vertices: ${JSON.stringify(outside.slice(0, 4))}`);
    for (const stud of definition.connectors.filter(c => c.type === 'stud')) {
      const point = new Vector3(...stud.position).addScaledVector(new Vector3(...stud.normal), .1);
      assert.equal(hulls.some(hull => hull.containsPoint(point)), false, `${definition.id} counts its stud as solid body`);
    }
  }
  const slope = new ConvexHull().setFromPoints(getPart('ld_3039').collisionHulls[0].map(p => new Vector3(...p)));
  assert.equal(slope.containsPoint(new Vector3(0, 1, .8)), false, 'Air above the sloped face remains free');
  const headlight = getPart('ld_4070').collisionHulls.map(h => new ConvexHull().setFromPoints(h.map(p => new Vector3(...p))));
  assert.equal(headlight.some(h => h.containsPoint(new Vector3(0, .7, .4))), false, 'The side-stud insertion volume is not a solid body box');
});

test('specialty bottom interfaces have real stud-sized cavities in the Blender export', async () => {
  const gltf = await meshes, ray = new Raycaster();
  const offsets = [[0, 0], ...Array.from({ length: 16 }, (_, i) => [.29 * Math.cos(i * Math.PI / 8), .29 * Math.sin(i * Math.PI / 8)])];
  for (const id of specialtyIds) {
    const mesh = gltf.scene.getObjectByName(`part_${id}`);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.side = DoubleSide;
    for (const socket of getPart(`ld_${id}`).connectors.filter(c => c.type === 'socket')) {
      let enclosingFaces = 0;
      for (const [x, z] of offsets) {
        ray.set(new Vector3(socket.position[0] + x, socket.position[1] - .01, socket.position[2] + z), new Vector3(0, 1, 0));
        const hit = ray.intersectObject(mesh, false)[0];
        if (hit) enclosingFaces++;
        assert.ok(!hit || hit.distance >= .2, `${id} obstructs a standard stud at ${socket.position}: ${hit?.distance}`);
      }
      assert.ok(enclosingFaces >= 16, `${id} marks empty space instead of a real socket`);
    }
  }
  assert.equal(getPart('ld_3938').connectors.some(c => c.type === 'socket'), false, 'The top hinge half has no standard bottom clutch');
});

test('standard upper, lower and side joins on specialty pieces clear their real body profiles', () => {
  for (const id of specialtyIds) {
    const target = { id: 'target', partId: `ld_${id}`, x: 0, y: 3, z: 0, rotation: 0 };
    for (const [index, connector] of getConnectionPoints(target).filter(c => ['stud', 'socket'].includes(c.type)).entries()) {
      const lower = connector.type === 'socket', side = connector.normal[2] === 1;
      const joined = { id: `joined-${index}`, partId: 'ld_3005', rotation: 0, ...(side ? { rotationX: 90 } : {}),
        x: connector.position[0], y: connector.position[1] - (lower ? 1.2 : 0), z: connector.position[2] };
      assert.ok(canPlace(joined, [target]), `${id} rejects its standard ${connector.type} at ${connector.position}`);
      assert.equal(getConnections([target, joined]).length, 1, `${id} has no fixed connection at ${connector.position}`);
      const penetrating = { ...joined, x: joined.x - connector.normal[0] * .05, y: joined.y - connector.normal[1] * .05, z: joined.z - connector.normal[2] * .05 };
      assert.equal(canPlace(penetrating, [target]), false, `${id} permits penetration past its ${connector.type} seat`);
    }
    if (!['11477', '4740'].includes(id)) assert.equal(getPart(target.partId).mechanicalConnectionStatus, ['3937', '3938'].includes(id) ? 'axis-only' : 'manual');
  }
});

test('mechanical engagement centres and axes follow actual LDraw pin and peghole transforms', () => {
  for (const id of ['2780', '3673', '43093', '6558']) {
    const actual = getPart(`ld_${id}`).mechanicalConnectors.filter(c => c.type === 'pin');
    const expected = ldrawPrimitives(id, /^(connect|confric4|confric5|confric6|confric8)\.dat$/i)
      .map(c => ({ ...c, position: c.position.map((v, i) => v + c.normal[i] * .5) }));
    assert.deepEqual(ordered(actual), ordered(expected), `${id} pin engagement datum differs from its primitive`);
  }
  for (const id of ['32316', '32523', '3700', '3701']) {
    const expected = ldrawPrimitives(id, /^peghole\.dat$/i).map(c => ({ ...c, position: c.position.map((v, i) => v - c.normal[i] * .5) }));
    assert.deepEqual(ordered(getPart(`ld_${id}`).mechanicalConnectors), ordered(expected), `${id} hole axis differs from its actual peghole mouths`);
  }
});

test('real exported mechanical bores have clear R6 cores and R8 mouths exactly 2 LDU deep', async () => {
  const gltf = await meshes, ray = new Raycaster();
  for (const id of ['32316', '32523', '3700', '3701']) {
    const definition = getPart(`ld_${id}`), mesh = gltf.scene.getObjectByName(definition.nodeName);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.side = DoubleSide;
    for (const bore of definition.mechanicalConnectors.filter(c => c.normal.some(n => n === 1))) {
      const axis = new Vector3(...bore.normal), u = new Vector3(1, 0, 0), v = new Vector3().crossVectors(axis, u);
      const centre = new Vector3(...bore.position);
      for (const radius of [.29, .31, .39, .41]) for (let i = 0; i < 32; i++) {
        const origin = centre.clone().addScaledVector(axis, -.75).addScaledVector(u, radius * Math.cos(i * Math.PI / 16)).addScaledVector(v, radius * Math.sin(i * Math.PI / 16));
        ray.set(origin, axis);
        const hit = ray.intersectObject(mesh, false)[0];
        if (radius === .29) assert.equal(hit, undefined, `${id} is not open through its nominal R6 core`);
        else {
          assert.ok(hit, `${id} lacks the measured bore wall at radius ${radius}`);
          const depth = Math.abs(hit.point.clone().sub(centre).dot(axis));
          // R=.39 grazes the export's .01-stud bevel around the R8 counterbore rim.
          const tolerance = radius === .39 ? .01 : .002;
          assert.ok(Math.abs(depth - (radius > .4 ? .5 : .4)) < tolerance, `${id} has a different counterbore step at R=${radius}: ${depth}`);
        }
      }
    }
  }
});

test('friction compression is bounded by actual ribs and leaves the collars and locking lips full size', async () => {
  const gltf = await meshes;
  for (const id of ['2780', '43093', '6558']) {
    const definition = getPart(`ld_${id}`), positions = gltf.scene.getObjectByName(definition.nodeName).geometry.attributes.position;
    let ribMax = 0, collarMax = 0, lipMax = 0;
    for (let i = 0; i < positions.count; i++) {
      const point = new Vector3().fromBufferAttribute(positions, i), radial = Math.hypot(point.y - definition.sourceOriginInGame[1], point.z);
      if (withinCompressedFrictionRib(point, definition)) ribMax = Math.max(ribMax, radial);
      if (radial > .39) collarMax = Math.max(collarMax, radial);
      if (Math.abs(point.x - definition.bbox[0][0]) < .11) lipMax = Math.max(lipMax, radial);
    }
    assert.ok(ribMax > .311 && ribMax < .313, `${id} does not have the measured .0125-stud friction interference`);
    assert.ok(collarMax > .399 && lipMax > .324, `${id} must retain its actual collar and locking lip`);
    assert.equal(definition.collisionFit.frictionCompression, .013);
  }
  assert.equal(getPart('ld_3673').collisionFit.frictionCompression, 0, 'The plain pin has no friction-rib exception');
});

test('hinge axis metadata matches the actual bearing cylinders without claiming unverified body mating', () => {
  for (const id of ['3937', '3938']) {
    const primitives = ldrawPrimitives(id, id === '3937' ? /^5-16cylo\.dat$/i : /^4-4cylo\.dat$/i)
      .filter(c => c.basisLengths.every(length => Math.abs(length - .2) < 1e-6))
      .map(c => ({ ...c, position: c.position.map((v, i) => v - c.normal[i] * .1) }));
    const expected = [...new Map(ordered(primitives).map(c => [JSON.stringify(c), c])).values()];
    assert.deepEqual(ordered(getPart(`ld_${id}`).mechanicalConnectors), expected);
    assert.equal(getPart(`ld_${id}`).mechanicalConnectionStatus, 'axis-only');
  }
  const female = getPart('ld_3937').mechanicalPivot, male = getPart('ld_3938').mechanicalPivot;
  assert.deepEqual(female.axis, male.axis);
  assert.deepEqual(female.position.map(round), male.position.map((v, i) => round(v + (i === 1 ? .4 : 0))), 'The closed raw LDraw pose has a common pivot');
});

test('every audited pin segment seats in every real round bore and offset shafts still hit the ring', () => {
  for (const holeId of ['32316', '32523', '3700', '3701']) {
    const target = { id: 'target', partId: `ld_${holeId}`, x: 0, y: 3, z: 0, rotation: 0 };
    for (const bore of getConnectionPoints(target).filter(c => c.type === 'pin-hole')) {
      for (const pinId of ['2780', '3673', '43093', '6558']) for (const segment of getPart(`ld_${pinId}`).mechanicalConnectors) {
        const orientation = new Quaternion().setFromUnitVectors(new Vector3(...segment.normal), new Vector3(...bore.normal).negate());
        const local = new Vector3(...segment.position).applyQuaternion(orientation);
        const seated = { id: 'seated', partId: `ld_${pinId}`, rotation: 0, quaternion: orientation.toArray(), x: bore.position[0] - local.x, y: bore.position[1] - local.y, z: bore.position[2] - local.z };
        assert.ok(canPlace(seated, [target]), `${pinId} segment ${segment.position} does not fit ${holeId} bore ${bore.position}`);
        assert.equal(getConnections([target, seated]).length, 1);
        assert.equal(canPlace({ ...seated, x: seated.x + .08 }, [target]), false, `${pinId} passes solid material beside ${holeId}'s bore`);
      }
    }
  }
  const tile = { id: 'tile', partId: 'ld_2431', x: 0, y: 0, z: 0, rotation: 0 };
  for (const id of ['2780', '3673', '43093', '6558']) {
    assert.ok(canPlace({ id: 'resting', partId: `ld_${id}`, x: 0, y: .4, z: 0, rotation: 0 }, [tile]), `${id} has a phantom collar protrusion below its visible bottom`);
  }
});

test('legacy asset aliases retain dimensions while their connectors and bounds follow the rendered asset rotation', async () => {
  const gltf = await meshes;
  for (const legacy of LEGACY_PARTS.filter(p => p.ldrawId)) {
    const rotation = new Quaternion().setFromEuler(new Euler(0, legacy.assetRotation * Math.PI / 180, 0));
    const expected = ldrawStuds(legacy.ldrawId).map(c => ({ position: new Vector3(...c.position).applyQuaternion(rotation).toArray(), normal: new Vector3(...c.normal).applyQuaternion(rotation).toArray() }));
    const instance = { id: 'legacy', partId: legacy.id, rotation: 0, x: 0, y: 0, z: 0 };
    assert.deepEqual(ordered(getConnectionPoints(instance).filter(c => c.type === 'stud')), ordered(expected), legacy.id);
    const mesh = gltf.scene.getObjectByName(`part_${legacy.ldrawId}`), positions = mesh.geometry.attributes.position, bounds = getBounds(instance, true);
    for (let i = 0; i < positions.count; i++) {
      const point = new Vector3().fromBufferAttribute(positions, i).applyQuaternion(rotation);
      assert.ok(point.x >= bounds.minX - 1e-4 && point.x <= bounds.maxX + 1e-4 && point.y >= bounds.minY - 1e-4 && point.y <= bounds.maxY + 1e-4 && point.z >= bounds.minZ - 1e-4 && point.z <= bounds.maxZ + 1e-4, `${legacy.id} render leaves declared bbox`);
    }
  }
  assert.equal(getPart('slope22').connectors.filter(c => c.type === 'stud').length, 2, 'Old saved slopes use the two real rear studs');
  assert.equal(getPart('brick12').width, 1);
  assert.equal(getPart('brick12').depth, 2);
});
