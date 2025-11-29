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
const HOT_AREA_ALLOWED_MODES = Shell.ActionMode.ALL ?? [
  Shell.ActionMode.NORMAL,
  Shell.ActionMode.OVERVIEW,
  Shell.ActionMode.POPUP,
  Shell.ActionMode.FULLSCREEN,
].reduce((mask, mode) => mask | (typeof mode === 'number' ? mode : 0), 0);

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

const DockHotArea = GObject.registerClass({
  Signals: {
    triggered: {},
  },
}, class DockHotArea extends St.Widget {
  private _pressureBarrier: any;
  private _horizontalBarrier: Meta.Barrier | null = null;
  private _triggerAllowed = true;
  private _left: number;
  private _bottom: number;
  private _monitor: MonitorGeometry;

  _init(monitor: MonitorGeometry) {
    super._init({ reactive: true, visible: true, name: 'aurora-dock-hot-area' });
    this._monitor = monitor;
    this._left = monitor.x;
    this._bottom = monitor.y + monitor.height;

    this._pressureBarrier = new Layout.PressureBarrier(
      HOT_AREA_TRIGGER_SPEED,
      HOT_AREA_TRIGGER_TIMEOUT,
      HOT_AREA_ALLOWED_MODES || Shell.ActionMode.NORMAL
    );

    this._pressureBarrier.connectObject('trigger', () => {
      if (this._triggerAllowed) {
        this.emit('triggered');
      }
    }, this);

    // Also respond to pointer entering the hot area for reliability
    this.connectObject('enter-event', () => {
      if (this._triggerAllowed) {
        this.emit('triggered');
      }
      return Clutter.EVENT_PROPAGATE;
    }, this);

    global.display.connectObject(
      'grab-op-begin', (_display: any, _window: any, op: Meta.GrabOp) => {
        if (op === Meta.GrabOp.MOVING) {
          this._triggerAllowed = false;
        }
      },
      'grab-op-end', (_display: any, _window: any, op: Meta.GrabOp) => {
        if (op === Meta.GrabOp.MOVING) {
          this._triggerAllowed = true;
        }
      },
      this
    );
  }

  setGeometry(monitor: MonitorGeometry): void {
    this._monitor = monitor;
    this._left = monitor.x;
    this._bottom = monitor.y + monitor.height;
    if (this._pressureBarrier) {
      this.setBarrierSize(monitor.width);
    }
  }

  setBarrierSize(size: number): void {
    if (!this._pressureBarrier) {
      return;
    }
    if (this._horizontalBarrier) {
      this._pressureBarrier.removeBarrier(this._horizontalBarrier);
      this._horizontalBarrier.destroy();
      this._horizontalBarrier = null;
    }

    const width = Number.isFinite(size) ? size : 0;
    if (width <= 0 || !this._hasValidCoordinates()) {
      return;
    }

    const left = this._left;
    const bottom = this._bottom;

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

  private _hasValidCoordinates(): boolean {
    return Number.isFinite(this._left) && Number.isFinite(this._bottom);
  }

  override destroy(): void {
    global.display.disconnectObject(this);
    if (this._pressureBarrier) {
      this.setBarrierSize(0);
    }
    if (this._pressureBarrier) {
      this._pressureBarrier.disconnectObject?.(this);
      this._pressureBarrier.destroy?.();
      this._pressureBarrier = null;
    }
    const parentDestroy = (St.Widget.prototype as St.Widget)?.destroy;
    if (typeof parentDestroy === 'function') {
      parentDestroy.call(this);
    } else {
      (this as unknown as { run_dispose?: () => void }).run_dispose?.();
    }
  }
});

const DockIntellihide = GObject.registerClass({
  Properties: {
    'monitor-index': GObject.ParamSpec.int(
      'monitor-index',
      'Monitor Index',
      'Monitor tracked for dock overlap checks',
      GObject.ParamFlags.READWRITE,
      -1,
      32,
      Main.layoutManager.primaryIndex
    ),
  },
  Signals: {
    'status-changed': {},
  },
}, class DockIntellihide extends GObject.Object {
  private _monitorIndex = Main.layoutManager.primaryIndex;
  private _tracker: Shell.WindowTracker | null = null;
  private _targetBox: DashBounds | null = null;
  private _status: OverlapStatus = OverlapStatus.UNDEFINED;
  private _focusActor: any = null;
  private _focusActorId = 0;
  private _destroyed = false;

  _init(params: { 'monitor-index'?: number; monitorIndex?: number } = {}) {
    super._init(params);
    this._tracker = Shell.WindowTracker.get_default() ?? null;
    this.monitorIndex = params['monitor-index'] ?? params.monitorIndex ?? this._monitorIndex;

    global.display.connectObject(
      'window-entered-monitor', () => this._checkOverlap(),
      'window-left-monitor', () => this._checkOverlap(),
      'restacked', () => this._checkOverlap(),
      'notify::focus-window', () => this._checkOverlap(),
      this
    );

    Main.layoutManager.connectObject('monitors-changed', () => this._checkOverlap(), this);
    this._ensureTracker()?.connectObject('notify::focus-app', () => this._checkOverlap(), this);
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
    if (typeof index !== 'number' || this._monitorIndex === index) {
      return;
    }
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

  private _checkOverlap(): void {
    if (Main.overview.visible) {
      this._applyOverlap(false, true);
      return;
    }

    if (!this._targetBox) {
      return;
    }

    this._disconnectFocusActor();

    const tracker = this._ensureTracker();
    if (!tracker) {
      return;
    }

    const focusApp = tracker.focus_app;
    if (!focusApp) {
      this._checkRemainingWindows();
      return;
    }

    let focusWin = focusApp.get_windows().find((w) => this._isCandidateWindow(w));

    if (focusWin && this._monitorIndex === Main.layoutManager.primaryIndex) {
      const activeWorkspace = global.workspace_manager.get_active_workspace();
      if (focusWin.get_workspace() !== activeWorkspace) {
        focusWin = null;
      }
    }

    if (!focusWin) {
      this._checkRemainingWindows();
      return;
    }

    this._applyOverlap(this._doesOverlap(focusWin.get_frame_rect()), true);

    this._focusActor = focusWin.get_compositor_private();
    if (this._focusActor) {
      this._focusActorId = this._focusActor.connect('notify::allocation', () => {
        this._applyOverlap(this._doesOverlap(focusWin.get_frame_rect()));
      });
    }
  }

  private _ensureTracker(): Shell.WindowTracker | null {
    if (!this._tracker) {
      this._tracker = Shell.WindowTracker.get_default() ?? null;
    }
    return this._tracker;
  }

  private _checkRemainingWindows(): void {
    const windows = global.get_window_actors()
      .map((actor: any) => actor.meta_window)
      .filter((win: Meta.Window) => this._isCandidateWindow(win));

    if (windows.length === 0) {
      this._applyOverlap(false, true);
      return;
    }

    const overlap = windows.some((win: Meta.Window) => this._doesOverlap(win.get_frame_rect()));
    this._applyOverlap(overlap);
  }

  private _isCandidateWindow(win: Meta.Window | null): win is Meta.Window {
    if (!win) {
      return false;
    }

    if (win.get_monitor() !== this._monitorIndex) {
      return false;
    }

    if (win.minimized || !win.showing_on_its_workspace()) {
      return false;
    }

    if (this._monitorIndex === Main.layoutManager.primaryIndex) {
      const activeWorkspace = global.workspace_manager.get_active_workspace();
      if (win.get_workspace() !== activeWorkspace) {
        return false;
      }
    }

    return OVERLAP_WINDOW_TYPES.includes(win.get_window_type());
  }

  private _doesOverlap(winBox: Meta.Rectangle): boolean {
    const targetBox = this._targetBox!;
    return !(
      winBox.x + winBox.width < targetBox.x ||
      targetBox.x + targetBox.width < winBox.x ||
      winBox.y + winBox.height < targetBox.y ||
      targetBox.y + targetBox.height < winBox.y
    );
  }

  private _applyOverlap(overlap: boolean, force = false): void {
    const newStatus = overlap ? OverlapStatus.BLOCKED : OverlapStatus.CLEAR;
    if (!force && newStatus === this._status) {
      return;
    }
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
    if (Main.keyboard.visible) {
      this._applyOverlap(true, true);
    } else {
      this._applyOverlap(false, true);
      this._checkOverlap();
    }
  }

  override destroy(): void {
    if (this._destroyed) {
      return;
    }
    this._destroyed = true;
    this._disconnectFocusActor();
    global.display.disconnectObject(this);
    Main.layoutManager.disconnectObject(this);
    this._tracker?.disconnectObject(this);
    this._tracker = null;
    Main.keyboard.disconnectObject(this);
    Main.overview.disconnectObject(this);
    this.disconnectObject?.(this);
    const parentDestroy = (GObject.Object.prototype as GObject.Object & { destroy?: () => void }).destroy;
    if (typeof parentDestroy === 'function') {
      parentDestroy.call(this);
    } else {
      (this as unknown as { run_dispose?: () => void }).run_dispose?.();
    }
  }
});

export class Dock extends Module {
  private _bindings = new Map<number, ManagedDockBinding>();
  private _overviewDashState: { wasVisible: boolean; reactive: boolean; opacity: number } | null = null;

  override enable(): void {
    console.log('Enabling dock module');
    this._setOverviewDashSuppressed(true);

    this._rebuildBindings();
    Main.layoutManager.connectObject(
      'monitors-changed', () => this._rebuildBindings(),
      'hot-corners-changed', () => this._rebuildBindings(),
      this
    );
    global.display.connectObject('workareas-changed', () => this._refreshWorkAreas(), this);
    
    // Refresh on session mode changes (e.g., returning from lock screen)
    Main.sessionMode.connectObject('updated', () => {
      console.log('Session mode updated, refreshing dock');
      this._refreshBindingsLayout();
    }, this);
  }

  override disable(): void {
    console.log('Disabling dock module');
    this._setOverviewDashSuppressed(false);
    Main.layoutManager.disconnectObject(this);
    global.display.disconnectObject(this);
    Main.sessionMode.disconnectObject(this);
    this._clearBindings();
  }

  private _setOverviewDashSuppressed(suppress: boolean): void {
    const dash = Main.overview.dash;
    if (!dash) {
      return;
    }

    if (suppress) {
      if (this._overviewDashState) {
        return;
      }

      this._overviewDashState = {
        wasVisible: dash.visible,
        reactive: this._getActorReactive(dash),
        opacity: dash.opacity ?? 255,
      };

      dash.show?.();
      dash.opacity = 0;
      this._setActorReactive(dash, false);
      return;
    }

    if (!this._overviewDashState) {
      return;
    }

    dash.opacity = this._overviewDashState.opacity;
    this._setActorReactive(dash, this._overviewDashState.reactive);
    if (!this._overviewDashState.wasVisible) {
      dash.hide?.();
    }
    this._overviewDashState = null;
  }

  private _getActorReactive(actor: St.Widget & { get_reactive?: () => boolean }): boolean {
    if (typeof actor.get_reactive === 'function') {
      return actor.get_reactive() ?? true;
    }
    return actor.reactive ?? true;
  }

  private _setActorReactive(actor: St.Widget & { set_reactive?: (value: boolean) => void }, value: boolean): void {
    if (typeof actor.set_reactive === 'function') {
      actor.set_reactive(value);
      return;
    }
    actor.reactive = value;
  }

  private _rebuildBindings(): void {
    this._clearBindings();

    const monitors: MonitorGeometry[] = Main.layoutManager.monitors ?? [];
    monitors.forEach((monitor, index) => {
      if (this._hasDefinedBottom(monitors, index)) {
        const binding = this._createBinding(monitor, index);
        if (binding) {
          this._bindings.set(index, binding);
        }
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

    const intellihide = new DockIntellihide({ monitorIndex, 'monitor-index': monitorIndex });
    dash.setTargetBoxListener((box) => {
      intellihide.updateTargetBox(box);
    });

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
      // Don't interfere if hot area is currently revealing the dock
      if (binding.hotAreaActive) {
        return;
      }

      if (intellihide.status === OverlapStatus.CLEAR) {
        this._clearHotAreaReveal(binding);
      }
      switch (intellihide.status) {
        case OverlapStatus.CLEAR:
          dash.blockAutoHide(true);
          dash.show(true);
          break;
        case OverlapStatus.BLOCKED:
          dash.blockAutoHide(false);
          break;
        default:
          break;
      }
    }, this);

    return binding;
  }

  private _createHotArea(binding: ManagedDockBinding, monitor: MonitorGeometry): InstanceType<typeof DockHotArea> | null {
    if (!monitor || !this._isValidMonitor(monitor)) {
      console.warn(`Skipping dock hot area for monitor ${binding.monitorIndex}: invalid geometry`, monitor);
      return null;
    }

    const hotArea = new DockHotArea(monitor);
    // Add as chrome to ensure it receives pointer events
    Main.layoutManager.addChrome(hotArea, {
      trackFullscreen: true,
      affectsInputRegion: true,
      affectsStruts: false,
    });
    // Place as a thin strip at the bottom edge
    const height = 2;
    hotArea.set_size(monitor.width, height);
    hotArea.set_position(monitor.x, monitor.y + monitor.height - height);
    hotArea.setBarrierSize(monitor.width);
    hotArea.connectObject('triggered', () => {
      console.log(`Dock hot area triggered on monitor ${binding.monitorIndex}`);
      this._revealDockFromHotArea(binding);
    }, this);

    return hotArea;
  }

  private _refreshWorkAreas(): void {
    this._bindings.forEach((binding) => this._updateWorkArea(binding));
  }

  private _refreshBindingsLayout(): void {
    this._bindings.forEach((binding) => {
      // Force dash to recalculate its size
      binding.dash.refresh();
      this._updateWorkArea(binding);
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

    // Refresh dash layout before applying work area to ensure proper sizing
    binding.dash.refresh();
    binding.dash.applyWorkArea(bounds);
    binding.container.show();

    // Keep hot area aligned with current work area bottom
    if (binding.hotArea) {
      const height = 2;
      binding.hotArea.set_size(bounds.width, height);
      binding.hotArea.set_position(bounds.x, bounds.y + bounds.height - height);
      binding.hotArea.setGeometry({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
    }
  }

  private _clearBindings(): void {
    this._bindings.forEach((binding) => this._destroyBinding(binding));
    this._bindings.clear();
  }

  private _destroyBinding(binding: ManagedDockBinding): void {
    if (binding.destroyed) {
      return;
    }
    binding.destroyed = true;

    this._clearHotAreaReveal(binding);
    binding.intellihide.disconnectObject?.(this);
    binding.hotArea?.disconnectObject?.(this);

    if (binding.hotArea) {
      Main.layoutManager.removeChrome?.(binding.hotArea);
      binding.hotArea.destroy();
    }
    binding.hotArea = null;

    binding.intellihide.destroy();
    binding.dash.detachFromContainer();
    binding.dash.destroy();

    Main.layoutManager.removeChrome?.(binding.container);
    binding.container.destroy();
  }

  private _hasDefinedBottom(monitors: MonitorGeometry[], index: number): boolean {
    const monitor = monitors[index];
    if (!monitor) {
      return false;
    }

    const bottom = monitor.y + monitor.height;
    const left = monitor.x;
    const right = monitor.x + monitor.width;

    const hasMonitorBelow = monitors.some((other, otherIndex) => {
      if (otherIndex === index) {
        return false;
      }
      const otherTop = other.y;
      const otherLeft = other.x;
      const otherRight = other.x + other.width;
      return (
        otherTop >= bottom &&
        otherLeft < right &&
        otherRight > left
      );
    });

    return !hasMonitorBelow;
  }

  private _isValidMonitor(monitor: MonitorGeometry): boolean {
    return [monitor.x, monitor.y, monitor.width, monitor.height].every((value) => Number.isFinite(value)) && monitor.width > 0 && monitor.height > 0;
  }

  private _revealDockFromHotArea(binding: ManagedDockBinding): void {
    this._clearHotAreaReveal(binding);
    
    // Mark hot area as active to prevent intellihide interference
    binding.hotAreaActive = true;
    
    // Force dock to show even if intellihide would normally block it
    binding.dash.blockAutoHide(true);
    binding.dash.show(true);

    binding.autoHideReleaseId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HOT_AREA_REVEAL_DURATION, () => {
      binding.autoHideReleaseId = 0;
      binding.hotAreaActive = false;
      binding.dash.blockAutoHide(false);
      // Let intellihide decide whether to keep showing or hide
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
}
