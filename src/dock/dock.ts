import '@girs/gjs';
import { gettext as _ } from 'gettext';

import St from '@girs/st-18';
import GLib from '@girs/glib-2.0';

import * as Main from '@girs/gnome-shell/ui/main';

import type { ExtensionContext } from '~/core/context.ts';
import { logger } from '~/core/logger.ts';
import { Module } from '~/module.ts';
import type { ModuleDefinition } from '~/module.ts';
import { AuroraDash, type DashBounds } from '~/shared/ui/dash.ts';
import { DockHotArea } from '~/dock/hotArea.ts';
import { DockIntellihide, OverlapStatus } from '~/dock/intellihide.ts';
import { hasDefinedBottom } from '~/dock/monitorTopology.ts';

const HOT_AREA_REVEAL_DURATION = 1500;
const HOT_AREA_STRIP_HEIGHT = 1;
const LOG_PREFIX = 'Dock';

export type ManagedDockBinding = {
  monitorIndex: number;
  container: St.Bin;
  dash: AuroraDash;
  intellihide: InstanceType<typeof DockIntellihide> | null;
  hotArea: InstanceType<typeof DockHotArea> | null;
  strutActor: St.Widget | null;
  autoHideReleaseId: number;
  hotAreaEnableId: number;
  hotAreaActive: boolean;
};

export class Dock extends Module {
  private _bindings = new Map<number, ManagedDockBinding>();
  private _pendingRebuild = false;
  private _dockSettings: any = null;
  private _alwaysShow = false;
  private _showTrash = true;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this._dockSettings = this.context.settings.getRawSettings();
    this._alwaysShow = this._dockSettings?.get_boolean('dock-always-show') ?? false;
    this._showTrash = this._dockSettings?.get_boolean('dock-show-trash') ?? true;
    logger.debug(
      `enable alwaysShow=${this._alwaysShow} showTrash=${this._showTrash} monitors=${Main.layoutManager.monitors?.length ?? 0}`,
      { prefix: LOG_PREFIX },
    );

    Main.overview.dash.hide();

    this._rebuildBindings();
    Main.layoutManager.connectObject(
      'monitors-changed',
      () => this._rebuildBindings(),
      'hot-corners-changed',
      () => this._rebuildBindings(),
      this,
    );
    global.display.connectObject('workareas-changed', () => this._refreshWorkAreas(), this);
    Main.sessionMode.connectObject('updated', () => this._refreshBindingsLayout(), this);

    Main.overview.connectObject(
      'showing',
      () => this._setOverviewVisible(true),
      'hidden',
      () => this._setOverviewVisible(false),
      this,
    );

    this._dockSettings?.connectObject?.(
      'changed::dock-always-show',
      () => {
        this._alwaysShow = this._dockSettings?.get_boolean('dock-always-show') ?? false;
        this._rebuildBindings();
      },
      'changed::dock-show-trash',
      () => {
        this._showTrash = this._dockSettings?.get_boolean('dock-show-trash') ?? true;
        this._rebuildBindings();
      },
      this,
    );

    this.context.signals.connectObject('icons-woven', () => this._refreshBindingsLayout(), this);
  }

  override disable(): void {
    Main.overview.dash.show();
    this._dockSettings?.disconnectObject?.(this);
    this._dockSettings = null;
    this.context.signals.disconnectObject(this);
    Main.layoutManager.disconnectObject(this);
    global.display.disconnectObject(this);
    Main.sessionMode.disconnectObject(this);
    Main.overview.disconnectObject(this);
    this._pendingRebuild = false;
    this._clearBindings();
  }

  get bindings(): readonly ManagedDockBinding[] {
    return [...this._bindings.values()];
  }

  get alwaysShow(): boolean {
    return this.context.settings.getBoolean('dock-always-show');
  }

  toggleAlwaysShow(): boolean {
    const enabled = !this.context.settings.getBoolean('dock-always-show');
    this.context.settings.setBoolean('dock-always-show', enabled);
    return enabled;
  }

  showAll(): void {
    this._bindings.forEach((binding) => this._showBinding(binding));
  }

  hideAll(): void {
    this._bindings.forEach((binding) => this._hideBinding(binding));
  }

  showMonitor(monitorIndex: number): boolean {
    const binding = this._bindings.get(monitorIndex);
    if (!binding) return false;
    this._showBinding(binding);
    return true;
  }

  hideMonitor(monitorIndex: number): boolean {
    const binding = this._bindings.get(monitorIndex);
    if (!binding) return false;
    this._hideBinding(binding);
    return true;
  }

  revealMonitorFromHotArea(monitorIndex: number): boolean {
    const binding = this._bindings.get(monitorIndex);
    if (!binding?.hotArea) return false;
    this._revealDockFromHotArea(binding);
    return true;
  }

  revealFromHotArea(): void {
    this._bindings.forEach((binding) => {
      if (binding.hotArea) this._revealDockFromHotArea(binding);
    });
  }

  private _showBinding(binding: ManagedDockBinding): void {
    logger.debug(`monitor=${binding.monitorIndex} forced show`, { prefix: LOG_PREFIX });
    this._clearHotAreaReveal(binding);
    this._clearHotAreaEnable(binding);
    binding.hotAreaActive = false;
    binding.hotArea?.setEnabled(false);
    binding.dash.blockAutoHide(true);
  }

  private _hideBinding(binding: ManagedDockBinding): void {
    logger.debug(`monitor=${binding.monitorIndex} forced hide`, { prefix: LOG_PREFIX });
    this._clearHotAreaReveal(binding);
    this._clearHotAreaEnable(binding);
    binding.hotAreaActive = true;
    binding.hotArea?.setEnabled(false);
    binding.dash.blockAutoHide(false);
    binding.dash.hide(true);
    this._enableHotAreaWhenDockHidden(binding);
  }

  private _rebuildBindings(): void {
    // Defer the rebuild until the overview is hidden. Destroying dashes while
    // a window DnD is active in the overview can leave stale signal connections
    // that fire on the already-disposed AuroraDash objects.
    if (Main.overview.visible) {
      this._pendingRebuild = true;
      return;
    }

    this._pendingRebuild = false;
    this._clearBindings();

    const monitors: DashBounds[] = Main.layoutManager.monitors ?? [];
    logger.debug(
      `rebuild monitors=[${monitors.map((monitor, index) => `${index}:${monitor.x},${monitor.y} ${monitor.width}x${monitor.height}`).join(';')}]`,
      { prefix: LOG_PREFIX },
    );
    monitors.forEach((monitor, index) => {
      if (hasDefinedBottom(monitors, index)) {
        const binding = this._createBinding(monitor, index);
        if (binding) this._bindings.set(index, binding);
      } else {
        logger.debug(`monitor=${index} skipped because another monitor is below it`, {
          prefix: LOG_PREFIX,
        });
      }
    });

    this._refreshWorkAreas();
  }

  private _createBinding(monitor: DashBounds, monitorIndex: number): ManagedDockBinding | null {
    // In always-show mode the strutActor must be added to uiGroup BEFORE the
    // container. Both are inserted via addChrome (→ uiGroup.add_child), so the
    // one added first sits lower in Z-order. The DnD system uses PickMode.ALL
    // which picks the topmost actor; if strutActor were above the container it
    // would be picked instead of the AuroraDash, breaking drag-and-drop.
    const strutActor = this._alwaysShow ? this._createStrutActor(monitorIndex) : null;

    const container = new St.Bin({
      name: `aurora-dock-container-${monitorIndex}`,
      reactive: true,
      visible: false,
    });

    Main.layoutManager.addChrome(container, {
      trackFullscreen: true,
      affectsStruts: false,
    });

    const dash = new (AuroraDash as unknown as new (p: {
      monitorIndex: number;
      showTrash: boolean;
    }) => AuroraDash)({
      monitorIndex,
      showTrash: this._showTrash,
    });
    container.set_child(dash);
    dash.attachToContainer(container);

    const binding: ManagedDockBinding = {
      monitorIndex,
      container,
      dash,
      intellihide: null,
      hotArea: null,
      strutActor: null,
      autoHideReleaseId: 0,
      hotAreaEnableId: 0,
      hotAreaActive: false,
    };
    logger.debug(
      `monitor=${monitorIndex} binding created geometry=${monitor.x},${monitor.y} ${monitor.width}x${monitor.height} mode=${this._alwaysShow ? 'always-show' : 'intellihide'}`,
      { prefix: LOG_PREFIX },
    );

    if (this._alwaysShow) {
      binding.strutActor = strutActor;
      dash.setFlushMode(true);
      dash.blockAutoHide(true);
      container.connectObject(
        'notify::allocation',
        () => this._updateStrutFromContainer(binding),
        this,
      );
    } else {
      const intellihide = new DockIntellihide(monitorIndex);
      binding.intellihide = intellihide;
      dash.setTargetBoxListener((box) => intellihide.updateTargetBox(box));

      binding.hotArea = this._createHotArea(binding, monitor);

      intellihide.connectObject(
        'status-changed',
        () => {
          if (binding.hotAreaActive) {
            this._handleHotAreaActiveIntellihideChange(binding);
            return;
          }

          if (intellihide.status === OverlapStatus.CLEAR) {
            logger.debug(`monitor=${monitorIndex} intellihide=CLEAR show`, {
              prefix: LOG_PREFIX,
            });
            this._clearHotAreaReveal(binding);
            this._clearHotAreaEnable(binding);
            binding.hotArea?.setEnabled(false);
            dash.blockAutoHide(true);
          } else if (intellihide.status === OverlapStatus.BLOCKED) {
            logger.debug(`monitor=${monitorIndex} intellihide=BLOCKED release autohide`, {
              prefix: LOG_PREFIX,
            });
            dash.forceAutoHide(true);
            this._enableHotAreaWhenDockHidden(binding);
          }
        },
        'blocked-reasserted',
        () => {
          // A focus change re-affirmed BLOCKED without an enum transition
          // (e.g. switching between two fullscreen windows). Dismiss any
          // lingering hot-area reveal so the dock does not stay pinned open.
          if (binding.hotAreaActive) {
            this._handleHotAreaActiveIntellihideChange(binding);
          }
        },
        this,
      );
    }

    return binding;
  }

  private _createStrutActor(monitorIndex: number): St.Widget {
    const strut = new St.Widget({
      name: `aurora-dock-strut-${monitorIndex}`,
      reactive: false,
      opacity: 0,
    });
    Main.layoutManager.addChrome(strut, {
      trackFullscreen: false,
      affectsStruts: true,
    });
    return strut;
  }

  private _updateStrutFromContainer(binding: ManagedDockBinding): void {
    if (!binding.strutActor) return;
    const h = binding.container.height;
    if (h <= 0) return;
    const monitor = Main.layoutManager.monitors?.[binding.monitorIndex];
    if (!monitor) return;
    binding.strutActor.set_size(monitor.width, h);
    binding.strutActor.set_position(monitor.x, monitor.y + monitor.height - h);
  }

  private _createHotArea(
    binding: ManagedDockBinding,
    monitor: DashBounds,
  ): InstanceType<typeof DockHotArea> | null {
    if (monitor.width <= 0 || monitor.height <= 0) return null;

    const hotArea = new DockHotArea(monitor);
    Main.layoutManager.addChrome(hotArea, {
      trackFullscreen: true,
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

    let bounds: DashBounds;

    if (this._alwaysShow) {
      // Use physical monitor height instead of work-area height to avoid a
      // feedback loop: our own strut shrinks the work area, which would push
      // the dock upward on each workareas-changed signal.
      const monitor = Main.layoutManager.monitors?.[binding.monitorIndex];
      bounds = {
        x: workArea.x,
        y: monitor ? monitor.y : workArea.y,
        width: workArea.width,
        height: monitor ? monitor.height : workArea.height,
      };
    } else {
      bounds = {
        x: workArea.x,
        y: workArea.y,
        width: workArea.width,
        height: workArea.height,
      };
    }

    binding.dash.refresh();
    binding.dash.applyWorkArea(bounds);
    logger.debug(
      `monitor=${binding.monitorIndex} workarea=${bounds.x},${bounds.y} ${bounds.width}x${bounds.height}`,
      { prefix: LOG_PREFIX },
    );

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
    logger.debug(`monitor=${binding.monitorIndex} binding destroyed`, { prefix: LOG_PREFIX });
    if (binding.autoHideReleaseId) {
      GLib.source_remove(binding.autoHideReleaseId);
      binding.autoHideReleaseId = 0;
    }
    this._clearHotAreaEnable(binding);

    binding.intellihide?.disconnectObject?.(this);
    binding.hotArea?.disconnectObject?.(this);
    binding.container.disconnectObject?.(this);

    if (binding.hotArea) {
      Main.layoutManager.removeChrome?.(binding.hotArea);
      binding.hotArea.destroy();
      binding.hotArea = null;
    }

    if (binding.strutActor) {
      Main.layoutManager.removeChrome?.(binding.strutActor);
      binding.strutActor.destroy();
      binding.strutActor = null;
    }

    binding.intellihide?.destroy();
    binding.dash.detachFromContainer();
    binding.dash.destroy();

    Main.layoutManager.removeChrome?.(binding.container);
    binding.container.destroy();
  }

  private _revealDockFromHotArea(binding: ManagedDockBinding): void {
    if (binding.hotAreaActive) {
      logger.debug(`monitor=${binding.monitorIndex} duplicate hot-area reveal ignored`, {
        prefix: LOG_PREFIX,
      });
      return;
    }

    logger.debug(`monitor=${binding.monitorIndex} hot-area reveal started`, {
      prefix: LOG_PREFIX,
    });
    this._clearHotAreaReveal(binding);
    this._clearHotAreaEnable(binding);
    binding.hotAreaActive = true;
    binding.hotArea?.setEnabled(false);
    // Pin the dock shown so it reliably appears under the dwelling pointer.
    binding.dash.blockAutoHide(true);

    // After a short grace (time to move onto the dock) hand visibility to the
    // dash's native hover-based autohide. It keeps the dock while the pointer
    // is over it and retracts once the pointer leaves. Hover is tracked via
    // Clutter crossing events on the dock actor, so it stays reliable even when
    // the pointer moves onto a client (fullscreen/maximized) window — unlike a
    // stage motion watch, which never fires once the pointer is over a window.
    binding.autoHideReleaseId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      HOT_AREA_REVEAL_DURATION,
      () => {
        binding.autoHideReleaseId = 0;
        this._releaseHotAreaToAutoHide(binding);
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  private _clearHotAreaReveal(binding: ManagedDockBinding): void {
    if (binding.autoHideReleaseId) {
      GLib.source_remove(binding.autoHideReleaseId);
      binding.autoHideReleaseId = 0;
    }
  }

  private _handleHotAreaActiveIntellihideChange(binding: ManagedDockBinding): void {
    if (binding.intellihide?.status !== OverlapStatus.BLOCKED) {
      logger.debug(
        `monitor=${binding.monitorIndex} ignored intellihide=${OverlapStatus[binding.intellihide?.status ?? OverlapStatus.CLEAR]} while hot area is active`,
        { prefix: LOG_PREFIX },
      );
      return;
    }

    // A blocking window is (re)asserted while the reveal is up — e.g. switching
    // between two fullscreen/maximized windows via the dock icons. End the
    // reveal grace early and let native autohide govern: the dock stays while
    // the pointer is over it and retracts the moment it leaves.
    logger.debug(
      `monitor=${binding.monitorIndex} intellihide=BLOCKED while hot area is active; handing to native autohide`,
      { prefix: LOG_PREFIX },
    );
    this._clearHotAreaReveal(binding);
    this._releaseHotAreaToAutoHide(binding);
  }

  // End a hot-area reveal: when a window is blocking, hand the dock to the
  // dash's native hover-based autohide (stays while hovered, hides on leave);
  // when nothing is blocking, keep it pinned visible.
  private _releaseHotAreaToAutoHide(binding: ManagedDockBinding): void {
    if (binding.intellihide?.status === OverlapStatus.CLEAR) {
      logger.debug(`monitor=${binding.monitorIndex} hot-area reveal kept visible: CLEAR`, {
        prefix: LOG_PREFIX,
      });
      binding.hotAreaActive = false;
      binding.hotArea?.setEnabled(false);
      binding.dash.blockAutoHide(true);
      return;
    }

    logger.debug(
      `monitor=${binding.monitorIndex} hot-area reveal handed to native autohide: BLOCKED`,
      { prefix: LOG_PREFIX },
    );
    binding.dash.blockAutoHide(false);
    binding.dash.ensureAutoHide();
    this._enableHotAreaWhenDockHidden(binding);
  }

  private _enableHotAreaWhenDockHidden(binding: ManagedDockBinding): void {
    this._clearHotAreaEnable(binding);

    binding.hotAreaEnableId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
      if (binding.dash.visible) return GLib.SOURCE_CONTINUE;

      binding.hotAreaEnableId = 0;
      binding.hotAreaActive = false;
      binding.hotArea?.setEnabled(true);
      logger.debug(`monitor=${binding.monitorIndex} hot area rearmed after hide`, {
        prefix: LOG_PREFIX,
      });
      return GLib.SOURCE_REMOVE;
    });
  }

  private _clearHotAreaEnable(binding: ManagedDockBinding): void {
    if (!binding.hotAreaEnableId) return;
    GLib.source_remove(binding.hotAreaEnableId);
    binding.hotAreaEnableId = 0;
  }

  private _setOverviewVisible(overviewShowing: boolean): void {
    if (!overviewShowing && this._pendingRebuild) {
      this._rebuildBindings();
      return;
    }

    this._bindings.forEach((binding) => {
      if (overviewShowing) {
        this._clearHotAreaReveal(binding);
        this._clearHotAreaEnable(binding);
        binding.hotAreaActive = false;
        binding.hotArea?.setEnabled(false);
        binding.dash.blockAutoHide(false);
        binding.dash.hide(false);
        binding.container.hide();
      } else {
        binding.hotArea?.setEnabled(true);
        this._updateWorkArea(binding);
        if (this._alwaysShow) {
          binding.dash.blockAutoHide(true);
        } else {
          binding.intellihide?.refresh('overview-hidden', true);
        }
      }
    });
  }
}

export const definition: ModuleDefinition = {
  key: 'dock',
  settingsKey: 'module-dock',
  section: 'dock-panel',
  title: _('Dock'),
  subtitle: _('Custom dock with auto-hide and intellihide features'),
  options: [
    {
      key: 'dock-always-show',
      title: _('Always Show Dock'),
      subtitle: _('Keep dock permanently visible and shrink windows so they never overlap it'),
      type: 'switch',
    },
    {
      key: 'dock-show-trash',
      title: _('Show Trash Icon'),
      subtitle: _('Show a trash can in the dock; click to open it, right-click to empty it'),
      type: 'switch',
    },
  ],
  factory: (ctx) => new Dock(ctx),
};
