/** One image of a theme cursor, as listed in its `metadata.json`. */
export type CursorFrame = {
  filename: string;
  hotspotX: number;
  hotspotY: number;
  nominalSize: number;
};

/** Straight RGBA pixels with their layout, as gdk-pixbuf hands them out. */
export type PixelView = {
  pixels: Uint8Array;
  width: number;
  height: number;
  rowstride: number;
  channels: number;
};

// Measured on Adwaita, drawing a shape at the size of the Shell's texture differs from the Shell's
// own pixels by 0 when its viewport is a whole number of pixels, and by up to 12 on a 4/3 or 5/3
// monitor, whose fractional viewport librsvg cannot reproduce. Another shape is at least 12 away
// and usually over 20, so the nearest shape wins and anything beyond this is not a theme cursor.
export const MAX_MATCH_DIFFERENCE = 16;
// Below this no other shape can be nearer, so the search can stop.
export const EXACT_MATCH_DIFFERENCE = 1.5;
const HOTSPOT_TOLERANCE = 1.5;
const RGBA_CHANNELS = 4;

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Reads a theme's `metadata.json`, which lists one frame per image of the cursor. */
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
    if (typeof filename !== 'string' || filename.includes('/') || nominalSize <= 0) return null;

    frames.push({
      filename,
      hotspotX: numberOrZero(description['hotspot_x']),
      hotspotY: numberOrZero(description['hotspot_y']),
      nominalSize,
    });
  }

  return frames;
}

/** Where the Shell puts the hotspot of a frame, in the pixels of the cursor texture. */
export function expectedHotspot(
  frame: CursorFrame,
  cursorSize: number,
  monitorScale: number,
): [number, number] {
  const factor = (cursorSize / frame.nominalSize) * monitorScale;

  return [Math.trunc(frame.hotspotX * factor), Math.trunc(frame.hotspotY * factor)];
}

/** Whether `frame` puts its hotspot where the tracker reports it, give or take truncation. */
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
 * Logical size and hotspot of a frame, before the monitor scale. They come from the theme rather
 * than from the texture, whose size and hotspot the Shell truncates to whole pixels.
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
 * Mean absolute difference between two straight RGBA images, in 0 to 255 over premultiplied
 * colour, so transparent pixels do not count for whatever colour they happen to hold. Images of a
 * different size or format never match.
 */
export function meanPixelDifference(first: PixelView, second: PixelView): number {
  if (
    first.width !== second.width ||
    first.height !== second.height ||
    first.channels !== RGBA_CHANNELS ||
    second.channels !== RGBA_CHANNELS
  )
    return Infinity;

  let total = 0;
  for (let y = 0; y < first.height; y++) {
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
