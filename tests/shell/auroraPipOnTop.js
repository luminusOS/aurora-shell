/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

/**
 * Aurora Shell — PipOnTop module smoke test
 *
 * Verifies that:
 *  - enable() and disable() complete without crashing (I13)
 *
 * Full PiP behaviour (window stays above others) requires a real PiP window
 * and cannot be tested in a headless environment.
 *
 * Run with:
 *   gnome-shell-test-tool --headless \
 *     --extension dist/target/aurora-shell@luminusos.github.io.shell-extension.zip \
 *     tests/shell/auroraPipOnTop.js
 */

import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { EXTENSION_UUID, getAuroraSettings, waitForExtension } from './testUtils.js';

export var METRICS = {};

/** @returns {void} */
export function init() {
  Scripting.defineScriptEvent('lifecycleOk', 'PipOnTop enable/disable cycle completed without crash');
}

/** @returns {Promise<void>} */
export async function run() {
  await waitForExtension(EXTENSION_UUID);

  const auroraSettings = getAuroraSettings();

  await Scripting.waitLeisure();
  await Scripting.sleep(200);

  auroraSettings.set_boolean('module-pip-on-top', false);
  await Scripting.waitLeisure();
  await Scripting.sleep(200);

  auroraSettings.set_boolean('module-pip-on-top', true);
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
    throw new Error('PipOnTop enable/disable cycle crashed the shell');
}
