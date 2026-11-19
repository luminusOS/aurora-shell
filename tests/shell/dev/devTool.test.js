/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {
  EXTENSION_UUID,
  getAuroraSettings,
  waitForCondition,
  waitForExtension,
  waitForModuleState,
} from '../support/testUtils.js';
import { exerciseCaptureTools, exerciseClipboardHistory } from './scenarios/captureAndClipboard.js';
import { exerciseDock } from './scenarios/dock.js';
import {
  exerciseCalendarReminders,
  exerciseTrayIcons,
  exerciseWeatherClock,
} from './scenarios/trayAndClocks.js';

const DEVTOOL_ID = 'aurora-devtool';
const TRAY_ID = 'aurora-tray-icons';

export var METRICS = {};

export function init() {
  Scripting.defineScriptEvent('extensionEnabled', 'Extension enabled');
  Scripting.defineScriptEvent('devToolAbsent', 'DevTool absent without AURORA_DEVTOOLS');
  Scripting.defineScriptEvent('devToolFound', 'DevTool found with AURORA_DEVTOOLS');
  Scripting.defineScriptEvent('devToolUiPassed', 'DevTool service returned its sections');
  Scripting.defineScriptEvent('captureToolPassed', 'Capture Tool DevTool actions passed');
  Scripting.defineScriptEvent('clipboardToolPassed', 'Clipboard History DevTool actions passed');
  Scripting.defineScriptEvent('trayIconsToolPassed', 'Tray Icons DevTool actions passed');
  Scripting.defineScriptEvent('weatherClockToolPassed', 'Weather Clock DevTool actions passed');
  Scripting.defineScriptEvent(
    'calendarRemindersToolPassed',
    'Calendar Reminders DevTool actions passed',
  );
  Scripting.defineScriptEvent('dockToolPassed', 'Dock DevTool actions passed');
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);
  Scripting.scriptEvent('extensionEnabled');

  const devToolsEnabled = GLib.getenv('AURORA_DEVTOOLS') === '1';
  const panelButton = Main.panel.statusArea[DEVTOOL_ID];

  if (panelButton) throw new Error('DevTool installed a Shell panel button');
  if (!devToolsEnabled) {
    Scripting.scriptEvent('devToolAbsent');
    return;
  }

  Scripting.scriptEvent('devToolFound');

  const settings = getAuroraSettings();
  settings.set_boolean('module-tray-icons', true);
  await waitForModuleState(settings, 'module-tray-icons', 'tray-icons', true);

  const tray = await waitForCondition({
    evaluate: () => Main.panel.statusArea[TRAY_ID],
    signals: [[Main.panel._rightBox, 'child-added']],
    description: `"${TRAY_ID}" indicator to join the panel for DevTool testing`,
  });

  const extension = Main.extensionManager.lookup(EXTENSION_UUID);
  const devTool = extension?.stateObj?._devTool?._tools;
  if (!devTool) throw new Error('DevTool instance not found on extension state object');

  const call = (method, parameters) =>
    Gio.DBus.session.call(
      'org.gnome.Shell',
      '/org/gnome/Shell/Extensions/AuroraShell/DevTool',
      'org.gnome.Shell.Extensions.AuroraShell.DevTool',
      method,
      parameters,
      null,
      Gio.DBusCallFlags.NONE,
      5000,
      null,
    );
  async function describe() {
    const reply = await call('Describe', null);
    return JSON.parse(reply.deepUnpack()[0]);
  }
  async function runAction(key, label) {
    const sections = await describe();
    const action = sections
      .find((section) => section.key === key)
      ?.actions.find((action) => action.label === label);
    if (!action || action.disabled) throw new Error(`Unavailable action: ${label}`);
    await call('Run', new GLib.Variant('(ss)', [key, action.id]));
    await Scripting.waitLeisure();
  }
  if (!(await describe()).some((section) => section.key === 'general'))
    throw new Error('Missing general tools');
  Scripting.scriptEvent('devToolUiPassed');

  await exerciseCaptureTools(runAction, settings, devTool);
  Scripting.scriptEvent('captureToolPassed');

  await exerciseClipboardHistory(runAction, settings, devTool);
  Scripting.scriptEvent('clipboardToolPassed');

  await exerciseTrayIcons(devTool, tray);
  Scripting.scriptEvent('trayIconsToolPassed');

  await exerciseWeatherClock(settings, devTool);
  Scripting.scriptEvent('weatherClockToolPassed');

  await exerciseCalendarReminders(settings, devTool);
  Scripting.scriptEvent('calendarRemindersToolPassed');

  await exerciseDock(settings, devTool);
  Scripting.scriptEvent('dockToolPassed');
}

let _extensionEnabled = false;
let _devToolAbsent = false;
let _devToolFound = false;
let _devToolUiPassed = false;
let _captureToolPassed = false;
let _clipboardToolPassed = false;
let _trayIconsToolPassed = false;
let _weatherClockToolPassed = false;
let _calendarRemindersToolPassed = false;
let _dockToolPassed = false;

export function script_extensionEnabled() {
  _extensionEnabled = true;
}

export function script_devToolAbsent() {
  _devToolAbsent = true;
}

export function script_devToolFound() {
  _devToolFound = true;
}

export function script_devToolUiPassed() {
  _devToolUiPassed = true;
}

export function script_captureToolPassed() {
  _captureToolPassed = true;
}

export function script_clipboardToolPassed() {
  _clipboardToolPassed = true;
}

export function script_trayIconsToolPassed() {
  _trayIconsToolPassed = true;
}

export function script_weatherClockToolPassed() {
  _weatherClockToolPassed = true;
}

export function script_calendarRemindersToolPassed() {
  _calendarRemindersToolPassed = true;
}

export function script_dockToolPassed() {
  _dockToolPassed = true;
}

export function finish() {
  if (!_extensionEnabled) throw new Error('Extension was not found or not enabled');

  if (GLib.getenv('AURORA_DEVTOOLS') === '1') {
    if (!_devToolFound) throw new Error('DevTool was not found with AURORA_DEVTOOLS=1');
    if (!_devToolUiPassed) throw new Error('DevTool service checks did not complete');
    if (!_captureToolPassed) throw new Error('Capture Tool DevTool actions did not complete');
    if (!_clipboardToolPassed)
      throw new Error('Clipboard History DevTool actions did not complete');
    if (!_trayIconsToolPassed) throw new Error('Tray Icons DevTool actions did not complete');
    if (!_weatherClockToolPassed) throw new Error('Weather Clock DevTool actions did not complete');
    if (!_calendarRemindersToolPassed)
      throw new Error('Calendar Reminders DevTool actions did not complete');
    if (!_dockToolPassed) throw new Error('Dock DevTool actions did not complete');
  } else if (!_devToolAbsent) {
    throw new Error('DevTool was not confirmed absent without AURORA_DEVTOOLS=1');
  }
}
