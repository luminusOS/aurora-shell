import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { waitForCondition, waitForTiming } from '../../support/testUtils.js';
import { assertCursorGeometry, assertDrawnFromTheme, searchThemeFor } from './themeCursor.js';
import { expectNoEnlargement, shake, waitForEnlarged, whileShaking } from './support.js';

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
      await expectNoEnlargement(
        overlay,
        () => shake(pointer),
        'Shaking while dragging enlarged the cursor',
      );
    } finally {
      pointer.notify_button(
        GLib.get_monotonic_time(),
        Clutter.BUTTON_PRIMARY,
        Clutter.ButtonState.RELEASED,
      );
    }

    // The theme animates the wait cursor, so no single SVG reproduces it and it is left alone. Its
    // frames sit about 10 from the `not-allowed` shape, and the overlay alone cannot show a wrong
    // match: the spinner changes the cursor every frame and cancels the image load.
    surface.cursor_type = Clutter.CursorType.WAIT;
    await whileShaking(pointer, async () => {
      await waitForTiming(600, 'Negative check: a cursor without a single SVG stays native');
      if (await searchThemeFor(tracker))
        throw new Error('A frame of the animated wait cursor was taken for a theme shape');
    });
    if (overlay.visible || !tracker.get_pointer_visible())
      throw new Error('A cursor with no SVG image in the theme was enlarged');
    surface.cursor_type = Clutter.CursorType.CROSSHAIR;

    const sprite = overlay.get_first_child();
    await whileShaking(pointer, async () => {
      await waitForEnlarged(overlay);
      if (!(await searchThemeFor(tracker)))
        throw new Error('The search found no theme shape for the crosshair cursor');
      const crosshairTexture = sprite.content.get_texture();

      surface.cursor_type = Clutter.CursorType.TEXT;
      await waitForCondition({
        evaluate: () => overlay.visible && sprite.content.get_texture() !== crosshairTexture,
        signals: [
          [tracker, 'cursor-changed'],
          [sprite, 'notify::content'],
        ],
        description: 'cursor image to follow a native cursor-shape change',
      });
      await assertDrawnFromTheme(sprite.content.get_texture(), 'text');
      assertCursorGeometry(sprite, tracker);

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
