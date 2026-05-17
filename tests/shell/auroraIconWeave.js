/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

/**
 * Aurora Shell — IconWeave module integration test
 *
 * Verifies that:
 *  - enable() and disable() complete without crashing (I19)
 *  - Shell.WindowTracker.prototype.get_window_app is patched while enabled
 *    and restored to its original after disable (I20)
 *
 * Run with:
 *   gnome-shell-test-tool --headless \
 *     --extension dist/target/aurora-shell@luminusos.github.io.shell-extension.zip \
 *     tests/shell/auroraIconWeave.js
 */

import Shell from 'gi://Shell';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { EXTENSION_UUID, getAuroraSettings, waitForExtension } from './testUtils.js';

export var METRICS = {};

/** @returns {void} */
export function init() {
  Scripting.defineScriptEvent('prototypePatched', 'WindowTracker.get_window_app is patched while enabled');
  Scripting.defineScriptEvent('prototypeRestored', 'WindowTracker.get_window_app restored after disable');
}

/** @returns {Promise<void>} */
export async function run() {
  await waitForExtension(EXTENSION_UUID);

  const auroraSettings = getAuroraSettings();

  await Scripting.waitLeisure();
  await Scripting.sleep(300);

  // I19/I20 — capture patched function while module is enabled
  const patchedFn = Shell.WindowTracker.prototype.get_window_app;

  // Disable icon-weave; prototype must be restored
  auroraSettings.set_boolean('module-icon-weave', false);
  await Scripting.waitLeisure();
  await Scripting.sleep(300);

  const restoredFn = Shell.WindowTracker.prototype.get_window_app;

  if (patchedFn === restoredFn) {
    auroraSettings.set_boolean('module-icon-weave', true);
    throw new Error(
      'Shell.WindowTracker.prototype.get_window_app was NOT restored after icon-weave disable — ' +
      'the patched function is still in place'
    );
  }

  Scripting.scriptEvent('prototypePatched');
  Scripting.scriptEvent('prototypeRestored');

  // Re-enable and verify it patches again (I19 — no crash on re-enable)
  auroraSettings.set_boolean('module-icon-weave', true);
  await Scripting.waitLeisure();
  await Scripting.sleep(200);

  const repatchedFn = Shell.WindowTracker.prototype.get_window_app;
  if (repatchedFn === restoredFn)
    throw new Error('Shell.WindowTracker.prototype.get_window_app was not re-patched after re-enable');
}

let _prototypePatched = false;
let _prototypeRestored = false;

/** @returns {void} */
export function script_prototypePatched() { _prototypePatched = true; }

/** @returns {void} */
export function script_prototypeRestored() { _prototypeRestored = true; }

/** @returns {void} */
export function finish() {
  if (!_prototypePatched)
    throw new Error('IconWeave did not patch Shell.WindowTracker.prototype.get_window_app on enable');
  if (!_prototypeRestored)
    throw new Error('IconWeave did not restore Shell.WindowTracker.prototype.get_window_app on disable');
}
