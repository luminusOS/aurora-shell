export type DashVisibilityState = {
  target: 'shown' | 'hidden';
  blocked: boolean;
  hovered: boolean;
  menuOpen: boolean;
  dragHeld: boolean;
};

export function shouldHideDash(state: DashVisibilityState): boolean {
  return !state.blocked && !state.hovered && !state.menuOpen && !state.dragHeld;
}

export type DashWindow = {
  monitor: number;
  workspace: number;
  sticky?: boolean;
  skipTaskbar?: boolean;
};

export function selectDashWindows<T extends DashWindow>(
  windows: readonly T[],
  monitor: number,
  workspace: number,
  isolateMonitor: boolean,
): T[] {
  return windows.filter((window) =>
    isDashWindowRelevant(window, monitor, workspace, isolateMonitor),
  );
}

export function isDashWindowRelevant(
  window: DashWindow,
  monitor: number,
  workspace: number,
  isolateMonitor: boolean,
): boolean {
  return (
    !window.skipTaskbar &&
    (window.sticky || window.workspace === workspace) &&
    (!isolateMonitor || window.monitor === monitor)
  );
}
