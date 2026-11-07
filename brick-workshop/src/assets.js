import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { registerPartMetadata } from './catalog.js';

const templates = new Map();
let metadata = new Map();
let loaded;
let demoData;
const loader = new GLTFLoader();

export async function loadPartAssets(onProgress = () => {}) {
  if (loaded) return loaded;
  loaded = (async () => {
    onProgress('正在载入 Blender 零件…');
    const [gltf, response] = await Promise.all([
      loader.loadAsync('/assets/parts.glb'), fetch('/assets/catalog-data.json'),
    ]);
    if (!response.ok) throw new Error('零件目录加载失败，请刷新重试。');
    const data = await response.json();
    const records = Array.isArray(data) ? data : Array.isArray(data.parts) ? data.parts : Object.values(data.parts ?? data);
    metadata = new Map(records.filter(p => p && p.id).map(p => [String(p.id), p]));
    gltf.scene.traverse(object => {
      if (/^part_/.test(object.name)) templates.set(object.name.slice(5), object);
    });
    if (templates.size < 47) throw new Error('零件模型不完整，请刷新后重新载入。');
    onProgress('零件已就绪');
    return { count: templates.size, metadata };
  })().catch(error => { loaded = null; throw error; });
  return loaded;
}

export function getAssetMetadata(id) { return metadata.get(String(id)); }

export function createAssetMesh(def, color) {
  const id = String(def.ldrawId ?? def.assetId ?? def.id.replace(/^ld_/, ''));
  const template = templates.get(id);
  if (!template) return null;
  const group = new THREE.Group();
  const object = template.clone(true);
  object.position.set(0, 0, 0);
  object.quaternion.identity();
  object.rotation.y=(def.assetRotation??0)*Math.PI/180;
  object.scale.set(1, 1, 1);
  object.traverse(child => {
    if (!child.isMesh) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const cloned = materials.map(original => {
      const material = original.clone();
      if (material.color && color) {
        const tint = material.transmission > 0.2 && color.toLowerCase() === '#515962' ? '#c99b32' : color;
        material.color.set(tint);
      }
      material.roughness = material.transmission > 0.2 ? 0.16 : 0.3;
      material.metalness = 0;
      material.envMapIntensity = 0.4;
      return material;
    });
    child.material = Array.isArray(child.material) ? cloned : cloned[0];
    child.castShadow = true;
    child.receiveShadow = true;
  });
  group.add(object);
  group.name = def.name;
  group.userData.definition = def;
  group.userData.isPart = true;
  group.userData.blenderAsset = id;
  return group;
}

export async function loadTransformerDemo() {
  if (demoData) return demoData;
  await loadPartAssets();
  const response = await fetch('/assets/transformer_demo.json');
  if (!response.ok) throw new Error('示例模型尚未载入，请稍后重试。');
  const [data, gltf, extra] = await Promise.all([response.json(), loader.loadAsync('/assets/demo-parts.glb'), fetch('/assets/demo-catalog-data.json').then(r=>{if(!r.ok)throw new Error('示例零件资料加载失败');return r.json();})]);
  registerPartMetadata(extra.parts);
  extra.parts.forEach(p=>metadata.set(String(p.id),p));
  gltf.scene.traverse(object => {
    if (/^part_/.test(object.name)) templates.set(object.name.slice(5), object);
  });
  demoData = data;
  return data;
}
