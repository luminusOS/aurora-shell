/**
 * Unit tests — dock/monitorTopology.ts
 *
 * hasDefinedBottom() is pure TypeScript with no GJS dependencies — ideal for
 * the Node.js test runner. Each case exercises a distinct layout geometry.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hasDefinedBottom } from '../../src/dock/monitorTopology.ts';

const mon = (x: number, y: number, width: number, height: number) => ({
  x,
  y,
  width,
  height,
});

test('hasDefinedBottom — single monitor returns true', () => {
  assert.strictEqual(hasDefinedBottom([mon(0, 0, 1920, 1080)], 0), true);
});

test('hasDefinedBottom — monitor with another directly below returns false', () => {
  const monitors = [mon(0, 0, 1920, 1080), mon(0, 1080, 1920, 1080)];
  assert.strictEqual(hasDefinedBottom(monitors, 0), false);
  assert.strictEqual(hasDefinedBottom(monitors, 1), true);
});

test('hasDefinedBottom — side-by-side monitors both return true', () => {
  const monitors = [mon(0, 0, 1920, 1080), mon(1920, 0, 1920, 1080)];
  assert.strictEqual(hasDefinedBottom(monitors, 0), true);
  assert.strictEqual(hasDefinedBottom(monitors, 1), true);
});

test('hasDefinedBottom — monitor with partial-overlap below returns false', () => {
  // Second monitor starts at the bottom edge of the first and overlaps in X
  const monitors = [mon(0, 0, 1920, 1080), mon(960, 1080, 960, 1080)];
  assert.strictEqual(hasDefinedBottom(monitors, 0), false);
});

test('hasDefinedBottom — monitor with non-overlapping X below returns true', () => {
  // Second monitor is below but entirely to the right with no X overlap
  const monitors = [mon(0, 0, 1920, 1080), mon(1920, 1080, 1920, 1080)];
  assert.strictEqual(hasDefinedBottom(monitors, 0), true);
});

test('hasDefinedBottom — out-of-bounds index returns false', () => {
  const monitors = [mon(0, 0, 1920, 1080)];
  assert.strictEqual(hasDefinedBottom(monitors, -1), false);
  assert.strictEqual(hasDefinedBottom(monitors, 5), false);
});
