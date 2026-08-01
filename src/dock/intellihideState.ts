export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverlapCandidate {
  rectangle: Rectangle;
  focused?: boolean;
  topmost?: boolean;
  fullscreen?: boolean;
  excludedFromSmartReveal?: boolean;
}

export interface BlockingOverlapState {
  blocked: boolean;
  rectangles: Rectangle[];
}

/** Whether a window belongs to the workspace currently displayed by a dock. */
export function isOnActiveWorkspace(
  windowWorkspace: object | null,
  activeWorkspace: object | null,
  onAllWorkspaces: boolean,
): boolean {
  return onAllWorkspaces || windowWorkspace === activeWorkspace;
}

/** AABB overlap test used by intellihide. Touching edges do not count as overlap. */
export function rectanglesOverlap(first: Rectangle, second: Rectangle): boolean {
  const firstIsLeft = first.x + first.width <= second.x;
  const firstIsRight = second.x + second.width <= first.x;
  const firstIsAbove = first.y + first.height <= second.y;
  const firstIsBelow = second.y + second.height <= first.y;

  return !(firstIsLeft || firstIsRight || firstIsAbove || firstIsBelow);
}

/** Intellihide is blocked when any relevant window overlaps the dock. */
export function hasOverlap(rectangles: Rectangle[], target: Rectangle): boolean {
  return rectangles.some((rectangle) => rectanglesOverlap(rectangle, target));
}

/**
 * Computes the windows that are allowed to block intellihide.
 *
 * If an eligible candidate window is focused, only that focused window is
 * considered. If focus is on another monitor, only the topmost eligible window
 * on this monitor is considered. This prevents a fullscreen/maximized
 * background window from keeping the dock hidden while a small window is
 * visibly above it.
 *
 * Windows excluded from the smart-reveal exception (such as PiP) are skipped
 * while selecting that foreground window. A focused excluded window blocks
 * smart reveal unconditionally; otherwise the next eligible window underneath
 * remains authoritative. If every candidate is excluded, the dock also remains
 * hidden: an excluded foreground window must never reveal it.
 */
export function getBlockingOverlapState(
  candidates: OverlapCandidate[],
  target: Rectangle | null,
  monitorFullscreen: boolean,
): BlockingOverlapState {
  const smartRevealCandidates = candidates.filter(
    (candidate) => candidate.excludedFromSmartReveal !== true,
  );
  const focusedCandidatePreventsSmartReveal = candidates.some(
    (candidate) => candidate.focused === true && candidate.excludedFromSmartReveal === true,
  );
  const focusedCandidates = smartRevealCandidates.filter((candidate) => candidate.focused === true);
  const hasExplicitTopmostCandidate = candidates.some((candidate) => candidate.topmost === true);
  const topmostCandidate = hasExplicitTopmostCandidate ? smartRevealCandidates.at(-1) : undefined;
  const blockingCandidates =
    focusedCandidates.length > 0
      ? focusedCandidates
      : topmostCandidate
        ? [topmostCandidate]
        : smartRevealCandidates.length > 0
          ? smartRevealCandidates
          : candidates;
  const rectangles = blockingCandidates.map((candidate) => candidate.rectangle);
  const hasExclusiveWindow =
    focusedCandidatePreventsSmartReveal ||
    blockingCandidates.some((candidate) => candidate.fullscreen === true) ||
    (blockingCandidates.length === 0 && monitorFullscreen) ||
    (candidates.length > 0 && smartRevealCandidates.length === 0);

  return {
    blocked: hasExclusiveWindow || (target !== null && hasOverlap(rectangles, target)),
    rectangles,
  };
}
