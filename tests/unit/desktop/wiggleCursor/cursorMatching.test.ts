import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MATCH_THRESHOLD,
  expectedHotspot,
  matchesHotspot,
  meanPixelDifference,
  parseCursorMetadata,
  type CursorFrame,
  type PixelView,
} from '../../../../src/desktop/wiggleCursor/cursorMatching.ts';

const ARROW: CursorFrame = {
  filename: 'default.svg',
  hotspotX: 8,
  hotspotY: 7,
  nominalSize: 24,
  delay: 0,
};

function image(width: number, height: number, fill: [number, number, number, number]): PixelView {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) pixels.set(fill, i * 4);

  return { pixels, width, height, rowstride: width * 4, channels: 4 };
}

describe('parseCursorMetadata', () => {
  it('reads the frames of a theme cursor', () => {
    const frames = parseCursorMetadata(
      '[{"filename":"default.svg","hotspot_x":8,"hotspot_y":7,"nominal_size":24}]',
    );

    assert.deepEqual(frames, [ARROW]);
  });

  it('keeps the delay of an animated frame', () => {
    const frames = parseCursorMetadata(
      '[{"filename":"a.svg","delay":16,"nominal_size":24},{"filename":"b.svg","delay":16,"nominal_size":24}]',
    );

    assert.equal(frames?.length, 2);
    assert.equal(frames?.[0]?.delay, 16);
  });

  it('rejects text that is not JSON', () => {
    assert.equal(parseCursorMetadata('not json'), null);
  });

  it('rejects anything but a non-empty list', () => {
    assert.equal(parseCursorMetadata('{}'), null);
    assert.equal(parseCursorMetadata('[]'), null);
  });

  it('rejects a frame without a file or a nominal size', () => {
    assert.equal(parseCursorMetadata('[{"nominal_size":24}]'), null);
    assert.equal(parseCursorMetadata('[{"filename":"a.svg"}]'), null);
    assert.equal(parseCursorMetadata('[{"filename":"a.svg","nominal_size":0}]'), null);
    assert.equal(parseCursorMetadata('[null]'), null);
  });
});

describe('expectedHotspot', () => {
  it('scales the hotspot by the cursor size over the nominal size', () => {
    assert.deepEqual(expectedHotspot(ARROW, 24, 1), [8, 7]);
    assert.deepEqual(expectedHotspot(ARROW, 48, 1), [16, 14]);
  });

  it('follows the monitor scale, truncating like the Shell does', () => {
    assert.deepEqual(expectedHotspot(ARROW, 24, 2), [16, 14]);
    assert.deepEqual(expectedHotspot(ARROW, 24, 1.5), [12, 10]);
  });
});

describe('matchesHotspot', () => {
  it('accepts the hotspot the Shell reports', () => {
    assert.equal(matchesHotspot(ARROW, 24, 1, [8, 7]), true);
  });

  it('tolerates a pixel of rounding', () => {
    assert.equal(matchesHotspot(ARROW, 24, 1.25, [10, 8]), true);
  });

  it('rejects another cursor shape', () => {
    assert.equal(matchesHotspot(ARROW, 24, 1, [16, 16]), false);
  });
});

describe('meanPixelDifference', () => {
  it('is zero for identical images', () => {
    const opaque = image(4, 4, [200, 10, 10, 255]);

    assert.equal(meanPixelDifference(opaque, image(4, 4, [200, 10, 10, 255])), 0);
  });

  it('ignores the colour of fully transparent pixels', () => {
    assert.equal(meanPixelDifference(image(4, 4, [255, 0, 0, 0]), image(4, 4, [0, 255, 0, 0])), 0);
  });

  it('reads rows by their own stride', () => {
    const tight = image(2, 2, [10, 20, 30, 255]);
    const padded: PixelView = {
      pixels: new Uint8Array(2 * 12),
      width: 2,
      height: 2,
      rowstride: 12,
      channels: 4,
    };
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 2; x++) padded.pixels.set([10, 20, 30, 255], y * 12 + x * 4);

    assert.equal(meanPixelDifference(tight, padded), 0);
  });

  it('stays under the match threshold for rounding noise', () => {
    const noisy = image(4, 4, [201, 10, 10, 255]);

    assert.ok(meanPixelDifference(image(4, 4, [200, 10, 10, 255]), noisy) < MATCH_THRESHOLD);
  });

  it('is far above the match threshold for a different shape', () => {
    const first = image(4, 4, [0, 0, 0, 0]);
    const second = image(4, 4, [0, 0, 0, 0]);
    for (let i = 0; i < 8; i++) second.pixels.set([0, 0, 0, 255], i * 4);

    assert.ok(meanPixelDifference(first, second) > MATCH_THRESHOLD);
  });

  it('never matches images of a different size or format', () => {
    assert.equal(
      meanPixelDifference(image(4, 4, [0, 0, 0, 255]), image(5, 4, [0, 0, 0, 255])),
      Infinity,
    );
    assert.equal(
      meanPixelDifference(image(4, 4, [0, 0, 0, 255]), {
        ...image(4, 4, [0, 0, 0, 255]),
        channels: 3,
      }),
      Infinity,
    );
  });
});
