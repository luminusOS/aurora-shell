/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

/**
 * Aurora Shell — ThemeChanger module integration test
 *
 * Verifies that:
 *  - enable() and disable() complete without throwing (I11)
 *  - Setting color-scheme to "default" is intercepted and forced to
 *    "prefer-light" by the module (I12)
 *
 * Run with:
 *   gnome-shell-test-tool --headless \
 *     --extension dist/target/aurora-shell@luminusos.github.io.shell-extension.zip \
 *     tests/shell/auroraThemeChanger.js
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
  Scripting.defineScriptEvent('lifecycleOk', 'enable/disable cycle completed without crash');
  Scripting.defineScriptEvent('defaultIntercepted', '"default" color-scheme forced to prefer-light');
}

/** @returns {Promise<void>} */
export async function run() {
  const ext = Main.extensionManager.lookup(EXTENSION_UUID);
  if (!ext)
    throw new Error(`Extension ${EXTENSION_UUID} not found`);
  if (ext.state !== EXTENSION_STATE_ENABLED)
    throw new Error(`Extension state is ${ext.state}, expected ENABLED (1)`);

  const auroraSettings = getAuroraSettings(ext);
  const desktopSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });

  await Scripting.waitLeisure();
  await Scripting.sleep(200);

  // I11 — disable / re-enable without crash
  auroraSettings.set_boolean('module-theme-changer', false);
  await Scripting.waitLeisure();
  await Scripting.sleep(200);

  auroraSettings.set_boolean('module-theme-changer', true);
  await Scripting.waitLeisure();
  await Scripting.sleep(200);

  Scripting.scriptEvent('lifecycleOk');

  // I12 — set color-scheme to "default"; module must flip it to "prefer-light"
  const originalScheme = desktopSettings.get_string('color-scheme');

  desktopSettings.set_string('color-scheme', 'default');
  await Scripting.waitLeisure();
  await Scripting.sleep(300);

  const intercepted = desktopSettings.get_string('color-scheme');
  if (intercepted !== 'prefer-light') {
    // restore before throwing
    desktopSettings.set_string('color-scheme', originalScheme);
    throw new Error(
      `Expected ThemeChanger to intercept "default" and set "prefer-light", got "${intercepted}"`
    );
  }

  Scripting.scriptEvent('defaultIntercepted');

  // restore
  desktopSettings.set_string('color-scheme', originalScheme);
  await Scripting.waitLeisure();
}

let _lifecycleOk = false;
let _defaultIntercepted = false;

/** @returns {void} */
export function script_lifecycleOk() { _lifecycleOk = true; }

/** @returns {void} */
export function script_defaultIntercepted() { _defaultIntercepted = true; }

/** @returns {void} */
export function finish() {
  if (!_lifecycleOk)
    throw new Error('ThemeChanger enable/disable cycle crashed the shell');
  if (!_defaultIntercepted)
    throw new Error('ThemeChanger did not intercept "default" color-scheme and force it to prefer-light');
}
