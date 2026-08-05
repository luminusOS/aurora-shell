import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  activeDisplayRoles,
  classifyDevice,
  classifyInputMode,
  classifyOrientation,
  createDeviceSnapshot,
  sameDeviceSnapshot,
  type InputPresence,
  type MonitorInput,
} from '~/device/runtime.ts';

const input = (values: Partial<InputPresence> = {}): InputPresence => ({
  touch: false,
  pointer: false,
  keyboard: false,
  ...values,
});

const monitor = (values: Partial<MonitorInput> = {}): MonitorInput => ({
  index: 0,
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  scale: 1,
  isBuiltin: true,
  ...values,
});

test('device runtime — orientation is based on logical dimensions', () => {
  assert.equal(classifyOrientation(1080, 1920), 'portrait');
  assert.equal(classifyOrientation(1920, 1080), 'landscape');
  assert.equal(classifyOrientation(800, 800), 'square');
  assert.equal(classifyOrientation(0, 800), 'unknown');
});

test('device runtime — input mode reports mixed devices honestly', () => {
  assert.equal(classifyInputMode(input({ touch: true })), 'touch');
  assert.equal(classifyInputMode(input({ pointer: true })), 'pointer');
  assert.equal(classifyInputMode(input({ keyboard: true })), 'keyboard');
  assert.equal(classifyInputMode(input({ touch: true, keyboard: true })), 'mixed');
  assert.equal(classifyInputMode(input()), 'unknown');
});

test('device runtime — classifies phone, tablet, laptop, desktop and unknown', () => {
  assert.equal(
    classifyDevice([monitor({ width: 412, height: 892 })], input({ touch: true })),
    'phone',
  );
  assert.equal(
    classifyDevice([monitor({ width: 800, height: 1280 })], input({ touch: true })),
    'tablet',
  );
  assert.equal(classifyDevice([monitor()], input({ keyboard: true })), 'laptop');
  assert.equal(
    classifyDevice([monitor({ isBuiltin: false })], input({ pointer: true })),
    'desktop',
  );
  assert.equal(classifyDevice([], input()), 'unknown');
});

test('device runtime — mixed phone topology assigns mobile internal and desktop external roles', () => {
  const snapshot = createDeviceSnapshot(
    [
      monitor({ width: 412, height: 892 }),
      monitor({ index: 1, x: 412, width: 1920, height: 1080, isBuiltin: false }),
    ],
    input({ touch: true, pointer: true, keyboard: true }),
    new Set(['touch']),
  );
  assert.equal(snapshot.deviceClass, 'phone');
  assert.deepEqual(
    snapshot.monitors.map((item) => item.role),
    ['mobile', 'desktop'],
  );
  assert.deepEqual([...activeDisplayRoles(snapshot)].sort(), ['desktop', 'mobile']);
});

test('device runtime — mobile-only topology retains desktop fallback for current modules', () => {
  const snapshot = createDeviceSnapshot(
    [monitor({ width: 412, height: 892 })],
    input({ touch: true }),
    new Set(['touch']),
  );
  assert.deepEqual([...activeDisplayRoles(snapshot)].sort(), ['desktop', 'mobile']);
  assert.deepEqual([...activeDisplayRoles(snapshot, false)], ['mobile']);
});

test('device runtime — equality detects meaningful topology changes only', () => {
  const first = createDeviceSnapshot([monitor()], input({ keyboard: true }), new Set());
  const same = createDeviceSnapshot([monitor()], input({ keyboard: true }), new Set());
  const changed = createDeviceSnapshot(
    [monitor({ width: 1080, height: 1920 })],
    input({ keyboard: true }),
    new Set(),
  );
  assert.equal(sameDeviceSnapshot(first, same), true);
  assert.equal(sameDeviceSnapshot(first, changed), false);
});
