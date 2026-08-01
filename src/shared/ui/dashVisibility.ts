import Clutter from '@girs/clutter-18';
import GLib from '@girs/glib-2.0';
import type St from '@girs/st-18';
import * as Main from '@girs/gnome-shell/ui/main';

import { LifecycleScope } from '~/core/lifecycleScope.ts';
import { logger } from '~/core/logger.ts';
import { createManagedSource } from '~/core/mainLoop.ts';

import type { DashBounds } from './dashLayout.ts';
import { shouldHideDash } from './dashState.ts';

const AUTOHIDE_TIMEOUT = 100;
const VISIBILITY_ANIMATION_TIME = 200;
const HIDE_SCALE = 0.98;
const EASE_DURATION_FACTOR = 0.8;
const FULL_OPACITY = 255;
const PIVOT_CENTER_BOTTOM: [number, number] = [0.5, 1];
const LOG_PREFIX = 'DockDash';

type VisibilityTarget = 'shown' | 'hidden';

type DashVisibilityOptions = {
  getContentActor: () => St.Widget | null;
  getContainer: () => St.Bin | null;
  getMonitorIndex: () => number;
  getWorkArea: () => DashBounds | null;
  isMenuOpen: () => boolean;
  applyWorkArea: (workArea: DashBounds) => void;
  queueTargetBoxUpdate: () => void;
  showActor: () => void;
  hideActor: () => void;
};

export class DashVisibilityController {
  private _lifecycle = new LifecycleScope();
  private _autohideTimeout = createManagedSource(this._lifecycle);
  private _delayEnsureAutoHide = createManagedSource(this._lifecycle);
  private _blockAutoHideDelay = createManagedSource(this._lifecycle);
  private _target: VisibilityTarget;
  private _showCompletionCallbacks: Array<() => void> = [];
  private _pendingShow: { animate: boolean } | null = null;
  private _blockAutoHide = false;
  private _itemDragHold = false;
  private _hovered = false;

  constructor(
    private _dash: any,
    private _options: DashVisibilityOptions,
  ) {
    this._target = _dash.visible ? 'shown' : 'hidden';
  }

  get hovered(): boolean {
    return this._hovered;
  }

  setHovered(hovered: boolean): void {
    this._hovered = hovered;
    this.updateAutoHide();
  }

  blockAutoHide(block: boolean): void {
    this._blockAutoHide = block;

    if (block && !Main.overview.visible) {
      this.show(true);
    } else if (!block) {
      this._ensureHoverState();
    }

    this.updateAutoHide();
  }

  forceAutoHide(animate = true): void {
    this._blockAutoHide = false;
    this._blockAutoHideDelay.clear();
    this._autohideTimeout.clear();
    this.hide(animate);
  }

  ensureAutoHide(): void {
    this._delayEnsureAutoHide.replace(() =>
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, VISIBILITY_ANIMATION_TIME, () => {
        this._delayEnsureAutoHide.complete();
        this.updateAutoHide();
        return GLib.SOURCE_REMOVE;
      }),
    );
  }

  show(animate = true, onComplete?: () => void): void {
    this._options.getContainer()?.show();
    this._setContainerInputEnabled(true);

    if (onComplete) {
      this._showCompletionCallbacks.push(onComplete);
    }

    if (this._target === 'shown') {
      if (this._isFullyShown()) {
        this._flushShowCompletionCallbacks();
      }
      return;
    }

    logger.debug(
      `monitor=${this._options.getMonitorIndex()} visibility ${this._target}->shown animate=${animate}`,
      { prefix: LOG_PREFIX },
    );
    this._target = 'shown';

    if (!this._hasValidAllocation()) {
      this._pendingShow = { animate };
      return;
    }

    this._pendingShow = null;
    this._performShow(animate);
  }

  hide(animate = true): void {
    if (this._itemDragHold) {
      this.show(false);
      return;
    }

    this._setContainerInputEnabled(false);

    if (this._target === 'hidden') {
      if (this._isFullyHidden()) return;

      logger.debug(
        `monitor=${this._options.getMonitorIndex()} visibility hidden resync animate=${animate}`,
        { prefix: LOG_PREFIX },
      );
    } else {
      logger.debug(
        `monitor=${this._options.getMonitorIndex()} visibility ${this._target}->hidden animate=${animate}`,
        { prefix: LOG_PREFIX },
      );
    }

    this._target = 'hidden';
    this._pendingShow = null;
    this._showCompletionCallbacks = [];

    if (this._isFullyHidden()) return;

    this._dash.remove_all_transitions();
    this._dash.set_pivot_point(...PIVOT_CENTER_BOTTOM);

    if (!animate) {
      this._applyHiddenState();
      this._options.hideActor();
      return;
    }

    this._dash.ease({
      opacity: 0,
      scaleX: HIDE_SCALE,
      scaleY: HIDE_SCALE,
      duration: VISIBILITY_ANIMATION_TIME * EASE_DURATION_FACTOR,
      mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
      onComplete: () => {
        if (this._target !== 'hidden') return;

        this._options.hideActor();
        logger.debug(`monitor=${this._options.getMonitorIndex()} hidden transition completed`, {
          prefix: LOG_PREFIX,
        });
      },
    });
    this._dash.ease_property('translation-y', this._dash.height, {
      duration: VISIBILITY_ANIMATION_TIME,
      mode: Clutter.AnimationMode.LINEAR,
    });
  }

  beginItemDrag(): void {
    this._itemDragHold = !Main.overview.visible && (this._dash.visible || this._target === 'shown');

    if (this._itemDragHold) {
      this._autohideTimeout.clear();
      this.show(false);
    }
  }

  endItemDrag(): void {
    if (!this._itemDragHold) return;

    this._itemDragHold = false;
    this.updateAutoHide();
  }

  updateAutoHide(): void {
    if (!this._options.getContentActor()) return;

    if (this._itemDragHold) {
      this._autohideTimeout.clear();
      this.show(false);
      return;
    }

    this._autohideTimeout.replace(() =>
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, AUTOHIDE_TIMEOUT, () => {
        if (!this._options.getContentActor()) {
          this._autohideTimeout.complete();
          return GLib.SOURCE_REMOVE;
        }

        if (this._hovered) {
          this._autohideTimeout.complete();
          return GLib.SOURCE_REMOVE;
        }

        const shouldHide = shouldHideDash({
          target: this._target,
          blocked: this._blockAutoHide,
          hovered: this._hovered,
          menuOpen: this._options.isMenuOpen(),
          dragHeld: this._itemDragHold,
        });
        if (!shouldHide) {
          return GLib.SOURCE_CONTINUE;
        }

        this.hide(true);
        this._autohideTimeout.complete();
        return GLib.SOURCE_REMOVE;
      }),
    );
  }

  flushPendingShow(): void {
    if (!this._pendingShow || !this._hasValidAllocation()) return;

    const { animate } = this._pendingShow;
    this._pendingShow = null;
    this._performShow(animate);
  }

  handleContainerDestroyed(): void {
    this._clearSources();
    this._itemDragHold = false;
    this._hovered = false;
  }

  handleContainerDetached(): void {
    this._pendingShow = null;
  }

  destroy(): void {
    this._lifecycle.dispose();
    this._dash.remove_all_transitions();
    this._pendingShow = null;
    this._showCompletionCallbacks = [];
  }

  private _performShow(animate: boolean): void {
    if (this._target !== 'shown') return;

    if (this._isFullyShown()) {
      this._flushShowCompletionCallbacks();
      return;
    }

    const workArea = this._options.getWorkArea();
    if (workArea) {
      this._options.applyWorkArea(workArea);
    }

    const wasVisible = this._dash.visible;
    this._dash.remove_all_transitions();
    this._dash.set_pivot_point(...PIVOT_CENTER_BOTTOM);

    if (!animate) {
      this._applyShownState();
      this._options.showActor();
      this._options.queueTargetBoxUpdate();
      this._flushShowCompletionCallbacks();
      return;
    }

    if (!wasVisible) {
      this._applyHiddenState();
    }
    this._options.showActor();

    this._dash.ease({
      opacity: FULL_OPACITY,
      scaleX: 1,
      scaleY: 1,
      duration: VISIBILITY_ANIMATION_TIME,
      mode: Clutter.AnimationMode.EASE_IN_CUBIC,
      onComplete: () => {
        if (this._target !== 'shown') return;

        this._applyShownState();
        this._options.queueTargetBoxUpdate();
        logger.debug(`monitor=${this._options.getMonitorIndex()} shown transition completed`, {
          prefix: LOG_PREFIX,
        });
        this._flushShowCompletionCallbacks();
      },
    });
    this._dash.ease_property('translation-y', 0, {
      duration: VISIBILITY_ANIMATION_TIME * EASE_DURATION_FACTOR,
      mode: Clutter.AnimationMode.LINEAR,
    });
  }

  private _applyShownState(): void {
    this._dash.translation_y = 0;
    this._dash.opacity = FULL_OPACITY;
    this._dash.set_scale(1, 1);
  }

  private _applyHiddenState(): void {
    this._dash.translation_y = this._dash.height;
    this._dash.opacity = 0;
    this._dash.set_scale(HIDE_SCALE, HIDE_SCALE);
  }

  private _flushShowCompletionCallbacks(): void {
    const callbacks = this._showCompletionCallbacks;
    this._showCompletionCallbacks = [];

    for (const callback of callbacks) {
      callback();
    }
  }

  private _ensureHoverState(): void {
    if (!this._options.getContentActor()) return;

    this._blockAutoHideDelay.replace(() =>
      GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        if (this._options.getContentActor() && this._hovered) {
          this.show(false);
        }

        this._blockAutoHideDelay.complete();
        return GLib.SOURCE_REMOVE;
      }),
    );
  }

  private _isFullyShown(): boolean {
    return (
      this._dash.visible &&
      this._dash.translation_y === 0 &&
      this._dash.scale_x === 1 &&
      this._dash.scale_y === 1 &&
      this._dash.opacity === FULL_OPACITY
    );
  }

  private _isFullyHidden(): boolean {
    return !this._dash.visible && this._dash.opacity === 0;
  }

  private _hasValidAllocation(): boolean {
    const allocation = this._dash.get_allocation_box();
    const width = Math.max(0, allocation.x2 - allocation.x1);
    const height = Math.max(0, allocation.y2 - allocation.y1);
    return width > 0 && height > 0;
  }

  private _setContainerInputEnabled(enabled: boolean): void {
    this._options.getContainer()?.set_reactive(enabled);
  }

  private _clearSources(): void {
    this._autohideTimeout.clear();
    this._delayEnsureAutoHide.clear();
    this._blockAutoHideDelay.clear();
  }
}
