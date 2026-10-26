import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BrightnessWriteQueue,
  sliderToVcpValue,
  vcpToSliderValue,
} from '~/panel/externalBrightness/brightnessWrites.ts';

test('VCP and slider values convert within their ranges', () => {
  assert.equal(vcpToSliderValue(50, 100), 0.5);
  assert.equal(vcpToSliderValue(150, 100), 1);
  assert.equal(vcpToSliderValue(10, 0), 0);

  assert.equal(sliderToVcpValue(0.5, 100), 50);
  assert.equal(sliderToVcpValue(0.334, 100), 33);
  assert.equal(sliderToVcpValue(1.4, 100), 100);
  assert.equal(sliderToVcpValue(-0.2, 100), 0);
  assert.equal(sliderToVcpValue(0.5, 0), 0);
});

test('BrightnessWriteQueue writes one value at a time and keeps only the latest request', () => {
  const queue = new BrightnessWriteQueue(40);

  assert.equal(queue.request(50), 50);
  assert.equal(queue.request(55), null);
  assert.equal(queue.request(60), null);
  assert.equal(queue.request(70), null);

  assert.equal(queue.finishWrite(true), 70);
  assert.equal(queue.finishWrite(true), null);
});

test('BrightnessWriteQueue reports busy while a write runs or waits', () => {
  const queue = new BrightnessWriteQueue(40);
  assert.equal(queue.busy, false);

  queue.request(50);
  assert.equal(queue.busy, true);
  queue.request(60);
  assert.equal(queue.finishWrite(true), 60);
  assert.equal(queue.busy, true);
  assert.equal(queue.finishWrite(true), null);
  assert.equal(queue.busy, false);
});

test('BrightnessWriteQueue skips values that are already applied', () => {
  const queue = new BrightnessWriteQueue(40);

  assert.equal(queue.request(40), null);
  assert.equal(queue.request(41), 41);
  assert.equal(queue.finishWrite(true), null);
  assert.equal(queue.request(41), null);
});

test('BrightnessWriteQueue skips a pending value equal to the one just written', () => {
  const queue = new BrightnessWriteQueue();

  assert.equal(queue.request(30), 30);
  assert.equal(queue.request(30), null);
  assert.equal(queue.finishWrite(true), null);
});

test('BrightnessWriteQueue retries a value after a failed write', () => {
  const queue = new BrightnessWriteQueue(40);

  assert.equal(queue.request(50), 50);
  assert.equal(queue.finishWrite(false), null);
  assert.equal(queue.request(50), 50);
});

test('BrightnessWriteQueue does not rewrite a value applied by another client', () => {
  const queue = new BrightnessWriteQueue(40);

  queue.noteKnownValue(65);

  assert.equal(queue.request(65), null);
  assert.equal(queue.request(66), 66);
});

test('an observation overlapping a write cannot suppress a later request', () => {
  const queue = new BrightnessWriteQueue(40);
  assert.equal(queue.request(60), 60);
  queue.noteKnownValue(30);
  assert.equal(queue.finishWrite(true), null);
  assert.equal(queue.request(30), 30);
});
