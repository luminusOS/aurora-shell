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

import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

const SCHEMA_ID = 'org.gnome.shell.extensions.aurora-shell';
const EXTENSION_UUID = 'aurora-shell@luminusos.github.io';
const EXTENSION_STATE_ENABLED = 1;

function getAuroraSettings(ext) {
  const schemaDir = ext.dir.get_child('schemas').get_path();
  const source = Gio.SettingsSchemaSource.new_from_directory(
    schemaDir,
    Gio.SettingsSchemaSource.get_default(),
    false,
  );
  const schema = source.lookup(SCHEMA_ID, true);
  if (!schema)
    throw new Error(`Schema ${SCHEMA_ID} not found in ${schemaDir}`);
  return new Gio.Settings({ settings_schema: schema });
}

export var METRICS = {};

/** @returns {void} */
export function init() {
  Scripting.defineScriptEvent('prototypePatched', 'WindowTracker.get_window_app is patched while enabled');
  Scripting.defineScriptEvent('prototypeRestored', 'WindowTracker.get_window_app restored after disable');
}

/** @returns {Promise<void>} */
export async function run() {
  const ext = Main.extensionManager.lookup(EXTENSION_UUID);
  if (!ext)
    throw new Error(`Extension ${EXTENSION_UUID} not found`);
  if (ext.state !== EXTENSION_STATE_ENABLED)
    throw new Error(`Extension state is ${ext.state}, expected ENABLED (1)`);

  const auroraSettings = getAuroraSettings(ext);

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
