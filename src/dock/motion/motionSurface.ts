// Owns one IconMotionController per dock icon and groups them to compute
// neighbor-hover distances, ported from d2d-companion's
// lib/runtime/motionSurface.js. Each AuroraDash has two container sources:
// _box for app icons and _dashContainer for fixed items such as Trash and
// removable storage. Both feed one visually ordered neighbor group.

import GLib from '@girs/glib-2.0';
import Meta from '@girs/meta-18';
import type Clutter from '@girs/clutter-18';
import St from '@girs/st-18';

import type { MotionRecipe } from '~/dock/motion/catalog.ts';
import type { DockPosition } from '~/dock/dockConfiguration.ts';
import { NeighborRadius } from '~/dock/motion/catalog.ts';
import {
  IconMotionController,
  type IconBudget,
  type MotionTarget,
} from '~/dock/motion/iconMotionController.ts';

interface DashItemContainerLike extends St.Widget {
  child?: MotionTarget;
}

function isMotionTarget(widget: St.Widget): widget is MotionTarget {
  return widget instanceof St.Button;
}

interface SourceConnections {
  childAddedId: number;
  destroyId: number;
}

export class MotionSurface {
  private _recipe: MotionRecipe;
  private _position: DockPosition;
  private _onMeasured: (measurement: IconBudget) => void;
  private _icons = new Map<MotionTarget, IconMotionController>();
  private _group: NeighborGroup | null;
  private _sources: Map<St.Widget, SourceConnections> | null = new Map();

  constructor({
    recipe,
    position,
    getOrderedContainers,
    onMeasured = () => {},
  }: {
    recipe: MotionRecipe;
    position: DockPosition;
    getOrderedContainers: () => Clutter.Actor[];
    onMeasured?: (measurement: IconBudget) => void;
  }) {
    this._recipe = recipe;
    this._position = position;
    this._onMeasured = onMeasured;
    this._group = new NeighborGroup(getOrderedContainers);
  }

  get controllers(): IconMotionController[] {
    return [...this._icons.values()];
  }

  setRecipe(recipe: MotionRecipe): void {
    this._recipe = recipe;
    for (const controller of this.controllers) controller.setRecipe(recipe);
  }

  addContainerSource(source: St.Widget): void {
    if (!this._sources || this._sources.has(source)) return;
    for (const container of source.get_children())
      this._registerContainer(container as DashItemContainerLike);
    const childAddedId = source.connect(
      'child-added',
      (_source: St.Widget, container: St.Widget) => {
        this._registerContainer(container as DashItemContainerLike);
      },
    );
    const destroyId = source.connect('destroy', () => {
      this._sources?.delete(source);
    });
    this._sources.set(source, { childAddedId, destroyId });
  }

  dispose(): void {
    if (!this._sources) return;
    for (const [icon, controller] of [...this._icons]) {
      this._icons.delete(icon);
      controller.dispose();
    }
    this._group?.dispose();
    this._group = null;
    for (const [source, connections] of this._sources) {
      if (connections.childAddedId) source.disconnect(connections.childAddedId);
      if (connections.destroyId) source.disconnect(connections.destroyId);
    }
    this._sources.clear();
    this._sources = null;
  }

  private _registerContainer(container: DashItemContainerLike): void {
    let icon = container.child;
    if (!icon) {
      if (!isMotionTarget(container)) return;
      icon = container;
    }

    let baseIcon = icon.icon;
    if (!baseIcon && icon._delegate) {
      baseIcon = icon._delegate.icon;
    }
    if (!baseIcon || !baseIcon._iconBin || this._icons.has(icon)) return;

    const bin = baseIcon._iconBin;

    const controller = new IconMotionController({
      icon,
      baseIcon,
      bin,
      recipe: this._recipe,
      position: this._position,
      onHoverChanged: (changed, hovered) => this._group?.setHovered(changed, hovered),
      onDestroyed: (destroyed) => {
        this._icons.delete(icon);
        this._group?.remove(destroyed);
      },
      onMeasured: (measurement) => this._onMeasured(measurement),
    });
    this._group?.add(controller, container);
    this._icons.set(icon, controller);
  }
}

class NeighborGroup {
  private _entries: Array<{ controller: IconMotionController; container: St.Widget }> = [];
  private _dirty = new Set<IconMotionController>();
  private _hovered: IconMotionController | null = null;
  private _flushId = 0;
  private _getOrderedContainers: () => Clutter.Actor[];

  constructor(getOrderedContainers: () => Clutter.Actor[]) {
    this._getOrderedContainers = getOrderedContainers;
  }

  add(controller: IconMotionController, container: St.Widget): void {
    this._entries.push({ controller, container });
    this._scheduleFlush();
  }

  remove(controller: IconMotionController): void {
    const index = this._entries.findIndex((entry) => entry.controller === controller);
    if (index === -1) return;
    this._entries.splice(index, 1);
    if (this._hovered === controller) this._hovered = null;
    // Survivors shift by one index, so their distances change too.
    this._scheduleFlush();
  }

  setHovered(controller: IconMotionController, hovered: boolean): void {
    this._hovered = hovered ? controller : this._hovered === controller ? null : this._hovered;
    // The flip must apply even when the distances are inert.
    this._dirty.add(controller);
    this._scheduleFlush();
  }

  dispose(): void {
    this._cancelFlush();
    this._hovered = null;
    this._entries = [];
  }

  private _scheduleFlush(): void {
    if (this._flushId) return;
    this._flushId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
      this._flushId = 0;
      this._flush();
      return GLib.SOURCE_REMOVE;
    });
  }

  private _cancelFlush(): void {
    if (!this._flushId) return;
    global.compositor.get_laters().remove(this._flushId);
    this._flushId = 0;
  }

  // Swap first so changes made while applying get a fresh flush.
  private _flush(): void {
    this._syncNeighbors();
    const dirty = this._dirty;
    this._dirty = new Set();
    for (const { controller } of this._entries) {
      if (dirty.has(controller)) controller.applyHoverState();
    }
  }

  private _syncNeighbors(): void {
    const orderedContainers = this._getOrderedContainers();
    this._entries.sort((first, second) => {
      const firstIndex = orderedContainers.indexOf(first.container);
      const secondIndex = orderedContainers.indexOf(second.container);
      return (
        (firstIndex === -1 ? Number.MAX_SAFE_INTEGER : firstIndex) -
        (secondIndex === -1 ? Number.MAX_SAFE_INTEGER : secondIndex)
      );
    });
    const hoveredIndex = this._entries.findIndex((entry) => entry.controller === this._hovered);
    for (let index = 0; index < this._entries.length; index++) {
      const distance = hoveredIndex === -1 ? Infinity : Math.abs(index - hoveredIndex);
      // Beyond any possible radius the transform is identity; collapse to
      // Infinity so far icons never see a change to apply.
      const entry = this._entries[index];
      if (!entry) continue;
      if (entry.controller.setNeighborDistance(distance > NeighborRadius.MAX ? Infinity : distance))
        this._dirty.add(entry.controller);
    }
  }
}
