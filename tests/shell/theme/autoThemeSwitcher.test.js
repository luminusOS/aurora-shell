/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import Gio from 'gi://Gio';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { EXTENSION_UUID, getAuroraSettings, waitForExtension } from '../support/testUtils.js';

function computeExpectedScheme(lightH, lightM, darkH, darkM) {
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  const light = lightH * 60 + lightM;
  const dark = darkH * 60 + darkM;
  const isLight =
    light < dark ? current >= light && current < dark : current >= light || current < dark;
  return isLight ? 'prefer-light' : 'prefer-dark';
}

export var METRICS = {};

export function init() {
  Scripting.defineScriptEvent(
    'schemeCorrect',
    'color-scheme matches expected value for current time',
  );
  Scripting.defineScriptEvent('settingsChangeOk', 'Settings key change did not crash the shell');
  Scripting.defineScriptEvent('disableOk', 'Module disabled without crash');
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);

  const auroraSettings = getAuroraSettings();
  const desktopSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });

  auroraSettings.set_boolean('module-auto-theme-switcher', true);
  await Scripting.waitLeisure();
  await Scripting.sleep(300);

  const lightH = auroraSettings.get_int('auto-theme-switcher-light-hours');
  const lightM = auroraSettings.get_int('auto-theme-switcher-light-minutes');
  const darkH = auroraSettings.get_int('auto-theme-switcher-dark-hours');
  const darkM = auroraSettings.get_int('auto-theme-switcher-dark-minutes');

  const expected = computeExpectedScheme(lightH, lightM, darkH, darkM);
  const actual = desktopSettings.get_string('color-scheme');

  if (actual !== expected) {
    throw new Error(
      `color-scheme is "${actual}", expected "${expected}" for current time ` +
        `(light=${lightH}:${String(lightM).padStart(2, '0')}, dark=${darkH}:${String(darkM).padStart(2, '0')})`,
    );
  }

  Scripting.scriptEvent('schemeCorrect');

  const originalDarkH = auroraSettings.get_int('auto-theme-switcher-dark-hours');
  auroraSettings.set_int('auto-theme-switcher-dark-hours', (originalDarkH + 1) % 24);
  await Scripting.waitLeisure();
  await Scripting.sleep(300);
  auroraSettings.set_int('auto-theme-switcher-dark-hours', originalDarkH);
  await Scripting.waitLeisure();

  Scripting.scriptEvent('settingsChangeOk');

  auroraSettings.set_boolean('module-auto-theme-switcher', false);
  await Scripting.waitLeisure();
  await Scripting.sleep(300);

  auroraSettings.set_boolean('module-auto-theme-switcher', true);
  await Scripting.waitLeisure();
  await Scripting.sleep(200);

  Scripting.scriptEvent('disableOk');
}

let _schemeCorrect = false;
let _settingsChangeOk = false;
let _disableOk = false;

export function script_schemeCorrect() {
  _schemeCorrect = true;
}

export function script_settingsChangeOk() {
  _settingsChangeOk = true;
}

export function script_disableOk() {
  _disableOk = true;
}

export function finish() {
  if (!_schemeCorrect)
    throw new Error('color-scheme was not set to the expected value after enable');
  if (!_settingsChangeOk) throw new Error('Shell crashed when a time-boundary setting was changed');
  if (!_disableOk)
    throw new Error('Shell crashed when the auto-theme-switcher module was disabled');
}
