import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { waitForActorState, waitForTiming } from '../../support/testUtils.js';
import { assertCursorGeometry, assertDrawnFromTheme } from './themeCursor.js';
import { shake, waitForEnlarged, whileShaking } from './support.js';

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

    // The theme animates the wait cursor, so no single SVG reproduces it and it is left alone.
    surface.cursor_type = Clutter.CursorType.WAIT;
    await whileShaking(pointer, () =>
      waitForTiming(600, 'Negative check: a cursor without a single SVG stays native'),
    );
    if (overlay.visible || !tracker.get_pointer_visible())
      throw new Error('A cursor with no SVG image in the theme was enlarged');
    // Mutter 51.rc never prepares a cursor that is set while the pointer is hidden, which is what
    // an enlargement does, and hands the tracker an empty texture. 51.0 fixed it but the CI image
    // still carries the rc, so each shape is set while the real pointer is visible.
    const sprite = overlay.get_first_child();
    for (const [cursorType, themeName] of [
      [Clutter.CursorType.CROSSHAIR, 'crosshair'],
      [Clutter.CursorType.TEXT, 'text'],
    ]) {
      surface.cursor_type = cursorType;
      await whileShaking(pointer, async () => {
        await waitForEnlarged(overlay);
        await assertDrawnFromTheme(sprite.content.get_texture(), themeName);
        assertCursorGeometry(sprite, tracker);
      });
      await waitForActorState(overlay, (actor) => !actor.visible, {
        properties: ['visible'],
        description: `cursor to shrink after the ${themeName} shape`,
        timeoutMs: 1500,
      });
    }

    surface.cursor_type = Clutter.CursorType.NONE;
    await whileShaking(pointer, () =>
      waitForTiming(600, 'Negative check: keep shaking over a cursor with no texture'),
    );
    if (overlay.visible || !tracker.get_pointer_visible())
      throw new Error('A cursor with no native texture was enlarged');
  } finally {
    surface.destroy();
  }
}
