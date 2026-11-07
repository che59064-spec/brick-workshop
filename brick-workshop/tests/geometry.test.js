import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PARTS, getPart } from '../src/catalog.js';
import { createPartMesh, setPartAppearance, disposePartMesh } from '../src/geometry.js';

test('all catalog parts have finite geometry aligned to their declared footprint', () => {
  for (const def of PARTS) {
    const part = createPartMesh(def);
    const bounds = new THREE.Box3().setFromObject(part);
    const size = bounds.getSize(new THREE.Vector3());
    assert.ok([size.x, size.y, size.z, bounds.min.y].every(Number.isFinite), def.id);
    assert.ok(size.x <= def.width + 0.08, `${def.id} width ${size.x}`);
    assert.ok(size.z <= def.depth + 0.08, `${def.id} depth ${size.z}`);
    assert.ok(bounds.min.y > -0.025, `${def.id} bottom ${bounds.min.y}`);
    assert.ok(bounds.max.y <= def.height + (def.studs ? 0.2 : 0.03), `${def.id} height ${bounds.max.y}`);
    disposePartMesh(part);
  }
});

test('instances reuse geometry but selection and ghost colors remain independent', () => {
  const a = createPartMesh(getPart('brick24'), '#515962');
  const b = createPartMesh(getPart('brick24'), '#515962');
  assert.equal(a.children[0].geometry, b.children[0].geometry);
  assert.notEqual(a.children[0].material, b.children[0].material);
  const initial = b.children[0].material.color.getHexString();
  setPartAppearance(a, { ghost: true, valid: false });
  assert.equal(b.children[0].material.color.getHexString(), initial);
  assert.equal(a.children[0].material.opacity, 0.44);
  setPartAppearance(a, { selected: true });
  assert.equal(a.children[0].material.color.getHexString(), initial);
  assert.equal(a.children[0].material.opacity, 1);
  let sharedDisposed = false;
  b.children[0].geometry.addEventListener('dispose', () => { sharedDisposed = true; });
  disposePartMesh(a);
  assert.equal(sharedDisposed, false);
  assert.equal(b.children[0].material.opacity, 1);
  disposePartMesh(b);
});
