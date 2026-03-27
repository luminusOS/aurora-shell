/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

/**
 * Aurora Shell — Basic smoke test
 *
 * Verifies that:
 *  - The extension is found and enabled by ExtensionManager
 *  - The top panel is still visible (extension didn't break it)
 *  - The overview can be opened and closed normally
 *
 * Run with:
 *   gnome-shell-test-tool --headless \
 *     --extension dist/target/aurora-shell@luminusos.github.io.zip \
 *     tests/shell/auroraBasic.js
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

const EXTENSION_UUID = 'aurora-shell@luminusos.github.io';

// ExtensionState.ENABLED == 1 (from GNOME Shell internals)
const EXTENSION_STATE_ENABLED = 1;

export var METRICS = {};

/** @returns {void} */
export function init() {
  Scripting.defineScriptEvent('extensionEnabled', 'Aurora Shell extension is enabled');
  Scripting.defineScriptEvent('overviewShown', 'Overview shown successfully');
  Scripting.defineScriptEvent('overviewHidden', 'Overview hidden successfully');
}

/** @returns {Promise<void>} */
export async function run() {
  // --- 1. Verify the extension is loaded and enabled ---
  const ext = Main.extensionManager.lookup(EXTENSION_UUID);
  if (!ext)
    throw new Error(`Extension ${EXTENSION_UUID} not found in ExtensionManager`);

  if (ext.state !== EXTENSION_STATE_ENABLED)
    throw new Error(`Extension state is ${ext.state} (expected ${EXTENSION_STATE_ENABLED} = ENABLED)`);

  Scripting.scriptEvent('extensionEnabled');
  await Scripting.sleep(500);

  // --- 2. Verify the top panel is intact ---
  if (!Main.panel.visible)
    throw new Error('Top panel is not visible — extension may have broken it');

  // --- 3. Verify the overview still works ---
  Main.overview.connect('shown', () => Scripting.scriptEvent('overviewShown'));
  Main.overview.connect('hidden', () => Scripting.scriptEvent('overviewHidden'));

  console.debug('[aurora-test] Showing overview');
  Main.overview.show();
  await Scripting.waitLeisure();
  await Scripting.sleep(300);

  console.debug('[aurora-test] Hiding overview');
  Main.overview.hide();
  await Scripting.waitLeisure();
  await Scripting.sleep(300);
}

let _extensionEnabled = false;
let _overviewShown = false;
let _overviewHidden = false;

/** @returns {void} */
export function script_extensionEnabled() {
  _extensionEnabled = true;
}

/** @returns {void} */
export function script_overviewShown() {
  _overviewShown = true;
}

/** @returns {void} */
export function script_overviewHidden() {
  _overviewHidden = true;
}

/** @returns {void} */
export function finish() {
  if (!_extensionEnabled)
    throw new Error('Aurora Shell extension was not found or not enabled');

  if (!_overviewShown)
    throw new Error('Overview failed to show — dock or another module may have broken it');

  if (!_overviewHidden)
    throw new Error('Overview failed to hide');
}
