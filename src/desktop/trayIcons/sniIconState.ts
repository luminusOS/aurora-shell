export type SniPixmap = { width: number; height: number; bytes: ArrayLike<number> };

export type PixelLayout = {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
};

export type Tone = readonly [red: number, green: number, blue: number];

/** Byte order of GdkPixbuf pixels. */
export const RGBA_LAYOUT: PixelLayout = { red: 0, green: 1, blue: 2, alpha: 3 };

/** Byte order of StatusNotifierItem `IconPixmap` data, which is not premultiplied. */
export const ARGB_LAYOUT: PixelLayout = { alpha: 0, red: 1, green: 2, blue: 3 };

const CHANNELS_PER_PIXEL = 4;
const LUMINANCE_LEVELS = 256;

// Alpha, channel spread, and luminance band width are in 0-255 channel levels.
const SOLID_ALPHA_THRESHOLD = 128;
const TONE_TOLERANCE = 18;
// Share of solid pixels that must fit the dominant tone, so a few stray pixels do not disqualify.
const REQUIRED_TONE_RATIO = 0.92;

export function selectSniPixmap<T extends Pick<SniPixmap, 'width' | 'height'>>(
  pixmaps: readonly T[],
  targetSize: number,
  minimumSize = 8,
): T | null {
  const usable = pixmaps.filter((p) => p.width >= minimumSize && p.height >= minimumSize);
  if (usable.length === 0) return null;

  const selected = [...usable].sort((a, b) => {
    const aDistance = Math.abs(Math.min(a.width, a.height) - targetSize);
    const bDistance = Math.abs(Math.min(b.width, b.height) - targetSize);
    return aDistance - bDistance || b.width * b.height - a.width * a.height;
  })[0];
  if (!selected) return null;

  return selected;
}

/**
 * A symbolic icon is one flat neutral tone whose shape comes from alpha alone. Grayscale artwork
 * (shaded logos, a white shield with dark lettering) is neutral too, but painting it with a single
 * tone erases its internal detail, so the solid pixels must also share one luminance band.
 * Translucent edge pixels are ignored because their alpha, not their color, carries the shape.
 *
 * Only the first `pixelCount` pixels are read, so `pixels` may be longer than the image.
 */
export function isSymbolicSniPixels(
  pixels: ArrayLike<number>,
  layout: PixelLayout = RGBA_LAYOUT,
  pixelCount = Math.floor(pixels.length / CHANNELS_PER_PIXEL),
): boolean {
  const neutralLuminance = new Uint32Array(LUMINANCE_LEVELS);
  let solidPixels = 0;

  for (let pixel = 0, offset = 0; pixel < pixelCount; pixel++, offset += CHANNELS_PER_PIXEL) {
    if (pixels[offset + layout.alpha]! < SOLID_ALPHA_THRESHOLD) continue;

    solidPixels++;
    const red = pixels[offset + layout.red]!;
    const green = pixels[offset + layout.green]!;
    const blue = pixels[offset + layout.blue]!;
    if (Math.max(red, green, blue) - Math.min(red, green, blue) > TONE_TOLERANCE) continue;

    neutralLuminance[Math.floor((red + green + blue) / 3)]!++;
  }

  if (solidPixels === 0) return false;

  return densestBandCount(neutralLuminance) / solidPixels >= REQUIRED_TONE_RATIO;
}

/** Largest number of pixels that fall inside any one luminance band of tolerance-wide radius. */
function densestBandCount(histogram: Uint32Array): number {
  const bandWidth = TONE_TOLERANCE * 2 + 1;
  let bandCount = 0;
  let densest = 0;

  for (let level = 0; level < histogram.length; level++) {
    bandCount += histogram[level]!;
    if (level >= bandWidth) bandCount -= histogram[level - bandWidth]!;
    if (bandCount > densest) densest = bandCount;
  }

  return densest;
}

/**
 * Returns the first `height` rows of an RGBA image without row padding.
 *
 * When the rows are already packed this is a view of `data`, not a copy, so callers must treat
 * the result as read-only.
 */
export function packRgbaRows(
  data: Uint8Array,
  width: number,
  height: number,
  rowstride: number,
): Uint8Array {
  const rowBytes = width * CHANNELS_PER_PIXEL;
  if (rowstride === rowBytes) return data.subarray(0, rowBytes * height);

  const packed = new Uint8Array(rowBytes * height);
  for (let row = 0; row < height; row++) {
    packed.set(data.subarray(row * rowstride, row * rowstride + rowBytes), row * rowBytes);
  }

  return packed;
}

/** Converts pixels to a new RGBA buffer, painting every pixel with `tone` when one is given. */
export function toRgba(
  source: ArrayLike<number>,
  layout: PixelLayout,
  pixelCount: number,
  tone?: Tone,
): Uint8Array {
  const rgba = new Uint8Array(pixelCount * CHANNELS_PER_PIXEL);

  if (tone) {
    const [red, green, blue] = tone;
    for (let pixel = 0, offset = 0; pixel < pixelCount; pixel++, offset += CHANNELS_PER_PIXEL) {
      rgba[offset] = red;
      rgba[offset + 1] = green;
      rgba[offset + 2] = blue;
      rgba[offset + 3] = source[offset + layout.alpha]!;
    }
    return rgba;
  }

  for (let pixel = 0, offset = 0; pixel < pixelCount; pixel++, offset += CHANNELS_PER_PIXEL) {
    rgba[offset] = source[offset + layout.red]!;
    rgba[offset + 1] = source[offset + layout.green]!;
    rgba[offset + 2] = source[offset + layout.blue]!;
    rgba[offset + 3] = source[offset + layout.alpha]!;
  }

  return rgba;
}
