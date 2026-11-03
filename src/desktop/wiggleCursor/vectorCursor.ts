import type Clutter from '@girs/clutter-18';
import Cogl from '@girs/cogl-18';
import type GdkPixbuf from '@girs/gdkpixbuf-2.0';
import Gio from '@girs/gio-2.0';
import Shell from '@girs/shell-18';
import St from '@girs/st-18';
import type Rsvg from 'gi://Rsvg';

import { logger } from '~/core/logger.ts';
import {
  EXACT_MATCH_DIFFERENCE,
  MAX_MATCH_DIFFERENCE,
  logicalGeometry,
  matchesHotspot,
  meanPixelDifference,
  type CursorGeometry,
  type PixelView,
} from './cursorMatching.ts';
import { readCursorSvg, readScalableCursors, type ThemeCursor } from './cursorTheme.ts';

type RsvgModule = typeof Rsvg;

// Longest side of the enlarged image (4 MiB of pixels). A pointer so large that 5x would exceed it
// is enlarged less instead of being skipped.
const MAX_VECTOR_SIDE = 1024;

/** The enlarged cursor and where it goes, in logical pixels relative to the pointer. */
export type VectorCursor = {
  content: Clutter.Content;
  geometry: CursorGeometry;
};

/** What the cursor tracker exposes of the cursor the Shell is drawing. */
type NativeCursor = {
  texture: Cogl.Texture;
  /** Hotspot in the pixels of the texture, as the tracker reports it. */
  hotspot: [number, number];
  /** Scale of the monitor the pointer was on when the image was requested. */
  monitorScale: number;
};

let rsvgModule: Promise<RsvgModule | null> | null = null;

// The typelib ships with librsvg but not in every distribution's default install.
function loadRsvg(): Promise<RsvgModule | null> {
  if (!rsvgModule) {
    rsvgModule = import('gi://Rsvg').then(
      (module) => module.default,
      (error) => {
        logger.warn(
          'Rsvg is unavailable, so Wiggle Cursor cannot enlarge the pointer',
          { prefix: 'WiggleCursor' },
          error,
        );
        return null;
      },
    );
  }

  return rsvgModule;
}

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

function pixelView(pixbuf: GdkPixbuf.Pixbuf): PixelView {
  return {
    pixels: pixbuf.get_pixels(),
    width: pixbuf.get_width(),
    height: pixbuf.get_height(),
    rowstride: pixbuf.get_rowstride(),
    channels: pixbuf.get_n_channels(),
  };
}

// `get_pixbuf` draws at the size the document declares, so the stylesheet is what picks the pixel
// size. It changes the handle, so read the intrinsic size from it beforehand. The size is
// `!important` because the theme is untrusted and a style element in the SVG would otherwise win.
function drawSvg(handle: Rsvg.Handle, width: number, height: number): GdkPixbuf.Pixbuf | null {
  handle.set_stylesheet(
    new TextEncoder().encode(
      `svg { width: ${width}px !important; height: ${height}px !important; }`,
    ),
  );
  const pixbuf = handle.get_pixbuf();

  return pixbuf && pixbuf.get_width() === width && pixbuf.get_height() === height ? pixbuf : null;
}

// One unreadable or malformed theme file must not hide the cursors that come after it.
async function drawCandidate(
  rsvg: RsvgModule,
  themeCursor: ThemeCursor,
  width: number,
  height: number,
): Promise<{ svg: Uint8Array; pixbuf: GdkPixbuf.Pixbuf } | null> {
  try {
    const svg = await readCursorSvg(themeCursor);
    const pixbuf = drawSvg(rsvg.Handle.new_from_data(svg), width, height);

    return pixbuf ? { svg, pixbuf } : null;
  } catch (error) {
    logger.warn(
      `Skipping the cursor ${themeCursor.frame.filename}`,
      { prefix: 'WiggleCursor' },
      error,
    );
    return null;
  }
}

/**
 * Redraws the current cursor from the vector image of the cursor theme at the enlarged size.
 *
 * The tracker only exposes the pixels the Shell rasterised, not which cursor they show. The theme
 * is searched for the cursor whose SVG, drawn at the size of those pixels, comes closest to them.
 * A cursor that no theme shape comes close to, such as the one an application sets itself,
 * yields null.
 */
export class VectorCursorSource {
  private _catalog: { theme: string; cursors: Promise<ThemeCursor[]> } | null = null;

  constructor(private readonly _interfaceSettings: Gio.Settings) {}

  /**
   * Resolves to null when the cursor cannot be enlarged from the theme: no theme shape comes close
   * or Rsvg is missing. It also resolves to null once `isCurrent()` turns false; that is polled
   * between the awaits so a superseded request stops early.
   *
   * The image is `magnification` times the size of the tracker texture, or less for a pointer so
   * large that this would pass `MAX_VECTOR_SIDE`.
   */
  async createCursor(
    nativeCursor: NativeCursor,
    magnification: number,
    isCurrent: () => boolean,
  ): Promise<VectorCursor | null> {
    const width = nativeCursor.texture.get_width();
    const height = nativeCursor.texture.get_height();
    const enlargement = Math.min(magnification, MAX_VECTOR_SIDE / Math.max(width, height));
    if (enlargement < 1) return null;

    const nativePixels = await readPixbuf(nativeCursor.texture);
    if (!isCurrent()) return null;

    const rsvg = await loadRsvg();
    if (!rsvg) return null;

    const cursorSize = this._interfaceSettings.get_int('cursor-size');
    const match = await this._findClosest(rsvg, nativePixels, nativeCursor, cursorSize, isCurrent);
    if (!match || !isCurrent()) return null;

    const handle = rsvg.Handle.new_from_data(match.svg);
    const [hasSize, svgWidth, svgHeight] = handle.get_intrinsic_size_in_pixels();
    if (!hasSize) return null;

    const enlarged = drawSvg(
      handle,
      Math.floor(width * enlargement),
      Math.floor(height * enlargement),
    );
    if (!enlarged) return null;

    return {
      content: uploadImage(enlarged),
      geometry: logicalGeometry(match.cursor.frame, svgWidth, svgHeight, cursorSize),
    };
  }

  private async _findClosest(
    rsvg: RsvgModule,
    nativePixels: GdkPixbuf.Pixbuf,
    nativeCursor: NativeCursor,
    cursorSize: number,
    isCurrent: () => boolean,
  ): Promise<{ cursor: ThemeCursor; svg: Uint8Array } | null> {
    const nativeView = pixelView(nativePixels);
    const themeCursors = await this._cursorsFor(this._interfaceSettings.get_string('cursor-theme'));
    let closest: { cursor: ThemeCursor; svg: Uint8Array } | null = null;
    let smallestDifference = MAX_MATCH_DIFFERENCE;

    for (const themeCursor of themeCursors) {
      if (!isCurrent()) return null;
      if (
        !matchesHotspot(
          themeCursor.frame,
          cursorSize,
          nativeCursor.monitorScale,
          nativeCursor.hotspot,
        )
      )
        continue;

      const drawn = await drawCandidate(
        rsvg,
        themeCursor,
        nativePixels.get_width(),
        nativePixels.get_height(),
      );
      if (!drawn) continue;

      const difference = meanPixelDifference(
        nativeView,
        pixelView(drawn.pixbuf),
        smallestDifference,
      );
      if (difference >= smallestDifference) continue;

      smallestDifference = difference;
      closest = { cursor: themeCursor, svg: drawn.svg };
      if (difference < EXACT_MATCH_DIFFERENCE) break;
    }

    return closest;
  }

  private _cursorsFor(theme: string): Promise<ThemeCursor[]> {
    if (!this._catalog || this._catalog.theme !== theme)
      this._catalog = { theme, cursors: readScalableCursors(theme) };

    return this._catalog.cursors;
  }
}
