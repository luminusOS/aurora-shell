import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  calculateDashPlacement,
  calculateDashReorderPosition,
  isSelfReorderPosition,
  selectDashIconSize,
} from '~/shared/ui/dashLayout.ts';

const workArea = { x: 100, y: 50, width: 1000, height: 700 };

test('dash placement centers the dock along each selected edge', () => {
  assert.deepEqual(calculateDashPlacement(workArea, 400, 80, 10, 'bottom'), {
    x: 400,
    y: 660,
    width: 400,
    height: 80,
  });
  assert.deepEqual(calculateDashPlacement(workArea, 80, 400, 10, 'left'), {
    x: 110,
    y: 200,
    width: 80,
    height: 400,
  });
  assert.deepEqual(calculateDashPlacement(workArea, 80, 400, 10, 'right'), {
    x: 1010,
    y: 200,
    width: 80,
    height: 400,
  });
});

test('dash icon size treats configured size as a maximum', () => {
  assert.equal(selectDashIconSize(64, 47, 1), 32);
  assert.equal(selectDashIconSize(48, 200, 1), 48);
  assert.equal(selectDashIconSize(64, 96, 2), 48);
});

test('dash reorder position follows the active orientation', () => {
  assert.equal(
    calculateDashReorderPosition({
      position: 'bottom',
      pointerX: 75,
      pointerY: 5,
      childCount: 4,
      mainAxisSize: 100,
    }),
    3,
  );
  assert.equal(
    calculateDashReorderPosition({
      position: 'left',
      pointerX: 5,
      pointerY: 75,
      childCount: 4,
      mainAxisSize: 100,
    }),
    3,
  );
});

test('dash reorder position excludes an animated placeholder from the usable axis', () => {
  assert.equal(
    calculateDashReorderPosition({
      position: 'left',
      pointerX: 5,
      pointerY: 75,
      childCount: 4,
      mainAxisSize: 125,
      excludedMainAxisSize: 25,
    }),
    3,
  );
});

test('dash reorder self-check ignores applications that are not favorites yet', () => {
  assert.equal(isSelfReorderPosition(-1, 0), false);
  assert.equal(isSelfReorderPosition(2, 2), true);
  assert.equal(isSelfReorderPosition(2, 3), true);
  assert.equal(isSelfReorderPosition(2, 4), false);
});
