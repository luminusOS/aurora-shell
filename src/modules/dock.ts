// @ts-nocheck
import '@girs/gjs';

import St from '@girs/st-17';
import Clutter from '@girs/clutter-17';
import GObject from '@girs/gobject-2.0';
import Meta from '@girs/meta-17';
import Shell from '@girs/shell-17';
import GLib from '@girs/glib-2.0';

import * as Main from '@girs/gnome-shell/ui/main';
import * as Layout from '@girs/gnome-shell/ui/layout';

import { Module } from './module.ts';
import { AuroraDash, type DashBounds } from '../ui/dash.ts';

const HOT_AREA_TRIGGER_SPEED = 150;
const HOT_AREA_TRIGGER_TIMEOUT = 550;
const HOT_AREA_REVEAL_DURATION = 1500;
/** Height (in pixels) of the invisible strip at the screen bottom that triggers dock reveal. */
const HOT_AREA_STRIP_HEIGHT = 1;

const HOT_AREA_ALLOWED_MODES = Shell.ActionMode.ALL ?? [
  Shell.ActionMode.NORMAL,
  Shell.ActionMode.OVERVIEW,
  Shell.ActionMode.POPUP,
  Shell.ActionMode.FULLSCREEN,
].reduce((mask, mode) => mask | (typeof mode === 'number' ? mode : 0), 0);

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

enum OverlapStatus {
  UNDEFINED = -1,
  CLEAR = 0,
  BLOCKED = 1,
}

type MonitorGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ManagedDockBinding = {
  monitorIndex: number;
  container: St.Bin;
  dash: AuroraDash;
  intellihide: InstanceType<typeof DockIntellihide>;
  hotArea: InstanceType<typeof DockHotArea> | null;
  autoHideReleaseId: number;
  destroyed: boolean;
  hotAreaActive: boolean;
};

// -- Hot Area --

/**
 * Invisible input barrier at the bottom screen edge.
 *
 * Uses a GNOME Shell PressureBarrier plus a thin reactive widget to detect
 * when the user pushes the pointer against the bottom edge, then emits
 * 'triggered' so the Dock module can reveal the dash.
 */
const DockHotArea = GObject.registerClass({
  Signals: { triggered: {} },
}, class DockHotArea extends St.Widget {
  private _pressureBarrier: any;
  private _horizontalBarrier: Meta.Barrier | null = null;
  private _triggerAllowed = true;
  private _monitor: MonitorGeometry;

  _init(monitor: MonitorGeometry) {
    super._init({ reactive: true, visible: true, name: 'aurora-dock-hot-area' });
    this._monitor = monitor;

    this._pressureBarrier = new Layout.PressureBarrier(
      HOT_AREA_TRIGGER_SPEED,
      HOT_AREA_TRIGGER_TIMEOUT,
      HOT_AREA_ALLOWED_MODES || Shell.ActionMode.NORMAL
    );

    this._pressureBarrier.connectObject('trigger', () => {
      if (this._triggerAllowed) this.emit('triggered');
    }, this);

    this.connectObject('enter-event', () => {
      if (this._triggerAllowed) this.emit('triggered');
      return Clutter.EVENT_PROPAGATE;
    }, this);

    // Suppress triggers while the user is dragging a window
    global.display.connectObject(
      'grab-op-begin', (_d: any, _w: any, op: Meta.GrabOp) => {
        if (op === Meta.GrabOp.MOVING) this._triggerAllowed = false;
      },
      'grab-op-end', (_d: any, _w: any, op: Meta.GrabOp) => {
        if (op === Meta.GrabOp.MOVING) this._triggerAllowed = true;
      },
      this
    );
  }

  setGeometry(monitor: MonitorGeometry): void {
    this._monitor = monitor;
    this._rebuildBarrier(monitor.width);
  }

  setBarrierSize(size: number): void {
    this._rebuildBarrier(size);
  }

  override destroy(): void {
    global.display.disconnectObject(this);
    this._destroyBarrier();

    this._pressureBarrier?.disconnectObject?.(this);
    this._pressureBarrier?.destroy?.();
    this._pressureBarrier = null;

    super.destroy();
  }

  private _rebuildBarrier(size: number): void {
    if (!this._pressureBarrier) return;

    this._destroyBarrier();

    const width = Number.isFinite(size) ? size : 0;
    const left = this._monitor.x;
    const bottom = this._monitor.y + this._monitor.height;

    if (width <= 0 || !Number.isFinite(left) || !Number.isFinite(bottom)) return;

    this._horizontalBarrier = new Meta.Barrier({
      backend: global.backend,
      x1: left,
      x2: left + width,
      y1: bottom,
      y2: bottom,
      directions: Meta.BarrierDirection.POSITIVE_Y,
    });

    this._pressureBarrier.addBarrier(this._horizontalBarrier);
  }

  private _destroyBarrier(): void {
    if (!this._horizontalBarrier) return;
    this._pressureBarrier?.removeBarrier(this._horizontalBarrier);
    this._horizontalBarrier.destroy();
    this._horizontalBarrier = null;
  }
});

// -- Intellihide --

/**
 * Tracks whether any window overlaps the dock's target box on a given monitor.
 *
 * Emits 'status-changed' whenever the overlap state transitions between
 * CLEAR and BLOCKED so the Dock module can show/hide the dash accordingly.
 */
const DockIntellihide = GObject.registerClass({
  Properties: {
    'monitor-index': GObject.ParamSpec.int(
      'monitor-index', 'Monitor Index',
      'Monitor tracked for dock overlap checks',
      GObject.ParamFlags.READWRITE, -1, 32,
      Main.layoutManager.primaryIndex
    ),
  },
  Signals: { 'status-changed': {} },
}, class DockIntellihide extends GObject.Object {
  private _monitorIndex = Main.layoutManager.primaryIndex;
  private _tracker: Shell.WindowTracker | null = null;
  private _targetBox: DashBounds | null = null;
  private _status: OverlapStatus = OverlapStatus.UNDEFINED;
  private _focusActor: any = null;
  private _focusActorId = 0;
  private _destroyed = false;

  _init(params: { 'monitor-index'?: number } = {}) {
    super._init(params);
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

  get monitorIndex(): number {
    return this._monitorIndex;
  }

  set monitorIndex(index: number) {
    if (typeof index !== 'number' || this._monitorIndex === index) return;
    this._monitorIndex = index;
    this._checkOverlap();
  }

  get status(): OverlapStatus {
    return this._status;
  }

  updateTargetBox(box: DashBounds | null): void {
    this._targetBox = box;
    this._checkOverlap();
  }

  override destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    this._disconnectFocusActor();
    global.display.disconnectObject(this);
    Main.layoutManager.disconnectObject(this);
    this._tracker?.disconnectObject(this);
    this._tracker = null;
    Main.keyboard.disconnectObject(this);
    Main.overview.disconnectObject(this);
    this.disconnectObject?.(this);

    // GObject.Object has no destroy(); use run_dispose() instead
    (this as unknown as { run_dispose?: () => void }).run_dispose?.();
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
});

// -- Dock Module --

/**
 * Dock module for Aurora Shell.
 *
 * Manages per-monitor dock bindings, each consisting of:
 * - An {@link AuroraDash} widget (the visible dock)
 * - A {@link DockIntellihide} instance (auto-hide when windows overlap)
 * - A {@link DockHotArea} input barrier (reveal dock on bottom-edge push)
 *
 * The module hides the default GNOME overview dash and replaces it with
 * its own dock on every monitor whose bottom edge is not occluded by
 * another monitor (multi-monitor aware).
 */
export class Dock extends Module {
  private _bindings = new Map<number, ManagedDockBinding>();

  override enable(): void {
    Main.overview.dash.hide();

    this._rebuildBindings();
    Main.layoutManager.connectObject(
      'monitors-changed', () => this._rebuildBindings(),
      'hot-corners-changed', () => this._rebuildBindings(),
      this
    );
    global.display.connectObject('workareas-changed', () => this._refreshWorkAreas(), this);
    Main.sessionMode.connectObject('updated', () => this._refreshBindingsLayout(), this);

    // Hide the dock while the overview or app grid is visible
    Main.overview.connectObject(
      'showing', () => this._setOverviewVisible(true),
      'hidden', () => this._setOverviewVisible(false),
      this
    );
  }

  override disable(): void {
    Main.overview.dash.show();
    Main.layoutManager.disconnectObject(this);
    global.display.disconnectObject(this);
    Main.sessionMode.disconnectObject(this);
    Main.overview.disconnectObject(this);
    this._clearBindings();
  }

  private _rebuildBindings(): void {
    this._clearBindings();

    const monitors: MonitorGeometry[] = Main.layoutManager.monitors ?? [];
    monitors.forEach((monitor, index) => {
      if (this._hasDefinedBottom(monitors, index)) {
        const binding = this._createBinding(monitor, index);
        if (binding) this._bindings.set(index, binding);
      }
    });

    this._refreshWorkAreas();
  }

  private _createBinding(monitor: MonitorGeometry, monitorIndex: number): ManagedDockBinding | null {
    const container = new St.Bin({
      name: `aurora-dock-container-${monitorIndex}`,
      reactive: false,
      visible: false,
    });

    Main.layoutManager.addChrome(container, {
      trackFullscreen: true,
      affectsInputRegion: true,
      affectsStruts: false,
    });

    const dash = new AuroraDash({ monitorIndex });
    container.set_child(dash);
    dash.attachToContainer(container);

    const intellihide = new DockIntellihide({ 'monitor-index': monitorIndex });
    dash.setTargetBoxListener((box) => intellihide.updateTargetBox(box));

    const binding: ManagedDockBinding = {
      monitorIndex,
      container,
      dash,
      intellihide,
      hotArea: null,
      autoHideReleaseId: 0,
      destroyed: false,
      hotAreaActive: false,
    };

    binding.hotArea = this._createHotArea(binding, monitor);

    intellihide.connectObject('status-changed', () => {
      if (binding.hotAreaActive) return;

      if (intellihide.status === OverlapStatus.CLEAR) {
        this._clearHotAreaReveal(binding);
        dash.blockAutoHide(true);
        dash.show(true);
      } else if (intellihide.status === OverlapStatus.BLOCKED) {
        dash.blockAutoHide(false);
      }
    }, this);

    return binding;
  }

  private _createHotArea(binding: ManagedDockBinding, monitor: MonitorGeometry): InstanceType<typeof DockHotArea> | null {
    if (!isValidMonitor(monitor)) return null;

    const hotArea = new DockHotArea(monitor);
    Main.layoutManager.addChrome(hotArea, {
      trackFullscreen: true,
      affectsInputRegion: true,
      affectsStruts: false,
    });

    hotArea.set_size(monitor.width, HOT_AREA_STRIP_HEIGHT);
    hotArea.set_position(monitor.x, monitor.y + monitor.height - HOT_AREA_STRIP_HEIGHT);
    hotArea.setBarrierSize(monitor.width);

    hotArea.connectObject('triggered', () => this._revealDockFromHotArea(binding), this);

    return hotArea;
  }

  private _refreshWorkAreas(): void {
    this._bindings.forEach((b) => this._updateWorkArea(b));
  }

  private _refreshBindingsLayout(): void {
    this._bindings.forEach((b) => {
      b.dash.refresh();
      this._updateWorkArea(b);
    });
  }

  private _updateWorkArea(binding: ManagedDockBinding): void {
    const workArea = Main.layoutManager.getWorkAreaForMonitor(binding.monitorIndex);
    if (!workArea) {
      binding.dash.hide(false);
      return;
    }

    const bounds: DashBounds = {
      x: workArea.x,
      y: workArea.y,
      width: workArea.width,
      height: workArea.height,
    };

    binding.dash.refresh();
    binding.dash.applyWorkArea(bounds);
    binding.container.show();

    if (binding.hotArea) {
      binding.hotArea.set_size(bounds.width, HOT_AREA_STRIP_HEIGHT);
      binding.hotArea.set_position(bounds.x, bounds.y + bounds.height - HOT_AREA_STRIP_HEIGHT);
      binding.hotArea.setGeometry(bounds);
    }
  }

  private _clearBindings(): void {
    this._bindings.forEach((b) => this._destroyBinding(b));
    this._bindings.clear();
  }

  private _destroyBinding(binding: ManagedDockBinding): void {
    if (binding.destroyed) return;
    binding.destroyed = true;

    this._clearHotAreaReveal(binding);
    binding.intellihide.disconnectObject?.(this);
    binding.hotArea?.disconnectObject?.(this);

    if (binding.hotArea) {
      Main.layoutManager.removeChrome?.(binding.hotArea);
      binding.hotArea.destroy();
      binding.hotArea = null;
    }

    binding.intellihide.destroy();
    binding.dash.detachFromContainer();
    binding.dash.destroy();

    Main.layoutManager.removeChrome?.(binding.container);
    binding.container.destroy();
  }

  /**
   * Returns true if no other monitor sits directly below this one.
   * Used to avoid placing a dock between vertically stacked monitors.
   */
  private _hasDefinedBottom(monitors: MonitorGeometry[], index: number): boolean {
    const monitor = monitors[index];
    if (!monitor) return false;

    const bottom = monitor.y + monitor.height;
    const left = monitor.x;
    const right = left + monitor.width;

    return !monitors.some((other, i) => {
      if (i === index) return false;
      return other.y >= bottom && other.x < right && other.x + other.width > left;
    });
  }

  private _revealDockFromHotArea(binding: ManagedDockBinding): void {
    this._clearHotAreaReveal(binding);
    binding.hotAreaActive = true;
    binding.dash.blockAutoHide(true);
    binding.dash.show(true);

    binding.autoHideReleaseId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HOT_AREA_REVEAL_DURATION, () => {
      binding.autoHideReleaseId = 0;
      binding.hotAreaActive = false;
      binding.dash.blockAutoHide(false);
      binding.dash.ensureAutoHide();
      return GLib.SOURCE_REMOVE;
    });
  }

  private _clearHotAreaReveal(binding: ManagedDockBinding): void {
    if (binding.autoHideReleaseId) {
      GLib.source_remove(binding.autoHideReleaseId);
      binding.autoHideReleaseId = 0;
    }
  }

  /** Hide all dock containers during overview/app grid, restore on close. */
  private _setOverviewVisible(overviewShowing: boolean): void {
    this._bindings.forEach((binding) => {
      if (overviewShowing) {
        this._clearHotAreaReveal(binding);
        binding.hotAreaActive = false;
        binding.dash.blockAutoHide(false);
        binding.dash.hide(false);
        binding.container.hide();
      } else {
        // Re-apply work area so the container is at the correct position
        // and size before making anything visible again.
        this._updateWorkArea(binding);
        // Let intellihide decide whether to show the dash
        binding.intellihide.emit('status-changed');
      }
    });
  }
}

// -- Utilities --

function isValidMonitor(m: MonitorGeometry): boolean {
  return Number.isFinite(m.x) && Number.isFinite(m.y) && m.width > 0 && m.height > 0;
}
