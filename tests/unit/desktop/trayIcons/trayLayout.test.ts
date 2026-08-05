import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateTrayLayout,
  getEffectiveTrayLimit,
  visibleTrayIndexes,
} from '~/desktop/trayIcons/trayLayout.ts';

test('tray layout computes collapsed viewport, overflow and maximum scroll', () => {
  const layout = calculateTrayLayout({
    count: 8,
    itemWidth: 30,
    gap: 3,
    configuredLimit: 4,
    availableWidth: null,
    collapsed: true,
  });
  assert.equal(layout.fullWidth, 261);
  assert.equal(layout.viewportWidth, 129);
  assert.equal(layout.maxScroll, 132);
  assert.equal(layout.hasOverflow, true);
});

test('tray layout constrains effective limit and visible indexes to available width', () => {
  assert.equal(getEffectiveTrayLimit(8, 30, 3, 96), 3);
  assert.deepEqual(visibleTrayIndexes(8, 3, 165, 30, 3), { start: 5, end: 8 });
});

test('expanded tray uses the reserved viewport and resets clip start', () => {
  const layout = calculateTrayLayout({
    count: 5,
    itemWidth: 30,
    gap: 3,
    configuredLimit: 3,
    availableWidth: 120,
    collapsed: false,
  });
  assert.equal(layout.reservedWidth, 120);
  assert.equal(layout.viewportWidth, 120);
  assert.equal(layout.clipStart, 0);
});
