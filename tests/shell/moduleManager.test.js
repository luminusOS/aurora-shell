/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { EXTENSION_UUID, getAuroraSettings, waitForExtension } from './support/testUtils.js';

// All registered module settings keys (mirrors registry.ts)
const MODULE_SETTINGS_KEYS = [
  'module-no-overview',
  'module-pip-on-top',
  'module-theme-changer',
  'module-dock',
  'module-volume-mixer',
  'module-xwayland-indicator',
  'module-privacy',
  'module-icon-weave',
  'module-app-search-tooltip',
  'module-auto-theme-switcher',
  'module-bluetooth-menu',
  'module-weather-clock',
  'module-meeting-clock',
];

export var METRICS = {};

export function init() {
  Scripting.defineScriptEvent('togglesComplete', 'All module toggles completed without error');
}

export async function run() {
  // Resolve settings via the extension's own dir so the schema is found even
  // in an isolated test environment where system schemas are not compiled.
  await waitForExtension(EXTENSION_UUID);

  const settings = getAuroraSettings();

  const original = {};
  for (const key of MODULE_SETTINGS_KEYS) original[key] = settings.get_boolean(key);

  console.debug('[aurora-test] Starting module toggle test');

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

  for (const key of MODULE_SETTINGS_KEYS) settings.set_boolean(key, original[key]);

  await Scripting.waitLeisure();

  if (!Main.panel.visible) throw new Error('Top panel is not visible after module toggles');

  Scripting.scriptEvent('togglesComplete');
  await Scripting.sleep(300);
}

let _togglesComplete = false;

export function script_togglesComplete() {
  _togglesComplete = true;
}

export function finish() {
  if (!_togglesComplete)
    throw new Error(
      'Module toggle test did not complete; the shell may have crashed during the enable/disable cycle',
    );
}
