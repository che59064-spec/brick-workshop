import test from 'node:test';
import assert from 'node:assert/strict';
import { getRecoveryKey, writeDraft } from '../src/storage.js';

function memoryStorage(entries = [], fail = () => false) {
  const values = new Map(entries), writes = [];
  return {
    values, writes,
    getItem: key => values.get(key) ?? null,
    setItem(key, value) {
      if (fail(key)) throw new Error('QuotaExceededError');
      values.set(key, value); writes.push(key);
    },
  };
}

const key = 'workshop-v2', recoveryKey = getRecoveryKey(key);
const broken = '{"version":2,"parts": [\n损坏原文 🔧\u0000';

test('a damaged source is preserved verbatim before saving; ordinary saves leave unrelated keys alone', () => {
  const storage = memoryStorage([[key, broken], ['other-project', 'untouched']]);
  writeDraft(storage, key, 'new valid draft', broken);
  assert.equal(storage.getItem(recoveryKey), broken);
  assert.equal(storage.getItem(key), 'new valid draft');
  assert.equal(storage.getItem('other-project'), 'untouched');
  assert.deepEqual(storage.writes, [recoveryKey, key]);
  const ordinary = memoryStorage([['other-project', 'untouched']]);
  writeDraft(ordinary, key, 'ordinary draft');
  assert.deepEqual([...ordinary.values], [['other-project', 'untouched'], [key, 'ordinary draft']]);
});

test('repeated saves reuse the same recovery copy, including an empty unreadable source', () => {
  const storage = memoryStorage([[key, broken]]);
  writeDraft(storage, key, 'first draft', broken);
  writeDraft(storage, key, 'second draft', broken);
  assert.equal(storage.values.size, 2);
  assert.equal(storage.getItem(recoveryKey), broken);
  assert.equal(storage.getItem(key), 'second draft');
  assert.equal(storage.writes.filter(name => name === recoveryKey).length, 1);
  const empty = memoryStorage([[key, '']]);
  writeDraft(empty, key, 'new draft', '');
  assert.equal(empty.getItem(recoveryKey), '');
});

test('an older recovery is archived without replacing existing archives and reused on retry', () => {
  const storage = memoryStorage([[key, broken], [recoveryKey, 'older recovery'], [`${recoveryKey}-1`, 'first archive']]);
  writeDraft(storage, key, 'new valid draft', broken);
  assert.equal(storage.getItem(`${recoveryKey}-1`), 'first archive');
  assert.equal(storage.getItem(`${recoveryKey}-2`), 'older recovery');
  assert.equal(storage.getItem(recoveryKey), broken);
  const retry = memoryStorage([[key, broken], [recoveryKey, 'older recovery'], [`${recoveryKey}-1`, 'older recovery']]);
  writeDraft(retry, key, 'new valid draft', broken);
  assert.equal(retry.values.size, 3);
  assert.equal(retry.getItem(`${recoveryKey}-1`), 'older recovery');
});

test('quota failures during archival, recovery or final save never replace the active source', () => {
  for (const failingKey of [`${recoveryKey}-1`, recoveryKey, key]) {
    const storage = memoryStorage([[key, broken], [recoveryKey, 'older recovery']], name => name === failingKey);
    assert.throws(() => writeDraft(storage, key, 'new valid draft', broken), /QuotaExceededError/);
    assert.equal(storage.getItem(key), broken);
    assert.ok(storage.getItem(recoveryKey) === 'older recovery' || storage.getItem(`${recoveryKey}-1`) === 'older recovery');
  }
});
