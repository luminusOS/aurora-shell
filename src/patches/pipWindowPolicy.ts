const PIP_TITLES = new Set(['picture-in-picture', 'picture in picture']);

export interface PipWindowState {
  isAbove(): boolean;
  isOnAllWorkspaces(): boolean;
  makeAbove(): void;
  makeSticky(): void;
  unmakeAbove(): void;
  unmakeSticky(): void;
}

export interface PipWindowOwnership {
  madeAbove: boolean;
  madeSticky: boolean;
}

export function isPipTitle(title: string | null): boolean {
  if (!title) return false;

  const normalizedTitle = title.trim().toLowerCase();
  return PIP_TITLES.has(normalizedTitle) || normalizedTitle.endsWith(' - pip');
}

export function enforcePipWindow(
  window: PipWindowState,
  ownership: PipWindowOwnership | null,
): PipWindowOwnership {
  const nextOwnership = ownership ?? {
    madeAbove: !window.isAbove(),
    madeSticky: !window.isOnAllWorkspaces(),
  };

  if (!window.isAbove()) window.makeAbove();
  if (!window.isOnAllWorkspaces()) window.makeSticky();

  return nextOwnership;
}

export function restorePipWindow(window: PipWindowState, ownership: PipWindowOwnership): void {
  if (ownership.madeSticky && window.isOnAllWorkspaces()) window.unmakeSticky();
  if (ownership.madeAbove && window.isAbove()) window.unmakeAbove();
}
