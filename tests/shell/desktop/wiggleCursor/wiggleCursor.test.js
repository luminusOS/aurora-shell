/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { exerciseEnvironment } from './environment.js';
import { exerciseCursorShape } from './cursorShape.js';
import { MAGNIFICATION, shake, waitForSharpCursor } from './support.js';
import {
  EXTENSION_UUID,
  ensureOverviewHidden,
  getAuroraSettings,
  waitForActorState,
  waitForCondition,
  waitForExtension,
  waitForModuleState,
  waitForTiming,
} from '../../support/testUtils.js';

export var METRICS = {};
let completed = false;

export function init() {
  Scripting.defineScriptEvent(
    'wiggleCursorVerified',
    'Wiggle cursor rendering and cleanup verified',
  );
}

function overlay() {
  return Main.uiGroup.get_children().find((actor) => actor.name === 'aurora-wiggle-cursor');
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);
  await ensureOverviewHidden();
  const settings = getAuroraSettings();
  if (!settings.get_default_value('module-wiggle-cursor').get_boolean())
    throw new Error('Wiggle Cursor must be enabled by default');

  const seat = global.stage.context.get_backend().get_default_seat();
  const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
  const tracker = global.backend.get_cursor_tracker();
  const [originalX, originalY] = global.get_pointer();
  const originalEnabled = settings.get_boolean('module-wiggle-cursor');
  try {
    settings.set_boolean('module-wiggle-cursor', true);
    await waitForModuleState(settings, 'module-wiggle-cursor', 'wiggle-cursor', true);
    const actor = overlay();
    if (!actor || actor.visible) throw new Error('Expected a hidden cursor overlay at startup');

    for (let i = 0; i < 8; i++) {
      pointer.notify_absolute_motion(GLib.get_monotonic_time(), 300 + i * 30, 350);
      await waitForTiming(30, 'Negative check: delay straight-sweep samples without a shake');
    }
    if (actor.visible) throw new Error('Normal navigation enlarged the cursor');

    await shake(pointer);
    await waitForActorState(actor, (a) => a.visible && Math.abs(a.scale_x - MAGNIFICATION) < 0.01, {
      properties: ['visible', 'scale-x'],
      description: `fixed ${MAGNIFICATION}x cursor enlargement`,
    });
    if (tracker.get_pointer_visible()) throw new Error('Native cursor was not inhibited');
    const sprite = actor.get_first_child();
    const nativeTexture = tracker.get_sprite();
    const sharpTexture = await waitForSharpCursor(sprite);
    if (
      sharpTexture.get_width() !== nativeTexture.get_width() * MAGNIFICATION ||
      sharpTexture.get_height() !== nativeTexture.get_height() * MAGNIFICATION
    )
      throw new Error(
        `Sharpened cursor is ${sharpTexture.get_width()}x${sharpTexture.get_height()} ` +
          `for a ${nativeTexture.get_width()}x${nativeTexture.get_height()} native texture`,
      );
    const [hotX, hotY] = tracker.get_hot();
    const nativeScale = tracker.get_scale();
    if (
      Math.abs(sprite.x + hotX * nativeScale) > 0.1 ||
      Math.abs(sprite.y + hotY * nativeScale) > 0.1
    )
      throw new Error('Enlarged cursor hotspot is misaligned');
    if (!sprite.content || sprite.width <= 0 || sprite.height <= 0)
      throw new Error('Cursor overlay has no native content');

    // Mutter updates client cursor textures in place and only emits cursor-changed. A second
    // change while the first image is still being built must not leave the obsolete one showing.
    const firstImage = sprite.content;
    tracker.emit('cursor-changed');
    tracker.emit('cursor-changed');
    await waitForCondition({
      evaluate: () => sprite.content instanceof St.ImageContent && sprite.content !== firstImage,
      signals: [[sprite, 'notify::content']],
      description: 'sharpened image to be rebuilt after the cursor texture changed',
    });

    await waitForTiming(900, 'Delay retrigger until near the original hold deadline');
    await shake(pointer);
    if (actor.scale_x > MAGNIFICATION + 0.01)
      throw new Error('Repeated shaking exceeded fixed magnification');
    await waitForTiming(700, 'Negative check: retrigger must outlive the original hold deadline');
    if (!actor.visible || Math.abs(actor.scale_x - MAGNIFICATION) > 0.01)
      throw new Error('Repeated shaking did not extend the hold deadline');
    let deflationAnimated = false;
    const scaleId = actor.connect('notify::scale-x', () => {
      if (
        actor.visible &&
        actor.scale_x > 1 &&
        actor.scale_x < MAGNIFICATION &&
        actor.get_transition('scale-x')
      )
        deflationAnimated = true;
    });
    try {
      await waitForActorState(actor, (a) => !a.visible, {
        properties: ['visible'],
        description: 'cursor to deflate after the hold period',
      });
    } finally {
      actor.disconnect(scaleId);
    }
    if (St.Settings.get().enable_animations && !deflationAnimated)
      throw new Error('Cursor did not animate its restoration before hiding');
    if (!tracker.get_pointer_visible()) throw new Error('Native cursor was not restored');

    await exerciseEnvironment(actor, pointer, tracker);
    await waitForModuleState(settings, 'module-wiggle-cursor', 'wiggle-cursor', true);
    const resumedOverlay = overlay();
    if (!resumedOverlay) throw new Error('Cursor overlay did not return after unlocking');
    await exerciseCursorShape(resumedOverlay, pointer, tracker);

    await shake(pointer);
    settings.set_boolean('module-wiggle-cursor', false);
    await waitForModuleState(settings, 'module-wiggle-cursor', 'wiggle-cursor', false);
    if (overlay() || !tracker.get_pointer_visible())
      throw new Error('Disabling while enlarged did not restore the cursor');

    settings.set_boolean('module-wiggle-cursor', true);
    await waitForModuleState(settings, 'module-wiggle-cursor', 'wiggle-cursor', true);
    await shake(pointer, 0);
    settings.set_boolean('module-wiggle-cursor', false);
    await waitForModuleState(settings, 'module-wiggle-cursor', 'wiggle-cursor', false);
    await waitForTiming(300, 'Negative check: a late sharpened image must not revive the overlay');
    if (overlay() || !tracker.get_pointer_visible())
      throw new Error('A pending sharpened image outlived the module');

    for (let i = 0; i < 3; i++) {
      settings.set_boolean('module-wiggle-cursor', true);
      await waitForModuleState(settings, 'module-wiggle-cursor', 'wiggle-cursor', true);
      settings.set_boolean('module-wiggle-cursor', false);
      await waitForModuleState(settings, 'module-wiggle-cursor', 'wiggle-cursor', false);
    }
    if (overlay() || !tracker.get_pointer_visible())
      throw new Error('Lifecycle leaked cursor ownership');
    Scripting.scriptEvent('wiggleCursorVerified');
  } finally {
    settings.set_boolean('module-wiggle-cursor', originalEnabled);
    seat.warp_pointer(originalX, originalY);
  }
}

export function script_wiggleCursorVerified() {
  completed = true;
}

export function finish() {
  if (!completed) throw new Error('Wiggle Cursor did not complete runtime verification');
}
