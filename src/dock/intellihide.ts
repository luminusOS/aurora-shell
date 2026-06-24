import '@girs/gjs';

import GObject from '@girs/gobject-2.0';
import GLib from '@girs/glib-2.0';
import Meta from '@girs/meta-18';

import * as Main from '@girs/gnome-shell/ui/main';

import { logger } from '~/core/logger.ts';
import {
  getBlockingOverlapState,
  isOnActiveWorkspace,
  rectanglesOverlap,
} from '~/dock/intellihideState.ts';
import type { DashBounds } from '~/shared/ui/dash.ts';

const LOG_PREFIX = 'DockIntellihide';

/**
 * Quiet period before a computed overlap status is committed. Window lifecycle
 * events (creation, placement, monitor moves, restacks) make `get_frame_rect()`
 * report transient geometry — a 0x0 rect before placement, then the full work
 * area, then the real size — all within a fraction of a second. Committing each
 * transient toggles the dock ("piscando"/"aparecendo"). Coalescing to the last
 * stable value avoids the flicker while staying imperceptible.
 */
const STATUS_SETTLE_DELAY = 150;

/** Window types considered when checking whether a window overlaps the dock. */
const OVERLAP_WINDOW_TYPES: Meta.WindowType[] = [
  Meta.WindowType.NORMAL,
  Meta.WindowType.DOCK,
  Meta.WindowType.DIALOG,
  Meta.WindowType.MODAL_DIALOG,
  Meta.WindowType.TOOLBAR,
  Meta.WindowType.MENU,
  Meta.WindowType.UTILITY,
  Meta.WindowType.SPLASHSCREEN,
];

const TRACKED_WINDOW_SIGNALS = [
  'position-changed',
  'size-changed',
  'workspace-changed',
  'notify::fullscreen',
  'notify::main-monitor',
  'notify::maximized-horizontally',
  'notify::maximized-vertically',
  'notify::minimized',
  'notify::on-all-workspaces',
] as const;

export enum OverlapStatus {
  CLEAR = 0,
  BLOCKED = 1,
}

@GObject.registerClass({
  Signals: { 'status-changed': {}, 'blocked-reasserted': {} },
})
export class DockIntellihide extends GObject.Object {
  declare private _monitorIndex: number;
  private _targetBox: DashBounds | null = null;
  private _status: OverlapStatus | null = null;
  private _settleId = 0;
  private _pendingStatus: OverlapStatus = OverlapStatus.CLEAR;
  private _pendingReason = '';
  private _pendingRectangles: Array<{ x: number; y: number; width: number; height: number }> = [];
  declare private _trackedWindowActors: Set<any>;
  declare private _trackedWindows: Set<Meta.Window>;
  declare private _queuedRefreshIds: Set<number>;

  override _init(monitorIndex: number) {
    super._init();
    this._monitorIndex = monitorIndex;
    this._trackedWindowActors = new Set<any>();
    this._trackedWindows = new Set<Meta.Window>();
    this._queuedRefreshIds = new Set<number>();

    global.display.connectObject(
      'window-entered-monitor',
      () => this._queueRefresh('window-entered-monitor'),
      'window-left-monitor',
      () => this._queueRefresh('window-left-monitor'),
      'window-created',
      () => this._queueRefresh('window-created', [0, 100, 400, 1000]),
      'restacked',
      () => this._queueRefresh('restacked', [100, 250]),
      'notify::focus-window',
      () => this._queueRefresh('focus-window', [0, 50, 150]),
      'in-fullscreen-changed',
      () => this._queueRefresh('display-fullscreen-changed', [0, 100, 400]),
      this,
    );

    Main.layoutManager.connectObject(
      'monitors-changed',
      () => this._queueRefresh('monitors-changed', [0, 100, 400]),
      this,
    );
    global.workspace_manager.connectObject(
      'active-workspace-changed',
      () => this._queueRefresh('active-workspace-changed', [0, 100]),
      this,
    );
    Main.keyboard.connectObject(
      'visibility-changed',
      () => this._onKeyboardVisibilityChanged(),
      this,
    );
    Main.overview.connectObject(
      'showing',
      () => this._applyOverlap(false, 'overview-showing', []),
      'hidden',
      () => this._checkOverlap('overview-hidden'),
      this,
    );

    logger.debug(`monitor=${monitorIndex} initialized`, { prefix: LOG_PREFIX });
    this._queueRefresh('initial', [0, 250, 1000]);
  }

  get status(): OverlapStatus {
    return this._status ?? OverlapStatus.CLEAR;
  }

  updateTargetBox(box: DashBounds | null): void {
    this._targetBox = box;
    logger.debug(`monitor=${this._monitorIndex} target=${this._formatRectangle(box)}`, {
      prefix: LOG_PREFIX,
    });
    this._checkOverlap('target-box');
  }

  refresh(reason = 'manual-refresh', force = false): void {
    this._checkOverlap(reason, force);
  }

  destroy(): void {
    this._cancelPendingStatus();
    for (const id of this._queuedRefreshIds) {
      GLib.source_remove(id);
    }
    this._queuedRefreshIds.clear();
    this._clearTrackedWindows();
    global.display.disconnectObject(this);
    Main.layoutManager.disconnectObject(this);
    global.workspace_manager.disconnectObject(this);
    Main.keyboard.disconnectObject(this);
    Main.overview.disconnectObject(this);
  }

  private _checkOverlap(reason = 'unspecified', force = false): void {
    if (!this._isMonitorValid()) return;

    if (Main.overview.visible) {
      this._applyOverlap(false, reason, [], force);
      return;
    }

    if (Main.keyboard.visible) {
      this._applyOverlap(true, reason, [], force);
      return;
    }

    const candidates = global
      .get_window_actors()
      .map((actor: any) => ({ actor, window: actor.meta_window as Meta.Window }))
      .filter(({ window }) => this._isCandidateWindow(window));

    this._syncTrackedWindows(candidates);
    const focusedWindow = this._getFocusedCandidateWindow(candidates);
    const overlapState = getBlockingOverlapState(
      candidates.map(({ window }, index) => ({
        rectangle: window.get_frame_rect(),
        focused: focusedWindow === window,
        topmost: index === candidates.length - 1,
        fullscreen: window.is_fullscreen(),
      })),
      this._targetBox,
      global.display.get_monitor_in_fullscreen(this._monitorIndex),
    );

    if (!this._targetBox && !overlapState.blocked) return;

    this._applyOverlap(overlapState.blocked, reason, overlapState.rectangles, force);

    // Switching focus between two blocking windows (e.g. two fullscreen windows)
    // keeps the status at BLOCKED, so `_applyOverlap` emits no `status-changed`.
    // Reassert the blocked state on focus changes so consumers can re-evaluate
    // (the dock uses this to dismiss a lingering hot-area reveal).
    if (overlapState.blocked && reason === 'focus-window') {
      this.emit('blocked-reasserted');
    }
  }

  private _getFocusedCandidateWindow(
    candidates: Array<{ actor: any; window: Meta.Window }>,
  ): Meta.Window | null {
    const focusWindow = global.display.focus_window as Meta.Window | null;
    if (!focusWindow) return null;
    return candidates.some(({ window }) => window === focusWindow) ? focusWindow : null;
  }

  private _queueRefresh(reason: string, delays: number[] = [0]): void {
    for (const delay of delays) {
      const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
        this._queuedRefreshIds.delete(id);
        this._checkOverlap(reason);
        return GLib.SOURCE_REMOVE;
      });
      this._queuedRefreshIds.add(id);
    }
  }

  private _isMonitorValid(): boolean {
    const monitors = Main.layoutManager.monitors ?? [];
    return this._monitorIndex >= 0 && this._monitorIndex < monitors.length;
  }

  private _isCandidateWindow(win: Meta.Window | null): win is Meta.Window {
    if (!win || !this._windowBelongsToMonitor(win)) return false;
    if (win.minimized) return false;

    // A window mid-creation/placement reports a 0x0 frame before mutter places
    // it. Such a degenerate rect never meaningfully overlaps the dock and only
    // injects spurious CLEAR flaps, so ignore it until it has real geometry.
    const frame = win.get_frame_rect();
    if (frame.width <= 0 || frame.height <= 0) return false;

    if (
      !isOnActiveWorkspace(
        win.get_workspace(),
        global.workspace_manager.get_active_workspace(),
        win.is_on_all_workspaces(),
      )
    )
      return false;

    return OVERLAP_WINDOW_TYPES.includes(win.get_window_type());
  }

  private _windowBelongsToMonitor(win: Meta.Window): boolean {
    if (win.get_monitor() === this._monitorIndex) return true;

    const monitor = Main.layoutManager.monitors?.[this._monitorIndex];
    if (!monitor) return false;

    return rectanglesOverlap(win.get_frame_rect(), monitor);
  }

  private _applyOverlap(
    overlap: boolean,
    reason: string,
    rectangles: Array<{ x: number; y: number; width: number; height: number }>,
    force = false,
  ): void {
    // Forced updates (overview/keyboard transitions, explicit resyncs) are not
    // geometry flaps and must take effect at once. Everything else is debounced
    // so transient window geometry cannot toggle the dock.
    if (force) {
      this._cancelPendingStatus();
      this._commitStatus(overlap, reason, rectangles, true);
      return;
    }
    this._scheduleStatus(overlap, reason, rectangles);
  }

  private _scheduleStatus(
    overlap: boolean,
    reason: string,
    rectangles: Array<{ x: number; y: number; width: number; height: number }>,
  ): void {
    const newStatus = overlap ? OverlapStatus.BLOCKED : OverlapStatus.CLEAR;

    if (this._settleId !== 0) {
      // A commit for the same value is already pending: keep its timer running
      // (so a steady stream of identical rechecks still settles on schedule),
      // only refreshing the details logged on commit.
      if (newStatus === this._pendingStatus) {
        this._pendingReason = reason;
        this._pendingRectangles = rectangles;
        return;
      }
      // The target flipped before settling — restart the quiet period.
      GLib.source_remove(this._settleId);
      this._settleId = 0;
    }

    // The value reverted to what is already committed; nothing to do.
    if (newStatus === this._status) return;

    this._pendingStatus = newStatus;
    this._pendingReason = reason;
    this._pendingRectangles = rectangles;
    this._settleId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, STATUS_SETTLE_DELAY, () => {
      this._settleId = 0;
      this._commitStatus(
        this._pendingStatus === OverlapStatus.BLOCKED,
        this._pendingReason,
        this._pendingRectangles,
      );
      return GLib.SOURCE_REMOVE;
    });
  }

  private _cancelPendingStatus(): void {
    if (!this._settleId) return;
    GLib.source_remove(this._settleId);
    this._settleId = 0;
  }

  private _commitStatus(
    overlap: boolean,
    reason: string,
    rectangles: Array<{ x: number; y: number; width: number; height: number }>,
    force = false,
  ): void {
    const newStatus = overlap ? OverlapStatus.BLOCKED : OverlapStatus.CLEAR;
    if (!force && newStatus === this._status) return;
    const oldStatus = this._status === null ? 'UNKNOWN' : OverlapStatus[this._status];
    this._status = newStatus;
    const workspace = global.workspace_manager.get_active_workspace_index();
    logger.debug(
      `monitor=${this._monitorIndex} workspace=${workspace} ${oldStatus}->${OverlapStatus[newStatus]} reason=${reason}${force ? ' force=true' : ''} target=${this._formatRectangle(this._targetBox)} candidates=${rectangles.length} rects=[${rectangles.map((rectangle) => this._formatRectangle(rectangle)).join(';')}]`,
      { prefix: LOG_PREFIX },
    );
    this.emit('status-changed');
  }

  private _syncTrackedWindows(candidates: Array<{ actor: any; window: Meta.Window }>): void {
    const nextActors = new Set(candidates.map(({ actor }) => actor));
    const nextWindows = new Set(candidates.map(({ window }) => window));

    for (const actor of this._trackedWindowActors) {
      if (nextActors.has(actor)) continue;
      this._safeDisconnect(actor);
      this._trackedWindowActors.delete(actor);
    }

    for (const actor of nextActors) {
      if (this._trackedWindowActors.has(actor)) continue;
      try {
        actor.connectObject(
          'notify::allocation',
          () => this._checkOverlap('window-allocation'),
          this,
        );
        this._trackedWindowActors.add(actor);
      } catch {
        // Ignore actors disposed while the global window list is being updated.
      }
    }

    for (const win of this._trackedWindows) {
      if (nextWindows.has(win)) continue;
      this._safeDisconnect(win);
      this._trackedWindows.delete(win);
    }

    for (const win of nextWindows) {
      if (this._trackedWindows.has(win)) continue;
      try {
        this._connectTrackedWindow(win);
        this._trackedWindows.add(win);
      } catch {
        // Ignore windows unmanaged while signals are being connected.
      }
    }
  }

  private _connectTrackedWindow(win: Meta.Window): void {
    const signalArgs: any[] = [];
    for (const signal of TRACKED_WINDOW_SIGNALS) {
      signalArgs.push(signal, () => this._checkOverlap(signal));
    }
    (win as any).connectObject(...signalArgs, this);
  }

  private _clearTrackedWindows(): void {
    for (const actor of this._trackedWindowActors) {
      this._safeDisconnect(actor);
    }
    this._trackedWindowActors.clear();

    for (const win of this._trackedWindows) {
      this._safeDisconnect(win);
    }
    this._trackedWindows.clear();
  }

  private _safeDisconnect(target: unknown): void {
    try {
      (target as { disconnectObject?: (object: unknown) => void }).disconnectObject?.(this);
    } catch {
      // The object may already be disposed or unmanaged by Shell.
    }
  }

  private _onKeyboardVisibilityChanged(): void {
    this._checkOverlap('keyboard-visibility');
  }

  private _formatRectangle(
    rectangle: { x: number; y: number; width: number; height: number } | null,
  ): string {
    if (!rectangle) return 'none';
    return `${rectangle.x},${rectangle.y} ${rectangle.width}x${rectangle.height}`;
  }
}
