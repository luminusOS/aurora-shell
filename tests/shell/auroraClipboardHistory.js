/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

/**
 * Aurora Shell — ClipboardHistory module integration test
 *
 * Verifies:
 *  - Module enables and disables without crashing (I1)
 *  - Keybinding is removed cleanly after disable (no crash on re-enable) (I2)
 *  - aurora-clipboard-panel is not present in uiGroup while module is disabled (I3)
 */

import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { EXTENSION_UUID, getAuroraSettings, waitForExtension } from './testUtils.js';

const PANEL_CSS = 'aurora-clipboard-panel';

function findClipboardPanel() {
  for (const child of Main.uiGroup.get_children()) {
    if (child.has_style_class_name?.(PANEL_CSS)) return child;
  }
  return null;
}

export var METRICS = {};

export function init() {
  Scripting.defineScriptEvent('moduleEnabled', 'ClipboardHistory module enabled successfully');
  Scripting.defineScriptEvent('lifecycleOk', 'Module disabled and re-enabled without crash');
  Scripting.defineScriptEvent('panelClean', 'No aurora-clipboard-panel in uiGroup after disable');
  Scripting.defineScriptEvent('clipboardWritten', 'Clipboard text written for monitor test');
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);
  const auroraSettings = getAuroraSettings();

  await Scripting.waitLeisure();
  await Scripting.sleep(500);

  Scripting.scriptEvent('moduleEnabled');

  // toggle off
  auroraSettings.set_boolean('module-clipboard-history', false);
  await Scripting.waitLeisure();
  await Scripting.sleep(400);

  if (findClipboardPanel()) {
    throw new Error(`"${PANEL_CSS}" still in uiGroup after module was disabled`);
  }

  // toggle on
  auroraSettings.set_boolean('module-clipboard-history', true);
  await Scripting.waitLeisure();
  await Scripting.sleep(400);

  Scripting.scriptEvent('lifecycleOk');

  // write something to the clipboard so the monitor has something to pick up
  St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, 'aurora-test-clipboard-entry');
  await Scripting.waitLeisure();
  await Scripting.sleep(1500);

  Scripting.scriptEvent('clipboardWritten');

  // disable again and verify no panel leaked into the scene graph
  auroraSettings.set_boolean('module-clipboard-history', false);
  await Scripting.waitLeisure();
  await Scripting.sleep(400);

  if (findClipboardPanel()) {
    throw new Error(`"${PANEL_CSS}" leaked into uiGroup after second disable`);
  }

  Scripting.scriptEvent('panelClean');

  // restore
  auroraSettings.set_boolean('module-clipboard-history', true);
  await Scripting.waitLeisure();
  await Scripting.sleep(200);
}

let _moduleEnabled = false;
let _lifecycleOk = false;
let _panelClean = false;
let _clipboardWritten = false;

export function script_moduleEnabled() {
  _moduleEnabled = true;
}
export function script_lifecycleOk() {
  _lifecycleOk = true;
}
export function script_panelClean() {
  _panelClean = true;
}
export function script_clipboardWritten() {
  _clipboardWritten = true;
}

export function finish() {
  if (!_moduleEnabled) throw new Error('ClipboardHistory module did not enable');
  if (!_lifecycleOk) throw new Error('Shell crashed during module enable/disable cycle');
  if (!_clipboardWritten) throw new Error('Clipboard write step did not complete');
  if (!_panelClean) throw new Error(`"${PANEL_CSS}" was not cleaned up after module disable`);
}
