// tests/unit/trayState.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTrayState,
  toggleCollapsed,
  applyScroll,
  addAttention,
  clearAttention,
} from '../../src/desktop/trayIcons/trayState.ts';
import type { TrayItem } from '../../src/desktop/trayIcons/trayState.ts';

test('createTrayState returns collapsed=true, offset=0, empty attention set', () => {
  const state = createTrayState();
  assert.strictEqual(state.collapsed, true);
  assert.strictEqual(state.scrollOffset, 0);
  assert.strictEqual(state.attentionIds.size, 0);
  assert.strictEqual(state.autoCollapseTimer, null);
});

test('toggleCollapsed flips collapsed', () => {
  const state = createTrayState();
  state.scrollOffset = 50;
  toggleCollapsed(state);
  assert.strictEqual(state.collapsed, false);
  // scrollOffset is managed by TrayContainer._syncLayout, not toggleCollapsed
  toggleCollapsed(state);
  assert.strictEqual(state.collapsed, true);
});

test('applyScroll clamps to [0, maxScroll]', () => {
  const state = createTrayState();
  applyScroll(state, 200, 100);
  assert.strictEqual(state.scrollOffset, 100);
  applyScroll(state, -300, 100);
  assert.strictEqual(state.scrollOffset, 0);
  applyScroll(state, 30, 100);
  assert.strictEqual(state.scrollOffset, 30);
});

test('applyScroll does nothing when maxScroll <= 0', () => {
  const state = createTrayState();
  applyScroll(state, 50, 0);
  assert.strictEqual(state.scrollOffset, 0);
  applyScroll(state, 50, -10);
  assert.strictEqual(state.scrollOffset, 0);
});

test('addAttention and clearAttention manage Set membership', () => {
  const state = createTrayState();
  addAttention(state, 'item-1');
  assert.ok(state.attentionIds.has('item-1'));
  addAttention(state, 'item-2');
  assert.strictEqual(state.attentionIds.size, 2);
  clearAttention(state, 'item-1');
  assert.ok(!state.attentionIds.has('item-1'));
  assert.ok(state.attentionIds.has('item-2'));
});

test('TrayItem interface — optional fields are optional', () => {
  const item: TrayItem = {
    id: 'test-item',
    icon: 'application-symbolic',
    status: 'Active',
    activate() {},
    destroy() {},
  };
  // If TypeScript compiled this, optional fields (tooltip, secondaryActivate, showMenu) are optional
  assert.strictEqual(item.tooltip, undefined);
  assert.strictEqual(item.secondaryActivate, undefined);
  assert.strictEqual(item.showMenu, undefined);
  assert.strictEqual(item.status, 'Active');
});
