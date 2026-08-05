/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { EXTENSION_UUID, waitForExtension } from '../../support/testUtils.js';

export var METRICS = {};

export function init() {
  Scripting.defineScriptEvent('extensionEnabled', 'Aurora Shell extension is enabled');
  Scripting.defineScriptEvent('btToggleFound', 'BluetoothToggle found in quick settings');
  Scripting.defineScriptEvent('cssClassApplied', 'aurora-bt-menu CSS class applied to BT panel');
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);

  Scripting.scriptEvent('extensionEnabled');

  await Scripting.waitLeisure();
  await Scripting.sleep(600);

  const grid = Main.panel.statusArea.quickSettings?.menu?._grid;
  if (!grid) throw new Error('Quick settings grid not found');

  const toggle = grid.get_children().find((c) => c.constructor.name === 'BluetoothToggle');
  if (!toggle) throw new Error('BluetoothToggle not found in quick settings grid');

  Scripting.scriptEvent('btToggleFound');

  const hasClass = toggle.menu.actor.has_style_class_name('aurora-bt-menu');
  if (!hasClass)
    throw new Error('aurora-bt-menu CSS class not applied to BluetoothToggle menu actor');

  Scripting.scriptEvent('cssClassApplied');
}

let _extensionEnabled = false;
let _btToggleFound = false;
let _cssClassApplied = false;

export function script_extensionEnabled() {
  _extensionEnabled = true;
}

export function script_btToggleFound() {
  _btToggleFound = true;
}

export function script_cssClassApplied() {
  _cssClassApplied = true;
}

export function finish() {
  if (!_extensionEnabled) throw new Error('Aurora Shell extension was not found or not enabled');

  if (!_btToggleFound)
    throw new Error('BluetoothToggle not found — bluetooth module may not be wired up');

  if (!_cssClassApplied)
    throw new Error('aurora-bt-menu CSS class missing — BluetoothMenu module did not attach');
}
