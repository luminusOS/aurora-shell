import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { waitForCondition } from '../../support/testUtils.js';
import { shake, waitForSharpCursor } from './support.js';

async function repickCursor(pointer, tracker) {
  const outside = waitForCondition({
    evaluate: () => {
      const [position] = tracker.get_pointer();
      return position && position.x === 750;
    },
    signals: [[tracker, 'position-invalidated']],
    description: 'pointer to leave the themed cursor surface',
  });
  pointer.notify_absolute_motion(GLib.get_monotonic_time(), 750, 350);
  await outside;
  await Scripting.waitLeisure();
  pointer.notify_absolute_motion(GLib.get_monotonic_time(), 400, 350);
}

export async function exerciseCursorShape(overlay, pointer, tracker) {
  const surface = new Clutter.Actor({
    x: 300,
    y: 250,
    width: 400,
    height: 200,
    reactive: true,
    cursor_type: Clutter.CursorType.CROSSHAIR,
  });
  Main.uiGroup.add_child(surface);
  try {
    pointer.notify_button(
      GLib.get_monotonic_time(),
      Clutter.BUTTON_PRIMARY,
      Clutter.ButtonState.PRESSED,
    );
    try {
      await shake(pointer);
      if (overlay.visible) throw new Error('Shaking while dragging enlarged the cursor');
    } finally {
      pointer.notify_button(
        GLib.get_monotonic_time(),
        Clutter.BUTTON_PRIMARY,
        Clutter.ButtonState.RELEASED,
      );
    }

    await shake(pointer);
    if (!overlay.visible) throw new Error('A themed crosshair cursor did not enlarge');

    const sprite = overlay.get_first_child();
    const crosshairTexture = await waitForSharpCursor(sprite);
    surface.cursor_type = Clutter.CursorType.TEXT;
    await repickCursor(pointer, tracker);
    await waitForCondition({
      evaluate: () =>
        overlay.visible &&
        sprite.content instanceof St.ImageContent &&
        sprite.content.get_texture() !== crosshairTexture,
      signals: [
        [tracker, 'cursor-changed'],
        [sprite, 'notify::content'],
      ],
      description: 'sharpened cursor image to follow a native cursor-shape change',
    });
    const [hotX, hotY] = tracker.get_hot();
    const scale = tracker.get_scale();
    if (Math.abs(sprite.x + hotX * scale) > 0.1 || Math.abs(sprite.y + hotY * scale) > 0.1)
      throw new Error('Cursor-shape change lost hotspot alignment');

    surface.cursor_type = Clutter.CursorType.NONE;
    await repickCursor(pointer, tracker);
    await waitForCondition({
      evaluate: () => !overlay.visible,
      signals: [
        [tracker, 'cursor-changed'],
        [overlay, 'notify::visible'],
      ],
      description: 'missing native cursor texture to cancel enlargement',
    });
    await shake(pointer);
    if (overlay.visible) throw new Error('A cursor with no native texture was enlarged');
    if (!tracker.get_pointer_visible())
      throw new Error('Missing texture leaked a visibility inhibitor');
  } finally {
    surface.destroy();
  }
}
