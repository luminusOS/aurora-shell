/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

/**
 * Aurora Shell — Bluetooth Menu smoke test
 *
 * Verifies that:
 *  - The extension is enabled
 *  - BluetoothToggle receives the aurora-bt-menu CSS class
 *  - No JS errors are thrown during enable
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

const EXTENSION_UUID = 'aurora-shell@luminusos.github.io';
const EXTENSION_STATE_ENABLED = 1;

export var METRICS = {};

/** @returns {void} */
export function init() {
  Scripting.defineScriptEvent('extensionEnabled', 'Aurora Shell extension is enabled');
  Scripting.defineScriptEvent('btToggleFound', 'BluetoothToggle found in quick settings');
  Scripting.defineScriptEvent('cssClassApplied', 'aurora-bt-menu CSS class applied to BT panel');
}

/** @returns {Promise<void>} */
export async function run() {
  const ext = Main.extensionManager.lookup(EXTENSION_UUID);
  if (!ext)
    throw new Error(`Extension ${EXTENSION_UUID} not found in ExtensionManager`);

  if (ext.state !== EXTENSION_STATE_ENABLED)
    throw new Error(`Extension state is ${ext.state} (expected ${EXTENSION_STATE_ENABLED} = ENABLED)`);

  Scripting.scriptEvent('extensionEnabled');

  await Scripting.waitLeisure();

  const grid = Main.panel.statusArea.quickSettings?.menu?._grid;
  if (!grid)
    throw new Error('Quick settings grid not found');

  const toggle = grid.get_children().find(c => c.constructor.name === 'BluetoothToggle');
  if (!toggle)
    throw new Error('BluetoothToggle not found in quick settings grid');

  Scripting.scriptEvent('btToggleFound');

  const hasClass = toggle.menu.actor.has_style_class_name('aurora-bt-menu');
  if (!hasClass)
    throw new Error('aurora-bt-menu CSS class not applied to BluetoothToggle menu actor');

  Scripting.scriptEvent('cssClassApplied');
}

let _extensionEnabled = false;
let _btToggleFound = false;
let _cssClassApplied = false;

/** @returns {void} */
export function script_extensionEnabled() { _extensionEnabled = true; }

/** @returns {void} */
export function script_btToggleFound() { _btToggleFound = true; }

/** @returns {void} */
export function script_cssClassApplied() { _cssClassApplied = true; }

/** @returns {void} */
export function finish() {
  if (!_extensionEnabled)
    throw new Error('Aurora Shell extension was not found or not enabled');

  if (!_btToggleFound)
    throw new Error('BluetoothToggle not found — bluetooth module may not be wired up');

  if (!_cssClassApplied)
    throw new Error('aurora-bt-menu CSS class missing — BluetoothMenu module did not attach');
}
