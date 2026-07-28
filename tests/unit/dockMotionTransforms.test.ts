import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getBuiltInRecipe, Profile, PressEffect } from '../../src/dock/motion/catalog.ts';
import {
  dimOpacity,
  fitHoverToBudget,
  hoverNeedsBudget,
  neighborScaleAt,
  resolveIconTransform,
  resolvePressTransform,
  textureRenderSize,
} from '../../src/dock/motion/transforms.ts';

test('transforms — squash press shrinks the vertical axis toward the dock', () => {
  const identity = resolvePressTransform(PressEffect.SQUASH, 0);
  assert.equal(identity.scaleY, 1);
  const pressed = resolvePressTransform(PressEffect.SQUASH, 1);
  assert.ok(pressed.scaleY < 1);
  assert.equal(pressed.scaleX, 1);
});

test('transforms — dim press only changes opacity, not geometry', () => {
  const pressed = resolvePressTransform(PressEffect.DIM, 1);
  assert.equal(pressed.scaleX, 1);
  assert.equal(pressed.scaleY, 1);
  assert.ok(pressed.dim > 0);
});

test('transforms — dimOpacity scales down from the original, clamped to [0, 1]', () => {
  assert.equal(dimOpacity(255, 0), 255);
  assert.equal(dimOpacity(255, 1), 0);
  assert.equal(dimOpacity(200, 0.5), 100);
});

test('transforms — neighborScaleAt fades linearly to identity past the radius', () => {
  const hover = {
    ...getBuiltInRecipe(Profile.EXPRESSIVE).hover,
    neighborScale: 1.08,
    neighborRadius: 2,
  };
  assert.equal(neighborScaleAt(hover, 0), 1); // the hovered icon itself is not a "neighbor"
  assert.ok(neighborScaleAt(hover, 1) > neighborScaleAt(hover, 2));
  assert.equal(neighborScaleAt(hover, 3), 1); // beyond the radius
});

test('transforms — fitHoverToBudget leaves room untouched when it already fits', () => {
  const fitted = fitHoverToBudget(1.1, 5, 48, 1000);
  assert.equal(fitted.hoverScale, 1.1);
  assert.equal(fitted.lift, 5);
});

test('transforms — fitHoverToBudget shrinks scale and lift proportionally when clipped', () => {
  const fitted = fitHoverToBudget(1.5, 10, 48, 12);
  const reachBefore = 48 * 0.5 + 10;
  const reachAfter = 48 * (fitted.hoverScale - 1) + fitted.lift;
  assert.ok(Math.abs(reachAfter - 12) < 1e-6);
  assert.ok(reachAfter < reachBefore);
});

test('transforms — Subtle has a visible but gentler hover than Balanced', () => {
  const recipe = getBuiltInRecipe(Profile.SUBTLE);
  const transform = resolveIconTransform({ recipe, hovered: true });
  assert.equal(hoverNeedsBudget({ recipe, hovered: true }), true);
  assert.equal(transform.scaleX, 1.05);
  assert.ok(transform.scaleX < getBuiltInRecipe(Profile.BALANCED).hover.scale);
});

test('transforms — resolveIconTransform is identity when animations are globally off', () => {
  const recipe = getBuiltInRecipe(Profile.EXPRESSIVE);
  const transform = resolveIconTransform({ recipe, hovered: true, animationsEnabled: false });
  assert.equal(transform.scaleX, 1);
  assert.equal(transform.scaleY, 1);
  assert.equal(transform.translationY, 0);
});

test('transforms — resolveIconTransform scales and lifts on hover for Balanced', () => {
  const recipe = getBuiltInRecipe(Profile.BALANCED);
  const transform = resolveIconTransform({ recipe, hovered: true });
  assert.equal(transform.scaleX, 1.1);
  assert.equal(transform.scaleY, 1.1);
});

test('transforms — Balanced leaves neighboring icons at their normal size', () => {
  const recipe = getBuiltInRecipe(Profile.BALANCED);
  const transform = resolveIconTransform({ recipe, neighborDistance: 1 });
  assert.equal(transform.scaleX, 1);
  assert.equal(transform.scaleY, 1);
});

test('transforms — Expressive leaves neighboring icons at their normal size', () => {
  const recipe = getBuiltInRecipe(Profile.EXPRESSIVE);
  const transform = resolveIconTransform({ recipe, neighborDistance: 1 });
  assert.equal(transform.scaleX, 1);
  assert.equal(transform.scaleY, 1);
  assert.equal(transform.translationY, 0);
});

test('transforms — textureRenderSize uses 2x pixels for smooth hover magnification', () => {
  const recipe = getBuiltInRecipe(Profile.BALANCED);
  assert.equal(textureRenderSize(48, recipe), 96);
  assert.ok(textureRenderSize(48, recipe) >= 48 * recipe.hover.scale);
});

test('transforms — textureRenderSize stays at the normal size when hover is disabled', () => {
  const recipe = getBuiltInRecipe(Profile.SUBTLE);
  recipe.hover.enabled = false;
  assert.equal(textureRenderSize(48, recipe), 48);
});
