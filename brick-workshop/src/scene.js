import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { createPartMesh, setPartAppearance, disposePartMesh } from './geometry.js';
import { getPart } from './catalog.js';
import { createModuleVisuals } from './module-visuals.js';
import { pickStudConnector, pickMechanicalConnector } from './connector-picking.js';

/** Smallest perspective distance that fits the box in both camera axes. */
export function getFocusDistance(box, direction, aspect, fov, padding = 1.2) {
  if (box.isEmpty()) return 0;
  const towardCamera = direction.clone().normalize(), right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), towardCamera);
  if (right.lengthSq() < 1e-10) right.set(1, 0, 0); else right.normalize();
  const up = new THREE.Vector3().crossVectors(towardCamera, right), center = box.getCenter(new THREE.Vector3());
  const tangentY = Math.tan(THREE.MathUtils.degToRad(fov / 2)), tangentX = tangentY * Math.max(.01, aspect);
  let distance = 0;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const point = new THREE.Vector3(x, y, z).sub(center), depth = point.dot(towardCamera);
    distance = Math.max(distance, depth + Math.abs(point.dot(right)) * padding / tangentX, depth + Math.abs(point.dot(up)) * padding / tangentY);
  }
  return distance + .1;
}

function grainTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d'), data = context.createImageData(256, 256); let seed = 9361;
  for (let i = 0; i < data.data.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    const value = 242 + ((seed >>> 24) % 13);
    data.data[i] = data.data[i + 1] = data.data[i + 2] = value; data.data[i + 3] = 255;
  }
  context.putImageData(data, 0, 0);
  const texture = new THREE.CanvasTexture(canvas); texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(50, 50); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

export function createWorkshopScene(container, callbacks = {}) {
  const world = new THREE.Scene(); world.background = new THREE.Color('#c5c2b2');
  const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
  renderer.domElement.setAttribute('aria-label', '3D积木工作台'); renderer.domElement.tabIndex = 0; container.append(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(38, 1, .1, 600); camera.position.set(16, 17, 22);
  const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 0, 0);
  controls.enableDamping = true; controls.dampingFactor = .12; controls.minDistance = 4; controls.maxDistance = 140; controls.maxPolarAngle = Math.PI / 2 - .025;
  controls.mouseButtons.LEFT = null; controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE; controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
  controls.touches.ONE = THREE.TOUCH.ROTATE; controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  const env = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(renderer), envTarget = pmrem.fromScene(env, .04);
  world.environment = envTarget.texture; world.environmentIntensity = .28; env.dispose(); pmrem.dispose();
  world.add(new THREE.HemisphereLight('#fff8e5', '#606256', .4));
  const sun = new THREE.DirectionalLight('#fff8e9', 3); sun.position.set(-10, 20, 12); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -21, right: 21, top: 21, bottom: -21, far: 90 }); sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.normalBias = .008; sun.shadow.bias = -.0001; sun.shadow.radius = 3; world.add(sun, sun.target);
  const fill = new THREE.DirectionalLight('#e6ebe3', .4); fill.position.set(14, 7, -12); world.add(fill);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: '#d3d0bd', map: grainTexture(), roughness: .95 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -.035; floor.receiveShadow = true; world.add(floor);
  const grid = new THREE.GridHelper(40, 40, '#999e8e', '#b5b8a8'); grid.position.y = -.018; grid.material.transparent = true; grid.material.opacity = .36; world.add(grid);
  const composer = new EffectComposer(renderer); composer.addPass(new RenderPass(world, camera));
  const ao = new SSAOPass(world, camera, 600, 600); ao.kernelRadius = .55; ao.minDistance = .002; ao.maxDistance = .08; composer.addPass(ao); composer.addPass(new OutputPass());
  const antialias = new ShaderPass(FXAAShader); composer.addPass(antialias);
  const objects = new Map(), baseMatrices = new Map();
  const moduleVisuals = createModuleVisuals(), modules = new Map(), moduleLayer = new THREE.Group(); world.add(moduleLayer);
  const courseVehicle = { x: 0, z: 0, yaw: 0 }, motionCenter = new THREE.Vector3();
  let lastBattery = null, lastPose = null;
  let parts = [], selectedId = null, hiddenIds = new Set(), shouldRender = true, pointerDown = null, lastPointer = null, follow = true, sceneMode = 'build';
  const ghosts=new Map();
  const lastMotion = new THREE.Vector3(), raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), placementPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const pivotGizmo = new THREE.Group(); pivotGizmo.visible = false; world.add(pivotGizmo);
  const gizmoRing = new THREE.Mesh(new THREE.TorusGeometry(.7, .026, 8, 64), new THREE.MeshBasicMaterial({ color: '#0a84ff', depthTest: false })); pivotGizmo.add(gizmoRing);
  pivotGizmo.add(new THREE.Mesh(new THREE.SphereGeometry(.08, 12, 8), new THREE.MeshBasicMaterial({ color: '#a0d3ff', depthTest: false })));
  const testField = new THREE.Group(); testField.visible = false; world.add(testField);
  const gates = [[0, -7], [6, -14], [14, -10], [15, 1], [5, 6]].map(([x, z], i) => {
    const group = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.45, .055, 10, 64), new THREE.MeshStandardMaterial({ color: '#e8b642', emissive: '#70501b', emissiveIntensity: .3, roughness: .45 })); ring.position.y = 1.6; group.add(ring);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(.15, .24, .15, 16), new THREE.MeshStandardMaterial({ color: '#798269' })); base.position.y = .08; group.add(base);
    group.position.set(x, 0, z); group.userData = { index: i, x, z, collected: false }; testField.add(group); return group;
  });
  function context(event) {
    const rect = renderer.domElement.getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); raycaster.setFromCamera(pointer, camera);
    const ground = raycaster.ray.intersectPlane(plane, new THREE.Vector3()), hit = raycaster.intersectObjects([...objects.values()].filter(o => o.visible), true)[0]; let hitPart = null, normal = null;
    if (hit) { let item = hit.object; while (item && !item.userData.instanceId) item = item.parent; hitPart = parts.find(p => p.id === item?.userData.instanceId) ?? null; normal = hit.face?.normal.clone().transformDirection(hit.object.matrixWorld).toArray(); }
    const pickOptions={origin:raycaster.ray.origin.toArray(),direction:raycaster.ray.direction.toArray(),parts:parts.filter(p=>objects.get(p.id)?.visible),meshHitDistance:hit?.distance??null};
    const connector=sceneMode==='build'?[pickStudConnector(pickOptions),pickMechanicalConnector(pickOptions)].filter(Boolean).sort((a,b)=>a.distance-b.distance)[0]:null;
    if(connector){hitPart=connector.part;normal=connector.normal;}
    const placement = raycaster.ray.intersectPlane(placementPlane,new THREE.Vector3());
    return { point: connector?.point ?? hit?.point.toArray() ?? ground?.toArray() ?? null, groundPoint: ground?.toArray() ?? null, placementPoint:placement?.toArray()??null, hitPart, normal };
  }
  renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
  renderer.domElement.addEventListener('pointerdown', e => { pointerDown = { x: e.clientX, y: e.clientY, button: e.button }; });
  renderer.domElement.addEventListener('pointermove', e => { lastPointer = { clientX: e.clientX, clientY: e.clientY }; callbacks.onHover?.(context(e)); });
  renderer.domElement.addEventListener('pointerleave', () => { lastPointer = null; ghosts.forEach(ghost=>{ghost.visible=false;});shouldRender = true; callbacks.onLeave?.(); });
  renderer.domElement.addEventListener('pointerup', e => { if (pointerDown?.button === 0 && Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y) < 6) callbacks.onClick?.(context(e)); pointerDown = null; });
  controls.addEventListener('change', () => {
    shouldRender = true;camera.updateMatrixWorld();
    if(lastPointer)callbacks.onHover?.(context(lastPointer));
  });
  const observer = new ResizeObserver(() => { const { width, height } = container.getBoundingClientRect(); if (!width || !height) return; renderer.setSize(width, height); composer.setSize(width, height); const ratio = renderer.getPixelRatio(); antialias.uniforms.resolution.value.set(1 / (width * ratio), 1 / (height * ratio)); camera.aspect = width / height; camera.updateProjectionMatrix(); if (parts.length) focus(); shouldRender = true; }); observer.observe(container);
  function syncModule(part, object) {
    const type = part.function?.type; let marker = modules.get(part.id);
    if (marker && (marker.userData.type !== type || marker.userData.partId !== part.partId)) { moduleVisuals.remove(marker); modules.delete(part.id); marker = null; }
    if (!marker && type) { marker = moduleVisuals.create(type, getPart(part.partId)); if (marker) { marker.matrixAutoUpdate = false; marker.userData.partId = part.partId; modules.set(part.id, marker); moduleLayer.add(marker); } }
    if (marker) { marker.matrix.copy(object.matrix); marker.visible = object.visible; marker.updateMatrixWorld(true); }
  }
  function updateModules() { for (const [id, marker] of modules) { const object = objects.get(id); if (object) { marker.matrix.copy(object.matrix); marker.visible = object.visible; marker.updateMatrixWorld(true); } } }
  function setParts(next) {
    parts = next; const ids = new Set(next.map(p => p.id));
    for (const [id, object] of objects) if (!ids.has(id)) { world.remove(object); disposePartMesh(object); objects.delete(id); baseMatrices.delete(id); const marker = modules.get(id); if (marker) { moduleVisuals.remove(marker); modules.delete(id); } }
    for (const part of next) {
      let object = objects.get(part.id); const key = `${part.partId}:${part.color}`;
      if (!object || object.userData.key !== key) { if (object) { world.remove(object); disposePartMesh(object); } object = createPartMesh(getPart(part.partId), part.color); object.userData.instanceId = part.id; object.userData.key = key; objects.set(part.id, object); world.add(object); }
      object.position.set(part.x, part.y, part.z); if(part.quaternion)object.quaternion.fromArray(part.quaternion);else object.rotation.set((part.rotationX ?? 0) * Math.PI / 180, part.rotation * Math.PI / 180, (part.rotationZ ?? 0) * Math.PI / 180); object.updateMatrix(); baseMatrices.set(part.id, object.matrix.clone());
      object.visible = !hiddenIds.has(part.id); setPartAppearance(object, { selected: part.id === selectedId }); object.updateMatrixWorld(true);
      syncModule(part, object);
    }
    shouldRender = true;
  }
  function setTransforms(transforms) {
    for (const [id, object] of objects) { const value = transforms?.get?.(id) ?? transforms?.[id]; const matrix = value ? new THREE.Matrix4().fromArray(value.matrix ?? value) : baseMatrices.get(id); if (matrix) matrix.decompose(object.position, object.quaternion, object.scale); object.updateMatrixWorld(true); }
    updateModules();
    shouldRender = true;
  }
  function select(id) { selectedId = id; for (const [key, object] of objects) setPartAppearance(object, { selected: key === id }); shouldRender = true; }
  function showGhost(candidate, valid) {
    showGhosts(candidate?[candidate]:[],valid);
  }
  function showGhosts(candidates,valid) {
    const ids=new Set(candidates.map(p=>p.id));
    for(const [id,ghost] of ghosts)if(!ids.has(id)){world.remove(ghost);disposePartMesh(ghost);ghosts.delete(id);}
    for(const candidate of candidates){
      const key=`${candidate.partId}:${candidate.color}`;let ghost=ghosts.get(candidate.id);
      if(!ghost||ghost.userData.ghostKey!==key){if(ghost){world.remove(ghost);disposePartMesh(ghost);}ghost=createPartMesh(getPart(candidate.partId),candidate.color,{ghost:true});ghost.userData.ghostKey=key;ghosts.set(candidate.id,ghost);world.add(ghost);}
      ghost.visible=true;ghost.position.set(candidate.x,candidate.y,candidate.z);
      if(candidate.quaternion)ghost.quaternion.fromArray(candidate.quaternion);else ghost.rotation.set((candidate.rotationX??0)*Math.PI/180,candidate.rotation*Math.PI/180,(candidate.rotationZ??0)*Math.PI/180);
      setPartAppearance(ghost,{ghost:true,valid});
    }
    shouldRender=true;
  }
  function setHidden(ids) { hiddenIds = new Set(Array.isArray(ids)?ids:ids?[ids]:[]);for (const [key, object] of objects) object.visible = !hiddenIds.has(key);updateModules();shouldRender = true; }
  function setJointGizmo(joint) { pivotGizmo.visible = !!joint; if (joint) { pivotGizmo.position.fromArray(joint.pivot); gizmoRing.rotation.set(0, 0, 0); if (joint.axis === 'x') gizmoRing.rotation.y = Math.PI / 2; if (joint.axis === 'y') gizmoRing.rotation.x = Math.PI / 2; } shouldRender = true; }
  function view(name) { const distance = camera.position.distanceTo(controls.target); const direction = name === 'top' ? new THREE.Vector3(.001, 1, .001) : name === 'front' ? new THREE.Vector3(0, .15, 1) : new THREE.Vector3(.65, .58, .9); camera.position.copy(controls.target).add(direction.normalize().multiplyScalar(distance)); controls.update(); shouldRender = true; }
  function focus(poses = []) {
    if (!parts.length) { controls.target.set(0, 0, 0); camera.position.set(16, 17, 22); }
    else {
      const box = new THREE.Box3(); objects.forEach(o => box.expandByObject(o));
      if (poses.length) {
        const current = new Map([...objects].map(([id, object]) => [id, object.matrix.clone().toArray()]));
        for (const pose of poses) { setTransforms(pose); objects.forEach(o => box.expandByObject(o)); }
        setTransforms(current);
      }
      const center = box.getCenter(new THREE.Vector3()), direction = camera.position.clone().sub(controls.target).normalize(); controls.target.copy(center);
      const distance = getFocusDistance(box, direction, camera.aspect, camera.fov, sceneMode === 'joints' ? 1.35 : 1.2); camera.position.copy(center).add(direction.multiplyScalar(Math.max(sceneMode === 'test' ? 26 : 9, distance)));
    }
    controls.update(); shouldRender = true;
  }
  function setMotion(state, activePartIds, transforms) {
    const ids = new Set(activePartIds ?? parts.map(p => p.id)), active = parts.filter(p => ids.has(p.id)); if (!active.length) return 0;
    const center = new THREE.Vector3(active.reduce((s, p) => s + p.x, 0) / active.length, 0, active.reduce((s, p) => s + p.z, 0) / active.length);
    motionCenter.copy(center); Object.assign(courseVehicle, { x: center.x + state.x, z: center.z + state.z, yaw: state.yaw });
    const matrix = new THREE.Matrix4().makeTranslation(center.x + state.x, state.y, center.z + state.z).multiply(new THREE.Matrix4().makeRotationY(state.yaw)).multiply(new THREE.Matrix4().makeTranslation(-center.x, 0, -center.z));
    for (const [id, object] of objects) { const value = transforms?.get(id); const base = value ? new THREE.Matrix4().fromArray(value.matrix) : baseMatrices.get(id), pose = ids.has(id) ? matrix.clone().multiply(base) : baseMatrices.get(id); pose.decompose(object.position, object.quaternion, object.scale); object.updateMatrixWorld(true); }
    updateModules();
    if (follow) { const delta = new THREE.Vector3(state.x, state.y * .4, state.z).sub(lastMotion); controls.target.add(delta); camera.position.add(delta); }
    lastMotion.set(state.x, state.y * .4, state.z); sun.position.set(-10 + state.x, 20 + state.y, 12 + state.z); sun.target.position.set(state.x, state.y, state.z);
    let collected = 0;
    for (const gate of gates) { if (!gate.userData.collected && Math.hypot(center.x + state.x - gate.userData.x, center.z + state.z - gate.userData.z) < 2.3 && state.y < 3) { gate.userData.collected = true; gate.visible = false; } if (gate.userData.collected) collected++; }
    shouldRender = true; return collected;
  }
  function resetMotion() { lastMotion.set(0, 0, 0); Object.assign(courseVehicle, { x: motionCenter.x, z: motionCenter.z, yaw: 0 }); lastBattery = lastPose = null; setTransforms(null); setFunctionState(null); sun.position.set(-10, 20, 12); sun.target.position.set(0, 0, 0); gates.forEach(gate => { gate.visible = true; gate.userData.collected = false; }); shouldRender = true; }
  function setFunctionState(state, activePartIds = []) {
    const active = new Set(activePartIds), draining = !!state && lastBattery !== null && state.battery < lastBattery - 1e-8;
    const movingServo = !!state && lastPose !== null && Math.abs(state.poseProgress - lastPose) > 1e-6;
    for (const [id, marker] of modules) {
      const powered = !!state?.powered && active.has(id), type = marker.userData.type;
      const working = powered && (type === 'battery' ? draining : type === 'servo' ? movingServo : draining && (state.speed > .05 || Math.abs(state.vy) > .05));
      moduleVisuals.setState(marker, { powered, working, charge: state?.batteryFraction ?? 0, progress: state?.poseProgress ?? 0 });
    }
    lastBattery = state?.battery ?? null; lastPose = state?.poseProgress ?? null; shouldRender = true;
  }
  let frame, previous = performance.now();
  function animate(now) { frame = requestAnimationFrame(animate); const dt = Math.min((now - previous) / 1000, .05); previous = now; controls.update(); if (callbacks.onFrame?.(dt)) shouldRender = true; if (shouldRender) { composer.render(); shouldRender = false; } }
  frame = requestAnimationFrame(animate);
  return { setParts, setTransforms, select, showGhost, showGhosts, setHidden, setJointGizmo, view, focus, setMotion, resetMotion, setFunctionState,
    setModuleVisibility: value => { moduleLayer.visible = !!value; shouldRender = true; },
    getCourseState: () => ({ gates: gates.map(({ userData: { index, x, z, collected } }) => ({ index, x, z, collected })), vehicle: { ...courseVehicle } }),
    setMode: value => { sceneMode = value; testField.visible = value === 'test'; if (value !== 'test') setFunctionState(null); shouldRender = true; }, setFollow: value => { follow = value; }, setAO: value => { ao.enabled = value; shouldRender = true; }, setGrid: value => { grid.visible = value; shouldRender = true; },
    setPlacementPlane: height => { placementPlane.constant=-Math.max(0,height); },
    refreshPointer: () => { if (lastPointer) callbacks.onHover?.(context(lastPointer)); }, getCanvas: () => renderer.domElement,
    project: (x, y, z) => { const p = new THREE.Vector3(x, y, z).project(camera), r = renderer.domElement.getBoundingClientRect(); return { x: r.left + (p.x + 1) * r.width / 2, y: r.top + (1 - p.y) * r.height / 2 }; },
    dispose: () => { cancelAnimationFrame(frame); observer.disconnect(); controls.dispose(); objects.forEach(disposePartMesh);ghosts.forEach(disposePartMesh);ghosts.clear();moduleVisuals.dispose(); modules.clear(); envTarget.dispose(); composer.passes.forEach(pass => pass.dispose?.()); composer.dispose(); renderer.dispose(); },
  };
}

export function createThumbnails(definitions) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); renderer.setSize(200, 140); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
  const world = new THREE.Scene(); world.add(new THREE.HemisphereLight('#fff9ec', '#909384', 1.2)); const light = new THREE.DirectionalLight('#fff8e8', 2.4); light.position.set(-4, 8, 5); world.add(light);
  const camera = new THREE.OrthographicCamera(-4, 4, 2.8, -2.8, .1, 100), results = new Map();
  for (const def of definitions) { const mesh = createPartMesh(def, def.transparent ? '#c99b32' : '#555956'); world.add(mesh); const box = new THREE.Box3().setFromObject(mesh), center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()), scale = Math.max(size.x, size.z, size.y * 1.2) * .65 + .35; camera.left = -scale * 1.43; camera.right = scale * 1.43; camera.top = scale; camera.bottom = -scale; camera.position.copy(center).add(new THREE.Vector3(7, 8, 10)); camera.lookAt(center); camera.updateProjectionMatrix(); renderer.render(world, camera); results.set(def.id, renderer.domElement.toDataURL('image/png')); world.remove(mesh); disposePartMesh(mesh); }
  renderer.dispose(); return results;
}
