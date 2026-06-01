/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

/**
 * Aurora Shell — Meeting Clock integration test
 *
 * Verifies that the module can be toggled at runtime, wraps/restores the
 * date menu clock safely, and keeps the calendar menu usable.
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { EXTENSION_UUID, getAuroraSettings, waitForExtension } from './testUtils.js';

const MODULE_KEY = 'module-meeting-clock';

export var METRICS = {};

/** @returns {void} */
export function init() {
  Scripting.defineScriptEvent('meetingClockComplete', 'Meeting Clock test completed');
}

/** @returns {Promise<void>} */
export async function run() {
  await waitForExtension(EXTENSION_UUID);

  const settings = getAuroraSettings();
  const dateMenu = Main.panel.statusArea.dateMenu;
  const originalClockDisplay = dateMenu._clockDisplay;

  settings.set_boolean(MODULE_KEY, false);
  await Scripting.waitLeisure();
  await Scripting.sleep(300);

  if (originalClockDisplay.get_parent()?.has_style_class_name('aurora-meeting-clock-box'))
    throw new Error('Meeting Clock wrapper remained after disabling module');

  settings.set_boolean(MODULE_KEY, true);
  await Scripting.waitLeisure();
  await Scripting.sleep(500);

  const enabledParent = originalClockDisplay.get_parent();
  if (!enabledParent?.has_style_class_name('aurora-meeting-clock-box'))
    throw new Error('Meeting Clock did not wrap the clock display after enabling module');

  dateMenu.menu.open();
  await Scripting.waitLeisure();
  await Scripting.sleep(200);
  dateMenu.menu.close();
  await Scripting.waitLeisure();

  settings.set_boolean(MODULE_KEY, false);
  await Scripting.waitLeisure();
  await Scripting.sleep(300);

  if (originalClockDisplay.get_parent()?.has_style_class_name('aurora-meeting-clock-box'))
    throw new Error('Meeting Clock wrapper was not restored after second disable');

  settings.set_boolean(MODULE_KEY, false);
  await Scripting.waitLeisure();

  Scripting.scriptEvent('meetingClockComplete');
}

let _complete = false;

/** @returns {void} */
export function script_meetingClockComplete() {
  _complete = true;
}

/** @returns {void} */
export function finish() {
  if (!_complete) throw new Error('Meeting Clock integration test did not complete');
}
