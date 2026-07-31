import assert from 'node:assert/strict';
import test from 'node:test';

import { EdgeGestureGuard } from '../../src/dock/edgeGestureGuard.ts';

const BUTTON_1 = 1 << 8;
const BUTTON_2 = 1 << 9;
const BUTTON_MASK = BUTTON_1 | BUTTON_2;

test('dock edge gesture guard allows an idle pointer', () => {
  const guard = new EdgeGestureGuard();

  assert.equal(guard.observeModifiers(0, BUTTON_MASK), false);
});

test('dock edge gesture guard stays suppressed after a pressed button is released', () => {
  const guard = new EdgeGestureGuard();

  assert.equal(guard.observeModifiers(BUTTON_1, BUTTON_MASK), true);
  assert.equal(guard.observeModifiers(0, BUTTON_MASK), true);
});

test('dock edge gesture guard requires pointer leave after scroll', () => {
  const guard = new EdgeGestureGuard();

  assert.equal(guard.suppressUntilLeave(), true);
  assert.equal(guard.suppressUntilLeave(), false);
  assert.equal(guard.observeModifiers(0, BUTTON_MASK), true);

  guard.resetAfterPointerLeave();
  assert.equal(guard.observeModifiers(0, BUTTON_MASK), false);
});

test('dock edge gesture guard observes a transition cooldown', () => {
  const guard = new EdgeGestureGuard();

  guard.beginCooldown(1_000, 700);

  assert.equal(guard.isCoolingDown(1_699), true);
  assert.equal(guard.isCoolingDown(1_700), false);
});

test('dock edge gesture guard never shortens an active cooldown', () => {
  const guard = new EdgeGestureGuard();

  guard.beginCooldown(1_000, 700);
  guard.beginCooldown(1_100, 100);

  assert.equal(guard.isCoolingDown(1_699), true);
  assert.equal(guard.isCoolingDown(1_700), false);
});
