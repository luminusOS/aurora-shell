import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSymbolicSniArgb,
  isSymbolicSniPixels,
  selectSniPixmap,
} from '~/desktop/trayIcons/sniIconState.ts';

test('SNI pixmap selection ignores unusable images and chooses nearest size', () => {
  const pixmaps = [
    { width: 4, height: 4 },
    { width: 16, height: 16 },
    { width: 32, height: 32 },
  ];
  assert.equal(selectSniPixmap(pixmaps, 24), pixmaps[2]);
  assert.equal(selectSniPixmap([pixmaps[0]!], 24), null);
});

test('SNI symbolic classification accepts neutral pixels and rejects colorful icons', () => {
  assert.equal(isSymbolicSniPixels([40, 42, 41, 255, 250, 250, 251, 255]), true);
  assert.equal(isSymbolicSniPixels([255, 0, 0, 255, 0, 255, 0, 255]), false);
  assert.equal(isSymbolicSniArgb([255, 40, 42, 41]), true);
});
