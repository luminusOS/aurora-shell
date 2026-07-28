// Dock icon hover/press motion recipes, ported from d2d-companion's
// lib/motion/catalog.js (Subtle/Balanced/Expressive; "Balanced" is the
// profile that shipped as "Lively" in d2d-companion 0.1.0-beta.1). The
// launch effect from the source project is intentionally not ported here.

export const Profile = Object.freeze({
  SUBTLE: 'subtle',
  BALANCED: 'balanced',
  EXPRESSIVE: 'expressive',
});
export type ProfileId = (typeof Profile)[keyof typeof Profile];

export const PressMode = Object.freeze({
  LAUNCHES_ONLY: 'launches-only',
  ALL_PRIMARY_CLICKS: 'all-primary-clicks',
});
export type PressModeId = (typeof PressMode)[keyof typeof PressMode];

export const PressEffect = Object.freeze({
  SQUASH: 'squash',
  DIM: 'dim',
});
export type PressEffectId = (typeof PressEffect)[keyof typeof PressEffect];

export const Easing = Object.freeze({
  LINEAR: 'linear',
  EASE_OUT_QUAD: 'ease-out-quad',
  EASE_OUT_CUBIC: 'ease-out-cubic',
  EASE_OUT_BACK: 'ease-out-back',
});
export type EasingId = (typeof Easing)[keyof typeof Easing];

// The gschema range mirrors these bounds; keep them in sync.
export const NeighborRadius = Object.freeze({ MIN: 1, MAX: 3 });

export const DEFAULT_PROFILE: ProfileId = Profile.SUBTLE;

export interface HoverRecipe {
  enabled: boolean;
  scale: number;
  lift: number;
  duration: number;
  easing: EasingId;
  neighborScale: number;
  neighborRadius: number;
}

export interface PressRecipe {
  enabled: boolean;
  mode: PressModeId;
  effect: PressEffectId;
  intensity: number;
  duration: number;
}

export interface MotionRecipe {
  id: ProfileId;
  hover: HoverRecipe;
  press: PressRecipe;
}

const BUILTIN_RECIPES: Readonly<Record<ProfileId, MotionRecipe>> = deepFreeze({
  [Profile.SUBTLE]: {
    id: Profile.SUBTLE,
    hover: {
      enabled: true,
      scale: 1.05,
      lift: 0,
      duration: 150,
      easing: Easing.EASE_OUT_QUAD,
      neighborScale: 1,
      neighborRadius: 1,
    },
    press: {
      enabled: true,
      mode: PressMode.ALL_PRIMARY_CLICKS,
      effect: PressEffect.DIM,
      intensity: 0.2,
      duration: 90,
    },
  },
  [Profile.BALANCED]: {
    id: Profile.BALANCED,
    hover: {
      enabled: true,
      scale: 1.1,
      lift: 0,
      duration: 180,
      easing: Easing.EASE_OUT_CUBIC,
      neighborScale: 1,
      neighborRadius: 1,
    },
    press: {
      enabled: true,
      mode: PressMode.LAUNCHES_ONLY,
      effect: PressEffect.SQUASH,
      intensity: 0.35,
      duration: 90,
    },
  },
  [Profile.EXPRESSIVE]: {
    id: Profile.EXPRESSIVE,
    hover: {
      enabled: true,
      scale: 1.15,
      lift: 0,
      duration: 210,
      easing: Easing.EASE_OUT_CUBIC,
      neighborScale: 1,
      neighborRadius: 1,
    },
    press: {
      enabled: true,
      mode: PressMode.ALL_PRIMARY_CLICKS,
      effect: PressEffect.SQUASH,
      intensity: 0.55,
      duration: 120,
    },
  },
} satisfies Record<ProfileId, MotionRecipe>);

export function isBuiltInProfile(profile: string): profile is ProfileId {
  return Object.hasOwn(BUILTIN_RECIPES, profile);
}

export function getBuiltInRecipe(profile: string): MotionRecipe {
  const selected = isBuiltInProfile(profile) ? profile : DEFAULT_PROFILE;
  return clone(BUILTIN_RECIPES[selected]);
}

function clone(value: MotionRecipe): MotionRecipe {
  return JSON.parse(JSON.stringify(value)) as MotionRecipe;
}

function deepFreeze<T>(value: T): T {
  for (const child of Object.values(value as Record<string, unknown>)) {
    if (child && typeof child === 'object') deepFreeze(child);
  }
  return Object.freeze(value);
}
