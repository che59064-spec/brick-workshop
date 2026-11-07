import * as THREE from 'three';

/** Animate the Blender hierarchy in local space so child pieces stay attached. */
export function createDemoRuntime(data) {
  const root = new THREE.Group(), nodes = new Map();
  for (const def of data.nodes) { const object = new THREE.Group(); object.name = def.name; nodes.set(def.id, object); }
  for (const def of data.nodes) (nodes.get(def.parentId) ?? root).add(nodes.get(def.id));
  const poses = [...data.poses].sort((a, b) => a.t - b.t).map(pose => ({ t: pose.t, nodes: new Map(pose.nodes.map(n => [n.id, n])) }));
  const target = new THREE.Quaternion(), nextPosition = new THREE.Vector3();
  function evaluate(t) {
    const value = THREE.MathUtils.clamp(t, 0, 1); let index = poses.findIndex(p => p.t >= value);
    if (index < 0) index = poses.length - 1;
    const b = poses[index], a = poses[Math.max(0, index - 1)], alpha = a === b ? 0 : (value - a.t) / (b.t - a.t);
    for (const def of data.nodes) {
      const object = nodes.get(def.id), from = a.nodes.get(def.id), to = b.nodes.get(def.id);
      object.position.fromArray(from.position).lerp(nextPosition.fromArray(to.position), alpha);
      object.quaternion.fromArray(from.quaternion).slerp(target.fromArray(to.quaternion), alpha);
      object.scale.set(1, 1, 1);
    }
    root.updateMatrixWorld(true);
    return new Map(data.nodes.filter(n => n.type === 'part').map(def => [def.id, { matrix: nodes.get(def.id).matrixWorld.toArray() }]));
  }
  const rest = evaluate(0), lookup = new Map((data.restParts ?? []).map(p => [p.id, p]));
  const parts = data.nodes.filter(n => n.type === 'part').map(def => {
    const matrix = new THREE.Matrix4().fromArray(rest.get(def.id).matrix), position = new THREE.Vector3(), q = new THREE.Quaternion();
    matrix.decompose(position, q, new THREE.Vector3()); const euler = new THREE.Euler().setFromQuaternion(q, 'XYZ');
    const quarter = v => ((Math.round(THREE.MathUtils.radToDeg(v) / 90) * 90) % 360 + 360) % 360;
    return { id: def.id, partId: def.templateId ?? `ld_${def.ldrawId}`, x: position.x, y: position.y, z: position.z,
      rotationX: quarter(euler.x), rotation: quarter(euler.y), rotationZ: quarter(euler.z), quaternion:q.toArray(),
      color: lookup.get(def.id)?.color ?? def.material?.color ?? '#515962', allowOverlap: true };
  });
  return { parts, evaluate, source: data.sourceVideo, status: data.status };
}
