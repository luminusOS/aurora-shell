/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

/**
 * Aurora Shell — Weather Clock integration test
 *
 * Verifies that Weather Clock wraps/restores the date menu clock, renders a
 * fake weather snapshot, and coexists with Meeting Clock in the shared clock
 * pill layout.
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { EXTENSION_UUID, getAuroraSettings, waitForExtension } from './testUtils.js';

const WEATHER_MODULE_KEY = 'module-weather-clock';
const MEETING_MODULE_KEY = 'module-meeting-clock';

export var METRICS = {};

/** @returns {void} */
export function init() {
  Scripting.defineScriptEvent('weatherClockComplete', 'Weather Clock test completed');
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
    throw new Error('Clock pill wrapper remained after disabling clock modules');

  settings.set_boolean(WEATHER_MODULE_KEY, true);
  await Scripting.waitLeisure();
  await Scripting.sleep(500);

  const extension = Main.extensionManager.lookup(EXTENSION_UUID);
  const weatherClock = extension?.stateObj?._modules?.get('weather-clock');
  if (!weatherClock) throw new Error('Weather Clock module instance not found');

  weatherClock.setWeatherSnapshot('aurora-test', {
    iconName: 'weather-clear-symbolic',
    temperature: '24°',
    description: 'Clear sky',
  });
  await Scripting.waitLeisure();
  await Scripting.sleep(300);

  const wrapper = originalClockDisplay.get_parent();
  if (!wrapper?.has_style_class_name('aurora-clock-pill-box'))
    throw new Error('Weather Clock did not wrap the clock display');

  const weatherWidget = wrapper
    .get_children()
    .find((child) => child.has_style_class_name?.('aurora-weather-clock-widget'));
  if (!weatherWidget?.visible)
    throw new Error('Weather Clock widget did not render the fake weather snapshot');

  settings.set_boolean(MEETING_MODULE_KEY, true);
  await Scripting.waitLeisure();
  await Scripting.sleep(500);

  const meetingClock = extension?.stateObj?._modules?.get('meeting-clock');
  if (!meetingClock) throw new Error('Meeting Clock module instance not found');

  const now = Math.floor(Date.now() / 1000);
  meetingClock.setSourceEvents('aurora-test', [
    {
      id: 'aurora-test-meeting',
      title: 'Test meeting',
      startEpochSeconds: now + 300,
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
  await Scripting.sleep(300);

  const children = wrapper.get_children();
  const weatherIndex = children.findIndex((child) =>
    child.has_style_class_name?.('aurora-weather-clock-widget'),
  );
  const clockIndex = children.indexOf(originalClockDisplay);
  const meetingIndex = children.findIndex((child) =>
    child.has_style_class_name?.('aurora-meeting-clock-widget'),
  );

  if (!(weatherIndex >= 0 && clockIndex >= 0 && meetingIndex >= 0))
    throw new Error('Clock pill did not contain weather, clock, and meeting widgets');
  if (!(weatherIndex < clockIndex && clockIndex < meetingIndex))
    throw new Error('Clock pill order was not weather | clock | meeting');

  weatherClock.clearWeatherSnapshot('aurora-test');
  meetingClock.clearSourceEvents('aurora-test');
  settings.set_boolean(WEATHER_MODULE_KEY, false);
  settings.set_boolean(MEETING_MODULE_KEY, false);
  await Scripting.waitLeisure();
  await Scripting.sleep(300);

  if (originalClockDisplay.get_parent()?.has_style_class_name('aurora-clock-pill-box'))
    throw new Error('Clock pill wrapper was not restored after disabling clock modules');

  Scripting.scriptEvent('weatherClockComplete');
}

let _complete = false;

/** @returns {void} */
export function script_weatherClockComplete() {
  _complete = true;
}

/** @returns {void} */
export function finish() {
  if (!_complete) throw new Error('Weather Clock integration test did not complete');
}
