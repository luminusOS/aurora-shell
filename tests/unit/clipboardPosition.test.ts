import assert from 'node:assert/strict';
import test from 'node:test';

import {
  placeClipboardPanelNearPointer,
  resolveClipboardPanelAnchor,
} from '../../src/clipboard/clipboardPosition.ts';

const AREA = { x: 0, y: 24, width: 1280, height: 696 };
const WIDTH = 380;
const HEIGHT = 460;
const MARGIN = 12;
const OFFSET = 12;

test('placeClipboardPanelNearPointer places panel below and right of pointer', () => {
  const bounds = placeClipboardPanelNearPointer(200, 120, AREA, WIDTH, HEIGHT, MARGIN, OFFSET);

  assert.deepEqual(bounds, {
    x: 212,
    y: 132,
    width: WIDTH,
    height: HEIGHT,
  });
});

test('placeClipboardPanelNearPointer flips away from bottom-right edges', () => {
  const bounds = placeClipboardPanelNearPointer(1260, 700, AREA, WIDTH, HEIGHT, MARGIN, OFFSET);

  assert.deepEqual(bounds, {
    x: 868,
    y: 228,
    width: WIDTH,
    height: HEIGHT,
  });
});

test('placeClipboardPanelNearPointer clamps and shrinks in narrow work areas', () => {
  const bounds = placeClipboardPanelNearPointer(
    80,
    80,
    { x: 50, y: 50, width: 240, height: 260 },
    WIDTH,
    HEIGHT,
    MARGIN,
    OFFSET,
  );

  assert.deepEqual(bounds, {
    x: 62,
    y: 62,
    width: 216,
    height: 236,
  });
});

test('resolveClipboardPanelAnchor prefers focused window center and monitor', () => {
  const anchor = resolveClipboardPanelAnchor(100, 120, 0, {
    monitorIndex: 1,
    frame: { x: 1920, y: 80, width: 1000, height: 700 },
  });

  assert.deepEqual(anchor, {
    x: 2420,
    y: 430,
    monitorIndex: 1,
  });
});

test('resolveClipboardPanelAnchor falls back to pointer for invalid focused window frame', () => {
  const anchor = resolveClipboardPanelAnchor(100, 120, 0, {
    monitorIndex: 1,
    frame: { x: 1920, y: 80, width: 0, height: 700 },
  });

  assert.deepEqual(anchor, {
    x: 100,
    y: 120,
    monitorIndex: 0,
  });
});
