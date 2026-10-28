import type Clutter from '@girs/clutter-18';
import Cogl from '@girs/cogl-18';
import type GdkPixbuf from '@girs/gdkpixbuf-2.0';
import Gio from '@girs/gio-2.0';
import Shell from '@girs/shell-18';
import St from '@girs/st-18';

import type { CursorPlacement, VectorCursorSource } from './vectorCursor.ts';

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

function uploadImage(pixbuf: GdkPixbuf.Pixbuf): Clutter.Content {
  const width = pixbuf.get_width();
  const height = pixbuf.get_height();
  const content = new St.ImageContent({ preferred_width: width, preferred_height: height });
  const coglContext = global.stage.context.get_backend().get_cogl_context();
  const uploaded = content.set_bytes(
    coglContext,
    pixbuf.get_pixels(),
    Cogl.PixelFormat.RGBA_8888,
    width,
    height,
    pixbuf.get_rowstride(),
  );
  if (!uploaded) throw new Error('The cursor image could not be uploaded');

  return content;
}

/**
 * Redraws the cursor in `texture` from the vector image of the cursor theme, at `magnification`
 * times the size of the texture. Resolves to null when the theme has no such image, or when
 * `isCurrent()` turned false before the image was finished.
 */
export async function createVectorCursorContent(
  texture: Cogl.Texture,
  magnification: number,
  placement: CursorPlacement,
  vector: VectorCursorSource,
  isCurrent: () => boolean,
): Promise<Clutter.Content | null> {
  const native = await readPixbuf(texture);
  if (!isCurrent()) return null;

  const drawn = await vector.draw(native, placement, magnification, isCurrent);
  if (!drawn || !isCurrent()) return null;

  return uploadImage(drawn);
}
