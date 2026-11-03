export type CursorFrame = {
  filename: string;
  hotspotX: number;
  hotspotY: number;
  nominalSize: number;
};

export type PixelView = {
  pixels: Uint8Array;
  width: number;
  height: number;
  rowstride: number;
  channels: number;
};

// Measured on Adwaita. Where the Shell rasterises a whole number of pixels the right shape matches
// exactly, but a frame of the animated `wait` cursor sits about 10 from `not-allowed`, so the limit
// is tight. On a fractional viewport (4/3, 5/3) the right shape differs by up to 6 and `wait` is at
// least 12 away.
const MAX_WHOLE_PIXEL_DIFFERENCE = 2;
const MAX_FRACTIONAL_DIFFERENCE = 8;
const WHOLE_PIXEL_TOLERANCE = 1e-4;
// Below this no other shape can be nearer, so the search can stop.
export const EXACT_MATCH_DIFFERENCE = 1.5;
const HOTSPOT_TOLERANCE = 1.5;
const RGBA_CHANNELS = 4;

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** The frames a theme's `metadata.json` lists, or null when it is malformed. */
export function parseCursorMetadata(json: string): CursorFrame[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;

  const frames: CursorFrame[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) return null;
    const description = entry as Record<string, unknown>;
    const nominalSize = numberOrZero(description['nominal_size']);
    const filename = description['filename'];
    // The theme is untrusted input, and a path would reach outside the cursor's own directory.
    if (typeof filename !== 'string' || !/^[^/]+\.svg$/.test(filename) || nominalSize < 1)
      return null;

    frames.push({
      filename,
      hotspotX: numberOrZero(description['hotspot_x']),
      hotspotY: numberOrZero(description['hotspot_y']),
      nominalSize,
    });
  }

  return frames;
}

function expectedHotspot(
  frame: CursorFrame,
  cursorSize: number,
  monitorScale: number,
): [number, number] {
  const factor = (cursorSize / frame.nominalSize) * monitorScale;

  return [Math.trunc(frame.hotspotX * factor), Math.trunc(frame.hotspotY * factor)];
}

export function matchesHotspot(
  frame: CursorFrame,
  cursorSize: number,
  monitorScale: number,
  hotspot: [number, number],
): boolean {
  const [expectedX, expectedY] = expectedHotspot(frame, cursorSize, monitorScale);

  return (
    Math.abs(expectedX - hotspot[0]) <= HOTSPOT_TOLERANCE &&
    Math.abs(expectedY - hotspot[1]) <= HOTSPOT_TOLERANCE
  );
}

export type CursorGeometry = {
  width: number;
  height: number;
  hotspotX: number;
  hotspotY: number;
};

/**
 * The size the Shell rasterises `frame` at on a monitor, in the pixels of the cursor texture. It is
 * fractional on a fractional scale, and the texture is that size truncated.
 */
export function rasterisedSize(
  frame: CursorFrame,
  svgWidth: number,
  svgHeight: number,
  cursorSize: number,
  monitorScale: number,
): { width: number; height: number } {
  const factor = (cursorSize / frame.nominalSize) * monitorScale;

  return { width: svgWidth * factor, height: svgHeight * factor };
}

/** The texture size for a rasterised size, as the Shell truncates it. */
export function textureSize(size: { width: number; height: number }): {
  width: number;
  height: number;
} {
  return {
    width: Math.floor(size.width + WHOLE_PIXEL_TOLERANCE),
    height: Math.floor(size.height + WHOLE_PIXEL_TOLERANCE),
  };
}

/** How far the nearest shape may be from the tracker's pixels, given how the Shell drew them. */
export function maxMatchDifference(size: { width: number; height: number }): number {
  const isWholePixel =
    Math.abs(size.width - Math.round(size.width)) < WHOLE_PIXEL_TOLERANCE &&
    Math.abs(size.height - Math.round(size.height)) < WHOLE_PIXEL_TOLERANCE;

  return isWholePixel ? MAX_WHOLE_PIXEL_DIFFERENCE : MAX_FRACTIONAL_DIFFERENCE;
}

/**
 * Logical size and hotspot of a frame, taken from the theme because the Shell truncates those of
 * its texture to whole pixels.
 */
export function logicalGeometry(
  frame: CursorFrame,
  svgWidth: number,
  svgHeight: number,
  cursorSize: number,
): CursorGeometry {
  const factor = cursorSize / frame.nominalSize;

  return {
    width: svgWidth * factor,
    height: svgHeight * factor,
    hotspotX: frame.hotspotX * factor,
    hotspotY: frame.hotspotY * factor,
  };
}

/**
 * Mean absolute difference, 0 to 255, over premultiplied colour so that transparent pixels count
 * for nothing. Returns Infinity for images of a different size or format, and once the difference
 * is certain to reach `ceiling`, since the caller only keeps nearer images.
 */
export function meanPixelDifference(
  first: PixelView,
  second: PixelView,
  ceiling = Infinity,
): number {
  if (
    first.width !== second.width ||
    first.height !== second.height ||
    first.channels !== RGBA_CHANNELS ||
    second.channels !== RGBA_CHANNELS
  )
    return Infinity;

  const totalCeiling = ceiling * first.width * first.height * RGBA_CHANNELS;
  let total = 0;
  for (let y = 0; y < first.height; y++) {
    if (total >= totalCeiling) return Infinity;

    for (let x = 0; x < first.width; x++) {
      const a = y * first.rowstride + x * RGBA_CHANNELS;
      const b = y * second.rowstride + x * RGBA_CHANNELS;
      const alphaA = first.pixels[a + 3]!;
      const alphaB = second.pixels[b + 3]!;

      for (let channel = 0; channel < 3; channel++)
        total += Math.abs(
          (first.pixels[a + channel]! * alphaA - second.pixels[b + channel]! * alphaB) / 255,
        );
      total += Math.abs(alphaA - alphaB);
    }
  }

  return total / (first.width * first.height * RGBA_CHANNELS);
}
