import type { DashBounds } from '~/shared/ui/dash.ts';

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

/**
 * Returns the monitor indexes that should receive a dock.
 *
 * Primary-only mode deliberately ignores the vertical-topology safeguard: the
 * configured primary monitor must keep its dock even when another display is
 * positioned below it. All-monitors mode keeps the safeguard so a dock is not
 * placed on an internal edge between vertically stacked displays.
 */
export function getDockMonitorIndexes(
  monitors: DashBounds[],
  primaryIndex: number,
  showOnAllMonitors: boolean,
): number[] {
  if (!showOnAllMonitors) {
    return primaryIndex >= 0 && primaryIndex < monitors.length ? [primaryIndex] : [];
  }

  return monitors.flatMap((_monitor, index) => (hasDefinedBottom(monitors, index) ? [index] : []));
}
