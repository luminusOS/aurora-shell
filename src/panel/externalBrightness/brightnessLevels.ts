/** The level the master shows: the brightest display, so it reads 100% when any display is at 100%. */
export function combinedBrightness(levels: readonly number[]): number {
  return Math.max(0, ...levels);
}

/**
 * A display's level after the master moves from `from` to `to`: it moves by the same difference,
 * stopping at 0 and 1. At either end of the master every display goes to that end; otherwise a
 * dimmer display could never reach full brightness, because the master follows the brightest one.
 */
export function shiftBrightness(level: number, from: number, to: number): number {
  if (to >= 1) return 1;
  if (to <= 0) return 0;

  return Math.min(1, Math.max(0, level + to - from));
}
