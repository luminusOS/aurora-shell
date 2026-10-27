import GLib from 'gi://GLib';
import St from 'gi://St';
import { waitForCondition, waitForTiming } from '../../support/testUtils.js';

export const MAGNIFICATION = 5;

const SHAKE_SAMPLES = 5;

/**
 * Four short strokes, the least that counts as a deliberate shake.
 *
 * @param {Clutter.VirtualInputDevice} pointer
 * @param {number} [settleMs] Delay after the last sample before returning.
 */
export async function shake(pointer, settleMs = 60) {
  const tracker = global.backend.get_cursor_tracker();
  for (let i = 0; i < SHAKE_SAMPLES; i++) {
    const x = 400 + (i % 2) * 100;
    const arrived = waitForCondition({
      evaluate: () => {
        const [position] = tracker.get_pointer();
        return position && position.x === x && position.y === 350;
      },
      signals: [[tracker, 'position-invalidated']],
      description: `deliberate shake sample ${i} to reach the pointer tracker`,
    });
    pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, 350);
    await arrived;

    const last = i === SHAKE_SAMPLES - 1;
    if (!last) await waitForTiming(60, 'Delay each reversal to deliver a shake within 800ms');
    else if (settleMs > 0) await waitForTiming(settleMs, 'Delay settling after the last sample');
  }
}

/**
 * Wait until the overlay shows the resampled, sharpened cursor image.
 *
 * @param {Clutter.Actor} sprite
 * @returns {Promise<Cogl.Texture>} The sharpened image's texture.
 */
export async function waitForSharpCursor(sprite) {
  const content = await waitForCondition({
    evaluate: () => (sprite.content instanceof St.ImageContent ? sprite.content : null),
    signals: [[sprite, 'notify::content']],
    description: 'sharpened cursor image to replace the native texture',
  });
  return content.get_texture();
}
