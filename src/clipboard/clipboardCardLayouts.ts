import '@girs/gjs';

import Clutter from '@girs/clutter-18';
import GObject from '@girs/gobject-2.0';

function getOverlayPreferredHeight(container: Clutter.Actor, forWidth: number): [number, number] {
  const [content, actions] = container.get_children();
  const [contentMin, contentNatural] = content ? content.get_preferred_height(forWidth) : [0, 0];
  const [actionsMin, actionsNatural] =
    actions && actions.visible ? actions.get_preferred_height(forWidth) : [0, 0];

  return [Math.max(contentMin, actionsMin), Math.max(contentNatural, actionsNatural)];
}

function allocateTopRight(actor: Clutter.Actor | undefined, allocation: Clutter.ActorBox): void {
  if (!actor || !actor.visible) return;

  const [, width] = actor.get_preferred_width(-1);
  const [, height] = actor.get_preferred_height(width);
  actor.allocate(
    new Clutter.ActorBox({
      x1: allocation.x2 - width,
      y1: allocation.y1,
      x2: allocation.x2,
      y2: allocation.y1 + height,
    }),
  );
}

@GObject.registerClass
export class FloatingActionsLayout extends Clutter.LayoutManager {
  override vfunc_get_preferred_width(
    container: Clutter.Actor,
    forHeight: number,
  ): [number, number] {
    const content = container.first_child;
    if (!content) return [0, 0];

    return content.get_preferred_width(forHeight);
  }

  override vfunc_get_preferred_height(
    container: Clutter.Actor,
    forWidth: number,
  ): [number, number] {
    return getOverlayPreferredHeight(container, forWidth);
  }

  override vfunc_allocate(container: Clutter.Actor, allocation: Clutter.ActorBox): void {
    const [content, actions] = container.get_children();
    if (content) content.allocate(allocation);

    allocateTopRight(actions, allocation);
  }
}

@GObject.registerClass
export class CodeCardOverlayLayout extends FloatingActionsLayout {
  override vfunc_allocate(container: Clutter.Actor, allocation: Clutter.ActorBox): void {
    super.vfunc_allocate(container, allocation);
    const badge = container.get_children()[2];
    if (!badge) return;

    const [, width] = badge.get_preferred_width(-1);
    const [, height] = badge.get_preferred_height(width);
    badge.allocate(
      new Clutter.ActorBox({
        x1: allocation.x2 - width,
        y1: allocation.y2 - height,
        x2: allocation.x2,
        y2: allocation.y2,
      }),
    );
  }
}
