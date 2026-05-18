/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

/**
 * Aurora Shell — Tray Icons integration test
 *
 * Verifies that:
 *  - The aurora-tray-icons indicator is added to panel.statusArea when module is enabled
 *  - The indicator is null in panel.statusArea after the module is disabled
 *
 * Run with:
 *   gnome-shell-test-tool --headless \
 *     --extension dist/target/aurora-shell@luminusos.github.io.shell-extension.zip \
 *     tests/shell/auroraTrayIcons.js
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { EXTENSION_UUID, getAuroraSettings, waitForExtension } from './testUtils.js';

const INDICATOR_ID = 'aurora-tray-icons';

export var METRICS = {};

/** @returns {void} */
export function init() {
  Scripting.defineScriptEvent('extensionEnabled', 'Extension enabled');
  Scripting.defineScriptEvent('trayFound', 'Tray indicator found in panel.statusArea');
  Scripting.defineScriptEvent('trayGone', 'Tray indicator absent after disable');
}

/** @returns {Promise<void>} */
export async function run() {
  await waitForExtension(EXTENSION_UUID);
  Scripting.scriptEvent('extensionEnabled');
  await Scripting.sleep(500);

  // Wait for the indicator to appear (allows time for hot-reload to settle)
  let trayIndicator = null;
  for (let i = 0; i < 30; i++) {
    trayIndicator = Main.panel.statusArea[INDICATOR_ID];
    if (trayIndicator) break;
    console.log(`[aurora-tray-test] Waiting for indicator... attempt ${i + 1}`);
    await Scripting.sleep(200);
  }

  // --- 1. Verify tray indicator exists in panel.statusArea ---
  if (!trayIndicator)
    throw new Error(`"${INDICATOR_ID}" indicator not found in panel.statusArea after retries`);

  Scripting.scriptEvent('trayFound');
  await Scripting.sleep(200);

  // --- 2. Disable the module and verify indicator is removed ---
  const settings = getAuroraSettings();
  settings.set_boolean('module-tray-icons', false);
  await Scripting.waitLeisure();
  await Scripting.sleep(500);

  const afterDisable = Main.panel.statusArea[INDICATOR_ID];
  if (afterDisable)
    throw new Error(`"${INDICATOR_ID}" still present in panel.statusArea after disable`);

  Scripting.scriptEvent('trayGone');

  // Re-enable for cleanup
  settings.set_boolean('module-tray-icons', true);
  await Scripting.waitLeisure();
  await Scripting.sleep(300);
}

let _extensionEnabled = false;
let _trayFound = false;
let _trayGone = false;

/** @returns {void} */
export function script_extensionEnabled() { _extensionEnabled = true; }

/** @returns {void} */
export function script_trayFound() { _trayFound = true; }

/** @returns {void} */
export function script_trayGone() { _trayGone = true; }

/** @returns {void} */
export function finish() {
  if (!_extensionEnabled)
    throw new Error('Extension was not found or not enabled');
  if (!_trayFound)
    throw new Error('Tray indicator was not found in panel.statusArea after enable');
  if (!_trayGone)
    throw new Error('Tray indicator was not removed from panel.statusArea after disable');
}
