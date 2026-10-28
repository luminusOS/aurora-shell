import Clutter from '@girs/clutter-18';
import type Cogl from '@girs/cogl-18';
import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import St from '@girs/st-18';
import * as Main from '@girs/gnome-shell/ui/main';

import { Module } from '~/module.ts';
import { LifecycleScope } from '~/core/lifecycleScope.ts';
import { logger } from '~/core/logger.ts';
import { createManagedTimeout, type ManagedTimeout } from '~/core/mainLoop.ts';
import { textureToLogical } from './cursorGeometry.ts';
import { createVectorCursorContent } from './cursorImage.ts';
import { KEEP_SHAKE, ShakeDetector } from './shakeDetector.ts';
import { VectorCursorSource } from './vectorCursor.ts';

const MAGNIFICATION = 5;
// How long the cursor stays large after the last back-and-forth of the shake.
const SETTLE_MS = 350;
const TRANSITION_MS = 180;
const BUTTON_MASK =
  Clutter.ModifierType.BUTTON1_MASK |
  Clutter.ModifierType.BUTTON2_MASK |
  Clutter.ModifierType.BUTTON3_MASK;

// Cursor textures can be updated in place, so an image is only valid for the revision it was made in.
type CursorImageRequest = { texture: Cogl.Texture; revision: number };
// A null content means the theme has no vector image for this cursor.
type CursorImage = CursorImageRequest & { content: Clutter.Content | null };

export class WiggleCursor extends Module {
  private readonly _startDetector = new ShakeDetector();
  private readonly _keepDetector = new ShakeDetector(KEEP_SHAKE);
  private readonly _tracker = global.backend.get_cursor_tracker();
  private readonly _seat = global.stage.context.get_backend().get_default_seat();
  private _overlay: Clutter.Actor | null = null;
  private _sprite: Clutter.Actor | null = null;
  private _lifecycle: LifecycleScope | null = null;
  private _hold: ManagedTimeout | null = null;
  private _vectorCursors: VectorCursorSource | null = null;
  private _imageRequest: CursorImageRequest | null = null;
  private _image: CursorImage | null = null;
  private _cursorRevision = 0;
  private _cursorInhibited = false;
  private _shrinking = false;

  override enable(): void {
    this._lifecycle = new LifecycleScope();
    this._hold = createManagedTimeout(this._lifecycle);
    this._vectorCursors = new VectorCursorSource(
      new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' }),
    );
    this._overlay = new Clutter.Actor({
      name: 'aurora-wiggle-cursor',
      reactive: false,
      visible: false,
    });
    this._sprite = new Clutter.Actor({ reactive: false });
    this._sprite.set_content_scaling_filters(
      Clutter.ScalingFilter.TRILINEAR,
      Clutter.ScalingFilter.LINEAR,
    );
    this._overlay.add_child(this._sprite);
    Main.uiGroup.add_child(this._overlay);

    this._tracker.connectObject(
      'position-invalidated',
      () => this._onMotion(),
      'cursor-changed',
      () => this._onCursorChanged(),
      this,
    );
    Main.sessionMode.connectObject('updated', () => this._restore(), this);
    St.Settings.get().connectObject(
      'notify::magnifier-active',
      () => this._restore(),
      'notify::enable-animations',
      () => this._restore(),
      this,
    );
    Main.layoutManager.connectObject('monitors-changed', () => this._restore(), this);
  }

  override disable(): void {
    this._imageRequest = null;
    this._image = null;
    if (this._lifecycle) this._lifecycle.dispose();
    this._lifecycle = null;
    this._hold = null;
    this._vectorCursors = null;

    this._tracker.disconnectObject(this);
    Main.sessionMode.disconnectObject(this);
    St.Settings.get().disconnectObject(this);
    Main.layoutManager.disconnectObject(this);

    this._restore();
    if (this._overlay) {
      this._overlay.destroy();
      this._overlay = null;
      this._sprite = null;
    }
  }

  private _onMotion(): void {
    if (!this._overlay || !this._sprite || !this._hold) return;
    if (this._isEnlargementBlocked()) {
      if (this._cursorInhibited) this._restore();
      return;
    }
    if (!this._cursorInhibited && !this._tracker.get_pointer_visible()) {
      this._resetDetectors();
      return;
    }

    const [position, modifiers] = this._tracker.get_pointer();
    if (!position) return;

    this._overlay.set_position(position.x, position.y);
    if (this._cursorInhibited) this._positionSprite();

    // Dragging a slider or a selection back and forth is not a lost pointer.
    if (modifiers !== null && (modifiers & BUTTON_MASK) !== 0) {
      this._resetDetectors();
      return;
    }

    // Both keep their history, so a shake that has just started is already known to the second.
    const now = GLib.get_monotonic_time() / 1000;
    const shaken = this._startDetector.update(position.x, position.y, now);
    const stillShaking = this._keepDetector.update(position.x, position.y, now);

    if (this._cursorInhibited ? stillShaking : shaken) this._enlarge();
  }

  private _onCursorChanged(): void {
    this._cursorRevision++;
    if (!this._cursorInhibited) return;

    const texture = this._tracker.get_sprite();
    if (texture) void this._loadImage(texture, false);
    else this._restore();
  }

  private _enlarge(): void {
    if (!this._overlay || !this._sprite || !this._hold) return;

    const needsGrowing = !this._cursorInhibited || this._shrinking;
    if (!this._cursorInhibited) {
      const texture = this._tracker.get_sprite();
      if (!texture) return;

      const image = this._currentImage(texture);
      if (!image) {
        void this._loadImage(texture, true);
        return;
      }
      if (!image.content) return;

      this._sprite.content = image.content;
      this._positionSprite();

      // Keep the native sprite available while our visibility inhibitor hides it.
      this._seat.inhibit_unfocus();
      this._cursorInhibited = true;
      this._tracker.inhibit_cursor_visibility();
      Main.uiGroup.set_child_above_sibling(this._overlay, null);
      this._overlay.show();
    }

    if (needsGrowing) {
      this._shrinking = false;
      this._overlay.remove_all_transitions();
      const enlargement = {
        scale_x: MAGNIFICATION,
        scale_y: MAGNIFICATION,
        duration: St.Settings.get().enable_animations ? TRANSITION_MS : 0,
        mode: Clutter.AnimationMode.EASE_IN_OUT_CUBIC,
      };
      this._overlay.ease(enlargement);
    }

    this._hold.schedule(SETTLE_MS, () => this._shrink());
  }

  private _shrink(): void {
    if (!this._overlay) return;

    this._shrinking = true;
    const restoration = {
      scale_x: 1,
      scale_y: 1,
      duration: St.Settings.get().enable_animations ? TRANSITION_MS : 0,
      mode: Clutter.AnimationMode.EASE_IN_OUT_CUBIC,
      onComplete: () => this._restore(),
    };
    this._overlay.ease(restoration);
  }

  private _isEnlargementBlocked(): boolean {
    return Main.sessionMode.isLocked || St.Settings.get().magnifier_active;
  }

  private _currentImage(texture: Cogl.Texture): CursorImage | null {
    const image = this._image;
    if (!image || image.texture !== texture || image.revision !== this._cursorRevision) return null;

    return image;
  }

  private async _loadImage(texture: Cogl.Texture, enlargeWhenReady: boolean): Promise<void> {
    const vectorCursors = this._vectorCursors;
    if (!vectorCursors) return;

    const request: CursorImageRequest = { texture, revision: this._cursorRevision };
    this._imageRequest = request;
    const placement = {
      hotspot: this._tracker.get_hot(),
      monitorScale: global.display.get_monitor_scale(global.display.get_current_monitor()),
    };
    const isCurrent = (): boolean =>
      this._imageRequest === request && request.revision === this._cursorRevision;

    let content: Clutter.Content | null = null;
    try {
      content = await createVectorCursorContent(
        texture,
        MAGNIFICATION,
        placement,
        vectorCursors,
        isCurrent,
      );
    } catch (error) {
      logger.warn('Could not draw the enlarged cursor', { prefix: 'WiggleCursor' }, error);
    }
    if (!isCurrent()) return;

    this._imageRequest = null;
    this._image = { ...request, content };

    if (this._cursorInhibited) {
      if (!content || !this._sprite) {
        this._restore();
        return;
      }

      this._sprite.content = content;
      this._positionSprite();
    } else if (enlargeWhenReady && content && !this._isEnlargementBlocked()) {
      this._enlarge();
    }
  }

  private _positionSprite(): void {
    if (!this._sprite) return;
    const texture = this._tracker.get_sprite();
    if (!texture) {
      this._restore();
      return;
    }

    const scale = textureToLogical(
      this._tracker.get_scale(),
      global.display.get_monitor_scale(global.display.get_current_monitor()),
    );
    const [hotX, hotY] = this._tracker.get_hot();
    this._sprite.set_size(texture.get_width() * scale, texture.get_height() * scale);
    this._sprite.set_position(-hotX * scale, -hotY * scale);
  }

  private _resetDetectors(): void {
    this._startDetector.reset();
    this._keepDetector.reset();
  }

  private _restore(): void {
    if (this._hold) this._hold.clear();
    this._resetDetectors();
    this._shrinking = false;
    if (this._overlay) {
      this._overlay.remove_all_transitions();
      this._overlay.hide();
      this._overlay.set_scale(1, 1);
    }
    if (this._sprite) this._sprite.set_content(null);

    if (this._cursorInhibited) {
      this._cursorInhibited = false;
      this._tracker.uninhibit_cursor_visibility();
      this._seat.uninhibit_unfocus();
    }
  }
}
