export type Rectangle = { x: number; y: number; width: number; height: number };

export type ToolbarPlacement = {
  monitor: Rectangle;
  selection: Rectangle;
  protectedArea?: Rectangle;
  toolbar: {
    width: number;
    height: number;
    stageX: number;
    stageY: number;
    translationX: number;
    translationY: number;
  };
  margin: number;
};

export type ToolbarTranslation = { x: number; y: number };

export function findMonitorForSelection(
  selection: Rectangle,
  monitors: readonly Rectangle[],
  primaryIndex: number,
): Rectangle | null {
  let selectedMonitor: Rectangle | null = null;
  let selectedArea = 0;

  for (const monitor of monitors) {
    if (!isValidRectangle(monitor)) continue;
    const intersectionWidth = Math.max(
      0,
      Math.min(selection.x + selection.width, monitor.x + monitor.width) -
        Math.max(selection.x, monitor.x),
    );
    const intersectionHeight = Math.max(
      0,
      Math.min(selection.y + selection.height, monitor.y + monitor.height) -
        Math.max(selection.y, monitor.y),
    );
    const intersectionArea = intersectionWidth * intersectionHeight;
    if (!Number.isFinite(intersectionArea) || intersectionArea <= selectedArea) continue;

    selectedMonitor = monitor;
    selectedArea = intersectionArea;
  }

  if (selectedMonitor) return selectedMonitor;
  const primaryMonitor = monitors[primaryIndex];
  if (primaryMonitor && isValidRectangle(primaryMonitor)) return primaryMonitor;

  const fallbackMonitor = monitors.find(isValidRectangle);
  if (!fallbackMonitor) return null;

  return fallbackMonitor;
}

export function calculateToolbarTranslation(
  placement: ToolbarPlacement,
): ToolbarTranslation | null {
  const { monitor, selection, protectedArea, toolbar, margin } = placement;
  const coordinates = [
    monitor.x,
    monitor.y,
    monitor.width,
    monitor.height,
    selection.x,
    selection.y,
    selection.width,
    selection.height,
    toolbar.width,
    toolbar.height,
    toolbar.stageX,
    toolbar.stageY,
    toolbar.translationX,
    toolbar.translationY,
    margin,
  ];
  if (!coordinates.every(Number.isFinite)) return null;
  if (
    monitor.width <= 0 ||
    monitor.height <= 0 ||
    selection.width <= 0 ||
    selection.height <= 0 ||
    toolbar.width <= 0 ||
    toolbar.height <= 0
  )
    return null;
  if (protectedArea && !isValidRectangle(protectedArea)) return null;

  const anchorX = toolbar.stageX - toolbar.translationX;
  const anchorY = toolbar.stageY - toolbar.translationY;
  const desiredX = Math.max(
    monitor.x,
    Math.min(
      selection.x + selection.width / 2 - toolbar.width / 2,
      monitor.x + monitor.width - toolbar.width,
    ),
  );
  let desiredY = selection.y - toolbar.height - margin;
  if (desiredY < monitor.y) desiredY = selection.y + selection.height + margin;
  desiredY = Math.max(monitor.y, Math.min(desiredY, monitor.y + monitor.height - toolbar.height));

  if (
    protectedArea &&
    rectanglesOverlap(
      { x: desiredX, y: desiredY, width: toolbar.width, height: toolbar.height },
      protectedArea,
    )
  ) {
    const candidates = [
      protectedArea.y - toolbar.height - margin,
      protectedArea.y + protectedArea.height + margin,
    ].filter((candidateY) => {
      const toolbarRectangle = {
        x: desiredX,
        y: candidateY,
        width: toolbar.width,
        height: toolbar.height,
      };
      return (
        candidateY >= monitor.y &&
        candidateY + toolbar.height <= monitor.y + monitor.height &&
        !rectanglesOverlap(toolbarRectangle, protectedArea)
      );
    });

    if (candidates.length > 0) {
      candidates.sort((first, second) => Math.abs(first - desiredY) - Math.abs(second - desiredY));
      desiredY = candidates[0]!;
    }
  }

  const translation = {
    x: Math.round(desiredX - anchorX),
    y: Math.round(desiredY - anchorY),
  };
  return Number.isFinite(translation.x) && Number.isFinite(translation.y) ? translation : null;
}

function rectanglesOverlap(first: Rectangle, second: Rectangle): boolean {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

function isValidRectangle(rectangle: Rectangle): boolean {
  return (
    [rectangle.x, rectangle.y, rectangle.width, rectangle.height].every(Number.isFinite) &&
    rectangle.width > 0 &&
    rectangle.height > 0
  );
}
