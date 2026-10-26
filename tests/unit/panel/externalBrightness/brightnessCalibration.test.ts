import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseBrightnessRange } from '~/panel/externalBrightness/brightnessCalibration.ts';
import {
  sliderToVcpValue,
  vcpToSliderValue,
  BrightnessWriteQueue,
} from '~/panel/externalBrightness/brightnessWrites.ts';

test('manual ranges accept raw integer endpoints, not percentages or brand assumptions', () => {
  assert.deepEqual(parseBrightnessRange('5', '35'), { min: 5, max: 35 });
  assert.deepEqual(parseBrightnessRange('0', '255'), { min: 0, max: 255 });
  for (const [min, max] of [
    ['', '35'],
    ['-1', '35'],
    ['1.5', '35'],
    ['35', '35'],
    ['40', '35'],
    ['0', '65536'],
    ['NaN', '100'],
  ])
    assert.equal(parseBrightnessRange(min!, max!), null);
});

test('manual ranges map both ways and clamp without changing raw observations', () => {
  assert.equal(sliderToVcpValue(0, 35, 5), 5);
  assert.equal(sliderToVcpValue(0.5, 35, 5), 20);
  assert.equal(sliderToVcpValue(1, 35, 5), 35);
  assert.equal(sliderToVcpValue(2, 35, 5), 35);
  assert.equal(sliderToVcpValue(-1, 35, 5), 5);
  assert.equal(vcpToSliderValue(20, 35, 5), 0.5);
  assert.equal(vcpToSliderValue(100, 35, 5), 1);
  assert.equal(vcpToSliderValue(0, 35, 5), 0);
});

test('changing calibration discards queued values without forgetting an in-flight write', () => {
  const queue = new BrightnessWriteQueue(10);
  assert.equal(queue.request(60), 60);
  queue.request(90);
  queue.discardPending();
  assert.equal(queue.busy, true);
  assert.equal(queue.finishWrite(true), null);
  assert.equal(queue.request(20), 20);
});
