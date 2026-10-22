/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {
  EXTENSION_UUID,
  getAuroraSettings,
  waitForCondition,
  waitForExtension,
  waitForModuleState,
} from '../support/testUtils.js';

export var METRICS = {};

export function init() {
  Scripting.defineScriptEvent('lifecycleOk', 'enable/disable cycle completed without crash');
  Scripting.defineScriptEvent(
    'defaultIntercepted',
    '"default" color-scheme forced to prefer-light',
  );
  Scripting.defineScriptEvent(
    'toggleWritesPreferLight',
    'Dark Style toggle turned off writes prefer-light in one screen transition',
  );
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);

  const auroraSettings = getAuroraSettings();
  const desktopSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });

  await Scripting.waitLeisure();

  auroraSettings.set_boolean('module-theme-changer', false);
  await waitForModuleState(auroraSettings, 'module-theme-changer', 'theme-changer', false);

  auroraSettings.set_boolean('module-theme-changer', true);
  await waitForModuleState(auroraSettings, 'module-theme-changer', 'theme-changer', true);

  Scripting.scriptEvent('lifecycleOk');

  const originalScheme = desktopSettings.get_string('color-scheme');

  desktopSettings.set_string('color-scheme', 'default');
  await waitForCondition({
    evaluate: () => desktopSettings.get_string('color-scheme') === 'prefer-light',
    signals: [[desktopSettings, 'changed::color-scheme']],
    description: 'ThemeChanger to intercept the default color scheme',
  });

  const intercepted = desktopSettings.get_string('color-scheme');
  if (intercepted !== 'prefer-light') {
    desktopSettings.set_string('color-scheme', originalScheme);
    throw new Error(
      `Expected ThemeChanger to intercept "default" and set "prefer-light", got "${intercepted}"`,
    );
  }

  Scripting.scriptEvent('defaultIntercepted');

  desktopSettings.set_string('color-scheme', 'prefer-dark');
  await Scripting.waitLeisure();

  const writtenSchemes = [];
  const changedId = desktopSettings.connect('changed::color-scheme', () => {
    writtenSchemes.push(desktopSettings.get_string('color-scheme'));
  });

  const darkModeToggle = Main.panel.statusArea.quickSettings._darkMode.quickSettingsItems[0];
  darkModeToggle.emit('clicked', 0);
  const transitionRanOnClick = Main.layoutManager.screenTransition.visible;
  await Scripting.waitLeisure();

  desktopSettings.disconnect(changedId);
  desktopSettings.set_string('color-scheme', originalScheme);
  await Scripting.waitLeisure();

  if (writtenSchemes.join(',') !== 'prefer-light') {
    throw new Error(
      `Expected Dark Style toggle to write only "prefer-light", got "${writtenSchemes.join(',')}"`,
    );
  }

  if (!transitionRanOnClick)
    throw new Error('Dark Style toggle did not run the screen transition when turning dark off');

  Scripting.scriptEvent('toggleWritesPreferLight');
}

let _lifecycleOk = false;
let _defaultIntercepted = false;
let _toggleWritesPreferLight = false;

export function script_lifecycleOk() {
  _lifecycleOk = true;
}

export function script_defaultIntercepted() {
  _defaultIntercepted = true;
}

export function script_toggleWritesPreferLight() {
  _toggleWritesPreferLight = true;
}

export function finish() {
  if (!_toggleWritesPreferLight)
    throw new Error('Dark Style toggle did not write prefer-light directly');
  if (!_lifecycleOk) throw new Error('ThemeChanger enable/disable cycle crashed the shell');
  if (!_defaultIntercepted)
    throw new Error(
      'ThemeChanger did not intercept "default" color-scheme and force it to prefer-light',
    );
}
