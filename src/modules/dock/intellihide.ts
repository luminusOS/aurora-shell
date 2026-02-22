// @ts-nocheck
import '@girs/gjs';

import GObject from '@girs/gobject-2.0';
import Meta from '@girs/meta-17';
import Shell from '@girs/shell-17';

import * as Main from '@girs/gnome-shell/ui/main';

import type { DashBounds } from '../../ui/dash.ts';

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

export enum OverlapStatus {
  CLEAR = 0,
  BLOCKED = 1,
}

/**
 * Tracks whether any window overlaps the dock's target box on a given monitor.
 *
 * Emits 'status-changed' whenever the overlap state transitions between
 * CLEAR and BLOCKED so the Dock module can show/hide the dash accordingly.
 */
@GObject.registerClass({
  Signals: { 'status-changed': {} },
})
export class DockIntellihide extends GObject.Object {
  private declare _monitorIndex: number;
  private declare _tracker: Shell.WindowTracker | null;
  private _targetBox: DashBounds | null = null;
  private _status: OverlapStatus = OverlapStatus.CLEAR;
  private _focusActor: any = null;
  private _focusActorId = 0;

  _init(monitorIndex: number) {
    super._init();
    this._monitorIndex = monitorIndex;
    this._tracker = Shell.WindowTracker.get_default() ?? null;

    global.display.connectObject(
      'window-entered-monitor', () => this._checkOverlap(),
      'window-left-monitor', () => this._checkOverlap(),
      'restacked', () => this._checkOverlap(),
      'notify::focus-window', () => this._checkOverlap(),
      this
    );

    Main.layoutManager.connectObject('monitors-changed', () => this._checkOverlap(), this);
    this._tracker?.connectObject('notify::focus-app', () => this._checkOverlap(), this);
    Main.keyboard.connectObject('visibility-changed', () => this._onKeyboardVisibilityChanged(), this);
    Main.overview.connectObject(
      'showing', () => this._applyOverlap(false, true),
      'hidden', () => this._checkOverlap(),
      this
    );
  }

  get status(): OverlapStatus {
    return this._status;
  }

  updateTargetBox(box: DashBounds | null): void {
    this._targetBox = box;
    this._checkOverlap();
  }

  override destroy(): void {
    this._disconnectFocusActor();
    global.display.disconnectObject(this);
    Main.layoutManager.disconnectObject(this);
    this._tracker?.disconnectObject(this);
    this._tracker = null;
    Main.keyboard.disconnectObject(this);
    Main.overview.disconnectObject(this);
    this.disconnectObject?.(this);
  }

  private _checkOverlap(): void {
    if (Main.overview.visible) {
      this._applyOverlap(false, true);
      return;
    }

    if (!this._targetBox) return;

    this._disconnectFocusActor();

    const focusApp = this._tracker?.focus_app;
    if (!focusApp) {
      this._checkRemainingWindows();
      return;
    }

    let focusWin = focusApp.get_windows().find((w) => this._isCandidateWindow(w));

    // On the primary monitor, ignore windows from other workspaces
    if (focusWin && this._monitorIndex === Main.layoutManager.primaryIndex) {
      const activeWs = global.workspace_manager.get_active_workspace();
      if (focusWin.get_workspace() !== activeWs) focusWin = null;
    }

    if (!focusWin) {
      this._checkRemainingWindows();
      return;
    }

    this._applyOverlap(this._doesOverlap(focusWin.get_frame_rect()), true);

    // Track the focused window's allocation to update overlap in real time
    this._focusActor = focusWin.get_compositor_private();
    if (this._focusActor) {
      this._focusActorId = this._focusActor.connect('notify::allocation', () => {
        this._applyOverlap(this._doesOverlap(focusWin.get_frame_rect()));
      });
    }
  }

  private _checkRemainingWindows(): void {
    const windows = global.get_window_actors()
      .map((actor: any) => actor.meta_window)
      .filter((win: Meta.Window) => this._isCandidateWindow(win));

    const overlap = windows.some((win: Meta.Window) => this._doesOverlap(win.get_frame_rect()));
    this._applyOverlap(overlap, windows.length === 0);
  }

  private _isCandidateWindow(win: Meta.Window | null): win is Meta.Window {
    if (!win || win.get_monitor() !== this._monitorIndex) return false;
    if (win.minimized || !win.showing_on_its_workspace()) return false;

    if (this._monitorIndex === Main.layoutManager.primaryIndex) {
      if (win.get_workspace() !== global.workspace_manager.get_active_workspace()) return false;
    }

    return OVERLAP_WINDOW_TYPES.includes(win.get_window_type());
  }

  /** AABB overlap test between a window rectangle and the dock's target box. */
  private _doesOverlap(rect: Meta.Rectangle): boolean {
    const t = this._targetBox!;
    return !(
      rect.x + rect.width < t.x ||
      t.x + t.width < rect.x ||
      rect.y + rect.height < t.y ||
      t.y + t.height < rect.y
    );
  }

  private _applyOverlap(overlap: boolean, force = false): void {
    const newStatus = overlap ? OverlapStatus.BLOCKED : OverlapStatus.CLEAR;
    if (!force && newStatus === this._status) return;
    this._status = newStatus;
    this.emit('status-changed');
  }

  private _disconnectFocusActor(): void {
    if (this._focusActor && this._focusActorId) {
      this._focusActor.disconnect(this._focusActorId);
      this._focusActorId = 0;
      this._focusActor = null;
    }
  }

  private _onKeyboardVisibilityChanged(): void {
    this._applyOverlap(Main.keyboard.visible, true);
    if (!Main.keyboard.visible) this._checkOverlap();
  }
}
