// Pure dock icon hover/press transforms, ported from
// d2d-companion's lib/motion/transforms.js and adapted for each screen edge.

import {
  Easing,
  PressEffect,
  type HoverRecipe,
  type MotionRecipe,
  type PressEffectId,
} from '~/dock/motion/catalog.ts';

import type { DockPosition } from '~/dock/dockConfiguration.ts';

const PIVOTS: Record<DockPosition, readonly [number, number]> = {
  bottom: [0.5, 1],
  left: [0, 0.5],
  right: [1, 0.5],
};
const OUTWARD: Record<DockPosition, readonly [number, number]> = {
  bottom: [0, -1],
  left: [1, 0],
  right: [-1, 0],
};

export interface IconTransform {
  scaleX: number;
  scaleY: number;
  translationX: number;
  translationY: number;
  dim: number;
  pivot: readonly [number, number];
}

interface PressTransform {
  scaleX: number;
  scaleY: number;
  translationX: number;
  translationY: number;
  dim: number;
}

// Press effects: (intensity) → geometry + dim, identity at 0.
const PRESS_SQUASH_FACTOR = 0.22;
const PRESS_DIM_FACTOR = 0.3;

export function resolvePressTransform(
  effect: PressEffectId,
  intensity: number,
  position: DockPosition = 'bottom',
): PressTransform {
  const clamped = clamp(intensity, 0, 1);
  if (effect === PressEffect.DIM) return pressTransform({ dim: PRESS_DIM_FACTOR * clamped });
  const normalScale = 1 - PRESS_SQUASH_FACTOR * clamped;
  return position === 'bottom'
    ? pressTransform({ scaleY: normalScale })
    : pressTransform({ scaleX: normalScale });
}

export function dimOpacity(opacity: number, dim: number): number {
  return Math.round(opacity * (1 - clamp(dim, 0, 1)));
}

function pressTransform({
  scaleX = 1,
  scaleY = 1,
  translationX = 0,
  translationY = 0,
  dim = 0,
}: Partial<PressTransform> = {}): PressTransform {
  return { scaleX, scaleY, translationX, translationY, dim };
}

export function composeIconTransform({
  hoverScale = 1,
  lift = 0,
  pressIntensity = 0,
  pressEffect = PressEffect.SQUASH,
  position = 'bottom',
}: {
  hoverScale?: number;
  lift?: number;
  pressIntensity?: number;
  pressEffect?: PressEffectId;
  position?: DockPosition;
}): IconTransform {
  const press = resolvePressTransform(pressEffect, pressIntensity, position);
  const outward = OUTWARD[position];
  return {
    scaleX: hoverScale * press.scaleX,
    scaleY: hoverScale * press.scaleY,
    translationX: outward[0] * lift + press.translationX,
    translationY: outward[1] * lift + press.translationY,
    dim: press.dim,
    pivot: PIVOTS[position],
  };
}

// EASE_OUT_BACK overshoots by about 10%.
export const OVERSHOOT_RESERVE = 0.1;
export const TEXTURE_SUPERSAMPLE = 2;

// Load magnified icons at twice their normal resolution. Merely matching the
// final hover scale still leaves too few source pixels at the fractional sizes
// used by intermediate animation frames. The actor remains allocated at its
// normal size, so this improves Clutter's sampling without changing layout.
export function textureRenderSize(iconNormalSize: number, recipe: MotionRecipe): number {
  if (!(iconNormalSize > 0) || !Number.isFinite(iconNormalSize)) return 0;
  if (!recipe.hover.enabled) return Math.ceil(iconNormalSize);

  const largestScale = Math.max(1, recipe.hover.scale, recipe.hover.neighborScale);
  const overshoot = recipe.hover.easing === Easing.EASE_OUT_BACK ? OVERSHOOT_RESERVE : 0;
  const hoverRenderScale = 1 + (largestScale - 1) * (1 + overshoot);
  const renderScale = Math.max(TEXTURE_SUPERSAMPLE, hoverRenderScale);
  return Math.ceil(iconNormalSize * renderScale);
}

// Fit hover scale and lift into the available room above the dock.
export function fitHoverToBudget(
  hoverScale: number,
  lift: number,
  iconNormalSize: number,
  budgetPx: number,
  overshoot = 0,
): { hoverScale: number; lift: number } {
  if (!(iconNormalSize > 0) || !Number.isFinite(budgetPx)) return { hoverScale, lift };
  const budget = Math.max(0, budgetPx) / (1 + Math.max(0, overshoot));
  const scaleGrowth = iconNormalSize * Math.max(0, hoverScale - 1);
  const safeLift = Math.max(0, lift);
  const reach = scaleGrowth + safeLift;
  if (reach <= budget || reach === 0) return { hoverScale, lift };
  const factor = budget / reach;
  return {
    hoverScale: 1 + (scaleGrowth * factor) / iconNormalSize,
    lift: safeLift * factor,
  };
}

// Linear falloff: full neighbor scale next to the hover, fading to identity
// past the radius.
export function neighborScaleAt(hover: HoverRecipe, distance: number): number {
  if (!(distance >= 1) || distance > hover.neighborRadius) return 1;
  const weight = (hover.neighborRadius - distance + 1) / hover.neighborRadius;
  return 1 + (hover.neighborScale - 1) * weight;
}

// Only a hover reach (scale growth or lift) is fitted to the budget.
export function hoverNeedsBudget({
  recipe,
  hovered = false,
  neighborDistance = Infinity,
}: {
  recipe: MotionRecipe;
  hovered?: boolean;
  neighborDistance?: number;
}): boolean {
  const { hover } = recipe;
  if (!hover.enabled) return false;
  if (hovered) return hover.scale !== 1 || hover.lift !== 0;
  return neighborScaleAt(hover, neighborDistance) !== 1;
}

export function resolveIconTransform({
  recipe,
  hovered = false,
  neighborDistance = Infinity,
  pressed = false,
  animationsEnabled = true,
  budgetPx = Infinity,
  iconNormalSize = 0,
  position = 'bottom',
}: {
  recipe: MotionRecipe;
  hovered?: boolean;
  neighborDistance?: number;
  pressed?: boolean;
  animationsEnabled?: boolean;
  budgetPx?: number;
  iconNormalSize?: number;
  position?: DockPosition;
}): IconTransform {
  if (!animationsEnabled) {
    return {
      scaleX: 1,
      scaleY: 1,
      translationX: 0,
      translationY: 0,
      dim: 0,
      pivot: PIVOTS[position],
    };
  }

  const hoverEnabled = recipe.hover.enabled;
  const hoverScale =
    hoverEnabled && hovered
      ? recipe.hover.scale
      : hoverEnabled
        ? neighborScaleAt(recipe.hover, neighborDistance)
        : 1;
  const lift = hoverEnabled && hovered ? recipe.hover.lift : 0;
  const pressIntensity = recipe.press.enabled && pressed ? recipe.press.intensity : 0;

  const overshoot = recipe.hover.easing === Easing.EASE_OUT_BACK ? OVERSHOOT_RESERVE : 0;
  const fitted = fitHoverToBudget(hoverScale, lift, iconNormalSize, budgetPx, overshoot);

  return composeIconTransform({
    hoverScale: fitted.hoverScale,
    lift: fitted.lift,
    pressIntensity,
    pressEffect: recipe.press.effect,
    position,
  });
}

function clamp(value: number, minimum: number, maximum: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return minimum;
  return Math.min(maximum, Math.max(minimum, number));
}
