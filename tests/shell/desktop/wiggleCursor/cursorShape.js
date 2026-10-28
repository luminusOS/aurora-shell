import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { waitForCondition, waitForTiming } from '../../support/testUtils.js';
import { shake, waitForEnlarged, waitForSharpCursor, whileShaking } from './support.js';

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

    const sprite = overlay.get_first_child();
    await whileShaking(pointer, async () => {
      await waitForEnlarged(overlay);
      const crosshairTexture = await waitForSharpCursor(sprite);

      surface.cursor_type = Clutter.CursorType.TEXT;
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
      const monitorScale = global.display.get_monitor_scale(global.display.get_current_monitor());
      if (
        Math.abs(sprite.x + hotX / monitorScale) > 0.1 ||
        Math.abs(sprite.y + hotY / monitorScale) > 0.1
      )
        throw new Error('Cursor-shape change lost hotspot alignment');

      surface.cursor_type = Clutter.CursorType.NONE;
      await waitForCondition({
        evaluate: () => !overlay.visible,
        signals: [
          [tracker, 'cursor-changed'],
          [overlay, 'notify::visible'],
        ],
        description: 'missing native cursor texture to cancel enlargement',
      });
      await waitForTiming(600, 'Negative check: keep shaking over a cursor with no texture');
      if (overlay.visible) throw new Error('A cursor with no native texture was enlarged');
    });
    if (!tracker.get_pointer_visible())
      throw new Error('Missing texture leaked a visibility inhibitor');
  } finally {
    surface.destroy();
  }
}
