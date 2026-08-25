/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {
  EXTENSION_UUID,
  getAuroraModule,
  getAuroraSettings,
  waitForExtension,
} from '../../../support/testUtils.js';

const MEETING_MODULE_KEY = 'module-meeting-clock';
const WEATHER_MODULE_KEY = 'module-weather-clock';
const ALERT_EVENTS_WITHOUT_LINK_KEY = 'meeting-clock-alert-events-without-link';

export var METRICS = {};

export function init() {
  Scripting.defineScriptEvent('meetingClockComplete', 'Meeting Clock test completed');
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);

  const settings = getAuroraSettings();
  const dateMenu = Main.panel.statusArea.dateMenu;
  const originalClockDisplay = dateMenu._clockDisplay;

  settings.set_boolean(WEATHER_MODULE_KEY, false);
  settings.set_boolean(MEETING_MODULE_KEY, false);
  await Scripting.waitLeisure();

  if (originalClockDisplay.get_parent()?.has_style_class_name('aurora-clock-pill-box'))
    throw new Error('Meeting Clock wrapper remained after disabling module');

  settings.set_boolean(MEETING_MODULE_KEY, true);
  settings.set_boolean(ALERT_EVENTS_WITHOUT_LINK_KEY, false);
  await Scripting.waitLeisure();

  const enabledParent = originalClockDisplay.get_parent();
  if (!enabledParent?.has_style_class_name('aurora-clock-pill-box'))
    throw new Error('Meeting Clock did not wrap the clock display after enabling module');

  const meetingClock = getAuroraModule('meeting-clock');

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

  if (!meetingClock.showAlert('aurora-test-no-link'))
    throw new Error('Meeting Clock did not alert for no-link event when setting was enabled');
  if (meetingClock.activeAlertEventId !== 'aurora-test-no-link')
    throw new Error('Meeting Clock did not track active no-link alert');

  const alertSource = Main.messageTray
    .getSources()
    .find((source) => source.title === 'Meeting Clock');
  const alertNotification = alertSource?.notifications.find(
    (notification) => notification.title === 'Meeting starting soon',
  );
  if (!alertSource || !alertNotification)
    throw new Error('Meeting Clock alert notification not found in the message tray');

  let bannerRequests = 0;
  alertSource.connect('notification-request-banner', () => {
    bannerRequests++;
  });
  alertNotification.acknowledged = true;
  if (!meetingClock.showAlert('aurora-test-no-link'))
    throw new Error('Meeting Clock did not re-trigger an already active alert');
  if (bannerRequests === 0)
    throw new Error('Meeting Clock re-trigger did not request a new banner');

  meetingClock.clearSourceEvents('aurora-test');
  settings.set_boolean(ALERT_EVENTS_WITHOUT_LINK_KEY, false);
  await Scripting.waitLeisure();

  dateMenu.menu.open();
  await Scripting.waitLeisure();
  dateMenu.menu.close();
  await Scripting.waitLeisure();

  settings.set_boolean(MEETING_MODULE_KEY, false);
  await Scripting.waitLeisure();

  if (originalClockDisplay.get_parent()?.has_style_class_name('aurora-clock-pill-box'))
    throw new Error('Meeting Clock wrapper was not restored after second disable');

  settings.set_boolean(WEATHER_MODULE_KEY, false);
  settings.set_boolean(MEETING_MODULE_KEY, false);
  await Scripting.waitLeisure();

  Scripting.scriptEvent('meetingClockComplete');
}

let _complete = false;

export function script_meetingClockComplete() {
  _complete = true;
}

export function finish() {
  if (!_complete) throw new Error('Meeting Clock integration test did not complete');
}
