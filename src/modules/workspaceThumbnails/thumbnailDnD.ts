// @ts-nocheck
import Clutter from '@girs/clutter-17';
import * as Main from '@girs/gnome-shell/ui/main';
import { WorkspaceThumbnail } from '@girs/gnome-shell/ui/workspaceThumbnail';

const DIM_OPACITY = 102; // ~0.4 × 255
const EASE_DURATION = 150;

export class ThumbnailDnDPatcher {
  private _originalAddWindowClone: ((win: any) => any) | null = null;
  private _thumbnailsBox: any = null;

  patch(): void {
    const proto = (WorkspaceThumbnail as any).prototype;
    this._originalAddWindowClone = proto._addWindowClone;
    const original = this._originalAddWindowClone;
    const attachDragSignals = this._attachDragSignals.bind(this);

    proto._addWindowClone = function (win: any) {
      const clone = original!.call(this, win);
      attachDragSignals(clone, this);
      return clone;
    };

    this._walkExistingClones();
  }

  unpatch(): void {
    if (this._originalAddWindowClone) {
      (WorkspaceThumbnail as any).prototype._addWindowClone = this._originalAddWindowClone;
      this._originalAddWindowClone = null;
    }
    this._restoreAllOpacities();
    this._thumbnailsBox = null;
  }

  private _attachDragSignals(clone: any, thumbnail: any): void {
    clone.connect('drag-begin', () => this._dimSiblings(thumbnail));
    clone.connect('drag-end', () => this._restoreAllOpacities());
    clone.connect('drag-cancelled', () => this._restoreAllOpacities());
  }

  private _walkExistingClones(): void {
    try {
      const box = (Main.overview as any)._overview?._controls?._thumbnailsBox;
      if (!box?.visible) return;

      for (const thumbnail of box.get_children()) {
        for (const clone of thumbnail._windows ?? []) {
          this._attachDragSignals(clone, thumbnail);
        }
      }
    } catch (_e) {
      // Overview internals may differ across GNOME versions; skip gracefully
    }
  }

  private _dimSiblings(activeThumbnail: any): void {
    this._thumbnailsBox = activeThumbnail.get_parent();
    if (!this._thumbnailsBox) return;

    for (const sibling of this._thumbnailsBox.get_children()) {
      sibling.ease({
        opacity: sibling === activeThumbnail ? 255 : DIM_OPACITY,
        duration: EASE_DURATION,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      });
    }
  }

  private _restoreAllOpacities(): void {
    if (!this._thumbnailsBox) return;
    for (const child of this._thumbnailsBox.get_children()) {
      child.ease({
        opacity: 255,
        duration: EASE_DURATION,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      });
    }
    this._thumbnailsBox = null;
  }
}
