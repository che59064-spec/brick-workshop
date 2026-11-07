import test from 'node:test';
import assert from 'node:assert/strict';
import { PARTS, getPart, getFootprint } from '../src/catalog.js';
import {
  createDocument, validateDocument, serializeDocument, getBounds, canPlace,
  getConnections, getAssemblyStats, snapPlacement, createExample,
} from '../src/model.js';

const piece = (id, partId = 'brick22', overrides = {}) => ({ id, partId, x: 0.5, y: 0, z: 0.5, rotation: 0, color: '#515962', ...overrides });

test('catalog has distinct definitions and all physical dimensions are valid', () => {
  assert.equal(new Set(PARTS.map(p => p.id)).size, PARTS.length);
  assert.ok(PARTS.length >= 18);
  for (const p of PARTS) {
    assert.ok(p.width > 0 && p.depth > 0 && p.height > 0 && p.weight > 0);
    for (const [ix, iz] of getFootprint(p)) assert.ok(ix >= 0 && ix < p.width && iz >= 0 && iz < p.depth);
  }
});

test('quarter rotation exchanges width and depth', () => {
  assert.deepEqual(getBounds(piece('a', 'brick24', { rotation: 90 })), {
    minX: -1.5, maxX: 2.5, minY: 0, maxY: 1.2, minZ: -0.5, maxZ: 1.5, width: 4, depth: 2, height: 1.2,
  });
});

test('collisions reject overlap but allow face contact and replacement ignoring its ID', () => {
  const a = piece('a');
  assert.equal(canPlace(piece('b'), [a]), false);
  assert.equal(canPlace(piece('b', 'brick22', { x: 2.5 }), [a]), true);
  assert.equal(canPlace(piece('b', 'brick22', { y: 1.2 }), [a]), true);
  assert.equal(canPlace(a, [a], 'a'), true);
  assert.equal(canPlace(piece('b', 'brick22', { y: -0.4 }), []), false);
});

test('L concavity is available to other parts while its arms block overlap', () => {
  const l = piece('l', 'lbeam33', { x: 0, z: 0 });
  assert.equal(canPlace(piece('hole', 'brick11', { x: 0, z: 0 }), [l]), true);
  assert.equal(canPlace(piece('arm', 'brick11', { x: -1, z: 0 }), [l]), false);
  const rotated = { ...l, rotation: 90 };
  assert.equal(canPlace(piece('hole', 'brick11', { x: 0, z: 0 }), [rotated]), true);
  assert.equal(canPlace(piece('arm', 'brick11', { x: 0, z: 1 }), [rotated]), false);
});

test('polygon collision uses wing outline rather than its entire bounding rectangle', () => {
  const wing = piece('wing', 'wing46', { x: 0, z: 0 });
  assert.equal(canPlace(piece('outside', 'brick11', { x: 1.5, z: -2.5 }), [wing]), true);
  assert.equal(canPlace(piece('inside', 'brick11', { x: -1.5, z: -2.5 }), [wing]), false);
});

test('fixed connections require matching upper-bottom and lower stud centers', () => {
  const lower = piece('a');
  const upper = piece('b', 'brick22', { y: 1.2 });
  assert.deepEqual(getConnections([lower, upper]), [{ a: 'a', b: 'b', studs: 4 }]);
  assert.equal(getConnections([lower, { ...upper, x: 0.75 }]).length, 0);
  assert.equal(getConnections([lower, { ...upper, y: 1.6 }]).length, 0);
  const tile = piece('tile', 'tile22');
  assert.equal(getConnections([tile, { ...upper, y: 0.4 }]).length, 0);
});

test('a spanning plate can join two independent lower assemblies', () => {
  const a = piece('a', 'brick11', { x: 0, z: 0 });
  const b = piece('b', 'brick11', { x: 1, z: 0 });
  const bridge = piece('c', 'plate12', { x: 0.5, y: 1.2, z: 0, rotation: 90 });
  assert.equal(getAssemblyStats([a, b]).assemblies, 2);
  assert.equal(getAssemblyStats([a, b, bridge]).assemblies, 1);
  assert.equal(getAssemblyStats([a, b, bridge]).connections, 2);
  assert.equal(getAssemblyStats([bridge]).floatingAssemblies, 1);
});

test('snapping follows stud grid parity, surface heights and optional free placement', () => {
  assert.deepEqual(snapPlacement({ partId: 'brick12', rotation: 90, point: { x: 0.2, y: 0, z: 0.2 } }), {
    partId: 'brick12', rotation: 90, x: 0.5, y: 0, z: 0,
  });
  assert.equal(snapPlacement({ partId: 'brick11', point: { x: 0, y: 99, z: 0 }, hitPart: piece('a') }).y, 1.2);
  const freeLower = piece('free', 'brick22', { x: 0.63, y: 0.17, z: 0.29 });
  const atopFree = { ...snapPlacement({ partId: 'brick22', point: { x: 0.63, y: 1.37, z: 0.29 }, hitPart: freeLower }), id: 'upper', color: '#515962' };
  assert.equal(atopFree.y, 1.37);
  assert.equal(atopFree.x, 0.63);
  assert.equal(atopFree.z, 0.29);
  assert.equal(canPlace(atopFree, [freeLower]), true);
  assert.equal(getConnections([freeLower, atopFree])[0].studs, 4);
  assert.deepEqual(snapPlacement({ partId: 'brick11', point: { x: 0.13, y: 0.17, z: -0.21 }, snap: false }), {
    partId: 'brick11', rotation: 0, x: 0.13, y: 0.17, z: -0.21,
  });
});

test('saving and loading clone the complete accepted document', () => {
  const doc = { ...createDocument(' 我的作品 '), parts: [piece('a', 'brick24', { rotation: 270, color: '#DDAA33' })] };
  const restored = validateDocument(serializeDocument(doc));
  assert.equal(restored.name, '我的作品');
  assert.equal(restored.parts[0].rotation, 270);
  assert.equal(restored.parts[0].color, '#ddaa33');
  restored.parts[0].x = 20;
  assert.equal(doc.parts[0].x, 0.5);
});

test('invalid imports fail without changing current objects', () => {
  const original = { ...createDocument(), parts: [piece('a')] };
  const before = JSON.stringify(original);
  for (const value of [
    { ...original, version: 4 },
    { ...original, parts: [piece('a'), piece('a', 'brick11', { x: 9 })] },
    { ...original, parts: [piece('a', 'unknown')] },
    { ...original, parts: [piece('a', 'brick11', { x: Infinity })] },
    { ...original, parts: [piece('a', 'brick11', { x: 201 })] },
    { ...original, parts: [piece('a', 'brick11', { rotation: 45 })] },
    { ...original, parts: [piece('a', 'brick11', { color: 'red' })] },
    { ...original, parts: [piece('a'), piece('b')] },
    { ...original, parts: Array.from({ length: 1001 }, (_, i) => piece(`${i}`)) },
    'not json',
  ]) assert.throws(() => validateDocument(value));
  assert.equal(JSON.stringify(original), before);
});

test('example uses only catalog parts, has no overlaps and is one connected assembly', () => {
  const doc = createExample();
  assert.ok(doc.parts.length >= 10);
  assert.ok(doc.parts.every(p => getPart(p.partId)));
  doc.parts.forEach((p, i) => assert.equal(canPlace(p, doc.parts.slice(0, i)), true, p.id));
  assert.equal(getAssemblyStats(doc.parts).assemblies, 1);
  assert.deepEqual(validateDocument(serializeDocument(doc)), doc);
});
