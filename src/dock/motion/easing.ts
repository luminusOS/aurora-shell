import type Clutter from '@girs/clutter-18';

import { Easing, type EasingId } from '~/dock/motion/catalog.ts';

export function resolveAnimationMode(
  easing: EasingId,
  animationMode: typeof Clutter.AnimationMode,
): Clutter.AnimationMode {
  switch (easing) {
    case Easing.LINEAR:
      return animationMode.LINEAR;
    case Easing.EASE_OUT_QUAD:
      return animationMode.EASE_OUT_QUAD;
    case Easing.EASE_OUT_BACK:
      return animationMode.EASE_OUT_BACK;
    case Easing.EASE_OUT_CUBIC:
    default:
      return animationMode.EASE_OUT_CUBIC;
  }
}
