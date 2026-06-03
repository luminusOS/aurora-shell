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

const MEETING_MODULE_KEY = 'module-meeting-clock';
const WEATHER_MODULE_KEY = 'module-weather-clock';
const ALERT_EVENTS_WITHOUT_LINK_KEY = 'meeting-clock-alert-events-without-link';

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

  settings.set_boolean(WEATHER_MODULE_KEY, false);
  settings.set_boolean(MEETING_MODULE_KEY, false);
  await Scripting.waitLeisure();
  await Scripting.sleep(300);

  if (originalClockDisplay.get_parent()?.has_style_class_name('aurora-clock-pill-box'))
    throw new Error('Meeting Clock wrapper remained after disabling module');

  settings.set_boolean(MEETING_MODULE_KEY, true);
  settings.set_boolean(ALERT_EVENTS_WITHOUT_LINK_KEY, false);
  await Scripting.waitLeisure();
  await Scripting.sleep(500);

  const enabledParent = originalClockDisplay.get_parent();
  if (!enabledParent?.has_style_class_name('aurora-clock-pill-box'))
    throw new Error('Meeting Clock did not wrap the clock display after enabling module');

  const extension = Main.extensionManager.lookup(EXTENSION_UUID);
  const meetingClock = extension?.stateObj?._modules?.get('meeting-clock');
  if (!meetingClock) throw new Error('Meeting Clock module instance not found');

  const now = Math.floor(Date.now() / 1000);
  meetingClock.setSourceEvents('aurora-test', [
    {
      id: 'aurora-test-no-link',
      title: 'No link event',
      startEpochSeconds: now + 60,
      endEpochSeconds: now + 1800,
      sourceId: 'aurora-test',
      sourceName: 'Aurora Test',
      description: '',
      location: '',
      url: '',
      meetingUrl: '',
      isAllDay: false,
    },
  ]);
  await Scripting.waitLeisure();

  if (meetingClock.showAlert('aurora-test-no-link'))
    throw new Error('Meeting Clock alerted for no-link event while setting was disabled');

  settings.set_boolean(ALERT_EVENTS_WITHOUT_LINK_KEY, true);
  await Scripting.waitLeisure();
  await Scripting.sleep(100);

  if (!meetingClock.showAlert('aurora-test-no-link'))
    throw new Error('Meeting Clock did not alert for no-link event when setting was enabled');
  if (meetingClock.activeAlertEventId !== 'aurora-test-no-link')
    throw new Error('Meeting Clock did not track active no-link alert');

  meetingClock.clearSourceEvents('aurora-test');
  settings.set_boolean(ALERT_EVENTS_WITHOUT_LINK_KEY, false);
  await Scripting.waitLeisure();

  dateMenu.menu.open();
  await Scripting.waitLeisure();
  await Scripting.sleep(200);
  dateMenu.menu.close();
  await Scripting.waitLeisure();

  settings.set_boolean(MEETING_MODULE_KEY, false);
  await Scripting.waitLeisure();
  await Scripting.sleep(300);

  if (originalClockDisplay.get_parent()?.has_style_class_name('aurora-clock-pill-box'))
    throw new Error('Meeting Clock wrapper was not restored after second disable');

  settings.set_boolean(WEATHER_MODULE_KEY, false);
  settings.set_boolean(MEETING_MODULE_KEY, false);
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
