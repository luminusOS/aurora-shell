import type { DockPosition } from '~/dock/dockConfiguration.ts';

export interface DashBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DashPlacement = DashBounds;

const DASH_ICON_SIZE_STEPS = [16, 22, 24, 32, 48, 64];

export function selectDashIconSize(
  maxIconSize: number,
  availablePhysicalSize: number,
  scaleFactor: number,
): number {
  const candidates = DASH_ICON_SIZE_STEPS.filter((size) => size < maxIconSize);
  candidates.push(maxIconSize);

  let selected = candidates[0]!;
  for (const candidate of candidates) {
    if (candidate * scaleFactor <= availablePhysicalSize) selected = candidate;
  }

  return selected;
}

export function boundsContainPoint(bounds: DashBounds | null, x: number, y: number): boolean {
  if (!bounds) return false;
  return (
    x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height
  );
}

export function boundsEqual(a: DashBounds | null, b: DashBounds | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function calculateDashPlacement(
  workArea: DashBounds,
  preferredWidth: number,
  preferredHeight: number,
  edgeMargin: number,
  position: DockPosition = 'bottom',
): DashPlacement {
  const width = Math.min(Math.max(preferredWidth, 0), workArea.width);
  const height = Math.min(Math.max(preferredHeight, 0), workArea.height);
  if (position === 'left') {
    return {
      x: workArea.x + edgeMargin,
      y: workArea.y + Math.round((workArea.height - height) / 2),
      width,
      height,
    };
  }
  if (position === 'right') {
    return {
      x: Math.max(workArea.x, workArea.x + workArea.width - width - edgeMargin),
      y: workArea.y + Math.round((workArea.height - height) / 2),
      width,
      height,
    };
  }
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: Math.max(workArea.y, workArea.y + workArea.height - height - edgeMargin),
    width,
    height,
  };
}

export function isVerticalDock(position: DockPosition): boolean {
  return position !== 'bottom';
}

export function calculateDashReorderPosition({
  position,
  pointerX,
  pointerY,
  childCount,
  mainAxisSize,
  excludedMainAxisSize = 0,
  rtl = false,
}: {
  position: DockPosition;
  pointerX: number;
  pointerY: number;
  childCount: number;
  mainAxisSize: number;
  excludedMainAxisSize?: number;
  rtl?: boolean;
}): number {
  const availableMainAxisSize = mainAxisSize - Math.max(0, excludedMainAxisSize);
  if (childCount <= 0 || availableMainAxisSize <= 0) return 0;
  const coordinate = isVerticalDock(position) ? pointerY : pointerX;
  const forward = Math.floor((coordinate * childCount) / availableMainAxisSize);
  const positionAlongAxis = position === 'bottom' && rtl ? childCount - forward : forward;
  return Math.min(childCount, Math.max(0, positionAlongAxis));
}

export function isSelfReorderPosition(favoritePosition: number, targetPosition: number): boolean {
  return (
    favoritePosition >= 0 &&
    (targetPosition === favoritePosition || targetPosition === favoritePosition + 1)
  );
}
