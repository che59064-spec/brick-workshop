import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createModuleVisuals, MODULE_COLORS } from '../src/module-visuals.js';
import { getFocusDistance } from '../src/scene.js';

const definition = { width: .6, depth: .6, height: 1.2, bbox: [[-.3, 0, -.3], [.3, 1.4, .3]] };

test('mounted module glyphs fit small pieces, stay above their asset and use distinct shapes', () => {
  const visuals = createModuleVisuals(), shapes = new Set();
  for (const type of Object.keys(MODULE_COLORS)) {
    const marker = visuals.create(type, definition), box = new THREE.Box3().setFromObject(marker), size = box.getSize(new THREE.Vector3());
    assert.ok(size.x < definition.width && size.z < definition.depth, type);
    assert.ok(box.min.y >= 1.4 && box.max.y < 1.7, type);
    assert.ok([size.x, size.y, size.z].every(Number.isFinite));
    shapes.add(marker.userData.glyph.children.map(o => o.geometry?.type ?? o.type).join(','));
    marker.traverse(object => { if (object.isMesh) { const hits = []; object.raycast(new THREE.Raycaster(), hits); assert.equal(hits.length, 0); } });
  }
  assert.equal(shapes.size, 4);
  assert.equal(visuals.create('unknown', definition), null);
  visuals.dispose();
});

test('module state is instance-local and replacing or deleting a role disposes only its materials', () => {
  const visuals = createModuleVisuals(), a = visuals.create('battery', definition), b = visuals.create('battery', definition);
  const scene = new THREE.Scene(); scene.add(a, b);
  assert.equal(a.userData.glyph.children[0].geometry, b.userData.glyph.children[0].geometry);
  assert.notEqual(a.userData.indicator, b.userData.indicator);
  visuals.setState(a, { powered: true, working: true, charge: .4 });
  assert.equal(a.userData.state, 'working'); assert.equal(b.userData.state, 'unpowered');
  assert.deepEqual(a.userData.bars.map(bar => bar.visible), [true, true, false]);
  assert.ok(a.userData.indicator.emissiveIntensity > b.userData.indicator.emissiveIntensity);
  const shared = a.userData.glyph.children[0].geometry; let geometryDisposals = 0, ownMaterialDisposals = 0;
  shared.addEventListener('dispose', () => geometryDisposals++);
  a.userData.indicator.addEventListener('dispose', () => ownMaterialDisposals++);
  visuals.remove(a); visuals.remove(a);
  assert.equal(scene.children.length, 1); assert.equal(ownMaterialDisposals, 1); assert.equal(geometryDisposals, 0);
  const replacement = visuals.create('servo', definition); scene.add(replacement); visuals.setState(replacement, { powered: true, progress: 1 });
  assert.ok(replacement.userData.arm.rotation.y > 0); assert.equal(replacement.userData.state, 'powered');
  visuals.remove(replacement); assert.deepEqual(scene.children, [b]);
  visuals.dispose(); visuals.dispose(); assert.equal(scene.children.length, 0); assert.equal(geometryDisposals, 1);
  assert.equal(visuals.create('servo', definition), null);
});

test('camera fit contains every box corner at wide and portrait ratios without over-scaling tall objects', () => {
  const box = new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 12, 1));
  const direction = new THREE.Vector3(.65, .58, .9).normalize(), center = box.getCenter(new THREE.Vector3());
  const distances = [];
  for (const aspect of [16 / 9, 390 / 738]) {
    const camera = new THREE.PerspectiveCamera(38, aspect, .1, 600), distance = getFocusDistance(box, direction, aspect, camera.fov, 1.2);
    distances.push(distance); camera.position.copy(center).addScaledVector(direction, distance); camera.lookAt(center); camera.updateMatrixWorld(true);
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const point = new THREE.Vector3(x, y, z).project(camera);
      assert.ok(Math.abs(point.x) < 1 && Math.abs(point.y) < 1 && point.z < 1, `${aspect}: ${point.toArray()}`);
    }
  }
  assert.ok(distances[1] < distances[0] * 1.2, distances.join(','));
});
