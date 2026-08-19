import type { DashBounds } from '~/shared/ui/dash.ts';
import type { DockPosition } from '~/dock/dockConfiguration.ts';

export function hasDefinedEdge(
  monitors: DashBounds[],
  index: number,
  position: DockPosition,
): boolean {
  const monitor = monitors[index];
  if (!monitor) return false;

  const left = monitor.x;
  const right = left + monitor.width;
  const top = monitor.y;
  const bottom = top + monitor.height;

  return !monitors.some((other, i) => {
    if (i === index) return false;
    const overlapsX = other.x < right && other.x + other.width > left;
    const overlapsY = other.y < bottom && other.y + other.height > top;

    if (position === 'left') return overlapsY && other.x + other.width <= left;
    if (position === 'right') return overlapsY && other.x >= right;
    return overlapsX && other.y >= bottom;
  });
}

/** Returns whether the bottom edge is free for a dock. */
export function hasDefinedBottom(monitors: DashBounds[], index: number): boolean {
  return hasDefinedEdge(monitors, index, 'bottom');
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
  position: DockPosition = 'bottom',
): number[] {
  if (!showOnAllMonitors) {
    return primaryIndex >= 0 && primaryIndex < monitors.length ? [primaryIndex] : [];
  }

  return monitors.flatMap((_monitor, index) =>
    hasDefinedEdge(monitors, index, position) ? [index] : [],
  );
}
