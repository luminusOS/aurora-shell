/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import Gio from 'gi://Gio';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {
  waitForCondition,
  waitForTiming,
  EXTENSION_UUID,
  getAuroraModule,
  waitForExtension,
} from '../../support/testUtils.js';

export var METRICS = {};

const ITEM_COUNT = 24;

export function init() {
  Scripting.defineScriptEvent('extensionEnabled', 'Extension enabled');
  Scripting.defineScriptEvent('stressTestPassed', 'Stress test completed without crash');
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);
  Scripting.scriptEvent('extensionEnabled');

  const trayIconsModule = getAuroraModule('tray-icons');

  const trayContainer = trayIconsModule._container;
  if (!trayContainer) throw new Error('Tray container not found');

  console.log('[aurora-tray-stability] Starting stress test...');

  for (let i = 0; i < ITEM_COUNT; i++) {
    const id = `fake-item-${i}`;
    console.log(`[aurora-tray-stability] Adding item ${id}`);
    trayContainer.addItem({
      id,
      icon: 'face-smile-symbolic',
      status: 'Active',
      activate: () => {},
      destroy: () => {},
    });
  }

  await Scripting.waitLeisure();

  const availableClipWidth = trayContainer._availableClipWidth(true);
  const reservedWidth = trayContainer._clipArea.reservedWidth;
  if (availableClipWidth !== null && reservedWidth > availableClipWidth)
    throw new Error(
      `Tray reserved width ${reservedWidth} exceeded available clip width ${availableClipWidth}`,
    );

  trayContainer._state.collapsed = false;
  trayContainer._syncLayout(false);
  if (trayContainer._maxExpandedScroll() <= 0)
    throw new Error('Expanded tray did not report scrollable overflow');

  trayContainer._scrollByItems(-1);
  if (trayContainer._state.scrollOffset <= 0)
    throw new Error('Expanded tray scroll did not advance through hidden icons');

  const clipArea = trayContainer._clipArea;
  const animationCompleted = new Gio.SimpleAction({ name: 'viewport-animation-completed' });
  const originalAnimateViewport = clipArea.animateViewport;
  clipArea.animateViewport = function (...args) {
    const onComplete = args[6];
    args[6] = () => {
      onComplete();
      animationCompleted.activate(null);
    };
    return originalAnimateViewport.apply(this, args);
  };
  try {
    for (let i = 0; i < 5; i++) {
      console.log(`[aurora-tray-stability] Toggling collapse state (iteration ${i + 1})`);
      const state = trayContainer._state;
      state.collapsed = !state.collapsed;
      trayContainer._syncLayout(true);
      await waitForCondition({
        evaluate: () => !clipArea._viewportTimeout.active,
        signals: [[animationCompleted, 'activate']],
        description: 'TrayClipArea viewport animation to finish before the next collapse toggle',
      });
    }
  } finally {
    clipArea.animateViewport = originalAnimateViewport;
  }

  console.log('[aurora-tray-stability] Removing items during animation...');
  const state = trayContainer._state;
  state.collapsed = false;
  trayContainer._syncLayout(true);

  await waitForTiming(
    200,
    'remove icons while the TrayClipArea viewport animation is intentionally in progress',
  );
  for (let i = 0; i < ITEM_COUNT; i++) {
    trayContainer.removeItem(`fake-item-${i}`);
  }

  Scripting.scriptEvent('stressTestPassed');
}

let _extensionEnabled = false;
let _stressTestPassed = false;

export function script_extensionEnabled() {
  _extensionEnabled = true;
}
export function script_stressTestPassed() {
  _stressTestPassed = true;
}

export function finish() {
  if (!_extensionEnabled) throw new Error('Extension was not found or not enabled');
  if (!_stressTestPassed) throw new Error('Stress test did not complete');
}
