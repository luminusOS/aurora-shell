import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  calculateToolbarTranslation,
  findMonitorForSelection,
  type ToolbarPlacement,
} from '~/capture/toolbarPlacement.ts';

const placement: ToolbarPlacement = {
  monitor: { x: 0, y: 0, width: 1920, height: 1080 },
  selection: { x: 500, y: 300, width: 800, height: 500 },
  toolbar: {
    width: 600,
    height: 48,
    stageX: 660,
    stageY: 0,
    translationX: 0,
    translationY: 0,
  },
  margin: 12,
};

test('toolbar placement produces finite translations inside the monitor', () => {
  assert.deepEqual(calculateToolbarTranslation(placement), { x: -60, y: 240 });
});

test('toolbar placement moves below selections that have no room above', () => {
  assert.deepEqual(
    calculateToolbarTranslation({
      ...placement,
      selection: { x: 20, y: 10, width: 300, height: 200 },
    }),
    { x: -660, y: 222 },
  );
});

test('toolbar placement avoids protected native controls', () => {
  assert.deepEqual(
    calculateToolbarTranslation({
      ...placement,
      selection: { x: 500, y: 10, width: 800, height: 900 },
      protectedArea: { x: 0, y: 850, width: 1920, height: 200 },
    }),
    { x: -60, y: 790 },
  );
});

test('toolbar placement ignores a protected area outside its horizontal path', () => {
  assert.deepEqual(
    calculateToolbarTranslation({
      ...placement,
      selection: { x: 20, y: 10, width: 300, height: 200 },
      protectedArea: { x: 1400, y: 200, width: 400, height: 200 },
    }),
    { x: -660, y: 222 },
  );
});

test('toolbar placement selects the monitor containing most of the selection', () => {
  const monitors = [
    { x: 0, y: 0, width: 1920, height: 1080 },
    { x: 1920, y: 180, width: 2560, height: 1440 },
  ];

  assert.equal(
    findMonitorForSelection({ x: 2200, y: 400, width: 800, height: 500 }, monitors, 0),
    monitors[1],
  );
  assert.deepEqual(
    calculateToolbarTranslation({
      ...placement,
      monitor: monitors[1]!,
      selection: { x: 2200, y: 400, width: 800, height: 500 },
    }),
    { x: 1640, y: 340 },
  );
});

test('toolbar placement uses the primary monitor as a safe fallback', () => {
  const monitors = [
    { x: 0, y: 0, width: 1920, height: 1080 },
    { x: 1920, y: 0, width: 1920, height: 1080 },
  ];

  assert.equal(
    findMonitorForSelection({ x: 5000, y: 5000, width: 100, height: 100 }, monitors, 0),
    monitors[0],
  );
});

test('toolbar placement supports a monitor with a negative stage offset', () => {
  const monitors = [
    { x: 0, y: 0, width: 1920, height: 1080 },
    { x: -1600, y: -200, width: 1600, height: 900 },
  ];

  assert.equal(
    findMonitorForSelection({ x: -1400, y: 100, width: 600, height: 300 }, monitors, 0),
    monitors[1],
  );
});

test('toolbar placement rejects non-finite actor coordinates', () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(
      calculateToolbarTranslation({
        ...placement,
        toolbar: { ...placement.toolbar, stageX: value },
      }),
      null,
    );
    assert.equal(
      calculateToolbarTranslation({
        ...placement,
        toolbar: { ...placement.toolbar, stageY: value },
      }),
      null,
    );
  }
});
