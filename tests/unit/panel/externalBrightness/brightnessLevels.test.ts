import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  combinedBrightness,
  shiftBrightness,
} from '~/panel/externalBrightness/brightnessLevels.ts';

function percent(level: number): number {
  return Math.round(level * 100);
}

test('the master shows the brightest display', () => {
  assert.equal(combinedBrightness([0.4, 0.8, 0.2]), 0.8);
  assert.equal(combinedBrightness([0, 0]), 0);
  assert.equal(combinedBrightness([]), 0);
});

test('moving the master adds the same difference to every display', () => {
  assert.equal(percent(shiftBrightness(0.3, 0.4, 0.45)), 35);
  assert.equal(percent(shiftBrightness(0.4, 0.4, 0.45)), 45);
  assert.equal(percent(shiftBrightness(0.3, 0.4, 0.35)), 25);
  assert.equal(percent(shiftBrightness(0.4, 0.4, 0.35)), 35);
});

test('a display stops at the limits instead of overshooting', () => {
  assert.equal(shiftBrightness(0.1, 0.4, 0.2), 0);
  assert.equal(percent(shiftBrightness(0.95, 0.9, 0.99)), 100);
});

test('the master at either end puts every display at that end', () => {
  assert.equal(shiftBrightness(0.3, 0.4, 1), 1);
  assert.equal(shiftBrightness(0.9, 0.4, 0), 0);
});
