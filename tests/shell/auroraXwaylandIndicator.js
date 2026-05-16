/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

/**
 * Aurora Shell — XwaylandIndicator module smoke test
 *
 * Verifies that:
 *  - enable() and disable() complete without crashing (I17)
 *
 * Verifying the indicator icon for XWayland windows requires an actual
 * XWayland session and cannot be tested headlessly.
 *
 * Run with:
 *   gnome-shell-test-tool --headless \
 *     --extension dist/target/aurora-shell@luminusos.github.io.shell-extension.zip \
 *     tests/shell/auroraXwaylandIndicator.js
 */

import Gio from 'gi://Gio';
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
  Scripting.defineScriptEvent('lifecycleOk', 'XwaylandIndicator enable/disable completed without crash');
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
  await Scripting.sleep(200);

  auroraSettings.set_boolean('module-xwayland-indicator', false);
  await Scripting.waitLeisure();
  await Scripting.sleep(200);

  auroraSettings.set_boolean('module-xwayland-indicator', true);
  await Scripting.waitLeisure();
  await Scripting.sleep(200);

  Scripting.scriptEvent('lifecycleOk');
}

let _lifecycleOk = false;

/** @returns {void} */
export function script_lifecycleOk() { _lifecycleOk = true; }

/** @returns {void} */
export function finish() {
  if (!_lifecycleOk)
    throw new Error('XwaylandIndicator enable/disable cycle crashed the shell');
}
