import Clutter from '@girs/clutter-18';
import Cogl from '@girs/cogl-18';
import GdkPixbuf from '@girs/gdkpixbuf-2.0';
import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import Shell from '@girs/shell-18';
import St from '@girs/st-18';

import {
  BYTES_PER_PIXEL,
  fitsProcessingBudget,
  sharpenRgbaSteps,
  upscaleFactor,
} from './cursorSharpening.ts';

// Keeps one slice well inside a 16 ms frame; measured slices in the Shell take 0.4 to 3 ms.
const SLICE_BUDGET_US = 4000;

export type SharpeningSchedule = {
  /** Resolves once the main loop has had a chance to render. */
  pause(): Promise<void>;
  /** False once the result would be discarded, so the work can stop early. */
  isCurrent(): boolean;
};

function readPixbuf(texture: Cogl.Texture): Promise<GdkPixbuf.Pixbuf> {
  // The Shell API also encodes a PNG into this stream; only the returned pixbuf is used.
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
          const pixbuf = Shell.Screenshot.composite_to_stream_finish(result);
          if (pixbuf) resolve(pixbuf);
          else reject(new Error('The cursor texture could not be read'));
        } catch (error) {
          reject(error);
        }
      },
    );
  });
}

/**
 * The tracker only exposes the cursor at its theme size (typically 32 px), which turns blurry when
 * the GPU stretches it. Resampling it once with a high-quality filter and sharpening the edges
 * gives a much cleaner enlarged pointer.
 *
 * The sharpening runs in short slices between frames because a HiDPI cursor (a 64 px texture
 * becomes 320 px) would otherwise stall the Shell for about 50 ms. Resolves to null when
 * `isCurrent()` turned false before the image was finished. Textures beyond the processing budget
 * are shown as they are.
 */
export async function createSharpCursorContent(
  texture: Cogl.Texture,
  magnification: number,
  schedule: SharpeningSchedule,
): Promise<Clutter.Content | null> {
  if (!fitsProcessingBudget(texture.get_width(), texture.get_height()))
    return Clutter.TextureContent.new_from_texture(texture, null);

  const source = await readPixbuf(texture);
  if (!schedule.isCurrent()) return null;

  const factor = upscaleFactor(source.get_width(), source.get_height(), magnification);
  const width = source.get_width() * factor;
  const height = source.get_height() * factor;

  const scaled = source.scale_simple(width, height, GdkPixbuf.InterpType.HYPER);
  if (!scaled) throw new Error('The cursor image could not be resampled');

  const job = sharpenRgbaSteps(scaled.get_pixels(), width, height, scaled.get_rowstride(), factor);
  let sliceStart = GLib.get_monotonic_time();
  let step = job.next();
  while (!step.done) {
    if (GLib.get_monotonic_time() - sliceStart >= SLICE_BUDGET_US) {
      await schedule.pause();
      if (!schedule.isCurrent()) return null;
      sliceStart = GLib.get_monotonic_time();
    }
    step = job.next();
  }

  const content = new St.ImageContent({ preferred_width: width, preferred_height: height });
  const coglContext = global.stage.context.get_backend().get_cogl_context();
  const uploaded = content.set_bytes(
    coglContext,
    step.value,
    Cogl.PixelFormat.RGBA_8888,
    width,
    height,
    width * BYTES_PER_PIXEL,
  );
  if (!uploaded) throw new Error('The cursor image could not be uploaded');

  return content;
}
