import '@girs/gjs';
import { gettext as _ } from '~/shared/i18n.ts';

import St from '@girs/st-18';
import GLib from '@girs/glib-2.0';

import * as Main from '@girs/gnome-shell/ui/main';
import * as DND from '@girs/gnome-shell/ui/dnd';

import type { ExtensionContext } from '~/core/context.ts';
import { LifecycleScope } from '~/core/lifecycleScope.ts';
import { logger } from '~/core/logger.ts';
import { Module } from '~/module.ts';
import { AuroraDash, type DashBounds } from '~/shared/ui/dash.ts';
import { DockHotArea } from '~/dock/hotArea.ts';
import { DockIntellihide, OverlapStatus } from '~/dock/intellihide.ts';
import { getDockMonitorIndexes } from '~/dock/monitorTopology.ts';
import { DEFAULT_PROFILE, getBuiltInRecipe } from '~/dock/motion/catalog.ts';
import { DashMotionIntegration } from '~/dock/motion/dashMotionIntegration.ts';

const HOT_AREA_REVEAL_DURATION = 1500;
const HOT_AREA_STRIP_HEIGHT = 1;
const CONTEXTUAL_DRAG_REVEAL_DELAY = 800;
const TRANSITION_ACTIVATION_COOLDOWN = 700;
const LOG_PREFIX = 'Dock';

export type ManagedDockBinding = {
  monitorIndex: number;
  mode: 'always-show' | 'always-autohide' | 'intellihide';
  container: St.Bin;
  dash: AuroraDash;
  intellihide: InstanceType<typeof DockIntellihide> | null;
  hotArea: InstanceType<typeof DockHotArea> | null;
  strutActor: St.Widget | null;
  autoHideReleaseId: number;
  hotAreaEnableId: number;
  hotAreaActive: boolean;
  motion: DashMotionIntegration;
};

export class Dock extends Module {
  private _bindings = new Map<number, ManagedDockBinding>();
  private _lifecycle: LifecycleScope | null = null;
  private _pendingRebuild = false;
  private _dockSettings: any = null;
  private _alwaysShow = false;
  private _intellihideEnabled = false;
  private _showOnAllMonitors = false;
  private _showTrash = true;
  private _showExternalStorage = true;
  private _motionEnabled = true;
  private _motionProfile: string = DEFAULT_PROFILE;
  private _edgeDragMonitor: { dragMotion: (event: any) => number } | null = null;
  private _edgeDragTarget: ManagedDockBinding | null = null;
  private _edgeDragRevealId = 0;
  private _sessionWasLocked = false;
  private _fullscreenMonitors = new Set<number>();

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this._lifecycle = new LifecycleScope();
    this._dockSettings = this.context.settings.getRawSettings();
    this._alwaysShow = this._dockSettings?.get_boolean('dock-always-show') ?? false;
    this._intellihideEnabled = this._dockSettings?.get_boolean('dock-intellihide') ?? false;
    if (this._alwaysShow && this._intellihideEnabled) {
      this._intellihideEnabled = false;
      this._dockSettings?.set_boolean('dock-intellihide', false);
    }
    this._showOnAllMonitors = this._dockSettings?.get_boolean('dock-show-on-all-monitors') ?? false;
    this._showTrash = this._dockSettings?.get_boolean('dock-show-trash') ?? true;
    this._showExternalStorage =
      this._dockSettings?.get_boolean('dock-show-external-storage') ?? true;
    this._motionEnabled = this._dockSettings?.get_boolean('dock-motion-enabled') ?? true;
    this._motionProfile = this._dockSettings?.get_string('dock-motion-profile') ?? DEFAULT_PROFILE;
    logger.debug(
      [
        `enable alwaysShow=${this._alwaysShow}`,
        `intellihide=${this._intellihideEnabled}`,
        `showOnAllMonitors=${this._showOnAllMonitors}`,
        `showTrash=${this._showTrash}`,
        `showExternalStorage=${this._showExternalStorage}`,
        `monitors=${Main.layoutManager.monitors?.length ?? 0}`,
      ].join(' '),
      { prefix: LOG_PREFIX },
    );

    Main.overview.dash.hide();

    this._sessionWasLocked = Boolean(Main.sessionMode.isLocked);
    this._fullscreenMonitors = this._getFullscreenMonitors();
    this._rebuildBindings();
    this._setupContextualDragReveal();
    Main.layoutManager.connectObject(
      'monitors-changed',
      () => {
        this._rebuildBindings();
        this._fullscreenMonitors = this._getFullscreenMonitors();
        this._beginActivationCooldown('monitors-changed');
      },
      'hot-corners-changed',
      () => this._rebuildBindings(),
      'startup-complete',
      () => this._rebuildBindings(),
      this,
    );
    this._lifecycle.onDispose(() => Main.layoutManager.disconnectObject(this));

    global.display.connectObject(
      'workareas-changed',
      () => this._refreshWorkAreas(),
      'in-fullscreen-changed',
      () => this._handleFullscreenChanged(),
      this,
    );
    this._lifecycle.onDispose(() => global.display.disconnectObject(this));

    Main.sessionMode.connectObject(
      'updated',
      () => {
        const isLocked = Boolean(Main.sessionMode.isLocked);
        if (this._sessionWasLocked && !isLocked) {
          this._beginActivationCooldown('session-unlocked');
        }
        this._sessionWasLocked = isLocked;
        this._refreshBindingsLayout();
      },
      this,
    );
    this._lifecycle.onDispose(() => Main.sessionMode.disconnectObject(this));

    Main.overview.connectObject(
      'showing',
      () => this._setOverviewVisible(true),
      'hidden',
      () => this._setOverviewVisible(false),
      this,
    );
    this._lifecycle.onDispose(() => Main.overview.disconnectObject(this));

    this._dockSettings?.connectObject(
      'changed::dock-always-show',
      () => {
        this._alwaysShow = this._dockSettings?.get_boolean('dock-always-show') ?? false;
        if (this._alwaysShow && this._intellihideEnabled) {
          this._dockSettings?.set_boolean('dock-intellihide', false);
          return;
        }
        this._rebuildBindings();
      },
      'changed::dock-intellihide',
      () => {
        this._intellihideEnabled = this._dockSettings?.get_boolean('dock-intellihide') ?? false;
        if (this._intellihideEnabled && this._alwaysShow) {
          this._dockSettings?.set_boolean('dock-always-show', false);
          return;
        }
        this._rebuildBindings();
      },
      'changed::dock-show-on-all-monitors',
      () => {
        this._showOnAllMonitors =
          this._dockSettings?.get_boolean('dock-show-on-all-monitors') ?? false;
        this._rebuildBindings();
      },
      'changed::dock-show-trash',
      () => {
        this._showTrash = this._dockSettings?.get_boolean('dock-show-trash') ?? true;
        this._rebuildBindings();
      },
      'changed::dock-show-external-storage',
      () => {
        this._showExternalStorage =
          this._dockSettings?.get_boolean('dock-show-external-storage') ?? true;
        this._rebuildBindings();
      },
      'changed::dock-motion-enabled',
      () => {
        this._motionEnabled = this._dockSettings?.get_boolean('dock-motion-enabled') ?? true;
        this._bindings.forEach((b) => b.motion.setEnabled(this._motionEnabled));
      },
      'changed::dock-motion-profile',
      () => {
        this._motionProfile =
          this._dockSettings?.get_string('dock-motion-profile') ?? DEFAULT_PROFILE;
        const recipe = getBuiltInRecipe(this._motionProfile);
        this._bindings.forEach((b) => b.motion.setRecipe(recipe));
      },
      'changed::module-pip-on-top',
      () => {
        const enabled = this._dockSettings?.get_boolean('module-pip-on-top') ?? false;
        this._bindings.forEach((binding) =>
          binding.intellihide?.setExcludePipFromSmartReveal(enabled),
        );
      },
      this,
    );

    this.context.signals.connectObject('icons-woven', () => this._refreshBindingsLayout(), this);
    this._lifecycle.onDispose(() => this.context.signals.disconnectObject(this));
    this._lifecycle.onDispose(() => this._dockSettings?.disconnectObject(this));
  }

  override disable(): void {
    Main.overview.dash.show();
    this._teardownContextualDragReveal();
    this._lifecycle?.dispose();
    this._lifecycle = null;
    this._dockSettings = null;
    this._pendingRebuild = false;
    this._fullscreenMonitors.clear();
    this._clearBindings();
  }

  get bindings(): readonly ManagedDockBinding[] {
    return [...this._bindings.values()];
  }

  get alwaysShow(): boolean {
    return this.context.settings.getBoolean('dock-always-show');
  }

  get intellihideEnabled(): boolean {
    return this.context.settings.getBoolean('dock-intellihide');
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
    const primaryIndex = Main.layoutManager.primaryIndex;
    const monitorIndexes = getDockMonitorIndexes(monitors, primaryIndex, this._showOnAllMonitors);
    const monitorSummary = monitors
      .map(
        (monitor, index) => `${index}:${monitor.x},${monitor.y} ${monitor.width}x${monitor.height}`,
      )
      .join(';');
    logger.debug(
      [
        `rebuild primary=${primaryIndex}`,
        `showOnAllMonitors=${this._showOnAllMonitors}`,
        `selected=[${monitorIndexes.join(',')}]`,
        `monitors=[${monitorSummary}]`,
      ].join(' '),
      { prefix: LOG_PREFIX },
    );
    monitorIndexes.forEach((monitorIndex) => {
      const monitor = monitors[monitorIndex];
      if (!monitor) return;
      const binding = this._createBinding(monitor, monitorIndex);
      if (binding) this._bindings.set(monitorIndex, binding);
    });

    this._refreshWorkAreas();
  }

  private _createBinding(monitor: DashBounds, monitorIndex: number): ManagedDockBinding | null {
    const mode = this._alwaysShow
      ? 'always-show'
      : this._intellihideEnabled
        ? 'intellihide'
        : 'always-autohide';
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
      isolateMonitor: boolean;
      showTrash: boolean;
      showExternalStorage: boolean;
    }) => AuroraDash)({
      monitorIndex,
      isolateMonitor: this._showOnAllMonitors,
      showTrash: this._showTrash,
      showExternalStorage: this._showExternalStorage,
    });
    container.set_child(dash);
    dash.attachToContainer(container);

    const motion = new DashMotionIntegration(getBuiltInRecipe(this._motionProfile));
    motion.attach(dash, this._motionEnabled);

    const binding: ManagedDockBinding = {
      monitorIndex,
      mode,
      container,
      dash,
      intellihide: null,
      hotArea: null,
      strutActor: null,
      autoHideReleaseId: 0,
      hotAreaEnableId: 0,
      hotAreaActive: false,
      motion,
    };
    logger.debug(
      `monitor=${monitorIndex} binding created geometry=${monitor.x},${monitor.y} ${monitor.width}x${monitor.height} mode=${mode}`,
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
      binding.hotArea = this._createHotArea(binding, monitor);

      if (!this._intellihideEnabled) {
        dash.forceAutoHide(false);
        this._enableHotAreaWhenDockHidden(binding);
        return binding;
      }

      const intellihide = new DockIntellihide(
        monitorIndex,
        this._dockSettings?.get_boolean('module-pip-on-top') ?? false,
      );
      binding.intellihide = intellihide;
      dash.setTargetBoxListener((box) => intellihide.updateTargetBox(box));

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
            logger.debug(`monitor=${monitorIndex} intellihide=BLOCKED handoff autohide`, {
              prefix: LOG_PREFIX,
            });
            this._handOffBlockedDockToAutoHide(binding);
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
    if (this._edgeDragTarget === binding) this._clearContextualDragReveal();
    logger.debug(`monitor=${binding.monitorIndex} binding destroyed`, { prefix: LOG_PREFIX });
    if (binding.autoHideReleaseId) {
      GLib.source_remove(binding.autoHideReleaseId);
      binding.autoHideReleaseId = 0;
    }
    this._clearHotAreaEnable(binding);

    binding.intellihide?.disconnectObject(this);
    binding.hotArea?.disconnectObject(this);
    binding.container.disconnectObject(this);

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
    binding.motion.dispose();
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
        `monitor=${binding.monitorIndex} intellihide=CLEAR while hot area is active; keeping dock visible`,
        { prefix: LOG_PREFIX },
      );
      this._clearHotAreaReveal(binding);
      this._clearHotAreaEnable(binding);
      binding.hotAreaActive = false;
      binding.hotArea?.setEnabled(false);
      binding.dash.blockAutoHide(true);
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

  private _handOffBlockedDockToAutoHide(binding: ManagedDockBinding): void {
    binding.dash.blockAutoHide(false);
    binding.dash.ensureAutoHide();
    this._enableHotAreaWhenDockHidden(binding);
  }

  // End a hot-area reveal: when a window is blocking, hand the dock to the
  // dash's native hover-based autohide (stays while hovered, hides on leave);
  // when nothing is blocking, keep it pinned visible.
  private _releaseHotAreaToAutoHide(binding: ManagedDockBinding): void {
    if (binding.mode === 'intellihide' && binding.intellihide?.status === OverlapStatus.CLEAR) {
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
    this._handOffBlockedDockToAutoHide(binding);
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

  private _setupContextualDragReveal(): void {
    this._edgeDragMonitor = {
      dragMotion: (event: any) => {
        this._handleContextualDragMotion(event);
        return DND.DragMotionResult.CONTINUE;
      },
    };
    DND.addDragMonitor(this._edgeDragMonitor);

    Main.xdndHandler.connectObject('drag-end', () => this._clearContextualDragReveal(), this);
    Main.overview.connectObject(
      'item-drag-end',
      () => this._clearContextualDragReveal(),
      'item-drag-cancelled',
      () => this._clearContextualDragReveal(),
      'window-drag-end',
      () => this._clearContextualDragReveal(),
      'window-drag-cancelled',
      () => this._clearContextualDragReveal(),
      this,
    );
  }

  private _teardownContextualDragReveal(): void {
    this._clearContextualDragReveal();
    if (this._edgeDragMonitor) {
      DND.removeDragMonitor(this._edgeDragMonitor);
      this._edgeDragMonitor = null;
    }
    Main.xdndHandler.disconnectObject(this);
  }

  private _handleContextualDragMotion(event: any): void {
    const { source, x, y } = event;
    let target: ManagedDockBinding | null = null;
    for (const binding of this._bindings.values()) {
      if (
        binding.hotArea?.canStartContextualDragReveal(x, y) &&
        binding.dash.canAcceptContextualEdgeDrag(source)
      ) {
        target = binding;
        break;
      }
    }

    if (target === this._edgeDragTarget) return;

    this._clearContextualDragReveal();
    if (!target) return;

    this._edgeDragTarget = target;
    this._edgeDragRevealId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      CONTEXTUAL_DRAG_REVEAL_DELAY,
      () => {
        this._edgeDragRevealId = 0;
        const currentTarget = this._edgeDragTarget;
        this._edgeDragTarget = null;
        if (
          currentTarget &&
          this._bindings.get(currentTarget.monitorIndex) === currentTarget &&
          currentTarget.hotArea?.canStartContextualDragReveal(x, y) &&
          currentTarget.dash.canAcceptContextualEdgeDrag(source)
        ) {
          logger.debug(
            `monitor=${currentTarget.monitorIndex} contextual drag reveal after ${CONTEXTUAL_DRAG_REVEAL_DELAY}ms`,
            { prefix: LOG_PREFIX },
          );
          this._revealDockFromHotArea(currentTarget);
        }
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  private _clearContextualDragReveal(): void {
    if (this._edgeDragRevealId) {
      GLib.source_remove(this._edgeDragRevealId);
      this._edgeDragRevealId = 0;
    }
    this._edgeDragTarget = null;
  }

  private _beginActivationCooldown(reason: string): void {
    this._clearContextualDragReveal();
    this._bindings.forEach((binding) =>
      binding.hotArea?.beginCooldown(TRANSITION_ACTIVATION_COOLDOWN, reason),
    );
  }

  private _getFullscreenMonitors(): Set<number> {
    const fullscreenMonitors = new Set<number>();
    const monitors = Main.layoutManager.monitors ?? [];
    monitors.forEach((_monitor, index) => {
      if (global.display.get_monitor_in_fullscreen(index)) fullscreenMonitors.add(index);
    });
    return fullscreenMonitors;
  }

  private _handleFullscreenChanged(): void {
    const currentFullscreenMonitors = this._getFullscreenMonitors();
    const exitedFullscreen = [...this._fullscreenMonitors].some(
      (monitorIndex) => !currentFullscreenMonitors.has(monitorIndex),
    );
    this._fullscreenMonitors = currentFullscreenMonitors;
    if (exitedFullscreen) this._beginActivationCooldown('fullscreen-exited');
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
        } else if (this._intellihideEnabled) {
          binding.intellihide?.refresh('overview-hidden', true);
        } else {
          binding.dash.forceAutoHide(false);
          this._enableHotAreaWhenDockHidden(binding);
        }
      }
    });
  }
}
