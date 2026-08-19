import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getBuiltInRecipe, Profile } from '~/dock/motion/catalog.ts';
import { PressInteraction } from '~/dock/motion/pressInteraction.ts';

test('press interaction: ALL_PRIMARY_CLICKS presses immediately regardless of launch state', () => {
  const { press } = getBuiltInRecipe(Profile.EXPRESSIVE); // all-primary-clicks
  const interaction = new PressInteraction();
  assert.equal(interaction.beginPrimary(press, false), true);
  assert.equal(interaction.pressed, true);
});

test('press interaction: LAUNCHES_ONLY stays idle for clicks on a running app', () => {
  const { press } = getBuiltInRecipe(Profile.BALANCED); // launches-only
  const interaction = new PressInteraction();
  assert.equal(interaction.beginPrimary(press, false), false);
  assert.equal(interaction.pressed, false);
});

test('press interaction: LAUNCHES_ONLY presses for a click that starts a stopped app', () => {
  const { press } = getBuiltInRecipe(Profile.BALANCED);
  const interaction = new PressInteraction();
  assert.equal(interaction.beginPrimary(press, true), true);
  assert.equal(interaction.pressed, true);
});

test('press interaction: finishClick releases an active press exactly once', () => {
  const { press } = getBuiltInRecipe(Profile.EXPRESSIVE);
  const interaction = new PressInteraction();
  interaction.beginPrimary(press, false);
  assert.equal(interaction.finishClick(), true);
  assert.equal(interaction.pressed, false);
  assert.equal(interaction.finishClick(), false); // already released, no change
});

test('press interaction: syncButtonPressed releases an early drag-out before click fires', () => {
  const { press } = getBuiltInRecipe(Profile.EXPRESSIVE);
  const interaction = new PressInteraction();
  interaction.beginPrimary(press, false);
  assert.equal(interaction.syncButtonPressed(true), false); // still held, no change
  assert.equal(interaction.syncButtonPressed(false), true); // released outside the icon
  assert.equal(interaction.pressed, false);
});

test('press interaction: reset clears an in-progress press (e.g. pointer leaves)', () => {
  const { press } = getBuiltInRecipe(Profile.EXPRESSIVE);
  const interaction = new PressInteraction();
  interaction.beginPrimary(press, false);
  assert.equal(interaction.reset(), true);
  assert.equal(interaction.pressed, false);
});

test('press interaction: disabled press config never presses', () => {
  const { press } = getBuiltInRecipe(Profile.EXPRESSIVE);
  const interaction = new PressInteraction();
  assert.equal(interaction.beginPrimary({ ...press, enabled: false }, true), false);
  assert.equal(interaction.pressed, false);
});
