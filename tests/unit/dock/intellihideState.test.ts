import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  getBlockingOverlapState,
  hasOverlap,
  isOnActiveWorkspace,
  rectanglesOverlap,
} from '~/dock/intellihideState.ts';

const rect = (x: number, y: number, width: number, height: number) => ({
  x,
  y,
  width,
  height,
});

test('isOnActiveWorkspace accepts the active workspace on every monitor', () => {
  const activeWorkspace = {};
  assert.equal(isOnActiveWorkspace(activeWorkspace, activeWorkspace, false), true);
  assert.equal(isOnActiveWorkspace({}, activeWorkspace, false), false);
});

test('isOnActiveWorkspace accepts sticky windows', () => {
  assert.equal(isOnActiveWorkspace({}, {}, true), true);
});

test('rectanglesOverlap detects a window intersecting the dock', () => {
  assert.equal(rectanglesOverlap(rect(800, 1000, 500, 100), rect(700, 1030, 600, 50)), true);
  assert.equal(rectanglesOverlap(rect(0, 0, 500, 500), rect(700, 1030, 600, 50)), false);
});

test('rectanglesOverlap does not block when a small window only touches the dock edge', () => {
  assert.equal(rectanglesOverlap(rect(700, 530, 600, 500), rect(700, 1030, 600, 50)), false);
});

test('hasOverlap checks every relevant window rather than only the focused or last window', () => {
  const dock = rect(700, 1030, 600, 50);
  const windows = [rect(800, 1000, 500, 100), rect(0, 0, 500, 500)];

  assert.equal(hasOverlap(windows, dock), true);
});

test('getBlockingOverlapState lets a focused small window reveal over a background fullscreen window', () => {
  const dock = rect(700, 1030, 600, 50);
  const focusedSmallWindow = rect(100, 100, 500, 300);
  const backgroundFullscreenWindow = rect(0, 0, 1920, 1080);

  const state = getBlockingOverlapState(
    [
      { rectangle: focusedSmallWindow, focused: true },
      { rectangle: backgroundFullscreenWindow, fullscreen: true },
    ],
    dock,
    true,
  );

  assert.equal(state.blocked, false);
  assert.deepEqual(state.rectangles, [focusedSmallWindow]);
});

test('getBlockingOverlapState lets a topmost small window reveal when focus is on another monitor', () => {
  const dock = rect(700, 1030, 600, 50);
  const backgroundFullscreenWindow = rect(0, 0, 1920, 1080);
  const topmostSmallWindow = rect(100, 100, 500, 300);

  const state = getBlockingOverlapState(
    [
      { rectangle: backgroundFullscreenWindow, fullscreen: true },
      { rectangle: topmostSmallWindow, topmost: true },
    ],
    dock,
    true,
  );

  assert.equal(state.blocked, false);
  assert.deepEqual(state.rectangles, [topmostSmallWindow]);
});

test('getBlockingOverlapState does not let a focused PiP reveal over fullscreen', () => {
  const dock = rect(700, 1030, 600, 50);
  const backgroundFullscreenWindow = rect(0, 0, 1920, 1080);
  const focusedPipWindow = rect(100, 100, 500, 300);

  const state = getBlockingOverlapState(
    [
      { rectangle: backgroundFullscreenWindow, fullscreen: true },
      {
        rectangle: focusedPipWindow,
        focused: true,
        topmost: true,
        excludedFromSmartReveal: true,
      },
    ],
    dock,
    true,
  );

  assert.equal(state.blocked, true);
  assert.deepEqual(state.rectangles, [backgroundFullscreenWindow]);
});

test('getBlockingOverlapState keeps the dock hidden while PiP is focused without fullscreen', () => {
  const dock = rect(700, 1030, 600, 50);
  const backgroundWindow = rect(0, 0, 600, 500);
  const focusedPipWindow = rect(100, 100, 500, 300);

  const state = getBlockingOverlapState(
    [
      { rectangle: backgroundWindow },
      {
        rectangle: focusedPipWindow,
        focused: true,
        topmost: true,
        excludedFromSmartReveal: true,
      },
    ],
    dock,
    false,
  );

  assert.equal(state.blocked, true);
});

test('getBlockingOverlapState keeps ordinary small-window reveal when PiP exclusion is off', () => {
  const dock = rect(700, 1030, 600, 50);
  const backgroundFullscreenWindow = rect(0, 0, 1920, 1080);
  const focusedSmallWindow = rect(100, 100, 500, 300);

  const state = getBlockingOverlapState(
    [
      { rectangle: backgroundFullscreenWindow, fullscreen: true },
      { rectangle: focusedSmallWindow, focused: true, topmost: true },
    ],
    dock,
    true,
  );

  assert.equal(state.blocked, false);
  assert.deepEqual(state.rectangles, [focusedSmallWindow]);
});

test('getBlockingOverlapState still lets an excluded PiP block by overlapping the dock', () => {
  const dock = rect(700, 1030, 600, 50);
  const overlappingPipWindow = rect(800, 1000, 500, 100);

  const state = getBlockingOverlapState(
    [
      {
        rectangle: overlappingPipWindow,
        focused: true,
        topmost: true,
        excludedFromSmartReveal: true,
      },
    ],
    dock,
    false,
  );

  assert.equal(state.blocked, true);
  assert.deepEqual(state.rectangles, [overlappingPipWindow]);
});

test('getBlockingOverlapState does not reveal for an excluded PiP when focus is on another monitor', () => {
  const dock = rect(700, 1030, 600, 50);
  const topmostPipWindow = rect(100, 100, 500, 300);

  const state = getBlockingOverlapState(
    [
      {
        rectangle: topmostPipWindow,
        topmost: true,
        excludedFromSmartReveal: true,
      },
    ],
    dock,
    false,
  );

  assert.equal(state.blocked, true);
  assert.deepEqual(state.rectangles, [topmostPipWindow]);
});

test('getBlockingOverlapState blocks when the focused window overlaps the dock', () => {
  const dock = rect(700, 1030, 600, 50);
  const focusedOverlappingWindow = rect(800, 1000, 500, 100);

  const state = getBlockingOverlapState(
    [{ rectangle: focusedOverlappingWindow, focused: true }],
    dock,
    false,
  );

  assert.equal(state.blocked, true);
  assert.deepEqual(state.rectangles, [focusedOverlappingWindow]);
});

test('getBlockingOverlapState keeps monitor fullscreen blocking when there are no candidates', () => {
  const state = getBlockingOverlapState([], null, true);

  assert.equal(state.blocked, true);
});

test('getBlockingOverlapState blocks when the topmost window is fullscreen', () => {
  const state = getBlockingOverlapState(
    [{ rectangle: rect(0, 0, 1920, 1080), fullscreen: true, topmost: true }],
    null,
    true,
  );

  assert.equal(state.blocked, true);
});

test('getBlockingOverlapState does not treat non-overlapping non-fullscreen windows as exclusive', () => {
  const dock = rect(700, 1030, 600, 50);

  const state = getBlockingOverlapState([{ rectangle: rect(100, 100, 500, 300) }], dock, false);

  assert.equal(state.blocked, false);
});
