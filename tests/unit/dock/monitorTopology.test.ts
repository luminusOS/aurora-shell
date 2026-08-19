import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getDockMonitorIndexes, hasDefinedBottom, hasDefinedEdge } from '~/dock/monitorTopology.ts';

const mon = (x: number, y: number, width: number, height: number) => ({
  x,
  y,
  width,
  height,
});

test('hasDefinedBottom: single monitor returns true', () => {
  assert.strictEqual(hasDefinedBottom([mon(0, 0, 1920, 1080)], 0), true);
});

test('hasDefinedBottom: monitor with another directly below returns false', () => {
  const monitors = [mon(0, 0, 1920, 1080), mon(0, 1080, 1920, 1080)];
  assert.strictEqual(hasDefinedBottom(monitors, 0), false);
  assert.strictEqual(hasDefinedBottom(monitors, 1), true);
});

test('hasDefinedBottom: side-by-side monitors both return true', () => {
  const monitors = [mon(0, 0, 1920, 1080), mon(1920, 0, 1920, 1080)];
  assert.strictEqual(hasDefinedBottom(monitors, 0), true);
  assert.strictEqual(hasDefinedBottom(monitors, 1), true);
});

test('hasDefinedBottom: monitor with partial-overlap below returns false', () => {
  // Second monitor starts at the bottom edge of the first and overlaps in X
  const monitors = [mon(0, 0, 1920, 1080), mon(960, 1080, 960, 1080)];
  assert.strictEqual(hasDefinedBottom(monitors, 0), false);
});

test('hasDefinedBottom: monitor with non-overlapping X below returns true', () => {
  // Second monitor is below but entirely to the right with no X overlap
  const monitors = [mon(0, 0, 1920, 1080), mon(1920, 1080, 1920, 1080)];
  assert.strictEqual(hasDefinedBottom(monitors, 0), true);
});

test('hasDefinedBottom: out-of-bounds index returns false', () => {
  const monitors = [mon(0, 0, 1920, 1080)];
  assert.strictEqual(hasDefinedBottom(monitors, -1), false);
  assert.strictEqual(hasDefinedBottom(monitors, 5), false);
});

test('getDockMonitorIndexes: primary-only mode selects only the primary monitor', () => {
  const monitors = [mon(0, 0, 1920, 1080), mon(1920, 0, 1920, 1080)];
  assert.deepEqual(getDockMonitorIndexes(monitors, 1, false), [1]);
});

test('getDockMonitorIndexes: primary-only mode follows a changed primary monitor', () => {
  const monitors = [mon(0, 0, 1920, 1080), mon(1920, 0, 1920, 1080)];
  assert.deepEqual(getDockMonitorIndexes(monitors, 0, false), [0]);
  assert.deepEqual(getDockMonitorIndexes(monitors, 1, false), [1]);
});

test('getDockMonitorIndexes: primary-only mode keeps a primary with a monitor below it', () => {
  const monitors = [mon(0, 0, 1920, 1080), mon(0, 1080, 1920, 1080)];
  assert.deepEqual(getDockMonitorIndexes(monitors, 0, false), [0]);
});

test('getDockMonitorIndexes: all-monitors mode excludes internal bottom edges', () => {
  const monitors = [mon(0, 0, 1920, 1080), mon(0, 1080, 1920, 1080), mon(1920, 0, 1920, 1080)];
  assert.deepEqual(getDockMonitorIndexes(monitors, 0, true), [1, 2]);
});

test('getDockMonitorIndexes: invalid primary produces no dock in primary-only mode', () => {
  assert.deepEqual(getDockMonitorIndexes([mon(0, 0, 1920, 1080)], -1, false), []);
});

test('hasDefinedEdge: side-by-side monitors expose only their outside side edges', () => {
  const monitors = [mon(0, 0, 1920, 1080), mon(1920, 0, 1920, 1080)];
  assert.equal(hasDefinedEdge(monitors, 0, 'left'), true);
  assert.equal(hasDefinedEdge(monitors, 0, 'right'), false);
  assert.equal(hasDefinedEdge(monitors, 1, 'left'), false);
  assert.equal(hasDefinedEdge(monitors, 1, 'right'), true);
});

test('hasDefinedEdge: a monitor beyond a gap still occupies that edge', () => {
  const horizontalGap = [mon(0, 0, 1920, 1080), mon(2020, 0, 1920, 1080)];
  assert.equal(hasDefinedEdge(horizontalGap, 0, 'right'), false);
  assert.equal(hasDefinedEdge(horizontalGap, 1, 'left'), false);

  const verticalGap = [mon(0, 0, 1920, 1080), mon(0, 1180, 1920, 1080)];
  assert.equal(hasDefinedEdge(verticalGap, 0, 'bottom'), false);
});

test('getDockMonitorIndexes: all-monitors mode excludes inaccessible side edges', () => {
  const monitors = [mon(0, 0, 1920, 1080), mon(1920, 0, 1920, 1080)];
  assert.deepEqual(getDockMonitorIndexes(monitors, 0, true, 'left'), [0]);
  assert.deepEqual(getDockMonitorIndexes(monitors, 0, true, 'right'), [1]);
});
