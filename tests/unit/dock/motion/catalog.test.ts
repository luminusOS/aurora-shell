import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_PROFILE,
  Profile,
  getBuiltInRecipe,
  isBuiltInProfile,
} from '~/dock/motion/catalog.ts';

test('dock motion catalog: Subtle is the default profile', () => {
  assert.equal(DEFAULT_PROFILE, Profile.SUBTLE);
});

test('dock motion catalog: recognizes only the three built-in profiles', () => {
  assert.equal(isBuiltInProfile('subtle'), true);
  assert.equal(isBuiltInProfile('balanced'), true);
  assert.equal(isBuiltInProfile('expressive'), true);
  assert.equal(isBuiltInProfile('custom'), false);
  assert.equal(isBuiltInProfile('nonsense'), false);
});

test('dock motion catalog: falls back to the default profile for unknown ids', () => {
  assert.deepEqual(getBuiltInRecipe('nonsense'), getBuiltInRecipe(DEFAULT_PROFILE));
});

test('dock motion catalog: Subtle gives only the selected icon a gentle hover', () => {
  const recipe = getBuiltInRecipe(Profile.SUBTLE);
  assert.equal(recipe.hover.enabled, true);
  assert.equal(recipe.hover.scale, 1.05);
  assert.equal(recipe.hover.lift, 0);
  assert.equal(recipe.hover.neighborScale, 1);
  assert.equal(recipe.press.enabled, true);
  assert.equal(recipe.press.mode, 'all-primary-clicks');
});

test('dock motion catalog: Balanced only grows the selected icon', () => {
  const recipe = getBuiltInRecipe(Profile.BALANCED);
  assert.equal(recipe.hover.enabled, true);
  assert.equal(recipe.hover.scale, 1.1);
  assert.ok(recipe.hover.duration >= 180);
  assert.equal(recipe.hover.neighborScale, 1);
  assert.equal(recipe.press.mode, 'launches-only');
});

test('dock motion catalog: Expressive is stronger without overlapping neighboring icons', () => {
  const recipe = getBuiltInRecipe(Profile.EXPRESSIVE);
  assert.ok(recipe.hover.scale > getBuiltInRecipe(Profile.BALANCED).hover.scale);
  assert.equal(recipe.hover.scale, 1.15);
  assert.equal(recipe.hover.lift, 0);
  assert.equal(recipe.hover.neighborScale, 1);
  assert.equal(recipe.hover.easing, 'ease-out-cubic');
});

test('dock motion catalog: recipes are independent copies, not shared references', () => {
  const first = getBuiltInRecipe(Profile.BALANCED);
  const second = getBuiltInRecipe(Profile.BALANCED);
  first.hover.scale = 999;
  assert.notEqual(second.hover.scale, 999);
});
