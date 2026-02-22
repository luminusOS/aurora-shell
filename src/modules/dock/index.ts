// @ts-nocheck
import '@girs/gjs';

import St from '@girs/st-17';
import GLib from '@girs/glib-2.0';

import * as Main from '@girs/gnome-shell/ui/main';

import { Module } from '../../module.ts';
import { AuroraDash, type DashBounds } from '../../ui/dash.ts';
import { DockHotArea } from './hotArea.ts';
import { DockIntellihide, OverlapStatus } from './intellihide.ts';

const HOT_AREA_REVEAL_DURATION = 1500;
/** Height (in pixels) of the invisible strip at the screen bottom that triggers dock reveal. */
const HOT_AREA_STRIP_HEIGHT = 1;

type ManagedDockBinding = {
  monitorIndex: number;
  container: St.Bin;
  dash: AuroraDash;
  intellihide: InstanceType<typeof DockIntellihide>;
  hotArea: InstanceType<typeof DockHotArea> | null;
  autoHideReleaseId: number;
  hotAreaActive: boolean;
};

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

    const monitors: DashBounds[] = Main.layoutManager.monitors ?? [];
    monitors.forEach((monitor, index) => {
      if (this._hasDefinedBottom(monitors, index)) {
        const binding = this._createBinding(monitor, index);
        if (binding) this._bindings.set(index, binding);
      }
    });

    this._refreshWorkAreas();
  }

  private _createBinding(monitor: DashBounds, monitorIndex: number): ManagedDockBinding | null {
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

    const intellihide = new DockIntellihide(monitorIndex);
    dash.setTargetBoxListener((box) => intellihide.updateTargetBox(box));

    const binding: ManagedDockBinding = {
      monitorIndex,
      container,
      dash,
      intellihide,
      hotArea: null,
      autoHideReleaseId: 0,
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

  private _createHotArea(binding: ManagedDockBinding, monitor: DashBounds): InstanceType<typeof DockHotArea> | null {
    if (monitor.width <= 0 || monitor.height <= 0) return null;

    const hotArea = new DockHotArea(monitor);
    Main.layoutManager.addChrome(hotArea, {
      trackFullscreen: true,
      affectsInputRegion: true,
      affectsStruts: false,
    });

    hotArea.set_size(monitor.width, HOT_AREA_STRIP_HEIGHT);
    hotArea.set_position(monitor.x, monitor.y + monitor.height - HOT_AREA_STRIP_HEIGHT);

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
    if (binding.autoHideReleaseId) {
      GLib.source_remove(binding.autoHideReleaseId);
      binding.autoHideReleaseId = 0;
    }

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
  private _hasDefinedBottom(monitors: DashBounds[], index: number): boolean {
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
      // Keep the dock visible while the cursor is in the dock area.
      // This prevents a show/hide/re-trigger cycle when overlapping
      // windows cause BLOCKED status but the user is still at the
      // bottom of the screen trying to use the dock.
      const dashBounds = binding.dash.targetBox;
      if (dashBounds) {
        const [cursorX, cursorY] = global.get_pointer();
        if (cursorY >= dashBounds.y
            && cursorX >= dashBounds.x
            && cursorX <= dashBounds.x + dashBounds.width) {
          return GLib.SOURCE_CONTINUE;
        }
      }

      binding.autoHideReleaseId = 0;
      binding.hotAreaActive = false;

      if (binding.intellihide.status === OverlapStatus.CLEAR) {
        binding.dash.blockAutoHide(true);
        binding.dash.show(true);
      } else {
        binding.dash.blockAutoHide(false);
        binding.dash.ensureAutoHide();
      }

      return GLib.SOURCE_REMOVE;
    });
  }

  private _clearHotAreaReveal(binding: ManagedDockBinding): void {
    if (binding.autoHideReleaseId) {
      GLib.source_remove(binding.autoHideReleaseId);
      binding.autoHideReleaseId = 0;
    }
  }

  private _setOverviewVisible(overviewShowing: boolean): void {
    this._bindings.forEach((binding) => {
      if (overviewShowing) {
        this._clearHotAreaReveal(binding);
        binding.hotAreaActive = false;
        binding.dash.blockAutoHide(false);
        binding.dash.hide(false);
        binding.container.hide();
      } else {
        this._updateWorkArea(binding);
        binding.intellihide.emit('status-changed');
      }
    });
  }
}
