import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  fitsProcessingBudget,
  sharpenRgbaSteps,
  upscaleFactor,
} from '../../../../src/desktop/wiggleCursor/cursorSharpening.ts';

type Pixel = [number, number, number, number];

const FACTOR = 5;

function image(width: number, height: number, pixel: (x: number, y: number) => Pixel): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  }
  return data;
}

function sharpen(source: Uint8Array, width: number, height: number, rowstride = width * 4) {
  const job = sharpenRgbaSteps(source, width, height, rowstride, FACTOR);
  let step = job.next();
  while (!step.done) step = job.next();
  return step.value;
}

function channelAt(data: Uint8Array, width: number, x: number, y: number, channel: number) {
  return data[(y * width + x) * 4 + channel]!;
}

function steepestStep(
  data: Uint8Array,
  width: number,
  height: number,
  channel: number,
  vertical: boolean,
): number {
  let steepest = 0;
  for (let y = vertical ? 1 : 0; y < height; y++) {
    for (let x = vertical ? 0 : 1; x < width; x++) {
      const previous = vertical
        ? channelAt(data, width, x, y - 1, channel)
        : channelAt(data, width, x - 1, y, channel);
      steepest = Math.max(steepest, Math.abs(channelAt(data, width, x, y, channel) - previous));
    }
  }
  return steepest;
}

function ramp(position: number, start: number, length: number): number {
  return Math.min(1, Math.max(0, (position - start) / length));
}

describe('upscaleFactor', () => {
  it('uses the full magnification for typical cursor textures', () => {
    assert.equal(upscaleFactor(24, 24, 5), 5);
    assert.equal(upscaleFactor(32, 32, 5), 5);
  });

  it('shrinks the factor so the larger side stays within the image budget', () => {
    assert.equal(upscaleFactor(96, 96, 5), 4);
    assert.equal(upscaleFactor(32, 80, 5), 4);
  });

  it('keeps a factor of at least one for textures that still fit the budget', () => {
    assert.equal(upscaleFactor(200, 200, 5), 1);
    assert.equal(upscaleFactor(384, 384, 5), 1);
  });
});

describe('fitsProcessingBudget', () => {
  it('accepts textures whose larger side is within the image budget', () => {
    assert.ok(fitsProcessingBudget(32, 32));
    assert.ok(fitsProcessingBudget(384, 100));
    assert.ok(fitsProcessingBudget(384, 384));
  });

  it('rejects oversized and extreme-aspect textures before any pixel is read', () => {
    assert.equal(fitsProcessingBudget(385, 10), false);
    assert.equal(fitsProcessingBudget(10, 1024), false);
    assert.equal(fitsProcessingBudget(1024, 1024), false);
  });
});

describe('sharpenRgbaSteps', () => {
  it('leaves fully transparent images transparent', () => {
    const result = sharpen(
      image(20, 20, () => [0, 0, 0, 0]),
      20,
      20,
    );
    assert.ok(result.every((byte) => byte === 0));
  });

  it('leaves flat opaque colour untouched', () => {
    const result = sharpen(
      image(24, 24, () => [200, 40, 10, 255]),
      24,
      24,
    );
    for (let i = 0; i < result.length; i += 4) {
      assert.ok(Math.abs(result[i]! - 200) <= 1);
      assert.ok(Math.abs(result[i + 1]! - 40) <= 1);
      assert.ok(Math.abs(result[i + 2]! - 10) <= 1);
      assert.equal(result[i + 3], 255);
    }
  });

  it('preserves soft translucent regions such as drop shadows', () => {
    const result = sharpen(
      image(24, 24, () => [0, 0, 0, 64]),
      24,
      24,
    );
    for (let i = 0; i < result.length; i += 4) assert.ok(Math.abs(result[i + 3]! - 64) <= 1);
  });

  it('keeps the middle of a soft shadow gradient', () => {
    const width = 80;
    const gradient = image(width, 4, (x) =>
      x >= 50 ? [0, 0, 0, 255] : [0, 0, 0, Math.round(255 * 0.3 * ramp(x, 10, 40))],
    );

    const result = sharpen(gradient, width, 4);

    assert.ok(
      Math.abs(channelAt(result, width, 30, 1, 3) - channelAt(gradient, width, 30, 1, 3)) <= 3,
    );
  });

  it('steepens a blurred horizontal edge without moving it', () => {
    const width = 60;
    const blurred = image(width, 4, (x) => [0, 0, 0, Math.round(255 * ramp(x, 25, 10))]);

    const result = sharpen(blurred, width, 4);

    assert.ok(
      steepestStep(result, width, 4, 3, false) > steepestStep(blurred, width, 4, 3, false) * 1.5,
    );
    assert.ok(channelAt(result, width, 20, 1, 3) < 20);
    assert.ok(channelAt(result, width, 40, 1, 3) > 235);
    const crossing = Array.from({ length: width }, (_, x) =>
      channelAt(result, width, x, 1, 3),
    ).findIndex((alpha) => alpha >= 128);
    assert.ok(Math.abs(crossing - 30) <= 1, `crossing ${crossing}`);
  });

  it('steepens a blurred vertical edge as well', () => {
    const height = 60;
    const blurred = image(4, height, (_x, y) => [0, 0, 0, Math.round(255 * ramp(y, 25, 10))]);

    const result = sharpen(blurred, 4, height);

    assert.ok(
      steepestStep(result, 4, height, 3, true) > steepestStep(blurred, 4, height, 3, true) * 1.5,
    );
  });

  it('sharpens colour edges between opaque regions', () => {
    const width = 60;
    const blurred = image(width, 4, (x) => {
      const blend = ramp(x, 25, 10);
      return [Math.round(255 * (1 - blend)), 0, Math.round(255 * blend), 255];
    });

    const result = sharpen(blurred, width, 4);

    assert.ok(
      steepestStep(result, width, 4, 0, false) > steepestStep(blurred, width, 4, 0, false) * 1.5,
    );
    assert.ok(
      steepestStep(result, width, 4, 2, false) > steepestStep(blurred, width, 4, 2, false) * 1.5,
    );
  });

  it('keeps the colour of translucent edge pixels', () => {
    const width = 60;
    const halo = image(width, 4, (x) => [200, 30, 30, Math.round(255 * ramp(x, 25, 10))]);

    const result = sharpen(halo, width, 4);

    for (let x = 0; x < width; x++) {
      if (channelAt(result, width, x, 1, 3) < 30) continue;
      assert.ok(Math.abs(channelAt(result, width, x, 1, 0) - 200) <= 6, `red at ${x}`);
      assert.ok(Math.abs(channelAt(result, width, x, 1, 1) - 30) <= 6, `green at ${x}`);
    }
  });

  it('does not leak halos far from the shape', () => {
    const width = 60;
    const edge = image(width, 4, (x) => [255, 255, 255, x >= 30 ? 255 : 0]);

    const result = sharpen(edge, width, 4);

    for (let x = 0; x < 10; x++) assert.equal(channelAt(result, width, x, 1, 3), 0);
  });

  it('treats the image borders as continuing the edge pixels, not as wrapping around', () => {
    const width = 60;
    const rampAcross = image(width, 4, (x) => [0, 0, 0, Math.round(255 * ramp(x, 0, width - 1))]);

    const result = sharpen(rampAcross, width, 4);

    assert.ok(channelAt(result, width, 0, 1, 3) <= 5);
    assert.ok(channelAt(result, width, width - 1, 1, 3) >= 250);
  });

  it('keeps a soft region flat up to the image border', () => {
    const width = 60;
    const softLeft = image(width, 4, (x) => [0, 0, 0, x < 30 ? 100 : 0]);

    const result = sharpen(softLeft, width, 4);

    assert.ok(Math.abs(channelAt(result, width, 0, 1, 3) - 100) <= 3);
    assert.equal(channelAt(result, width, width - 1, 1, 3), 0);
  });

  it('ignores row padding and returns tightly packed pixels', () => {
    const width = 30;
    const height = 6;
    const tight = image(width, height, (x) => [10, 20, 30, x > 14 ? 255 : 0]);
    const rowstride = width * 4 + 8;
    const padded = new Uint8Array(rowstride * height).fill(0xab);
    for (let y = 0; y < height; y++)
      padded.set(tight.subarray(y * width * 4, (y + 1) * width * 4), y * rowstride);

    const result = sharpen(padded, width, height, rowstride);

    assert.equal(result.length, width * height * 4);
    assert.deepEqual(result, sharpen(tight, width, height));
  });

  it('does not modify its input', () => {
    const source = image(20, 20, (x) => [50, 60, 70, x > 9 ? 255 : 0]);
    const snapshot = source.slice();

    sharpen(source, 20, 20);

    assert.deepEqual(source, snapshot);
  });

  it('pauses often enough to keep each slice of work short', () => {
    const width = 160;
    const height = 160;
    const source = image(width, height, (x) => [0, 0, 0, x > 80 ? 255 : 0]);

    const job = sharpenRgbaSteps(source, width, height, width * 4, FACTOR);
    let pauses = 0;
    let step = job.next();
    while (!step.done) {
      pauses++;
      step = job.next();
    }

    assert.ok(pauses >= (height / 8) * 3, `${pauses} pauses`);
  });
});
