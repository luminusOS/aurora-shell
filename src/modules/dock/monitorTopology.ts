import type { DashBounds } from '~/shared/ui/dash.ts';

/**
 * Pure domain logic for analyzing monitor topology.
 */

/**
 * Returns true if no other monitor sits directly below this one.
 * Used to avoid placing a dock between vertically stacked monitors.
 */
export function hasDefinedBottom(monitors: DashBounds[], index: number): boolean {
  const monitor = monitors[index];
  if (!monitor) return false;

  const bottom = monitor.y + monitor.height;
  const left = monitor.x;
  const right = left + monitor.width;

  return !monitors.some((other, i) => {
    if (i === index) return false;
    return other.y >= bottom && other.x < right && other.x + other.width > left;
  });
}
