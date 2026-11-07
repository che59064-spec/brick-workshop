import test from 'node:test';
import assert from 'node:assert/strict';
import { getPart } from '../src/catalog.js';
import { createPlaytest, deriveVehicle, PLAYTEST_LIMITS } from '../src/playtest.js';

const height = getPart('brick11').height;
const part = (id, type, extra = {}) => ({
  id, partId: 'brick11', x: 0, y: 0, z: 0, rotation: 0, color: '#515962',
  ...(type ? { function: { type } } : {}), ...extra,
});
const document = parts => ({ version: 2, name: '测试车', parts, joints: [], poses: [] });
const stacked = roles => document(roles.map((role, i) => part(`p${i}`, role, { y: height * i })));
const drive = (sim, seconds, input) => { for (let i = 0; i < Math.round(seconds * 60); i++) sim.step(1 / 60, input); return sim.state; };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} should equal ${b}`);

test('arrow-key driving matches the advertised movement controls', () => {
  const wasd=createPlaytest(stacked(['wheel','battery'])),arrows=createPlaytest(stacked(['wheel','battery']));
  drive(wasd,.5,new Set(['KeyW','KeyD']));drive(arrows,.5,new Set(['ArrowUp','ArrowRight']));
  assert.deepEqual(arrows.state,wasd.state);
});

test('powered servos move toward a requested pose, consume energy and reset', () => {
  const sim = createPlaytest(stacked(['battery', 'servo']), { initialPose: .25 });
  sim.setPoseTarget(1);
  drive(sim, 1, {});
  close(sim.state.poseProgress, .85);
  assert.ok(sim.state.battery < 100);
  drive(sim, 1, {});
  close(sim.state.poseProgress, 1);
  sim.setPoseTarget(0);
  drive(sim, 1, {});
  assert.ok(sim.state.poseProgress < 1);
  sim.reset();
  close(sim.state.poseProgress, .25);
  const disconnected = createPlaytest(document([part('servo', 'servo'), part('battery', 'battery', { x: 20 })]));
  disconnected.setPoseTarget(1);
  drive(disconnected, 2, {});
  close(disconnected.state.poseProgress, 0);
  const exhausted = createPlaytest(stacked(['battery', 'servo']));
  exhausted.state.battery = 0;
  exhausted.setPoseTarget(1);
  drive(exhausted, 1, {});
  close(exhausted.state.poseProgress, 0);
});

test('ordinary structural pieces do not gain drive or lift from keyboard input', () => {
  const sim = createPlaytest(stacked([null, null]));
  drive(sim, 1, { forward: true, lift: true, left: true });
  assert.equal(sim.state.x, 0);
  assert.equal(sim.state.y, 0);
  assert.equal(sim.state.z, 0);
  assert.equal(sim.state.yaw, 0);
  assert.equal(sim.state.powered, false);
});

test('module power stays inside its connected assembly and mass includes structural ballast', () => {
  const parts = [part('wheel', 'wheel'), part('body'), part('battery', 'battery')];
  const unpowered = deriveVehicle(parts, [{ a: 'wheel', b: 'body' }]);
  assert.equal(unpowered.mass, getPart('brick11').weight * 2);
  assert.equal(unpowered.batteryCapacity, 0);
  assert.deepEqual(unpowered.disconnectedPartIds, ['battery']);
  const powered = deriveVehicle(parts, [{ a: 'wheel', b: 'body' }, { a: 'body', b: 'battery' }]);
  assert.equal(powered.batteryCapacity, 100);
  assert.equal(powered.mass, getPart('brick11').weight * 3);
});

test('a joint can carry the abstract electrical connection between rigid groups', () => {
  const doc = document([part('wheel', 'wheel'), part('battery', 'battery', { x: 4 })]);
  doc.joints = [{ id: 'joint', parentPartId: 'wheel', childPartId: 'battery' }];
  const sim = createPlaytest(doc);
  drive(sim, 0.2, { forward: true });
  assert.ok(sim.state.z < 0);
  assert.equal(sim.vehicle.activePartIds.length, 2);
});

test('mounted drive moves the assembly and greater mass reduces acceleration', () => {
  const light = createPlaytest(stacked(['wheel', 'battery']));
  const heavy = createPlaytest(stacked(['wheel', 'battery', null, null, null, null]));
  drive(light, 0.2, { forward: true });
  drive(heavy, 0.2, { forward: true });
  assert.ok(light.state.speed > heavy.state.speed);
  assert.ok(light.state.battery < light.vehicle.batteryCapacity);
  assert.ok(light.state.z < heavy.state.z);
});

test('extra connected thrusters increase acceleration without ignoring their weight', () => {
  const one = createPlaytest(stacked(['thruster', 'battery', null]));
  const two = createPlaytest(stacked(['thruster', 'battery', 'thruster']));
  drive(one, 0.1, { forward: true }); drive(two, 0.1, { forward: true });
  assert.equal(one.vehicle.mass, two.vehicle.mass);
  assert.ok(two.state.speed > one.state.speed);
});

test('empty batteries cannot keep accelerating; inertia decays under rolling resistance', () => {
  const doc = stacked(['wheel', 'battery']);
  doc.parts[1].function.capacity = 0.02;
  const sim = createPlaytest(doc);
  drive(sim, 0.1, { forward: true });
  assert.equal(sim.state.battery, 0);
  assert.equal(sim.state.powered, false);
  const speed = sim.state.speed;
  drive(sim, 1, { forward: true });
  assert.ok(speed > 0);
  assert.ok(sim.state.speed < speed);
  const withoutBattery = createPlaytest(stacked(['wheel', null]));
  drive(withoutBattery, 1, { forward: true });
  assert.equal(withoutBattery.state.speed, 0);
});

test('Space lifts powered thrusters and brakes cars that have no thruster', () => {
  const jet = createPlaytest(stacked(['thruster', 'battery']));
  drive(jet, 0.2, new Set(['Space']));
  assert.ok(jet.state.y > 0);
  assert.equal(jet.state.grounded, false);
  const brake = createPlaytest(stacked(['wheel', 'battery']));
  const coast = createPlaytest(stacked(['wheel', 'battery']));
  drive(brake, 0.2, { forward: true }); drive(coast, 0.2, { forward: true });
  drive(brake, 0.2, { space: true }); drive(coast, 0.2, {});
  assert.equal(brake.state.y, 0);
  assert.ok(brake.state.speed < coast.state.speed);
});

test('a wheel module high above the assembly floor provides no ground traction', () => {
  const sim = createPlaytest(stacked([null, 'battery', 'wheel']));
  drive(sim, 0.5, { forward: true });
  assert.equal(sim.vehicle.groundWheels, 0);
  assert.equal(sim.state.speed, 0);
  assert.match(sim.state.status, /轮组/);
});

test('reset restores position, velocities, heading and charge and notifies the scene', () => {
  const updates = [];
  const sim = createPlaytest(stacked(['thruster', 'battery']), { onChange: state => updates.push(state.x) });
  drive(sim, 0.2, { forward: true, left: true, lift: true });
  assert.ok(sim.state.y > 0);
  const sameState = sim.state;
  sim.step(0.01, { KeyR: true });
  assert.equal(sim.state, sameState);
  for (const field of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'yaw', 'elapsed']) assert.equal(sim.state[field], 0);
  assert.equal(sim.state.battery, sim.vehicle.batteryCapacity);
  assert.equal(updates.at(-1), 0);
});

test('frame gaps clamp dt, invalid inputs stay finite and explicit zero power stays zero', () => {
  const doc = stacked(['wheel', 'battery']);
  const clamped = createPlaytest(doc), expected = createPlaytest(doc);
  clamped.step(10000, { KeyW: true }); expected.step(PLAYTEST_LIMITS.maxDt, { KeyW: true });
  for (const field of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'battery', 'elapsed']) close(clamped.state[field], expected.state[field]);
  for (const dt of [NaN, Infinity, -1, 'bad']) clamped.step(dt, { forward: true });
  for (const value of Object.values(clamped.state)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
  doc.parts[0].function.power = 0;
  const disabled = createPlaytest(doc);
  drive(disabled, 1, { forward: true });
  assert.equal(disabled.state.speed, 0);
  doc.parts[0].function.power = Infinity;
  doc.parts[1].function.capacity = NaN;
  const safe = createPlaytest(doc);
  drive(safe, 0.1, { forward: true });
  assert.ok(Number.isFinite(safe.state.speed));
  assert.ok(Number.isFinite(safe.state.battery));
});

test('updating a document rebuilds connected functions without mutating saved parts', () => {
  const doc = stacked(['wheel', 'battery']);
  const before = JSON.stringify(doc);
  const sim = createPlaytest(doc);
  drive(sim, 0.1, { forward: true });
  assert.equal(JSON.stringify(doc), before);
  sim.setDocument(stacked(['thruster', 'battery']));
  assert.equal(sim.vehicle.wheels, 0);
  assert.equal(sim.vehicle.thrusters, 1);
  assert.equal(sim.state.z, 0);
});

test('document updates do not reuse an obsolete explicit connection snapshot', () => {
  const doc = document([part('wheel', 'wheel'), part('battery', 'battery', { x: 5 })]);
  const sim = createPlaytest(doc, { connections: [{ a: 'wheel', b: 'battery' }] });
  assert.equal(sim.vehicle.batteryCapacity, 100);
  sim.setDocument(doc);
  assert.equal(sim.vehicle.batteryCapacity, 0);
});
