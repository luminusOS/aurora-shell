import Clutter from '@girs/clutter-18';
import type Cogl from '@girs/cogl-18';
import GLib from '@girs/glib-2.0';
import St from '@girs/st-18';
import * as Main from '@girs/gnome-shell/ui/main';

import { Module } from '~/module.ts';
import { LifecycleScope, type ManagedSource } from '~/core/lifecycleScope.ts';
import { logger } from '~/core/logger.ts';
import { createManagedSource, createManagedTimeout, type ManagedTimeout } from '~/core/mainLoop.ts';
import { createSharpCursorContent } from './cursorImage.ts';
import { ShakeDetector } from './shakeDetector.ts';

const MAGNIFICATION = 5;
const HOLD_MS = 1800;
const TRANSITION_MS = 180;
const BUTTON_MASK =
  Clutter.ModifierType.BUTTON1_MASK |
  Clutter.ModifierType.BUTTON2_MASK |
  Clutter.ModifierType.BUTTON3_MASK;

// Cursor textures can be updated in place, so an image is only valid for the revision it was made in.
type SharpRequest = { texture: Cogl.Texture; revision: number };
type SharpImage = { texture: Cogl.Texture; revision: number; content: Clutter.Content };

export class WiggleCursor extends Module {
  private readonly _detector = new ShakeDetector();
  private readonly _tracker = global.backend.get_cursor_tracker();
  private readonly _seat = global.stage.context.get_backend().get_default_seat();
  private _overlay: Clutter.Actor | null = null;
  private _sprite: Clutter.Actor | null = null;
  private _lifecycle: LifecycleScope | null = null;
  private _hold: ManagedTimeout | null = null;
  private _renderingPause: ManagedSource | null = null;
  private _sharpRequest: SharpRequest | null = null;
  private _sharpImage: SharpImage | null = null;
  private _cursorRevision = 0;
  private _cursorInhibited = false;

  override enable(): void {
    this._lifecycle = new LifecycleScope();
    this._hold = createManagedTimeout(this._lifecycle);
    this._renderingPause = createManagedSource(this._lifecycle);
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
    this._sharpRequest = null;
    this._sharpImage = null;
    if (this._lifecycle) this._lifecycle.dispose();
    this._lifecycle = null;
    this._hold = null;
    this._renderingPause = null;

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
    if (Main.sessionMode.isLocked || St.Settings.get().magnifier_active) {
      if (this._cursorInhibited) this._restore();
      return;
    }
    if (!this._cursorInhibited && !this._tracker.get_pointer_visible()) {
      this._detector.reset();
      return;
    }

    const [position, modifiers] = this._tracker.get_pointer();
    if (!position) return;

    this._overlay.set_position(position.x, position.y);
    if (this._cursorInhibited) this._positionSprite();

    // Dragging a slider or a selection back and forth is not a lost pointer.
    if (modifiers !== null && (modifiers & BUTTON_MASK) !== 0) {
      this._detector.reset();
      return;
    }

    const now = GLib.get_monotonic_time() / 1000;
    if (this._detector.update(position.x, position.y, now)) this._enlarge();
  }

  private _onCursorChanged(): void {
    this._cursorRevision++;
    if (this._cursorInhibited) this._syncSprite();
  }

  private _enlarge(): void {
    if (!this._overlay || !this._sprite || !this._hold) return;
    if (!this._cursorInhibited) {
      if (!this._syncSprite()) return;

      // Keep the native sprite available while our visibility inhibitor hides it.
      this._seat.inhibit_unfocus();
      this._cursorInhibited = true;
      this._tracker.inhibit_cursor_visibility();
      Main.uiGroup.set_child_above_sibling(this._overlay, null);
      this._overlay.show();
    }

    this._overlay.remove_all_transitions();
    const enlargement = {
      scale_x: MAGNIFICATION,
      scale_y: MAGNIFICATION,
      duration: St.Settings.get().enable_animations ? TRANSITION_MS : 0,
      mode: Clutter.AnimationMode.EASE_IN_OUT_CUBIC,
    };
    this._overlay.ease(enlargement);

    this._hold.schedule(HOLD_MS, () => {
      if (!this._overlay) return;

      const restoration = {
        scale_x: 1,
        scale_y: 1,
        duration: St.Settings.get().enable_animations ? TRANSITION_MS : 0,
        mode: Clutter.AnimationMode.EASE_IN_OUT_CUBIC,
        onComplete: () => this._restore(),
      };
      this._overlay.ease(restoration);
    });
  }

  private _syncSprite(): boolean {
    if (!this._sprite) return false;
    const texture = this._tracker.get_sprite();
    if (!texture) {
      this._restore();
      return false;
    }

    if (
      this._sharpImage &&
      this._sharpImage.texture === texture &&
      this._sharpImage.revision === this._cursorRevision
    ) {
      this._sprite.content = this._sharpImage.content;
    } else {
      this._sprite.content = Clutter.TextureContent.new_from_texture(texture, null);
      if (!this._sharpRequest) void this._loadSharpContent(texture);
    }

    this._positionSprite();
    return true;
  }

  private async _loadSharpContent(texture: Cogl.Texture): Promise<void> {
    const request: SharpRequest = { texture, revision: this._cursorRevision };
    this._sharpRequest = request;
    const isCurrent = (): boolean =>
      this._sharpRequest === request && request.revision === this._cursorRevision;

    let content: Clutter.Content | null;
    try {
      content = await createSharpCursorContent(texture, MAGNIFICATION, {
        pause: () => this._pauseForRendering(),
        isCurrent,
      });
    } catch (error) {
      logger.warn('Could not sharpen the cursor image', { prefix: 'WiggleCursor' }, error);
      content = Clutter.TextureContent.new_from_texture(texture, null);
    }
    if (this._sharpRequest !== request) return;

    this._sharpRequest = null;
    if (content && request.revision === this._cursorRevision)
      this._sharpImage = { texture, revision: request.revision, content };
    if (this._cursorInhibited) this._syncSprite();
  }

  private _pauseForRendering(): Promise<void> {
    const renderingPause = this._renderingPause;

    return new Promise((resolve) => {
      // A request that outlives disable() has nothing left to wait for.
      if (!renderingPause) {
        resolve();
        return;
      }

      // Low priority lets the frame clock run before the next slice of work.
      renderingPause.replace(() =>
        GLib.idle_add(GLib.PRIORITY_LOW, () => {
          renderingPause.complete();
          resolve();
          return GLib.SOURCE_REMOVE;
        }),
      );
    });
  }

  private _positionSprite(): void {
    if (!this._sprite) return;
    const texture = this._tracker.get_sprite();
    if (!texture) {
      this._restore();
      return;
    }

    const scale = this._tracker.get_scale();
    const [hotX, hotY] = this._tracker.get_hot();
    this._sprite.set_size(texture.get_width() * scale, texture.get_height() * scale);
    this._sprite.set_position(-hotX * scale, -hotY * scale);
  }

  private _restore(): void {
    if (this._hold) this._hold.clear();
    this._detector.reset();
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
