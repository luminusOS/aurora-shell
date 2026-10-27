export const BYTES_PER_PIXEL = 4;

// The work grows with the square of the side (a 320 px image takes about 50 ms in one piece), so the
// side is capped: larger cursors are shown unprocessed and everything else runs in slices.
const MAX_IMAGE_SIDE = 384;
// Gaussian radius per upscale step: wide enough to reach the soft edge a resampling filter leaves.
const SIGMA_PER_FACTOR = 0.8;
// Unsharp mask strength. 3 hardened the white outline and clipped the soft shadow tail; 1.5 left
// the edge visibly soft.
const SHARPEN_AMOUNT = 2;
const ROWS_PER_STEP = 8;

export function fitsProcessingBudget(width: number, height: number): boolean {
  return Math.max(width, height) <= MAX_IMAGE_SIDE;
}

/** Only meaningful for textures that fit the processing budget. */
export function upscaleFactor(width: number, height: number, magnification: number): number {
  const fitting = Math.floor(MAX_IMAGE_SIDE / Math.max(width, height));
  return Math.max(1, Math.min(magnification, fitting));
}

function gaussianKernel(sigma: number): Float32Array {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(radius * 2 + 1);
  let total = 0;

  for (let offset = -radius; offset <= radius; offset++) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    kernel[offset + radius] = weight;
    total += weight;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] = kernel[i]! / total;

  return kernel;
}

function convolveRows(
  source: Float32Array,
  target: Float32Array,
  width: number,
  height: number,
  kernel: Float32Array,
  stepX: number,
  stepY: number,
  firstRow: number,
  endRow: number,
): void {
  const radius = (kernel.length - 1) / 2;

  for (let y = firstRow; y < endRow; y++) {
    for (let x = 0; x < width; x++) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;

      for (let tap = -radius; tap <= radius; tap++) {
        const sampleX = Math.min(width - 1, Math.max(0, x + tap * stepX));
        const sampleY = Math.min(height - 1, Math.max(0, y + tap * stepY));
        const sample = (sampleY * width + sampleX) * BYTES_PER_PIXEL;
        const weight = kernel[tap + radius]!;
        red += source[sample]! * weight;
        green += source[sample + 1]! * weight;
        blue += source[sample + 2]! * weight;
        alpha += source[sample + 3]! * weight;
      }

      const output = (y * width + x) * BYTES_PER_PIXEL;
      target[output] = red;
      target[output + 1] = green;
      target[output + 2] = blue;
      target[output + 3] = alpha;
    }
  }
}

function premultiply(
  source: Uint8Array,
  width: number,
  height: number,
  rowstride: number,
): Float32Array {
  const premultiplied = new Float32Array(width * height * BYTES_PER_PIXEL);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = y * rowstride + x * BYTES_PER_PIXEL;
      const to = (y * width + x) * BYTES_PER_PIXEL;
      const alpha = source[from + 3]! / 255;
      premultiplied[to] = (source[from]! / 255) * alpha;
      premultiplied[to + 1] = (source[from + 1]! / 255) * alpha;
      premultiplied[to + 2] = (source[from + 2]! / 255) * alpha;
      premultiplied[to + 3] = alpha;
    }
  }

  return premultiplied;
}

function toByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value * 255)));
}

function writeSharpenedRows(
  original: Float32Array,
  blurred: Float32Array,
  result: Uint8Array,
  width: number,
  firstRow: number,
  endRow: number,
): void {
  for (let pixel = firstRow * width; pixel < endRow * width; pixel++) {
    const offset = pixel * BYTES_PER_PIXEL;
    const sharpenedAlpha =
      original[offset + 3]! + SHARPEN_AMOUNT * (original[offset + 3]! - blurred[offset + 3]!);
    const alpha = Math.min(1, Math.max(0, sharpenedAlpha));
    if (alpha === 0) continue;

    // Premultiplied colour overshoots together with alpha. Once alpha saturates at 1, scale the
    // colour back down with it, or a shape of one colour would grow a lighter ring at its edge.
    const overshoot = sharpenedAlpha > 1 ? 1 / sharpenedAlpha : 1;
    for (let channel = 0; channel < 3; channel++) {
      const sharpened =
        original[offset + channel]! +
        SHARPEN_AMOUNT * (original[offset + channel]! - blurred[offset + channel]!);
      result[offset + channel] = toByte(
        Math.min(alpha, Math.max(0, sharpened * overshoot)) / alpha,
      );
    }
    result[offset + 3] = toByte(alpha);
  }
}

/**
 * Unsharp mask for an image that was enlarged by `factor`, working on premultiplied colour so
 * semi-transparent edges and drop shadows keep their colour. Input and output are straight
 * (non-premultiplied) RGBA; the output is tightly packed.
 *
 * It is a generator so a caller on a UI thread can interleave the work with rendering: it yields
 * after every few rows and returns the pixels when done.
 */
export function* sharpenRgbaSteps(
  source: Uint8Array,
  width: number,
  height: number,
  rowstride: number,
  factor: number,
): Generator<void, Uint8Array, void> {
  const original = premultiply(source, width, height, rowstride);
  yield;

  const kernel = gaussianKernel(factor * SIGMA_PER_FACTOR);
  const horizontal = new Float32Array(original.length);
  for (let row = 0; row < height; row += ROWS_PER_STEP) {
    convolveRows(original, horizontal, width, height, kernel, 1, 0, row, row + ROWS_PER_STEP);
    yield;
  }

  const blurred = new Float32Array(original.length);
  for (let row = 0; row < height; row += ROWS_PER_STEP) {
    convolveRows(horizontal, blurred, width, height, kernel, 0, 1, row, row + ROWS_PER_STEP);
    yield;
  }

  const result = new Uint8Array(width * height * BYTES_PER_PIXEL);
  for (let row = 0; row < height; row += ROWS_PER_STEP) {
    writeSharpenedRows(original, blurred, result, width, row, row + ROWS_PER_STEP);
    yield;
  }

  return result;
}
