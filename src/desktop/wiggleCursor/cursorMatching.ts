export type CursorFrame = {
  filename: string;
  hotspotX: number;
  hotspotY: number;
  nominalSize: number;
  delay: number;
};

export type PixelView = {
  pixels: Uint8Array;
  width: number;
  height: number;
  rowstride: number;
  channels: number;
};

// Both images come out of the same librsvg at the same size, so a true match differs by nothing
// but rounding. A different cursor of the same hotspot differs by tens of levels.
export const MATCH_THRESHOLD = 1.5;
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
    if (typeof description['filename'] !== 'string' || nominalSize <= 0) return null;

    frames.push({
      filename: description['filename'],
      hotspotX: numberOrZero(description['hotspot_x']),
      hotspotY: numberOrZero(description['hotspot_y']),
      nominalSize,
      delay: numberOrZero(description['delay']),
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
