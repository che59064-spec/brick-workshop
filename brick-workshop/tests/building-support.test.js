import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSupport, checkBuildChange, groundComponent } from '../src/building-support.js';
import { canPlace, getBounds, getConnections, snapPlacement } from '../src/model.js';

const piece = (id, partId = 'ld_3005', extra = {}) => ({ id, partId, x: 0, y: 0, z: 0, rotation: 0, color: '#515962', ...extra });
const doc = (parts = [], joints = []) => ({ parts, joints });
const ids = values => [...values].sort();
const joint = (parentPartId, childPartId) => ({ id: `${parentPartId}-${childPartId}`, parentPartId, childPartId, pivot: [0, 0, 0], axis: 'x', min: -90, max: 90, angleA: 0, angleB: 90 });

test('real visible geometry touching the ground is a root, including inverted studs', () => {
  const ground = piece('ground'), inverted = piece('inverted', 'ld_3005', { x: 3, rotationX: 180, y: 1.4 });
  assert.equal(getBounds(inverted, true).minY, 0);
  assert.deepEqual(ids(analyzeSupport([ground, inverted]).supportedIds), ['ground', 'inverted']);
  const oldPenetration = { ...inverted, y: 1.2 };
  assert.deepEqual(ids(analyzeSupport([oldPenetration]).unsupportedIds), ['inverted']);
  assert.equal(checkBuildChange(doc(), doc([ground, inverted])).valid, true);
});

test('normal stud stacking carries the upper brick from a grounded component', () => {
  const base = piece('base'), upper = piece('upper', 'ld_3005', { y: 1.2 });
  assert.equal(getConnections([base, upper]).length, 1);
  assert.deepEqual(ids(analyzeSupport([base, upper]).supportedIds), ['base', 'upper']);
  assert.equal(checkBuildChange(doc([base]), doc([base, upper])).valid, true);
});

test('a real brick resting on plate stud caps is unsupported while a fully seated stud mate is supported', () => {
  const plate = piece('plate', 'ld_3024'), onCaps = piece('upper', 'ld_3005', { y: .6 });
  assert.equal(canPlace(onCaps, [plate]), true);
  assert.equal(getConnections([plate, onCaps]).length, 0);
  assert.deepEqual(ids(analyzeSupport([plate, onCaps]).unsupportedIds), ['upper']);
  assert.equal(checkBuildChange(doc([plate]), doc([plate, onCaps])).valid, false);
  const seated = { ...onCaps, y: .4 };
  assert.equal(getConnections([plate, seated]).length, 1);
  assert.deepEqual(ids(analyzeSupport([plate, seated]).supportedIds), ['plate', 'upper']);
  assert.equal(checkBuildChange(doc([plate]), doc([plate, seated])).valid, true);
});

test('disabling the grid still seats an aligned socket instead of leaving it on stud caps', () => {
  const plate = piece('plate', 'ld_3024');
  const position = snapPlacement({ partId: 'ld_3005', point: { x: 0, y: .6, z: 0 }, normal: [0, 1, 0], hitPart: plate, snap: false }, [plate]);
  const free = piece('free', 'ld_3005', position);
  assert.equal(free.y, .4);
  assert.equal(getConnections([plate, free]).length, 1);
  assert.equal(checkBuildChange(doc([plate]), doc([plate, free])).valid, true);
});

test('old stud-cap drafts remain editable and grounding into their plate fails without damaging them', () => {
  const plate = piece('plate', 'ld_3024'), old = piece('old', 'ld_3005', { y: .6 });
  const before = doc([plate, old]), snapshot = structuredClone(before);
  assert.deepEqual(ids(analyzeSupport(before.parts).unsupportedIds), ['old']);
  assert.equal(checkBuildChange(before, doc([plate, { ...old, color: '#b85244' }])).valid, true);
  assert.throws(() => groundComponent(before, old.id), /无法将组件落地：.*重叠/);
  assert.deepEqual(before, snapshot);
  assert.equal(checkBuildChange(before, doc([plate, { ...old, x: 3, y: 0 }])).valid, true);
});

test('a real recessed headlight side stud carries a cantilevered plate in either graph direction', () => {
  const base = piece('base', 'ld_4070'), side = piece('side', 'ld_3024', { rotationX: 90, y: .7, z: .3 });
  assert.equal(canPlace(side, [base]), true);
  assert.equal(getConnections([base, side]).length, 1);
  assert.ok(getBounds(side, true).minY > 0);
  assert.deepEqual(ids(analyzeSupport([side, base]).supportedIds), ['base', 'side']);
  assert.equal(checkBuildChange(doc([base]), doc([side, base])).valid, true);
});

test('a smooth tile supports a real brick by vertical contact without a stud mate', () => {
  const tile = piece('tile', 'ld_3070b'), upper = piece('upper', 'ld_3005', { y: .4 });
  assert.equal(getConnections([tile, upper]).length, 0);
  assert.equal(canPlace(upper, [tile]), true);
  assert.deepEqual(ids(analyzeSupport([tile, upper]).supportedIds), ['tile', 'upper']);
  assert.equal(checkBuildChange(doc([tile]), doc([tile, upper])).valid, true);
  assert.deepEqual(ids(analyzeSupport([tile, { ...upper, y: .41 }]).unsupportedIds), ['upper']);
});

test('a grounded socket can carry a suspended brick attached by its outward stud', () => {
  const upright = piece('upright', 'ld_3023', { rotationZ: 90, y: 1 });
  const hanging = piece('hanging', 'ld_3005', { rotationZ: 90, x: 1.2, y: 1.5 });
  assert.equal(canPlace(hanging, [upright]), true);
  assert.deepEqual(getConnections([upright, hanging]), [{ a: 'hanging', b: 'upright', studs: 1 }]);
  assert.ok(getBounds(hanging, true).minY > 0);
  assert.deepEqual(ids(analyzeSupport([upright, hanging]).supportedIds), ['hanging', 'upright']);
  assert.equal(checkBuildChange(doc([upright]), doc([upright, hanging])).valid, true);
});

test('nesting flags neither hide real support contact nor turn penetration into support', () => {
  const tile = piece('tile', 'ld_3070b', { allowOverlap: true });
  const contact = piece('contact', 'ld_3005', { y: .4, allowOverlap: true });
  assert.deepEqual(ids(analyzeSupport([tile, contact]).supportedIds), ['contact', 'tile']);
  const penetrates = { ...contact, y: .2 };
  assert.deepEqual(ids(analyzeSupport([tile, penetrates]).unsupportedIds), ['contact']);
});

test('an isolated floating part, side touching, and a near-floor gap are unsupported', () => {
  const ground = piece('ground'), floating = piece('floating', 'ld_3005', { y: 2 });
  assert.equal(checkBuildChange(doc([ground]), doc([ground, floating])).valid, false);
  const side = piece('side', 'ld_3005', { x: 1, y: .4 });
  assert.deepEqual(ids(analyzeSupport([ground, side]).unsupportedIds), ['side']);
  const almostGround = piece('almost', 'ld_3005', { x: 10, y: .0005 });
  assert.deepEqual(ids(analyzeSupport([ground, almostGround]).unsupportedIds), ['almost']);
});

test('joints carry only nearby components and do not ground a remote fake joint', () => {
  const base = piece('base'), near = piece('near', 'ld_3005', { x: 1.2, y: .4 });
  assert.deepEqual(ids(analyzeSupport([base, near], [joint('base', 'near')]).supportedIds), ['base', 'near']);
  const far = { ...near, x: 4 };
  assert.deepEqual(ids(analyzeSupport([base, far], [joint('base', 'near')]).unsupportedIds), ['near']);
  assert.equal(checkBuildChange(doc([base]), doc([base, far], [joint('base', 'near')])).valid, false);
});

test('a floating connection cycle cannot create its own ground support', () => {
  const lower = piece('lower', 'ld_3005', { y: 2 }), upper = piece('upper', 'ld_3005', { y: 3.2 });
  assert.equal(getConnections([lower, upper]).length, 1);
  assert.deepEqual(ids(analyzeSupport([lower, upper]).supportedIds), []);
  assert.deepEqual(ids(analyzeSupport([lower, upper]).unsupportedIds), ['lower', 'upper']);
});

test('moving or deleting a bottom brick cannot strand its previously supported upper brick', () => {
  const base = piece('base'), upper = piece('upper', 'ld_3005', { y: 1.2 }), before = doc([base, upper]);
  assert.equal(checkBuildChange(before, doc([{ ...base, x: 5 }, upper])).valid, false);
  assert.equal(checkBuildChange(before, doc([upper])).valid, false);
  assert.equal(checkBuildChange(before, doc([base])).valid, true);
  assert.equal(checkBuildChange(before, doc([{ ...base, x: 5 }, { ...upper, x: 5 }])).valid, true);
});

test('removing the only bearing joint is blocked while an independent ground root is preserved', () => {
  const base = piece('base'), side = piece('side', 'ld_3005', { x: 1.2, y: .4 });
  const before = doc([base, side], [joint('base', 'side')]);
  assert.equal(checkBuildChange(before, doc([base, side])).valid, false);
  assert.equal(checkBuildChange(before, doc([base, { ...side, y: 0 }])).valid, true);
});

test('old floating drafts allow metadata edits and stepwise repairs without new floating pieces', () => {
  const old = piece('old', 'ld_3005', { y: 4 }), ground = piece('ground', 'ld_3005', { x: 4 });
  const before = doc([old]);
  assert.equal(checkBuildChange(before, doc([{ ...old, color: '#b85244', function: { type: 'battery', capacity: 100 } }])).valid, true);
  assert.equal(checkBuildChange(before, doc([old, ground])).valid, true);
  assert.equal(checkBuildChange(before, doc([{ ...old, y: 0 }])).valid, true);
  assert.equal(checkBuildChange(before, doc([{ ...old, x: 1 }])).valid, false);
  assert.equal(checkBuildChange(before, doc([old, piece('new', 'ld_3024', { x: 6, y: 4 })])).valid, false);
});

test('shared change validation still blocks collisions, ground crossing and invalid rotations', () => {
  const base = piece('base');
  assert.equal(checkBuildChange(doc([base]), doc([base, piece('overlap')])).valid, false);
  assert.equal(checkBuildChange(doc(), doc([piece('below', 'ld_3005', { y: -.1 })])).valid, false);
  assert.equal(checkBuildChange(doc(), doc([piece('invalid', 'ld_3005', { rotation: 45 })])).valid, false);
  assert.equal(checkBuildChange(doc([base]), doc([{ ...base, x: NaN }])).valid, false);
});

test('grounding a selected member lowers its real fixed component and preserves all other data', () => {
  const base = piece('base', 'ld_3005', { y: 3 }), upper = piece('upper', 'ld_3005', { y: 4.2, function: { type: 'battery', capacity: 100 } });
  const other = piece('other', 'ld_3004', { x: 8 });
  const before = { ...doc([base, upper, other]), name: '待修复旧稿', poses: [{ id: 'saved', name: '姿态', angles: {} }] }, snapshot = structuredClone(before);
  const after = groundComponent(before, 'upper');
  assert.notEqual(after, before);
  assert.deepEqual(after.parts, [{ ...base, y: 0 }, { ...upper, y: 1.2 }, other]);
  assert.deepEqual(after.name, before.name); assert.deepEqual(after.poses, before.poses);
  assert.deepEqual(before, snapshot);
  assert.equal(checkBuildChange(before, after).valid, true);
});

test('grounding follows real side mates and uses the component visual bottom instead of its selected origin', () => {
  const headlight = piece('headlight', 'ld_4070', { y: 3 }), side = piece('side', 'ld_3024', { rotationX: 90, y: 3.7, z: .3 });
  const after = groundComponent(doc([headlight, side]), 'side');
  assert.deepEqual(after.parts.map(part => part.y), [0, .7]);
  const inverted = piece('inverted', 'ld_3005', { rotationX: 180, y: 4.4 });
  const grounded = groundComponent(doc([inverted]), 'inverted');
  assert.equal(grounded.parts[0].y, 1.4);
  assert.equal(getBounds(grounded.parts[0], true).minY, 0);
});

test('grounding moves nearby joint components and their internal pivots by the same delta', () => {
  const base = piece('base', 'ld_3005', { y: 4 }), side = piece('side', 'ld_3005', { x: 1.2, y: 4.4 });
  const link = { ...joint('base', 'side'), name: '铰链', pivot: [.6, 4.7, .1] };
  const before = { ...doc([base, side], [link]), poses: [{ id: 'saved', name: '折叠', angles: { [link.id]: 60 } }] }, snapshot = structuredClone(before);
  const after = groundComponent(before, 'side');
  assert.deepEqual(after.parts.map(part => part.y), [0, .4]);
  assert.deepEqual(after.joints, [{ ...link, pivot: [.6, .7, .1] }]);
  assert.deepEqual(after.poses, before.poses);
  assert.deepEqual(before, snapshot);
});

test('grounding excludes distant fake joints and leaves their endpoints and pivots untouched', () => {
  const selected = piece('selected', 'ld_3005', { y: 4 }), far = piece('far', 'ld_3005', { x: 6, y: 4 });
  const link = { ...joint('selected', 'far'), pivot: [3, 4, 0] };
  const after = groundComponent(doc([selected, far], [link]), 'selected');
  assert.deepEqual(after.parts, [{ ...selected, y: 0 }, far]);
  assert.deepEqual(after.joints, [link]);
  assert.deepEqual(ids(analyzeSupport(after.parts, after.joints).unsupportedIds), ['far']);
});

test('grounding rejects an occupied destination without changing the original document', () => {
  const before = doc([piece('ground'), piece('floating', 'ld_3005', { y: 4 })]), snapshot = structuredClone(before);
  assert.throws(() => groundComponent(before, 'floating'), /无法将组件落地：.*重叠/);
  assert.deepEqual(before, snapshot);
  assert.throws(() => groundComponent(before, 'missing'), /请先选择/);
});

test('grounding a loose bearing tile cannot strand the piece it currently supports', () => {
  const before = doc([
    piece('base'),
    piece('headlight', 'ld_4070', { y: 1.2 }),
    piece('shelf', 'ld_3024', { rotationX: 90, y: 1.9, z: .3 }),
    piece('tile', 'ld_3070b', { y: 2.4, z: 1.1 }),
    piece('loose', 'ld_3005', { y: 2.8, z: 1.1 }),
  ]), snapshot = structuredClone(before);
  assert.equal(analyzeSupport(before.parts).unsupportedIds.size, 0);
  assert.throws(() => groundComponent(before, 'tile'), /无法将组件落地：.*其他积木悬空/);
  assert.deepEqual(before, snapshot);
});
