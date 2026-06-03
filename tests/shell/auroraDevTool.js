/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

/**
 * Aurora Shell — DevTool integration test
 *
 * Verifies the AURORA_DEVTOOLS startup gate and DevTool actions.
 */

import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { EXTENSION_UUID, getAuroraSettings, waitForExtension } from './testUtils.js';

const DEVTOOL_ID = 'aurora-devtool';
const TRAY_ID = 'aurora-tray-icons';

export var METRICS = {};

/** @returns {void} */
export function init() {
  Scripting.defineScriptEvent('extensionEnabled', 'Extension enabled');
  Scripting.defineScriptEvent('devToolAbsent', 'DevTool absent without AURORA_DEVTOOLS');
  Scripting.defineScriptEvent('devToolFound', 'DevTool found with AURORA_DEVTOOLS');
  Scripting.defineScriptEvent('clipboardToolPassed', 'Clipboard History DevTool actions passed');
  Scripting.defineScriptEvent('trayIconsToolPassed', 'Tray Icons DevTool actions passed');
  Scripting.defineScriptEvent('weatherClockToolPassed', 'Weather Clock DevTool actions passed');
  Scripting.defineScriptEvent('meetingClockToolPassed', 'Meeting Clock DevTool actions passed');
}

/** @returns {Promise<void>} */
export async function run() {
  await waitForExtension(EXTENSION_UUID);
  Scripting.scriptEvent('extensionEnabled');
  await Scripting.sleep(500);

  const devToolsEnabled = GLib.getenv('AURORA_DEVTOOLS') === '1';
  const panelButton = Main.panel.statusArea[DEVTOOL_ID];

  if (!devToolsEnabled) {
    if (panelButton)
      throw new Error(`"${DEVTOOL_ID}" should not be present without AURORA_DEVTOOLS=1`);
    Scripting.scriptEvent('devToolAbsent');
    return;
  }

  if (!panelButton) throw new Error(`"${DEVTOOL_ID}" indicator not found with AURORA_DEVTOOLS=1`);
  Scripting.scriptEvent('devToolFound');

  const settings = getAuroraSettings();
  settings.set_boolean('module-tray-icons', true);
  await Scripting.waitLeisure();
  await Scripting.sleep(500);

  const tray = Main.panel.statusArea[TRAY_ID];
  if (!tray)
    throw new Error(`"${TRAY_ID}" indicator not found; DevTool API test requires tray icons`);

  const extension = Main.extensionManager.lookup(EXTENSION_UUID);
  const devTool = extension?.stateObj?._devTool;
  if (!devTool) throw new Error('DevTool instance not found on extension state object');

  if (!devTool.generalTool) throw new Error('General DevTool section not found');

  settings.set_boolean('module-clipboard-history', true);
  await Scripting.waitLeisure();
  await Scripting.sleep(500);

  const clipboardTool = devTool.clipboardHistoryTool;
  if (!clipboardTool) throw new Error('Clipboard History DevTool section not found');

  const previousEntryCount = clipboardTool.entryCount;
  const messages = clipboardTool.addRandomMessages(2);
  if (messages.length !== 2)
    throw new Error('Clipboard History DevTool did not add random messages');
  if (clipboardTool.entryCount < previousEntryCount + 2)
    throw new Error('Clipboard History DevTool entry count did not increase');
  if (!clipboardTool.openPanel())
    throw new Error('Clipboard History DevTool did not open the panel');
  await Scripting.sleep(100);
  if (!clipboardTool.isPanelOpen)
    throw new Error('Clipboard History DevTool panel open state was not updated');

  Main.uiGroup
    .get_children()
    .find((actor) => actor.has_style_class_name?.('aurora-clipboard-panel'))
    ?.close?.();

  Scripting.scriptEvent('clipboardToolPassed');

  const trayIconsTool = devTool.trayIconsTool;
  if (!trayIconsTool) throw new Error('Tray Icons DevTool section not found');

  const firstId = trayIconsTool.addRandomFakeIcon();
  const secondId = trayIconsTool.addRandomFakeIcon();
  if (!firstId || !secondId) throw new Error('Tray Icons DevTool returned no fake item id');

  if (!trayIconsTool.fakeItemIds.includes(firstId) || !trayIconsTool.fakeItemIds.includes(secondId))
    throw new Error('Tray Icons DevTool did not track fake items after add');

  trayIconsTool.toggleAttentionOnAll();
  await Scripting.sleep(100);
  if (!tray._state?.attentionIds?.has(firstId) || !tray._state?.attentionIds?.has(secondId))
    throw new Error('Tray Icons DevTool did not toggle fake item alerts on');

  trayIconsTool.toggleAttentionOnAll();
  await Scripting.sleep(100);
  if (tray._state?.attentionIds?.has(firstId) || tray._state?.attentionIds?.has(secondId))
    throw new Error('Tray Icons DevTool did not toggle fake item alerts off');

  const trayWidget = tray._items?.get(firstId);
  const removeMenuItem = trayWidget?.trayItem?.menuItems?.find(
    (item) => item.label === 'Remove Icon',
  );
  if (!removeMenuItem) throw new Error(`Fake tray item "${firstId}" has no Remove Icon menu item`);

  removeMenuItem.action();
  await Scripting.sleep(500);

  if (trayIconsTool.fakeItemIds.includes(firstId))
    throw new Error(`Tray Icons DevTool still tracks fake item "${firstId}" after menu removal`);

  trayIconsTool.removeAllFakeIcons();
  await Scripting.sleep(500);
  if (trayIconsTool.fakeItemIds.length !== 0)
    throw new Error('Tray Icons DevTool still tracks fake items after remove all');

  Scripting.scriptEvent('trayIconsToolPassed');

  settings.set_boolean('module-weather-clock', true);
  await Scripting.waitLeisure();
  await Scripting.sleep(500);

  const weatherClockTool = devTool.weatherClockTool;
  if (!weatherClockTool) throw new Error('Weather Clock DevTool section not found');
  if (!weatherClockTool.showSunny())
    throw new Error('Weather Clock DevTool did not set a sunny snapshot');
  await Scripting.sleep(300);
  if (!weatherClockTool.isVisible)
    throw new Error('Weather Clock DevTool did not make the widget visible');
  if (!weatherClockTool.showOffline())
    throw new Error('Weather Clock DevTool did not set an offline snapshot');
  weatherClockTool.clearWeather();
  settings.set_boolean('module-weather-clock', false);
  await Scripting.waitLeisure();
  await Scripting.sleep(300);

  Scripting.scriptEvent('weatherClockToolPassed');

  settings.set_boolean('module-meeting-clock', true);
  await Scripting.waitLeisure();
  await Scripting.sleep(500);

  const meetingClockTool = devTool.meetingClockTool;
  if (!meetingClockTool) throw new Error('Meeting Clock DevTool section not found');

  const soonId = meetingClockTool.addSoonMeeting();
  const noLinkId = meetingClockTool.addNoLinkMeeting();
  if (!soonId || !noLinkId) throw new Error('Meeting Clock DevTool did not create fake meetings');
  if (meetingClockTool.devMeetingCount < 2)
    throw new Error('Meeting Clock DevTool did not track fake meetings');
  if (!meetingClockTool.triggerAlert())
    throw new Error('Meeting Clock DevTool did not trigger an alert for a linked meeting');
  if (!meetingClockTool.activeAlertEventId)
    throw new Error('Meeting Clock DevTool alert state was not updated');
  if (!meetingClockTool.openCalendar())
    throw new Error('Meeting Clock DevTool did not open the calendar menu');

  meetingClockTool.clearMeetings();
  await Scripting.sleep(300);
  if (meetingClockTool.devMeetingCount !== 0)
    throw new Error('Meeting Clock DevTool still tracks fake meetings after clear');

  settings.set_boolean('module-meeting-clock', false);
  await Scripting.waitLeisure();
  await Scripting.sleep(300);

  Scripting.scriptEvent('meetingClockToolPassed');
}

let _extensionEnabled = false;
let _devToolAbsent = false;
let _devToolFound = false;
let _clipboardToolPassed = false;
let _trayIconsToolPassed = false;
let _weatherClockToolPassed = false;
let _meetingClockToolPassed = false;

/** @returns {void} */
export function script_extensionEnabled() {
  _extensionEnabled = true;
}

/** @returns {void} */
export function script_devToolAbsent() {
  _devToolAbsent = true;
}

/** @returns {void} */
export function script_devToolFound() {
  _devToolFound = true;
}

/** @returns {void} */
export function script_clipboardToolPassed() {
  _clipboardToolPassed = true;
}

/** @returns {void} */
export function script_trayIconsToolPassed() {
  _trayIconsToolPassed = true;
}

/** @returns {void} */
export function script_weatherClockToolPassed() {
  _weatherClockToolPassed = true;
}

/** @returns {void} */
export function script_meetingClockToolPassed() {
  _meetingClockToolPassed = true;
}

/** @returns {void} */
export function finish() {
  if (!_extensionEnabled) throw new Error('Extension was not found or not enabled');

  if (GLib.getenv('AURORA_DEVTOOLS') === '1') {
    if (!_devToolFound) throw new Error('DevTool was not found with AURORA_DEVTOOLS=1');
    if (!_clipboardToolPassed)
      throw new Error('Clipboard History DevTool actions did not complete');
    if (!_trayIconsToolPassed) throw new Error('Tray Icons DevTool actions did not complete');
    if (!_weatherClockToolPassed)
      throw new Error('Weather Clock DevTool actions did not complete');
    if (!_meetingClockToolPassed) throw new Error('Meeting Clock DevTool actions did not complete');
  } else if (!_devToolAbsent) {
    throw new Error('DevTool was not confirmed absent without AURORA_DEVTOOLS=1');
  }
}
