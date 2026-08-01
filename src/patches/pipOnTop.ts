import { gettext as _ } from '~/shared/i18n.ts';
import type Meta from '@girs/meta-18';

import type { ExtensionContext } from '~/core/context.ts';
import { Module } from '~/module.ts';
import {
  enforcePipWindow,
  isPipTitle,
  restorePipWindow,
  type PipWindowOwnership,
  type PipWindowState,
} from '~/patches/pipWindowPolicy.ts';

interface TrackedWindow {
  ownership: PipWindowOwnership | null;
  syncing: boolean;
}

function toWindowState(window: Meta.Window): PipWindowState {
  return {
    isAbove: () => window.is_above(),
    isOnAllWorkspaces: () => window.is_on_all_workspaces(),
    makeAbove: () => window.make_above(),
    makeSticky: () => window.stick(),
    unmakeAbove: () => window.unmake_above(),
    unmakeSticky: () => window.unstick(),
  };
}

/**
 * PipOnTop Module
 *
 * Keeps Picture-in-Picture (PiP) windows above normal windows and visible on
 * every workspace. Mutter preserves their monitor and frame geometry.
 */
export class PipOnTop extends Module {
  private readonly _trackedWindows = new Map<Meta.Window, TrackedWindow>();

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    global.display.connectObject(
      'window-created',
      (_display: Meta.Display, window: Meta.Window) => this._trackWindow(window),
      this,
    );

    for (const actor of global.get_window_actors()) {
      const window = actor.meta_window;
      if (window) this._trackWindow(window);
    }
  }

  override disable(): void {
    global.display.disconnectObject(this);

    for (const [window, tracked] of this._trackedWindows) {
      this._restoreWindow(window, tracked);
      window.disconnectObject(this);
    }
    this._trackedWindows.clear();
  }

  private _trackWindow(window: Meta.Window): void {
    if (this._trackedWindows.has(window)) return;

    const tracked: TrackedWindow = {
      ownership: null,
      syncing: false,
    };
    this._trackedWindows.set(window, tracked);

    window.connectObject(
      'notify::title',
      () => this._syncWindow(window),
      'notify::above',
      () => this._syncWindow(window),
      'notify::on-all-workspaces',
      () => this._syncWindow(window),
      'unmanaged',
      () => this._trackedWindows.delete(window),
      this,
    );
    this._syncWindow(window);
  }

  private _syncWindow(window: Meta.Window): void {
    const tracked = this._trackedWindows.get(window);
    if (!tracked || tracked.syncing) return;

    tracked.syncing = true;
    try {
      const state = toWindowState(window);
      if (isPipTitle(window.get_title())) {
        tracked.ownership = enforcePipWindow(state, tracked.ownership);
      } else {
        this._restoreWindowState(state, tracked);
      }
    } finally {
      tracked.syncing = false;
    }
  }

  private _restoreWindow(window: Meta.Window, tracked: TrackedWindow): void {
    if (tracked.syncing) return;

    tracked.syncing = true;
    try {
      this._restoreWindowState(toWindowState(window), tracked);
    } finally {
      tracked.syncing = false;
    }
  }

  private _restoreWindowState(state: PipWindowState, tracked: TrackedWindow): void {
    if (!tracked.ownership) return;

    restorePipWindow(state, tracked.ownership);
    tracked.ownership = null;
  }
}
