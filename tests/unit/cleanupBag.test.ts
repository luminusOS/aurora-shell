import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CleanupBag } from '../../src/core/cleanupBag.ts';

test('CleanupBag — runs cleanup in reverse order and is idempotent', () => {
  const calls: number[] = [];
  const bag = new CleanupBag();
  bag.add(() => calls.push(1));
  bag.add(() => calls.push(2));
  bag.add(() => calls.push(3));
  bag.dispose();
  bag.dispose();
  assert.deepEqual(calls, [3, 2, 1]);
});

test('CleanupBag — disconnects signals', () => {
  const disconnected: number[] = [];
  const target = {
    connect: () => 42,
    disconnect: (id: number) => disconnected.push(id),
  };
  const bag = new CleanupBag();
  assert.equal(
    bag.connect(target, 'changed', () => undefined),
    42,
  );
  bag.dispose();
  assert.deepEqual(disconnected, [42]);
});

test('CleanupBag — pairs connectObject with disconnectObject', () => {
  const calls: string[] = [];
  const owner = {};
  const target = {
    disconnectObject: (value: object) => {
      assert.equal(value, owner);
      calls.push('disconnect');
    },
  };
  const bag = new CleanupBag();
  bag.connectObject(target, owner, () => calls.push('connect'));
  bag.dispose();
  assert.deepEqual(calls, ['connect', 'disconnect']);
});

test('CleanupBag — removes sources and D-Bus watches', () => {
  const calls: string[] = [];
  const bag = new CleanupBag();
  bag.source(7, (id) => calls.push(`source:${id}`));
  bag.watch(9, (id) => calls.push(`watch:${id}`));
  bag.dispose();
  assert.deepEqual(calls, ['watch:9', 'source:7']);
});

test('CleanupBag — cleanup added after disposal runs immediately', () => {
  let cleaned = false;
  const bag = new CleanupBag();
  bag.dispose();
  bag.add(() => (cleaned = true));
  assert.equal(cleaned, true);
});
