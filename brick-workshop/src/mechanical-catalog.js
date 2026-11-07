// Audited against bundled LDraw primitives and the exported Blender surfaces.
// One Technic hole is 20 LDU long: R6 core, R8 counterbores 2 LDU deep.
const TAU = Math.PI * 2, SIDES = 16, NUMERICAL_CLEARANCE = .00005;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

function clip(polygon, normal, offset) {
  const out = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], da = dot(a, normal) - offset, db = dot(b, normal) - offset;
    if (da >= -1e-10) out.push(a);
    if ((da >= 0) !== (db >= 0)) out.push(a.map((v, k) => v + (b[k] - v) * da / (da - db)));
  }
  return out.filter((p, i) => !i || Math.hypot(p[0] - out[i - 1][0], p[1] - out[i - 1][1]) > 1e-9);
}

function annulus(outline, centre, radius, low, high, axis) {
  const outer = outline.map(p => p.map((v, i) => v - centre[i])), hulls = [];
  for (let i = 0; i < SIDES; i++) {
    const a = [Math.cos(i * TAU / SIDES), Math.sin(i * TAU / SIDES)], b = [Math.cos((i + 1) * TAU / SIDES), Math.sin((i + 1) * TAU / SIDES)];
    const edge = [b[0] - a[0], b[1] - a[1]], outward = [edge[1], -edge[0]];
    let sector = clip(outer, [-a[1], a[0]], 0);
    sector = clip(sector, [b[1], -b[0]], 0);
    sector = clip(sector, outward, dot(a, outward) * (radius + NUMERICAL_CLEARANCE));
    if (sector.length < 3) continue;
    hulls.push([low, high].flatMap(d => sector.map(([u, v]) => axis === 'y' ? [u + centre[0], d, v + centre[1]] : [u + centre[0], v + centre[1], d])));
  }
  return hulls;
}

function boreBodies(outline, centres, axis, low, high) {
  return centres.flatMap((centre, i) => {
    // Partition between adjacent holes, so each convex sector preserves every aperture.
    const coordinate = axis === 'y' ? 1 : 0;
    let cell = outline;
    if (i) cell = clip(cell, coordinate ? [0, 1] : [1, 0], (centres[i - 1][coordinate] + centre[coordinate]) / 2);
    if (i < centres.length - 1) cell = clip(cell, coordinate ? [0, -1] : [-1, 0], -(centres[i + 1][coordinate] + centre[coordinate]) / 2);
    return [[low, low + .1, .4], [low + .1, high - .1, .3], [high - .1, high, .4]].flatMap(([a, b, radius]) => annulus(cell, centre, radius, a, b, axis));
  });
}

function cylinderX(radius, low, high, centreY, bounds) {
  let ring = Array.from({ length: SIDES }, (_, i) => [centreY + radius * Math.cos(i * TAU / SIDES), radius * Math.sin(i * TAU / SIDES)]);
  // Slotted collars have no material at the circular envelope's top/bottom tips.
  // Preserve their actual exported support planes instead of adding a phantom .01-stud protrusion.
  if (bounds) ring = clip(clip(ring, [1, 0], bounds[0][1]), [-1, 0], -bounds[1][1]);
  return [low, high].flatMap(x => ring.map(([y, z]) => [x, y, z]));
}

const pin = (x, y, direction, friction) => ({ type: 'pin', position: [x, y, 0], normal: [direction, 0, 0], length: 1, radius: .3, friction });
const hole = (position, axis) => [-1, 1].map(direction => ({ type: 'pin-hole', position: [...position], normal: axis.map(v => v * direction), length: 1, radius: .3, mouthRadius: .4, mouthDepth: .1 }));

export function mechanicalMetadata(record) {
  const id = String(record.ldrawId ?? record.id), origin = record.sourceOriginInGame;
  if (['32316', '32523'].includes(id)) {
    const end = id === '32316' ? 2 : 1, centres = Array.from({ length: end * 2 + 1 }, (_, i) => [0, i - end]);
    const outline = [0, 1].flatMap(half => Array.from({ length: 9 }, (_, i) => {
      const angle = (half * 8 + i) * Math.PI / 8;
      return [.45 * Math.cos(angle), (half ? -end : end) + .45 * Math.sin(angle)];
    }));
    return { mechanicalConnectionStatus: 'audited-pin-layout', mechanicalConnectors: centres.flatMap(([x, z]) => hole([x, .5, z], [0, 1, 0])), collisionHulls: boreBodies(outline, centres, 'y', 0, 1) };
  }
  if (['3700', '3701'].includes(id)) {
    const halfWidth = id === '3700' ? 1 : 2, centres = (id === '3700' ? [0] : [-1, 0, 1]).map(x => [x, .7]);
    const outline = [[-halfWidth, 0], [halfWidth, 0], [halfWidth, 1.2], [-halfWidth, 1.2]];
    return { mechanicalConnectionStatus: 'audited-pin-layout', mechanicalConnectors: centres.flatMap(([x, y]) => hole([x, y, 0], [0, 0, 1])), collisionHulls: boreBodies(outline, centres, 'z', -.5, .5) };
  }
  if (['2780', '3673', '43093', '6558'].includes(id)) {
    const centreY = origin[1], shift = origin[0], friction = id !== '3673';
    let sections, mechanicalConnectors;
    if (id === '6558') {
      sections = [[.325, -1.5, -1.4], [.3, -1.4, -.6], [.4, -.6, -.4], [.3, -.4, 1.4], [.325, 1.4, 1.5]];
      mechanicalConnectors = [-1, 0, 1].map(x => pin(x, centreY, x < 0 ? -1 : 1, friction));
    } else if (id === '43093') {
      sections = [[.325, -1, -.9], [.3, -.9, -.1], [.4, -.1, 0], [.3, 0, .975]];
      mechanicalConnectors = [pin(shift - .5, centreY, -1, friction)]; // The other half is a cross axle, not a snap pin.
    } else {
      sections = [[.325, -1, -.9], [.3, -.9, -.1], [.4, -.1, .1], [.3, .1, .9], [.325, .9, 1]];
      mechanicalConnectors = [-.5, .5].map(x => pin(x, centreY, Math.sign(x), friction));
    }
    return { mechanicalConnectionStatus: 'audited-pin-layout', mechanicalConnectors,
      // Raised friction ribs are elastically compressed in a real R6 bore; collars and locking lips retain their full radius.
      collisionFit: { nominalShaftRadius: .3, frictionCompression: friction ? .013 : 0, numericalClearance: NUMERICAL_CLEARANCE,
        compressedShaftIntervals: friction ? sections.filter(([radius, low]) => radius === .3 && (id !== '43093' || low < 0)).map(([, low, high]) => [low + shift, high + shift]) : [] },
      collisionHulls: sections.map(([radius, low, high]) => cylinderX(radius, low + shift, high + shift, centreY, record.bbox)) };
  }
  if (['32062', '3705'].includes(id)) {
    // A conservative cylindrical envelope contains the cross axle, without pretending it locks a round bore.
    return { mechanicalConnectionStatus: 'manual', mechanicalConnectors: [], collisionHulls: [cylinderX(.3, record.bbox[0][0], record.bbox[1][0], origin[1])] };
  }
  if (['3937', '3938'].includes(id)) {
    const y = origin[1] - .5, type = id === '3937' ? 'hinge-female' : 'hinge-male';
    return { mechanicalConnectionStatus: 'axis-only', mechanicalConnectors: [-.9, .9].map(x => ({ type, position: [x, y, 0], normal: [Math.sign(x) * (id === '3937' ? -1 : 1), 0, 0], radius: .2, length: .2, geometryStatus: 'axis-only' })), mechanicalPivot: { position: [0, y, 0], axis: [1, 0, 0] } };
  }
  return null;
}
