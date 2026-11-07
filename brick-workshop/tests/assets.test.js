import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createDemoRuntime } from '../src/demo.js';
import { registerPartMetadata } from '../src/catalog.js';
import { validateDocument, createDocument } from '../src/model.js';
test('the game loads 47 real independent Blender mesh nodes with finite normals',async()=>{
  const bytes=await readFile(new URL('../public/assets/parts.glb',import.meta.url));
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  assert.equal(gltf.scene.children.length,47);
  for(const part of gltf.scene.children){assert.match(part.name,/^part_/);assert.equal(part.isMesh,true);assert.ok(part.geometry.attributes.normal);assert.ok(part.geometry.attributes.position.count>12);assert.deepEqual(part.scale.toArray(),[1,1,1]);}
});
test('Blender demo preserves all 77 part IDs through local hierarchy animation and can enter free build',async()=>{
  const data=JSON.parse(await readFile(new URL('../public/assets/transformer_demo.json',import.meta.url),'utf8'));
  const extra=JSON.parse(await readFile(new URL('../public/assets/demo-catalog-data.json',import.meta.url),'utf8'));registerPartMetadata(extra.parts);
  const runtime=createDemoRuntime(data),a=runtime.evaluate(0),mid=runtime.evaluate(.55),b=runtime.evaluate(1),back=runtime.evaluate(0);
  assert.equal(a.size,77);assert.equal(mid.size,77);assert.equal(b.size,77);assert.deepEqual(a,back);
  assert.ok([...a].some(([id,value])=>Math.abs(value.matrix[13]-b.get(id).matrix[13])>1));
  assert.ok([...mid.values()].every(value=>value.matrix.every(Number.isFinite)));
  const document=validateDocument({...createDocument(),parts:runtime.parts});assert.equal(document.parts.length,77);
  for(const pose of data.poses){const actual=runtime.evaluate(pose.t);for(const expected of pose.nodes.filter(n=>actual.has(n.id))){assert.ok(actual.get(expected.id).matrix.every((n,i)=>Math.abs(n-expected.worldMatrix[i])<2e-5));}}
});
