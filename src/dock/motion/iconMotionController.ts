// Per-icon hover/press motion controller, ported from d2d-companion's
// lib/runtime/iconMotionController.js. The launch-related state
// (#launching, beginLaunch/endLaunch) is not ported — see the dock motion
// plan for why. PressMode.LAUNCHES_ONLY is honored via a direct check of
// the app's running state at click time instead of a launch engine.

import Clutter from '@girs/clutter-18';
import St from '@girs/st-18';
import Shell from '@girs/shell-18';

import type { MotionRecipe } from '~/dock/motion/catalog.ts';
import type { DockPosition } from '~/dock/dockConfiguration.ts';
import { resolveAnimationMode } from '~/dock/motion/easing.ts';
import { PressInteraction } from '~/dock/motion/pressInteraction.ts';
import {
  dimOpacity,
  hoverNeedsBudget,
  neighborScaleAt,
  resolveIconTransform,
  textureRenderSize,
} from '~/dock/motion/transforms.ts';

const OWNED_TRANSITIONS = Object.freeze(['scale-x', 'scale-y', 'translation-x', 'translation-y']);

function finiteActorValue(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

interface OriginalState {
  scaleX: number;
  scaleY: number;
  translationX: number;
  translationY: number;
  pivotX: number;
  pivotY: number;
  opacity: number;
  redirect: number;
}

interface SizeConstraints {
  minWidth: number;
  minWidthSet: boolean;
  naturalWidth: number;
  naturalWidthSet: boolean;
  minHeight: number;
  minHeightSet: boolean;
  naturalHeight: number;
  naturalHeightSet: boolean;
}

interface TextureState {
  actor: St.Icon;
  constraints: SizeConstraints;
}

interface AppliedProperties {
  scale_x: number;
  scale_y: number;
  translation_x: number;
  translation_y: number;
}

export interface IconBudget {
  budgetPx: number;
  iconNormalSize: number;
}

export interface BaseIconLike {
  iconSize: number;
  _iconBin?: St.Bin;
}

export type MotionTarget = Omit<St.Button, '_delegate'> & {
  app?: Shell.App | null;
  icon?: BaseIconLike;
  _delegate?: { icon?: BaseIconLike };
};

export interface IconMotionControllerParams {
  icon: MotionTarget;
  baseIcon: BaseIconLike;
  bin: St.Bin;
  recipe: MotionRecipe;
  position: DockPosition;
  onHoverChanged?: (controller: IconMotionController, hovered: boolean) => void;
  onDestroyed?: (controller: IconMotionController) => void;
  onMeasured?: (measurement: IconBudget) => void;
}

export class IconMotionController {
  private _icon: MotionTarget | null;
  private _baseIcon: BaseIconLike | null;
  private _bin: St.Bin | null;
  private _recipe: MotionRecipe;
  private _position: DockPosition;
  private _onHoverChanged: (controller: IconMotionController, hovered: boolean) => void;
  private _onDestroyed: (controller: IconMotionController) => void;
  private _onMeasured: (measurement: IconBudget) => void;

  private _dimmed = false;
  private _hovered = false;
  private _neighborDistance = Infinity;
  private _pendingBudgetReport = false;
  private _press = new PressInteraction();
  private _signalIds: number[] = [];
  private _binChildId = 0;
  private readonly _original: OriginalState;
  private _textureState: TextureState | null = null;
  private _lastApplied: AppliedProperties;

  constructor({
    icon,
    baseIcon,
    bin,
    recipe,
    position,
    onHoverChanged = () => {},
    onDestroyed = () => {},
    onMeasured = () => {},
  }: IconMotionControllerParams) {
    this._icon = icon;
    this._baseIcon = baseIcon;
    this._bin = bin;
    this._recipe = recipe;
    this._position = position;
    this._onHoverChanged = onHoverChanged;
    this._onDestroyed = onDestroyed;
    this._onMeasured = onMeasured;

    const [pivotX, pivotY] = bin.get_pivot_point();
    this._original = {
      scaleX: finiteActorValue(bin.scale_x, 1),
      scaleY: finiteActorValue(bin.scale_y, 1),
      translationX: finiteActorValue(bin.translation_x, 0),
      translationY: finiteActorValue(bin.translation_y, 0),
      pivotX: finiteActorValue(pivotX, 0.5),
      pivotY: finiteActorValue(pivotY, 0.5),
      opacity: bin.opacity,
      redirect: bin.offscreen_redirect,
    };
    // The bin starts at rest, so the first apply toward rest skips.
    this._lastApplied = {
      scale_x: this._original.scaleX,
      scale_y: this._original.scaleY,
      translation_x: this._original.translationX,
      translation_y: this._original.translationY,
    };

    this._signalIds.push(icon.connect('notify::hover', () => this._syncHover()));
    this._signalIds.push(
      icon.connect('button-press-event', (_actor: unknown, event: Clutter.Event) => {
        if (event.get_button() === Clutter.BUTTON_PRIMARY) {
          // Fixed dock actions (Trash/removable storage) have no Shell.App,
          // but their primary click still launches or opens something and
          // should receive the same tactile feedback as a cold app launch.
          const isLaunchClick = !icon.app || icon.app.state === Shell.AppState.STOPPED;
          if (this._press.beginPrimary(this._recipe.press, isLaunchClick))
            this._apply(this._recipe.press.duration);
        }
        return Clutter.EVENT_PROPAGATE;
      }),
    );
    this._signalIds.push(
      icon.connect('notify::pressed', () => {
        if (this._press.syncButtonPressed(icon.pressed)) this._apply(this._recipe.press.duration);
      }),
    );
    this._signalIds.push(
      icon.connect_after('clicked', () => {
        if (this._press.finishClick()) this._apply(this._recipe.press.duration);
      }),
    );
    this._signalIds.push(icon.connect('destroy', () => this.onTargetDestroyed()));
    this._binChildId = bin.connect('notify::child', () => this._syncTextureResolution());
    this._syncTextureResolution();
    this._syncHover();
  }

  get recipe(): MotionRecipe {
    return this._recipe;
  }

  setRecipe(recipe: MotionRecipe): void {
    this._recipe = recipe;
    this._press.reset();
    this._syncTextureResolution();
    this._apply();
  }

  // State only; returns true when the flush must apply this icon.
  setNeighborDistance(distance: number): boolean {
    if (this._neighborDistance === distance) return false;
    const { hover } = this._recipe;
    const visibleChange =
      hover.enabled &&
      neighborScaleAt(hover, this._neighborDistance) !== neighborScaleAt(hover, distance);
    this._neighborDistance = distance;
    return visibleChange && !this._hovered;
  }

  // The neighbor group schedules the apply.
  applyHoverState(): void {
    this._apply();
  }

  onTargetDestroyed(): void {
    if (!this._icon) return;
    this._signalIds = [];
    this._binChildId = 0;
    this._dimmed = false;
    this._textureState = null;
    this._bin = null;
    this._baseIcon = null;
    this._icon = null;
    this._onDestroyed(this);
  }

  dispose({ restore = true }: { restore?: boolean } = {}): void {
    if (!this._icon) return;
    if (this._icon) {
      for (const id of this._signalIds) this._icon.disconnect(id);
    }
    this._signalIds = [];
    if (this._bin && this._binChildId) this._bin.disconnect(this._binChildId);
    this._binChildId = 0;
    this._syncDim(0);
    if (restore) this._restore();
    this._onDestroyed(this);
    this._bin = null;
    this._baseIcon = null;
    this._icon = null;
  }

  measure(): IconBudget | null {
    return this._icon ? this._measureBudget() : null;
  }

  private _syncHover(): void {
    if (!this._icon) return;
    const hovered = Boolean(this._icon.hover);
    if (this._hovered === hovered) return;
    this._hovered = hovered;
    this._pendingBudgetReport = hovered;
    if (!hovered) this._press.reset();
    this._onHoverChanged(this, hovered);
  }

  private _apply(durationOverride: number | null = null): void {
    if (!this._icon || !this._bin) return;
    const animationsEnabled = St.Settings.get().enable_animations;
    const budget =
      this._pendingBudgetReport ||
      (animationsEnabled &&
        hoverNeedsBudget({
          recipe: this._recipe,
          hovered: this._hovered,
          neighborDistance: this._neighborDistance,
        }))
        ? this._measureBudget()
        : null;
    if (this._pendingBudgetReport) {
      this._pendingBudgetReport = false;
      if (budget) this._onMeasured(budget);
    }

    const transform = resolveIconTransform({
      recipe: this._recipe,
      hovered: this._hovered,
      neighborDistance: this._neighborDistance,
      pressed: this._press.pressed,
      animationsEnabled,
      budgetPx: budget ? budget.budgetPx : Infinity,
      iconNormalSize: budget ? budget.iconNormalSize : 0,
      position: this._position,
    });
    // Leaving settles a little more slowly than entering. This avoids a
    // twitchy snap-back during quick pointer sweeps without delaying hover.
    const hoverDuration = this._hovered
      ? this._recipe.hover.duration
      : Math.round(this._recipe.hover.duration * 1.15);
    const baseDuration = durationOverride === null ? hoverDuration : durationOverride;
    const duration = animationsEnabled ? baseDuration : 0;
    const properties: AppliedProperties = {
      scale_x: this._original.scaleX * transform.scaleX,
      scale_y: this._original.scaleY * transform.scaleY,
      translation_x: this._original.translationX + transform.translationX,
      translation_y: this._original.translationY + transform.translationY,
    };

    this._syncDim(transform.dim);
    this._bin.set_pivot_point(transform.pivot[0], transform.pivot[1]);

    const last = this._lastApplied;
    if (
      duration > 0 &&
      last.scale_x === properties.scale_x &&
      last.scale_y === properties.scale_y &&
      last.translation_x === properties.translation_x &&
      last.translation_y === properties.translation_y
    )
      return;
    this._lastApplied = properties;

    this._removeOwnedTransitions();
    if (duration === 0) {
      Object.assign(this._bin, properties);
      return;
    }

    this._bin.ease({
      ...properties,
      duration,
      mode: resolveAnimationMode(this._recipe.hover.easing, Clutter.AnimationMode),
    });
  }

  // Measure the room between the icon and the dash's clip.
  private _measureBudget(): IconBudget | null {
    if (!this._bin) return null;

    const parent = this._bin.get_parent();
    if (!parent) return null;

    let clipActor: Clutter.Actor | null = null;
    for (let node: Clutter.Actor | null = this._bin; node; node = node.get_parent()) {
      if (node.has_clip) {
        clipActor = node;
        break;
      }
    }
    if (!clipActor) return null;

    const box = this._bin.get_allocation_box();
    const clip = clipActor.get_clip();
    if (!clip) return null;
    const [clipX, clipY] = clipActor.get_transformed_position();
    const [parentX, parentY] = parent.get_transformed_position();
    if (this._position === 'left') {
      const right = parentX + box.x2;
      const clipRight = clipX + clip[0] + clip[2];
      return { budgetPx: clipRight - right, iconNormalSize: box.x2 - box.x1 };
    }
    if (this._position === 'right') {
      const left = parentX + box.x1;
      const clipLeft = clipX + clip[0];
      return { budgetPx: left - clipLeft, iconNormalSize: box.x2 - box.x1 };
    }

    const top = parentY + box.y1;
    const clipTop = clipY + clip[1];
    return { budgetPx: top - clipTop, iconNormalSize: box.y2 - box.y1 };
  }

  // A brightness effect would render offscreen and blur the scaled icon.
  // Dim from the original opacity, never the current one: a snapshot of an
  // already dimmed bin would compound and darken the icon for good.
  private _syncDim(dim: number): void {
    if (!this._bin) return;
    if (dim > 0) {
      if (!this._dimmed) {
        this._dimmed = true;
        this._bin.offscreen_redirect = 0;
      }
      this._bin.opacity = dimOpacity(this._original.opacity, dim);
    } else if (this._dimmed) {
      this._bin.opacity = this._original.opacity;
      this._bin.offscreen_redirect = this._original.redirect;
      this._dimmed = false;
    }
  }

  private _syncTextureResolution(): void {
    if (!this._bin || !this._baseIcon || !(this._baseIcon.iconSize > 0)) return;

    const normalSize = this._baseIcon.iconSize;

    const child = this._bin.child;
    if (!(child instanceof St.Icon)) return;
    if (this._textureState?.actor !== child) {
      this._textureState = {
        actor: child,
        constraints: {
          minWidth: child.min_width,
          minWidthSet: child.min_width_set,
          naturalWidth: child.natural_width,
          naturalWidthSet: child.natural_width_set,
          minHeight: child.min_height,
          minHeightSet: child.min_height_set,
          naturalHeight: child.natural_height,
          naturalHeightSet: child.natural_height_set,
        },
      };
    }

    const renderSize = textureRenderSize(normalSize, this._recipe);
    if (renderSize > 0 && child.icon_size !== renderSize) child.icon_size = renderSize;
    // Keep only the texture supersampled. Explicitly constraining the St.Icon
    // actor itself preserves the exact preferred size that Dash uses for its
    // icon-size budget; constraining the parent bin subtly changes that math.
    child.set_size(normalSize, normalSize);
  }

  private _restoreTextureResolution(): void {
    const state = this._textureState;
    if (!state) return;

    if (
      this._baseIcon &&
      this._baseIcon.iconSize > 0 &&
      state.actor.icon_size !== this._baseIcon.iconSize
    ) {
      state.actor.icon_size = this._baseIcon.iconSize;
    }

    const { actor, constraints } = state;
    actor.min_width = constraints.minWidth;
    actor.natural_width = constraints.naturalWidth;
    actor.min_height = constraints.minHeight;
    actor.natural_height = constraints.naturalHeight;
    actor.min_width_set = constraints.minWidthSet;
    actor.natural_width_set = constraints.naturalWidthSet;
    actor.min_height_set = constraints.minHeightSet;
    actor.natural_height_set = constraints.naturalHeightSet;
    this._textureState = null;
  }

  private _restore(): void {
    if (!this._bin) return;
    this._removeOwnedTransitions();
    this._bin.set_pivot_point(this._original.pivotX, this._original.pivotY);
    this._bin.set_scale(this._original.scaleX, this._original.scaleY);
    this._bin.translation_x = this._original.translationX;
    this._bin.translation_y = this._original.translationY;
    this._restoreTextureResolution();
  }

  private _removeOwnedTransitions(): void {
    if (!this._bin) return;
    for (const transition of OWNED_TRANSITIONS) this._bin.remove_transition(transition);
  }
}
