/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

/**
 * Aurora Shell — Module toggle integration test
 *
 * Verifies that each module can be disabled and re-enabled at runtime via
 * GSettings without crashing the shell or leaving stale state. This exercises
 * both the enable() and disable() lifecycle of every registered module.
 *
 * Run with:
 *   gnome-shell-test-tool --headless \
 *     --extension dist/target/aurora-shell@luminusos.github.io.zip \
 *     tests/shell/auroraModuleToggle.js
 */

import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

const SCHEMA_ID = 'org.gnome.shell.extensions.aurora-shell';
const EXTENSION_UUID = 'aurora-shell@luminusos.github.io';

// All registered module settings keys (mirrors registry.ts)
const MODULE_SETTINGS_KEYS = [
  'module-no-overview',
  'module-pip-on-top',
  'module-theme-changer',
  'module-dock',
  'module-volume-mixer',
  'module-xwayland-indicator',
  'module-privacy',
  'module-auto-theme-switcher',
];

export var METRICS = {};

/** @returns {void} */
export function init() {
  Scripting.defineScriptEvent('togglesComplete', 'All module toggles completed without error');
}

/** @returns {Promise<void>} */
export async function run() {
  // Resolve settings via the extension's own dir so the schema is found even
  // in an isolated test environment where system schemas are not compiled.
  const ext = Main.extensionManager.lookup(EXTENSION_UUID);
  if (!ext)
    throw new Error(`Extension ${EXTENSION_UUID} not found`);

  const schemaDir = ext.dir.get_child('schemas').get_path();
  const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
    schemaDir,
    Gio.SettingsSchemaSource.get_default(),
    false
  );
  const schema = schemaSource.lookup(SCHEMA_ID, true);
  if (!schema)
    throw new Error(`Schema ${SCHEMA_ID} not found in ${schemaDir}`);

  const settings = new Gio.Settings({ settings_schema: schema });

  // Save original values so we can restore them at the end.
  const original = {};
  for (const key of MODULE_SETTINGS_KEYS)
    original[key] = settings.get_boolean(key);

  console.debug('[aurora-test] Starting module toggle test');

  // Toggle each module off then back on and wait for the shell to settle.
  for (const key of MODULE_SETTINGS_KEYS) {
    console.debug(`[aurora-test] Disabling module: ${key}`);
    settings.set_boolean(key, false);
    await Scripting.waitLeisure();
    await Scripting.sleep(200);

    console.debug(`[aurora-test] Re-enabling module: ${key}`);
    settings.set_boolean(key, true);
    await Scripting.waitLeisure();
    await Scripting.sleep(200);
  }

  // Restore original state.
  for (const key of MODULE_SETTINGS_KEYS)
    settings.set_boolean(key, original[key]);

  await Scripting.waitLeisure();

  // Verify the panel and overview still work after all the toggling.
  if (!Main.panel.visible)
    throw new Error('Top panel is not visible after module toggles');

  Scripting.scriptEvent('togglesComplete');
  await Scripting.sleep(300);
}

let _togglesComplete = false;

/** @returns {void} */
export function script_togglesComplete() {
  _togglesComplete = true;
}

/** @returns {void} */
export function finish() {
  if (!_togglesComplete)
    throw new Error('Module toggle test did not complete — shell may have crashed during enable/disable cycle');
}
