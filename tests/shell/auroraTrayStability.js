/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

/**
 * Aurora Shell — Tray Stability test
 *
 * Stress tests the tray by adding/removing fake items and toggling state.
 * Verifies that the custom layout logic doesn't crash the shell.
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { EXTENSION_UUID, waitForExtension } from './testUtils.js';

export var METRICS = {};

export function init() {
  Scripting.defineScriptEvent('extensionEnabled', 'Extension enabled');
  Scripting.defineScriptEvent('stressTestPassed', 'Stress test completed without crash');
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);
  Scripting.scriptEvent('extensionEnabled');
  await Scripting.sleep(500);

  const extension = Main.extensionManager.lookup(EXTENSION_UUID);
  if (!extension || !extension.stateObj)
    throw new Error('Extension state object not found');

  const trayIconsModule = extension.stateObj._modules.get('tray-icons');
  if (!trayIconsModule)
    throw new Error('Tray icons module not found');

  const trayContainer = trayIconsModule._container;
  if (!trayContainer)
    throw new Error('Tray container not found');

  console.log('[aurora-tray-stability] Starting stress test...');

  // --- 1. Add multiple fake items ---
  for (let i = 0; i < 10; i++) {
    const id = `fake-item-${i}`;
    console.log(`[aurora-tray-stability] Adding item ${id}`);
    trayContainer.addItem({
      id,
      icon: 'face-smile-symbolic',
      status: 'Active',
      activate: () => {},
      destroy: () => {}
    });
    await Scripting.sleep(50);
  }

  await Scripting.sleep(500);

  // --- 2. Toggle collapse state multiple times ---
  for (let i = 0; i < 5; i++) {
    console.log(`[aurora-tray-stability] Toggling collapse state (iteration ${i + 1})`);
    // Simulate chevron click logic
    const state = trayContainer._state;
    state.collapsed = !state.collapsed;
    trayContainer._syncLayout(true);
    await Scripting.sleep(1000); // Wait for animation
  }

  // --- 3. Remove items while animating ---
  console.log('[aurora-tray-stability] Removing items during animation...');
  const state = trayContainer._state;
  state.collapsed = false;
  trayContainer._syncLayout(true);
  
  await Scripting.sleep(200);
  for (let i = 0; i < 10; i++) {
    trayContainer.removeItem(`fake-item-${i}`);
    await Scripting.sleep(100);
  }

  await Scripting.sleep(1000);
  Scripting.scriptEvent('stressTestPassed');
}

let _extensionEnabled = false;
let _stressTestPassed = false;

export function script_extensionEnabled() { _extensionEnabled = true; }
export function script_stressTestPassed() { _stressTestPassed = true; }

export function finish() {
  if (!_extensionEnabled)
    throw new Error('Extension was not found or not enabled');
  if (!_stressTestPassed)
    throw new Error('Stress test did not complete');
}
