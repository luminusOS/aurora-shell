/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

/**
 * Aurora Shell — VolumeMixer module integration test
 *
 * Verifies that:
 *  - After enable, an actor with CSS class "aurora-volume-mixer" is attached
 *    inside the OutputStreamSlider's menu (I15)
 *  - After disable, the actor is destroyed and no longer present (I16)
 *
 * If no OutputStreamSlider is present in the headless environment, the test
 * skips the attachment assertions gracefully and only verifies the lifecycle.
 *
 * Run with:
 *   gnome-shell-test-tool --headless \
 *     --extension dist/target/aurora-shell@luminusos.github.io.shell-extension.zip \
 *     tests/shell/auroraVolumeMixer.js
 */

import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

const SCHEMA_ID = 'org.gnome.shell.extensions.aurora-shell';
const EXTENSION_UUID = 'aurora-shell@luminusos.github.io';
const EXTENSION_STATE_ENABLED = 1;
const MIXER_CSS_CLASS = 'aurora-volume-mixer';

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

function findOutputSlider() {
  const grid = Main.panel.statusArea.quickSettings?.menu?._grid;
  if (!grid) return null;
  return grid.get_children().find(c => c.constructor.name === 'OutputStreamSlider') ?? null;
}

function findMixerPanelInSlider(slider) {
  if (!slider?.menu?._getMenuItems) return null;
  for (const item of slider.menu._getMenuItems()) {
    const box = item.actor ?? item;
    const n = box.get_n_children?.() ?? 0;
    for (let i = 0; i < n; i++) {
      const child = box.get_child_at_index(i);
      if (child?.has_style_class_name?.(MIXER_CSS_CLASS)) return child;
    }
  }
  return null;
}

export var METRICS = {};

/** @returns {void} */
export function init() {
  Scripting.defineScriptEvent('mixerAttached', 'aurora-volume-mixer found in OutputStreamSlider menu');
  Scripting.defineScriptEvent('mixerRemoved', 'aurora-volume-mixer removed after disable');
  Scripting.defineScriptEvent('lifecycleOk', 'enable/disable cycle completed (no slider in environment)');
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
  await Scripting.sleep(500);

  const slider = findOutputSlider();

  if (!slider) {
    // Headless environment has no audio — verify lifecycle only
    console.debug('[aurora-test] No OutputStreamSlider in environment; testing lifecycle only');

    auroraSettings.set_boolean('module-volume-mixer', false);
    await Scripting.waitLeisure();
    await Scripting.sleep(300);

    auroraSettings.set_boolean('module-volume-mixer', true);
    await Scripting.waitLeisure();
    await Scripting.sleep(200);

    Scripting.scriptEvent('lifecycleOk');
    return;
  }

  // I15 — mixer panel must be attached inside the slider menu
  const panelAfterEnable = findMixerPanelInSlider(slider);
  if (!panelAfterEnable)
    throw new Error(`No actor with CSS class "${MIXER_CSS_CLASS}" found in OutputStreamSlider menu`);

  Scripting.scriptEvent('mixerAttached');

  // I16 — disable module; panel must be gone
  auroraSettings.set_boolean('module-volume-mixer', false);
  await Scripting.waitLeisure();
  await Scripting.sleep(400);

  const panelAfterDisable = findMixerPanelInSlider(slider);
  if (panelAfterDisable)
    throw new Error(`"${MIXER_CSS_CLASS}" actor still present after module was disabled`);

  Scripting.scriptEvent('mixerRemoved');

  // restore
  auroraSettings.set_boolean('module-volume-mixer', true);
  await Scripting.waitLeisure();
  await Scripting.sleep(200);
}

let _mixerAttached = false;
let _mixerRemoved = false;
let _lifecycleOk = false;

/** @returns {void} */
export function script_mixerAttached() { _mixerAttached = true; }

/** @returns {void} */
export function script_mixerRemoved() { _mixerRemoved = true; }

/** @returns {void} */
export function script_lifecycleOk() { _lifecycleOk = true; }

/** @returns {void} */
export function finish() {
  const sliderPresent = _mixerAttached || _mixerRemoved;
  if (!sliderPresent && !_lifecycleOk)
    throw new Error('VolumeMixer module test did not complete — shell may have crashed');
  if (_mixerAttached && !_mixerRemoved)
    throw new Error('aurora-volume-mixer actor was not removed after module was disabled');
}
