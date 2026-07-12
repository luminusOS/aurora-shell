export interface DashBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DashPlacement = DashBounds;

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
  marginBottom: number,
): DashPlacement {
  const width = Math.min(Math.max(preferredWidth, 0), workArea.width);
  const height = Math.min(Math.max(preferredHeight, 0), workArea.height);
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: Math.max(workArea.y, workArea.y + workArea.height - height - marginBottom),
    width,
    height,
  };
}
