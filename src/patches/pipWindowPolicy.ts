const PIP_TITLE_SUFFIX = /(?:^|\s[-|:]\s)(?:picture[- ]in[- ]picture|pip)$/;

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

  const normalizedTitle = title
    .trim()
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, '-');
  return PIP_TITLE_SUFFIX.test(normalizedTitle);
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
