import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARGB_LAYOUT,
  RGBA_LAYOUT,
  isSymbolicSniPixels,
  packRgbaRows,
  selectSniPixmap,
  toRgba,
} from '~/desktop/trayIcons/sniIconState.ts';

function solidPixels(count: number, red: number, green: number, blue: number): number[] {
  return Array.from({ length: count }, () => [red, green, blue, 255]).flat();
}

test('SNI pixmap selection ignores unusable images and chooses nearest size', () => {
  const pixmaps = [
    { width: 4, height: 4 },
    { width: 16, height: 16 },
    { width: 32, height: 32 },
  ];
  assert.equal(selectSniPixmap(pixmaps, 24), pixmaps[2]);
  assert.equal(selectSniPixmap([pixmaps[0]!], 24), null);
});

test('SNI symbolic classification accepts a flat neutral tone and rejects colorful icons', () => {
  assert.equal(isSymbolicSniPixels([250, 250, 251, 255, 248, 250, 249, 255]), true);
  assert.equal(isSymbolicSniPixels([255, 0, 0, 255, 0, 255, 0, 255]), false);
  assert.equal(isSymbolicSniPixels([255, 40, 42, 41], ARGB_LAYOUT), true);
});

test('SNI symbolic classification rejects grayscale artwork with several tones', () => {
  const shieldWithLettering = [...solidPixels(2, 250, 250, 250), ...solidPixels(1, 30, 30, 30)];
  assert.equal(isSymbolicSniPixels(shieldWithLettering), false);

  const shadedCube = [
    ...solidPixels(1, 230, 230, 230),
    ...solidPixels(1, 170, 170, 170),
    ...solidPixels(1, 110, 110, 110),
  ];
  assert.equal(isSymbolicSniPixels(shadedCube), false);
});

test('SNI symbolic classification ignores translucent edge pixels', () => {
  const antiAliasedGlyph = [...solidPixels(20, 250, 250, 250), 10, 10, 10, 40];
  assert.equal(isSymbolicSniPixels(antiAliasedGlyph), true);
});

test('SNI symbolic classification tolerates a few stray pixels around the dominant tone', () => {
  const glyphWithStrayPixel = [...solidPixels(48, 250, 250, 250), ...solidPixels(1, 20, 20, 20)];
  assert.equal(isSymbolicSniPixels(glyphWithStrayPixel), true);
});

test('SNI symbolic classification rejects fully transparent images', () => {
  assert.equal(isSymbolicSniPixels([0, 0, 0, 0, 0, 0, 0, 0]), false);
});

test('SNI symbolic classification only reads the requested pixel count', () => {
  const colorfulTail = [...solidPixels(2, 250, 250, 250), ...solidPixels(2, 255, 0, 0)];
  assert.equal(isSymbolicSniPixels(colorfulTail, RGBA_LAYOUT, 2), true);
});

test('SNI pixel conversion reorders ARGB to RGBA and keeps colors', () => {
  const argb = [10, 1, 2, 3, 20, 4, 5, 6];
  assert.deepEqual([...toRgba(argb, ARGB_LAYOUT, 2)], [1, 2, 3, 10, 4, 5, 6, 20]);
});

test('SNI pixel conversion paints one tone while preserving alpha', () => {
  const argb = [10, 1, 2, 3, 20, 4, 5, 6];
  assert.deepEqual(
    [...toRgba(argb, ARGB_LAYOUT, 2, [48, 49, 50])],
    [48, 49, 50, 10, 48, 49, 50, 20],
  );
});

test('SNI row packing drops stride padding and avoids copying packed rows', () => {
  const padded = new Uint8Array([1, 2, 3, 4, 0, 0, 5, 6, 7, 8, 0, 0]);
  assert.deepEqual([...packRgbaRows(padded, 1, 2, 6)], [1, 2, 3, 4, 5, 6, 7, 8]);

  const packed = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(packRgbaRows(packed, 1, 2, 4).buffer, packed.buffer);
});
