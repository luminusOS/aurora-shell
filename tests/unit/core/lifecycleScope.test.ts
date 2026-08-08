import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LifecycleScope } from '~/core/lifecycleScope.ts';

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
  const id = scope.connect(target, 'changed', () => undefined);
  assert.equal(id, 42);
  scope.dispose();
  assert.deepEqual(disconnected, [42]);
});

test('LifecycleScope — replaces and clears a managed source', () => {
  const removed: number[] = [];
  const scope = new LifecycleScope();
  const source = scope.manageSource((id) => removed.push(id));

  source.replace(() => 1);
  assert.equal(source.active, true);
  source.replace(() => 2);
  assert.deepEqual(removed, [1]);
  source.clear();
  source.clear();

  assert.equal(source.active, false);
  assert.deepEqual(removed, [1, 2]);
});

test('LifecycleScope — removes the previous source before creating its replacement', () => {
  const events: string[] = [];
  const scope = new LifecycleScope();
  const source = scope.manageSource((id) => events.push(`remove:${id}`));

  source.replace(() => {
    events.push('create:1');
    return 1;
  });
  source.replace(() => {
    events.push('create:2');
    return 2;
  });

  assert.deepEqual(events, ['create:1', 'remove:1', 'create:2']);
});

test('LifecycleScope — completes a managed source without removing it', () => {
  const removed: number[] = [];
  const scope = new LifecycleScope();
  const source = scope.manageSource((id) => removed.push(id));

  source.replace(() => 7);
  source.complete();
  scope.dispose();

  assert.equal(source.active, false);
  assert.deepEqual(removed, []);
});

test('LifecycleScope — disposes an active managed source', () => {
  const removed: number[] = [];
  const scope = new LifecycleScope();
  const source = scope.manageSource((id) => removed.push(id));

  source.replace(() => 9);
  scope.dispose();
  scope.dispose();

  assert.deepEqual(removed, [9]);
});

test('LifecycleScope — disposes every active source in reverse registration order', () => {
  const removed: number[] = [];
  const scope = new LifecycleScope();
  const first = scope.manageSource((id) => removed.push(id));
  const second = scope.manageSource((id) => removed.push(id));

  first.replace(() => 1);
  second.replace(() => 2);
  scope.dispose();

  assert.deepEqual(removed, [2, 1]);
});

test('LifecycleScope — remains idempotent when a source remover reenters dispose', () => {
  const events: string[] = [];
  const scope = new LifecycleScope();
  const source = scope.manageSource((id) => {
    events.push(`remove:${id}`);
    scope.dispose();
  });
  scope.onDispose(() => events.push('teardown'));
  source.replace(() => 5);

  assert.doesNotThrow(() => scope.dispose());
  scope.dispose();

  assert.deepEqual(events, ['remove:5', 'teardown']);
});

test('LifecycleScope — does not create a managed source after disposal', () => {
  const removed: number[] = [];
  let created = false;
  const scope = new LifecycleScope();
  const source = scope.manageSource((id) => removed.push(id));
  scope.dispose();

  source.replace(() => {
    created = true;
    return 11;
  });

  assert.equal(source.active, false);
  assert.equal(created, false);
  assert.deepEqual(removed, []);
});

test('LifecycleScope — teardown registered after disposal runs immediately', () => {
  let tornDown = false;
  const scope = new LifecycleScope();
  scope.dispose();
  scope.onDispose(() => (tornDown = true));
  assert.equal(tornDown, true);
});
