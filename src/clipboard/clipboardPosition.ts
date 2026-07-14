export type ClipboardPanelBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function findClipboardPanelMonitorAtPoint(
  x: number,
  y: number,
  monitors: readonly ClipboardPanelBounds[],
  fallbackMonitorIndex: number,
): number {
  const monitorIndex = monitors.findIndex(
    (monitor) =>
      x >= monitor.x &&
      x < monitor.x + monitor.width &&
      y >= monitor.y &&
      y < monitor.y + monitor.height,
  );

  return monitorIndex >= 0 ? monitorIndex : fallbackMonitorIndex;
}

export function placeClipboardPanelNearPointer(
  pointerX: number,
  pointerY: number,
  workArea: ClipboardPanelBounds,
  preferredWidth: number,
  preferredHeight: number,
  edgeMargin: number,
  pointerOffset: number,
): ClipboardPanelBounds {
  const width = Math.min(preferredWidth, Math.max(1, workArea.width - edgeMargin * 2));
  const height = Math.min(preferredHeight, Math.max(1, workArea.height - edgeMargin * 2));
  const minX = workArea.x + edgeMargin;
  const minY = workArea.y + edgeMargin;
  const maxX = workArea.x + workArea.width - width - edgeMargin;
  const maxY = workArea.y + workArea.height - height - edgeMargin;
  const rightEdge = workArea.x + workArea.width - edgeMargin;
  const bottomEdge = workArea.y + workArea.height - edgeMargin;
  const preferredX =
    pointerX + pointerOffset + width <= rightEdge
      ? pointerX + pointerOffset
      : pointerX - width - pointerOffset;
  const preferredY =
    pointerY + pointerOffset + height <= bottomEdge
      ? pointerY + pointerOffset
      : pointerY - height - pointerOffset;

  return {
    x: clamp(preferredX, minX, maxX),
    y: clamp(preferredY, minY, maxY),
    width,
    height,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}
