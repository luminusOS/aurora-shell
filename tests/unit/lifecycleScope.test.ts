import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LifecycleScope } from '../../src/core/lifecycleScope.ts';

test('LifecycleScope — runs teardown in reverse order and is idempotent', () => {
  const calls: number[] = [];
  const scope = new LifecycleScope();
  scope.onDispose(() => calls.push(1));
  scope.onDispose(() => calls.push(2));
  scope.onDispose(() => calls.push(3));
  scope.dispose();
  scope.dispose();
  assert.deepEqual(calls, [3, 2, 1]);
});

test('LifecycleScope — disconnects signals', () => {
  const disconnected: number[] = [];
  const target = {
    connect: () => 42,
    disconnect: (id: number) => disconnected.push(id),
  };
  const scope = new LifecycleScope();
  scope.connect(target, 'changed', () => undefined);
  scope.dispose();
  assert.deepEqual(disconnected, [42]);
});

test('LifecycleScope — teardown registered after disposal runs immediately', () => {
  let tornDown = false;
  const scope = new LifecycleScope();
  scope.dispose();
  scope.onDispose(() => (tornDown = true));
  assert.equal(tornDown, true);
});
