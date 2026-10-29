/* global TextEncoder */

import Gio from 'gi://Gio';
import Rsvg from 'gi://Rsvg';
import Shell from 'gi://Shell';

const SHELL_THEME = 'resource:///org/gnome/shell/cursor-theme/icons/Adwaita/cursors_scalable/';
const MAX_MEAN_DIFFERENCE = 2;

/**
 * Draw a cursor of the Shell's bundled theme from its SVG, as the module is expected to.
 *
 * @param {string} name Cursor shape, such as `default` or `text`.
 * @param {number} width
 * @param {number} height
 * @returns {GdkPixbuf.Pixbuf}
 */
export function drawThemeCursor(name, width, height) {
  const file = Gio.File.new_for_uri(`${SHELL_THEME}${name}/${name}.svg`);
  const [, contents] = file.load_contents(null);
  const handle = Rsvg.Handle.new_from_data(contents);
  handle.set_stylesheet(
    new TextEncoder().encode(`svg { width: ${width}px; height: ${height}px; }`),
  );

  return handle.get_pixbuf();
}

/**
 * @param {Cogl.Texture} texture
 * @returns {Promise<GdkPixbuf.Pixbuf>}
 */
export function readTexture(texture) {
  const discardedPng = Gio.MemoryOutputStream.new_resizable();

  return new Promise((resolve, reject) => {
    Shell.Screenshot.composite_to_stream(
      texture,
      0,
      0,
      -1,
      -1,
      1,
      null,
      0,
      0,
      1,
      discardedPng,
      (_source, result) => {
        try {
          resolve(Shell.Screenshot.composite_to_stream_finish(result));
        } catch (error) {
          reject(error);
        }
      },
    );
  });
}

function meanDifference(first, second) {
  const channels = first.get_n_channels();
  const pixels = first.get_pixels();
  const others = second.get_pixels();
  let total = 0;

  for (let y = 0; y < first.get_height(); y++) {
    for (let x = 0; x < first.get_width(); x++) {
      const a = y * first.get_rowstride() + x * channels;
      const b = y * second.get_rowstride() + x * second.get_n_channels();
      const alphaA = pixels[a + 3];
      const alphaB = others[b + 3];
      for (let channel = 0; channel < 3; channel++)
        total += Math.abs((pixels[a + channel] * alphaA - others[b + channel] * alphaB) / 255);
      total += Math.abs(alphaA - alphaB);
    }
  }

  return total / (first.get_width() * first.get_height() * 4);
}

/**
 * Throw unless the overlay's image is the theme's SVG, drawn at the size of the image.
 *
 * @param {Cogl.Texture} texture The image shown by the cursor overlay.
 * @param {string} name Cursor shape the theme is expected to draw.
 */
export async function assertDrawnFromTheme(texture, name) {
  const shown = await readTexture(texture);
  const expected = drawThemeCursor(name, shown.get_width(), shown.get_height());
  const difference = meanDifference(shown, expected);

  if (difference > MAX_MEAN_DIFFERENCE)
    throw new Error(
      `The enlarged cursor is not the '${name}' SVG of the theme (mean difference ${difference})`,
    );
}

/**
 * Throw unless the overlay sprite has the logical size and hotspot of the native cursor.
 *
 * The Shell rasterises its cursors at the monitor scale and truncates the texture size and hotspot
 * to whole pixels, so they only agree with the sprite to within a logical pixel.
 *
 * @param {Clutter.Actor} sprite
 * @param {Meta.CursorTracker} tracker
 */
export function assertCursorGeometry(sprite, tracker) {
  const monitorScale = global.display.get_monitor_scale(global.display.get_current_monitor());
  const texture = tracker.get_sprite();
  const [hotX, hotY] = tracker.get_hot();
  const mismatches = [
    [sprite.width, texture.get_width() / monitorScale, 'width'],
    [sprite.height, texture.get_height() / monitorScale, 'height'],
    [-sprite.x, hotX / monitorScale, 'hotspot x'],
    [-sprite.y, hotY / monitorScale, 'hotspot y'],
  ].filter(([actual, expected]) => Math.abs(actual - expected) > 1);

  if (mismatches.length > 0) {
    const details = mismatches.map(
      ([actual, expected, what]) => `${what} ${actual} (expected ${expected})`,
    );
    throw new Error(
      `Enlarged cursor does not match the native one on a ${monitorScale}x monitor: ${details.join(', ')}`,
    );
  }
}
