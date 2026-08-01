import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectDashWindows, shouldHideDash } from '../../src/shared/ui/dashState.ts';

test('dash visibility hides only when no owner is holding it open', () => {
  const idle = {
    target: 'shown' as const,
    blocked: false,
    hovered: false,
    menuOpen: false,
    dragHeld: false,
  };
  assert.equal(shouldHideDash(idle), true);
  assert.equal(shouldHideDash({ ...idle, hovered: true }), false);
  assert.equal(shouldHideDash({ ...idle, dragHeld: true }), false);
});

test('dash window selection filters workspace, monitor and taskbar entries', () => {
  const windows = [
    { monitor: 0, workspace: 1 },
    { monitor: 1, workspace: 1 },
    { monitor: 0, workspace: 0, sticky: true },
    { monitor: 0, workspace: 1, skipTaskbar: true },
  ];
  assert.deepEqual(selectDashWindows(windows, 0, 1, true), [windows[0], windows[2]]);
  assert.deepEqual(selectDashWindows(windows, 0, 1, false), [windows[0], windows[1], windows[2]]);
});
