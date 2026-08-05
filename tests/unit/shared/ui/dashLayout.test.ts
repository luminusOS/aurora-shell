import assert from 'node:assert/strict';
import { test } from 'node:test';

import { boundsContainPoint, boundsEqual, calculateDashPlacement } from '~/shared/ui/dashLayout.ts';

const bounds = { x: 100, y: 50, width: 800, height: 600 };

test('dash layout — centers and bottom-aligns inside the work area', () => {
  assert.deepEqual(calculateDashPlacement(bounds, 300, 80, 12), {
    x: 350,
    y: 558,
    width: 300,
    height: 80,
  });
});

test('dash layout — clamps oversized or negative preferred dimensions', () => {
  assert.deepEqual(calculateDashPlacement(bounds, 1200, -20, 0), {
    x: 100,
    y: 650,
    width: 800,
    height: 0,
  });
});

test('dash layout — point containment includes edges', () => {
  assert.equal(boundsContainPoint(bounds, 100, 50), true);
  assert.equal(boundsContainPoint(bounds, 900, 650), true);
  assert.equal(boundsContainPoint(bounds, 99, 50), false);
  assert.equal(boundsContainPoint(null, 100, 50), false);
});

test('dash layout — structural bounds equality handles null', () => {
  assert.equal(boundsEqual(bounds, { ...bounds }), true);
  assert.equal(boundsEqual(bounds, { ...bounds, width: 799 }), false);
  assert.equal(boundsEqual(null, null), true);
  assert.equal(boundsEqual(bounds, null), false);
});
