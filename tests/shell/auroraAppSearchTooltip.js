/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

/**
 * Aurora Shell — AppSearchTooltip module integration test
 *
 * Verifies that:
 *  - No "app-search-tooltip" label exists in Main.uiGroup before any hover
 *    event occurs (I6) — the tooltip is created lazily, not at startup
 *  - enable() and disable() complete without crashing
 *
 * Actually triggering a hover event on a search icon is not reliable in a
 * headless environment; the tooltip appearance is therefore not tested here.
 *
 * Run with:
 *   gnome-shell-test-tool --headless \
 *     --extension dist/target/aurora-shell@luminusos.github.io.shell-extension.zip \
 *     tests/shell/auroraAppSearchTooltip.js
 */

import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

const SCHEMA_ID = 'org.gnome.shell.extensions.aurora-shell';
const EXTENSION_UUID = 'aurora-shell@luminusos.github.io';
const EXTENSION_STATE_ENABLED = 1;
const TOOLTIP_CSS_CLASS = 'app-search-tooltip';

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

function tooltipExistsInUiGroup() {
  const uiGroup = Main.uiGroup;
  const n = uiGroup.get_n_children();
  for (let i = 0; i < n; i++) {
    const child = uiGroup.get_child_at_index(i);
    if (child?.has_style_class_name?.(TOOLTIP_CSS_CLASS)) return true;
  }
  return false;
}

export var METRICS = {};

/** @returns {void} */
export function init() {
  Scripting.defineScriptEvent('noStrayTooltip', 'No app-search-tooltip label at startup');
  Scripting.defineScriptEvent('lifecycleOk', 'enable/disable cycle completed without crash');
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

  // I6 — no tooltip label should exist before any hover
  if (tooltipExistsInUiGroup())
    throw new Error(`"${TOOLTIP_CSS_CLASS}" label found in Main.uiGroup at startup — should only appear on hover`);

  Scripting.scriptEvent('noStrayTooltip');

  // lifecycle
  auroraSettings.set_boolean('module-app-search-tooltip', false);
  await Scripting.waitLeisure();
  await Scripting.sleep(200);

  auroraSettings.set_boolean('module-app-search-tooltip', true);
  await Scripting.waitLeisure();
  await Scripting.sleep(200);

  // tooltip must still not exist after re-enable
  if (tooltipExistsInUiGroup())
    throw new Error(`"${TOOLTIP_CSS_CLASS}" label appeared after re-enable without any hover event`);

  Scripting.scriptEvent('lifecycleOk');
}

let _noStrayTooltip = false;
let _lifecycleOk = false;

/** @returns {void} */
export function script_noStrayTooltip() { _noStrayTooltip = true; }

/** @returns {void} */
export function script_lifecycleOk() { _lifecycleOk = true; }

/** @returns {void} */
export function finish() {
  if (!_noStrayTooltip)
    throw new Error('A stray app-search-tooltip label was found in Main.uiGroup at startup');
  if (!_lifecycleOk)
    throw new Error('AppSearchTooltip enable/disable cycle crashed the shell');
}
