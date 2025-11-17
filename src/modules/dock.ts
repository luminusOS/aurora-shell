// @ts-nocheck
import '@girs/gjs';

import type Clutter from '@girs/clutter-17';
import St from '@girs/st-17';
import GObject from '@girs/gobject-2.0';
import Meta from '@girs/meta-17';
import Shell from '@girs/shell-17';

import * as Main from '@girs/gnome-shell/ui/main';
import * as Layout from '@girs/gnome-shell/ui/layout';

import { Module } from './module.ts';
import type { ConsoleLike } from '@girs/gnome-shell/extensions/extension';
import { AuroraDash, type DashBounds } from '../ui/dash.ts';

const HOT_AREA_TRIGGER_SPEED = 150;
const HOT_AREA_TRIGGER_TIMEOUT = 550;

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
    super._init();
    this._monitor = monitor;
    this._left = monitor.x;
    this._bottom = monitor.y + monitor.height;

    this._pressureBarrier = new Layout.PressureBarrier(
      HOT_AREA_TRIGGER_SPEED,
      HOT_AREA_TRIGGER_TIMEOUT,
      Shell.ActionMode.NORMAL
    );

    this._pressureBarrier.connectObject('trigger', () => {
      if (this._triggerAllowed) {
        this.emit('triggered');
      }
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
    this.setBarrierSize(monitor.width);
  }

  setBarrierSize(size: number): void {
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
      directions: Meta.BarrierDirection.NEGATIVE_Y,
    });

    this._pressureBarrier.addBarrier(this._horizontalBarrier);
  }

  private _hasValidCoordinates(): boolean {
    return Number.isFinite(this._left) && Number.isFinite(this._bottom);
  }

  override destroy(): void {
    global.display.disconnectObject(this);
    this.setBarrierSize(0);
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
    this._disconnectFocusActor();
    global.display.disconnectObject(this);
    Main.layoutManager.disconnectObject(this);
    this._tracker?.disconnectObject(this);
    this._tracker = null;
    Main.keyboard.disconnectObject(this);
    const parentDestroy = (GObject.Object.prototype as GObject.Object & { destroy?: () => void }).destroy;
    if (typeof parentDestroy === 'function') {
      parentDestroy.call(this);
    } else {
      (this as unknown as { run_dispose?: () => void }).run_dispose?.();
    }
  }
});

type DockBindingSignals = {
  intellihide: number;
  hotArea: number;
};

class DockBinding {
  private _dash: AuroraDash;
  private _container: St.Bin;
  private _intellihide: DockIntellihide;
  private _hotArea: DockHotArea | null = null;
  private _signals: DockBindingSignals = { intellihide: 0, hotArea: 0 };

  constructor(private _monitorIndex: number, monitor: MonitorGeometry, private _console: ConsoleLike | null) {
    this._container = new St.Bin({
      name: `aurora-dock-container-${_monitorIndex}`,
      reactive: false,
    });

    Main.layoutManager.addChrome(this._container, {
      trackFullscreen: true,
      affectsInputRegion: true,
      affectsStruts: false,
    });

    this._dash = new AuroraDash({ monitorIndex: _monitorIndex });
    this._container.set_child(this._dash);
    this._dash.attachToContainer(this._container);

    this._intellihide = new DockIntellihide({ monitorIndex: _monitorIndex, 'monitor-index': _monitorIndex });

    this._dash.setTargetBoxListener((box) => {
      this._intellihide.updateTargetBox(box);
    });

    this._signals.intellihide = this._intellihide.connect('status-changed', () => {
      switch (this._intellihide.status) {
        case OverlapStatus.CLEAR:
          this._dash.blockAutoHide(true);
          this._dash.show(true);
          break;
        case OverlapStatus.BLOCKED:
          this._dash.blockAutoHide(false);
          break;
        default:
          break;
      }
    });

    this._createHotArea(monitor);
  }

  get monitorIndex(): number {
    return this._monitorIndex;
  }

  updateWorkArea(): void {
    const workArea = Main.layoutManager.getWorkAreaForMonitor(this._monitorIndex);
    if (!workArea) {
      this._dash.hide(false);
      return;
    }

    const bounds: DashBounds = {
      x: workArea.x,
      y: workArea.y,
      width: workArea.width,
      height: workArea.height,
    };

    this._dash.applyWorkArea(bounds);
  }

  private _createHotArea(monitor: MonitorGeometry): void {
    if (!monitor) {
      return;
    }

    if (!this._isValidMonitor(monitor)) {
      this._console?.warn?.(`Skipping dock hot area for monitor ${this._monitorIndex}: invalid geometry`, monitor);
      return;
    }

    this._hotArea = new DockHotArea(monitor);
    this._hotArea.setBarrierSize(monitor.width);
    this._signals.hotArea = this._hotArea.connect('triggered', () => {
      this._console?.log(`Dock hot area triggered on monitor ${this._monitorIndex}`);
      this._dash.show(true);
      this._dash.ensureAutoHide();
    });
  }

  destroy(): void {
    if (this._signals.intellihide) {
      this._intellihide.disconnect(this._signals.intellihide);
      this._signals.intellihide = 0;
    }

    if (this._signals.hotArea && this._hotArea) {
      this._hotArea.disconnect(this._signals.hotArea);
      this._signals.hotArea = 0;
    }

    this._hotArea?.destroy();
    this._hotArea = null;

    this._intellihide.destroy();
    this._dash.detachFromContainer();
    this._dash.destroy();

    Main.layoutManager.removeChrome?.(this._container);
    this._container.destroy();
  }

  private _isValidMonitor(monitor: MonitorGeometry): boolean {
    return [monitor.x, monitor.y, monitor.width, monitor.height].every((value) => Number.isFinite(value)) && monitor.width > 0 && monitor.height > 0;
  }
}

class DockManager {
  private _bindings = new Map<number, DockBinding>();
  private _destroyed = false;

  constructor(private _console: ConsoleLike | null) {
    this._rebuild();

    Main.layoutManager.connectObject(
      'monitors-changed', () => this._rebuild(),
      'hot-corners-changed', () => this._rebuild(),
      this
    );

    global.display.connectObject('workareas-changed', () => this._refreshWorkAreas(), this);
  }

  private _rebuild(): void {
    if (this._destroyed) {
      return;
    }

    this._clearBindings();

    const monitors: MonitorGeometry[] = Main.layoutManager.monitors ?? [];
    monitors.forEach((monitor, index) => {
      if (this._hasDefinedBottom(monitors, index)) {
        const binding = new DockBinding(index, monitor, this._console);
        this._bindings.set(index, binding);
      }
    });

    this._refreshWorkAreas();
  }

  private _refreshWorkAreas(): void {
    this._bindings.forEach((binding) => binding.updateWorkArea());
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

  destroy(): void {
    this._destroyed = true;
    this._clearBindings();
    Main.layoutManager.disconnectObject(this);
    global.display.disconnectObject(this);
  }

  private _clearBindings(): void {
    this._bindings.forEach((binding) => binding.destroy());
    this._bindings.clear();
  }
}

export class Dock extends Module {
  private _manager: DockManager | null = null;
  private _hiddenDashActors: Clutter.Actor[] = [];

  override enable(): void {
    this.log('Enabling dock module');
    this._hideDefaultDash();
    this._manager = new DockManager(this._console);
  }

  override disable(): void {
    this.log('Disabling dock module');
    this._manager?.destroy();
    this._manager = null;
    this._restoreDefaultDash();
  }

  private _hideDefaultDash(): void {
    const layoutManager = Main.layoutManager as Record<string, Clutter.Actor | undefined>;
    const overview = Main.overview as Record<string, Clutter.Actor | undefined> | null;
    const tryAdd = (actor?: Clutter.Actor | null | undefined): void => {
      if (!actor || this._hiddenDashActors.includes(actor)) {
        return;
      }
      this._hiddenDashActors.push(actor);
      try {
        if (typeof (actor as any).hide === 'function') {
          (actor as any).hide();
        }
      } catch (_error) {
        /* ignore */
      }
      actor.visible = false;
    };

    ['dash', '_dash', 'primaryDash', '_primaryDash'].forEach((key) => tryAdd(layoutManager[key]));
    tryAdd((Main as any).dash);
    if (overview) {
      ['dash', '_dash'].forEach((key) => tryAdd(overview[key]));
    }
  }

  private _restoreDefaultDash(): void {
    for (const actor of this._hiddenDashActors) {
      try {
        if (typeof (actor as any).show === 'function') {
          (actor as any).show();
        }
      } catch (_error) {
        /* ignore */
      }
      actor.visible = true;
    }
    this._hiddenDashActors = [];
  }
}
