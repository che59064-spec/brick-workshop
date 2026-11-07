import { getPart } from './catalog.js';
import { getConnections } from './model.js';

// These are game parameters; catalog weight is an estimate, not a calibrated dynamics model.
export const MODULE_ROLES = Object.freeze({
  battery: Object.freeze({ name: '电池模块', capacity: 100, power: 0 }),
  thruster: Object.freeze({ name: '向量推进模块', power: 120 }),
  wheel: Object.freeze({ name: '驱动轮组', power: 60 }),
  servo: Object.freeze({ name: '伺服模块', power: 4 }),
});

export const PLAYTEST_LIMITS = Object.freeze({ maxDt: 0.05, maxSpeed: 30, boundary: 45, ceiling: 25, gravity: 6 });
const EPS = 1e-8;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback, min = 0, max = 10000) => typeof value === 'number' && Number.isFinite(value)
  ? clamp(value, min, max) : fallback;

function moduleOf(part) {
  const type = part.function?.type;
  if (!Object.hasOwn(MODULE_ROLES, type)) return null;
  const defaults = MODULE_ROLES[type];
  return {
    id: part.id, type,
    power: finite(part.function.power, defaults.power),
    capacity: type === 'battery' ? finite(part.function.capacity, defaults.capacity, 0, 100000) : 0,
  };
}

/** Fixed connections and joints carry the mounted modules' abstract power connection. */
export function deriveVehicle(parts = [], connections = []) {
  const valid = [], seen = new Set();
  for (const part of Array.isArray(parts) ? parts.slice(0, 1000) : []) {
    if (!part || typeof part.id !== 'string' || !part.id || seen.has(part.id)) continue;
    seen.add(part.id); valid.push(part);
  }
  const parents = new Map(valid.map(part => [part.id, part.id]));
  const find = id => {
    let root = id;
    while (parents.get(root) !== root) root = parents.get(root);
    while (id !== root) { const next = parents.get(id); parents.set(id, root); id = next; }
    return root;
  };
  for (const edge of Array.isArray(connections) ? connections : []) {
    if (edge && parents.has(edge.a) && parents.has(edge.b)) parents.set(find(edge.a), find(edge.b));
  }
  const groups = new Map();
  for (const part of valid) {
    const id = find(part.id);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(part);
  }
  const components = [...groups.values()].map(group => {
    const floor = Math.min(...group.map(part => finite(part.y, 0, -1000, 1000)));
    const modules = group.map(part => {
      const module = moduleOf(part);
      return module && { ...module, touchesGround: finite(part.y, 0, -1000, 1000) <= floor + 0.41 };
    }).filter(Boolean);
    const ofType = type => modules.filter(module => module.type === type);
    const sum = (list, field) => list.reduce((value, module) => value + module[field], 0);
    const wheels = ofType('wheel'), thrusters = ofType('thruster'), batteries = ofType('battery');
    const groundWheels = wheels.filter(wheel => wheel.touchesGround);
    return {
      partIds: group.map(part => part.id), modules,
      mass: group.reduce((mass, part) => mass + finite(getPart(part.partId)?.weight, 1, 0.05, 1000), 0),
      batteries: batteries.length, batteryCapacity: sum(batteries, 'capacity'),
      wheels: wheels.length, groundWheels: groundWheels.length, wheelForce: sum(groundWheels, 'power'),
      thrusters: thrusters.length, thrusterForce: sum(thrusters, 'power'),
      servos: ofType('servo').length, servoPower: sum(ofType('servo'), 'power'),
    };
  });
  const score = component => (component.wheels || component.thrusters || component.servos ? 1 : 0)
    + (component.batteryCapacity > 0 && (component.wheels || component.thrusters || component.servos) ? 2 : 0);
  const active = components.reduce((best, component) => !best || score(component) > score(best)
    || (score(component) === score(best) && component.partIds.length > best.partIds.length) ? component : best, null);
  const empty = {
    partIds: [], modules: [], mass: 0, batteries: 0, batteryCapacity: 0,
    wheels: 0, groundWheels: 0, wheelForce: 0, thrusters: 0, thrusterForce: 0, servos: 0, servoPower: 0,
  };
  const selected = active ?? empty;
  const activeIds = new Set(selected.partIds);
  return {
    ...selected, activePartIds: [...selected.partIds], components,
    totalMass: components.reduce((mass, component) => mass + component.mass, 0),
    disconnectedPartIds: valid.filter(part => !activeIds.has(part.id)).map(part => part.id),
  };
}

function deriveDocument(doc, options) {
  const parts = Array.isArray(doc?.parts) ? doc.parts : [];
  const fixed = Array.isArray(options.connections) ? options.connections
    : getConnections(parts.filter(part => part && getPart(part.partId)));
  const joints = Array.isArray(doc?.joints) ? doc.joints.map(joint => ({ a: joint?.parentPartId, b: joint?.childPartId })) : [];
  return deriveVehicle(parts, [...fixed, ...joints]);
}

/** state positions/speeds use the game's scene units, not measured airspeed. */
export function createPlaytest(doc, options = {}) {
  const state = {};
  const simulation = { vehicle: deriveDocument(doc, options), state, step, reset, setDocument,
    setPoseTarget: value => { state.poseTarget = finite(value, state.poseTarget, 0, 1); },
  };
  const notify = () => { if (typeof options.onChange === 'function') options.onChange(state, simulation.vehicle); };

  function telemetry(input = {}) {
    const vehicle = simulation.vehicle;
    state.speed = Math.hypot(state.vx, state.vz);
    state.grounded = state.y <= EPS;
    state.powered = state.battery > EPS;
    state.batteryFraction = vehicle.batteryCapacity > 0 ? clamp(state.battery / vehicle.batteryCapacity, 0, 1) : 0;
    if (!vehicle.activePartIds.length) state.status = '先搭建一个作品';
    else if (!vehicle.wheels && !vehicle.thrusters && !vehicle.servos) state.status = '挂载轮组或推进模块后可驾驶';
    else if (vehicle.batteryCapacity <= EPS) state.status = '动力组件未连接可用电池';
    else if (!state.powered) state.status = '电量已耗尽，按 R 重置';
    else if (!vehicle.wheels && !vehicle.thrusters && vehicle.servos) state.status = '伺服变形测试 · T 切换姿态';
    else if (!vehicle.thrusterForce && !vehicle.wheelForce) state.status = vehicle.wheels && !vehicle.groundWheels ? '轮组未接近装配体底部' : '模块动力设为零';
    else if (input.lift && state.grounded && vehicle.thrusterForce <= vehicle.mass * PLAYTEST_LIMITS.gravity) state.status = '推力不足以离地，可减重或增加推力';
    else state.status = state.grounded ? '地面驾驶测试' : '空中推进测试';
  }

  function reset() {
    Object.assign(state, { x: 0, y: 0, z: 0, yaw: 0, vx: 0, vy: 0, vz: 0, elapsed: 0, battery: simulation.vehicle.batteryCapacity });
    state.poseProgress = state.poseTarget = finite(options.initialPose, 0, 0, 1);
    telemetry(); notify();
    if (typeof options.onReset === 'function') options.onReset(state, simulation.vehicle);
    return state;
  }

  function setDocument(nextDoc, connections) {
    simulation.vehicle = deriveDocument(nextDoc, { connections });
    return reset();
  }

  function step(dt, keys = {}) {
    const pressed = (...names) => names.some(name => keys instanceof Set ? keys.has(name) : keys?.[name] === true || keys?.[name] === 1);
    if (pressed('reset', 'KeyR', 'r')) return reset();
    const vehicle = simulation.vehicle;
    const space = pressed('Space', 'space');
    const input = {
      throttle: Number(pressed('forward', 'KeyW', 'w', 'ArrowUp')) - Number(pressed('backward', 'KeyS', 's', 'ArrowDown')),
      steer: Number(pressed('left', 'KeyA', 'a', 'ArrowLeft')) - Number(pressed('right', 'KeyD', 'd', 'ArrowRight')),
      lift: pressed('lift') || (space && vehicle.thrusters > 0),
      brake: pressed('brake') || (space && !vehicle.thrusters),
      servo: pressed('servo') || (vehicle.servos > 0 && Math.abs(state.poseTarget - state.poseProgress) > EPS),
    };
    let remaining = finite(dt, 0, 0, PLAYTEST_LIMITS.maxDt);
    while (remaining > EPS) {
      const h = Math.min(remaining, 1 / 120);
      remaining -= h; state.elapsed += h;
      const grounded = state.y <= EPS;
      const wheelForce = grounded ? vehicle.wheelForce : 0;
      const directionLength = Math.max(1, Math.hypot(input.throttle, Number(input.lift)));
      const forwardThrust = vehicle.thrusterForce * input.throttle / directionLength;
      const liftThrust = vehicle.thrusterForce * Number(input.lift) / directionLength;
      const thrustUsed = Math.hypot(forwardThrust, liftThrust);
      const steeringForce = (wheelForce + vehicle.thrusterForce) * Math.abs(input.steer) * 0.15;
      const energyNeeded = (wheelForce * Math.abs(input.throttle) + thrustUsed + steeringForce + (input.servo ? vehicle.servoPower : 0)) * 0.025 * h;
      const powerFraction = state.battery > EPS ? (energyNeeded > EPS ? Math.min(1, state.battery / energyNeeded) : 1) : 0;
      state.battery = Math.max(0, state.battery - energyNeeded * powerFraction);
      if (input.servo && vehicle.servos > 0) {
        const delta = state.poseTarget - state.poseProgress;
        state.poseProgress += Math.sign(delta) * Math.min(Math.abs(delta), h * .6 * powerFraction);
      }
      const canSteer = (grounded && wheelForce > 0) || vehicle.thrusterForce > 0;
      if (canSteer) state.yaw += input.steer * 1.8 * h * powerFraction;
      state.yaw = ((state.yaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      const mass = Math.max(vehicle.mass, 0.05);
      const drive = (wheelForce * input.throttle + forwardThrust) / mass * powerFraction;
      state.vx += Math.sin(state.yaw) * drive * h;
      state.vz -= Math.cos(state.yaw) * drive * h;
      state.vy += (liftThrust / mass * powerFraction - PLAYTEST_LIMITS.gravity) * h;
      // shortcut: whole-assembly motion has no aerodynamic lift, tyre steering geometry or automatic robot gait.
      const drag = Math.exp(-(grounded ? (input.brake ? 14 : vehicle.groundWheels ? 0.8 : 5) : 0.18) * h);
      state.vx *= drag; state.vz *= drag;
      const speed = Math.hypot(state.vx, state.vz);
      if (speed > PLAYTEST_LIMITS.maxSpeed) { state.vx *= PLAYTEST_LIMITS.maxSpeed / speed; state.vz *= PLAYTEST_LIMITS.maxSpeed / speed; }
      state.vy = clamp(state.vy, -PLAYTEST_LIMITS.maxSpeed, PLAYTEST_LIMITS.maxSpeed);
      state.x += state.vx * h; state.y += state.vy * h; state.z += state.vz * h;
      if (state.y <= 0) { state.y = 0; state.vy = Math.max(0, state.vy); }
      if (state.y >= PLAYTEST_LIMITS.ceiling) { state.y = PLAYTEST_LIMITS.ceiling; state.vy = Math.min(0, state.vy); }
      for (const axis of ['x', 'z']) {
        if (Math.abs(state[axis]) > PLAYTEST_LIMITS.boundary) { state[axis] = clamp(state[axis], -PLAYTEST_LIMITS.boundary, PLAYTEST_LIMITS.boundary); state[`v${axis}`] = 0; }
      }
    }
    telemetry(input); notify();
    return state;
  }

  reset();
  return simulation;
}
