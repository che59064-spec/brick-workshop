import * as THREE from 'three';

export const MODULE_COLORS = Object.freeze({ battery: '#6b9875', thruster: '#d4a63a', wheel: '#b8bdb1', servo: '#6a96b6' });

/** Decorative game attachments; kept outside the asset, its hit targets and physical bounds. */
export function createModuleVisuals() {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 20);
  const ring = new THREE.TorusGeometry(1, .18, 8, 24);
  const sphere = new THREE.SphereGeometry(1, 12, 8);
  const geometries = [box, cylinder, ring, sphere], markers = new Set(); let disposed = false;

  function mesh(group, geometry, material, size, position, rotation) {
    const object = new THREE.Mesh(geometry, material);
    object.scale.fromArray(size); object.position.fromArray(position);
    if (rotation) object.rotation.set(...rotation);
    group.add(object); return object;
  }

  function create(type, definition) {
    if (disposed || !MODULE_COLORS[type]) return null;
    const marker = new THREE.Group(); marker.name = `game-module-${type}`;
    const glyph = new THREE.Group(), bounds = definition.bbox ?? definition.bodyBounds ?? [[-definition.width / 2, 0, -definition.depth / 2], [definition.width / 2, definition.height, definition.depth / 2]];
    const width = Math.max(.01, bounds[1][0] - bounds[0][0]), depth = Math.max(.01, bounds[1][2] - bounds[0][2]);
    const scale = Math.min(.6, width * .68, depth * .68 / .66);
    glyph.scale.setScalar(scale); glyph.position.set((bounds[0][0] + bounds[1][0]) / 2, bounds[1][1] + .035, (bounds[0][2] + bounds[1][2]) / 2);
    marker.add(glyph);
    const shell = new THREE.MeshStandardMaterial({ color: '#30362f', roughness: .42 });
    const accent = new THREE.MeshStandardMaterial({ color: MODULE_COLORS[type], roughness: .36 });
    const metal = new THREE.MeshStandardMaterial({ color: '#c9cabc', roughness: .35, metalness: .25 });
    const indicator = new THREE.MeshStandardMaterial({ color: '#555d4c', emissive: MODULE_COLORS[type], emissiveIntensity: 0, roughness: .3 });
    mesh(glyph, box, shell, [1, .09, .66], [0, .045, 0]);
    mesh(glyph, box, accent, [.09, .02, .58], [-.43, .1, 0]);
    const lamp = mesh(glyph, sphere, indicator, [.055, .025, .055], [.4, .11, .23]);
    let arm = null; const bars = [];
    if (type === 'battery') {
      mesh(glyph, box, accent, [.6, .035, .35], [0, .115, 0]);
      mesh(glyph, box, metal, [.08, .04, .16], [.34, .12, 0]);
      for (let i = 0; i < 3; i++) bars.push(mesh(glyph, box, indicator, [.07, .018, .19], [-.17 + i * .16, .145, 0]));
    } else if (type === 'thruster') {
      mesh(glyph, cylinder, metal, [.25, .05, .25], [0, .13, 0]);
      mesh(glyph, cylinder, shell, [.18, .06, .18], [0, .16, 0]);
      mesh(glyph, cylinder, indicator, [.11, .025, .11], [0, .197, 0]);
      for (const x of [-.32, .32]) mesh(glyph, box, accent, [.055, .04, .34], [x, .13, 0]);
    } else if (type === 'wheel') {
      mesh(glyph, box, metal, [.6, .045, .06], [0, .16, 0]);
      for (const x of [-.27, .27]) {
        mesh(glyph, cylinder, accent, [.19, .13, .19], [x, .17, 0], [0, 0, Math.PI / 2]);
        mesh(glyph, cylinder, shell, [.11, .14, .11], [x, .17, 0], [0, 0, Math.PI / 2]);
      }
    } else {
      mesh(glyph, ring, accent, [.22, .22, .22], [0, .135, 0], [-Math.PI / 2, 0, 0]);
      arm = new THREE.Group(); arm.position.y = .18; glyph.add(arm);
      mesh(arm, cylinder, metal, [.09, .05, .09], [0, 0, 0]);
      mesh(arm, box, metal, [.34, .04, .07], [.13, .015, 0]);
    }
    marker.userData = { moduleVisual: true, type, glyph, indicator, bars, arm, lamp, state: 'unpowered' };
    marker.traverse(object => { if (object.isMesh) { object.raycast = () => {}; object.castShadow = false; } });
    markers.add(marker); setState(marker); return marker;
  }

  function setState(marker, { powered = false, working = false, charge = 1, progress = 0 } = {}) {
    const data = marker.userData, enabled = !!powered;
    data.state = enabled ? working ? 'working' : 'powered' : 'unpowered';
    data.indicator.color.set(enabled ? charge < .15 ? '#c4773a' : MODULE_COLORS[data.type] : '#555d4c');
    data.indicator.emissiveIntensity = enabled ? working ? .65 : .18 : 0;
    data.bars.forEach((bar, i) => { bar.visible = enabled && charge > i / 3; });
    if (data.arm) data.arm.rotation.y = THREE.MathUtils.clamp(progress, 0, 1) * Math.PI * .8;
  }

  function remove(marker) {
    if (!markers.delete(marker)) return;
    const materials = new Set();
    marker.traverse(object => { if (object.isMesh) materials.add(object.material); });
    materials.forEach(material => material.dispose()); marker.removeFromParent(); marker.clear();
  }

  function dispose() { if (disposed) return; disposed = true; [...markers].forEach(remove); geometries.forEach(geometry => geometry.dispose()); }
  return { create, setState, remove, dispose };
}
