/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import Gio from 'gi://Gio';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {
  EXTENSION_UUID,
  getAuroraSettings,
  waitForCondition,
  waitForExtension,
  waitForModuleState,
} from '../support/testUtils.js';

export var METRICS = {};

const MODULE_SETTING = 'module-foreground-bridge';
const MODULE_KEY = 'foreground-bridge';
const BRIDGE_NAME = 'org.luminusos.AuroraShell.Foreground';
const BRIDGE_PATH = '/org/luminusos/AuroraShell/Foreground';
const CONSUMER_NAME = 'org.luminusos.ForegroundBooster';

export function init() {
  Scripting.defineScriptEvent('bridgeOk', 'Foreground bridge restricts focus to its consumer');
}

function openConnection() {
  const address = Gio.dbus_address_get_for_bus_sync(Gio.BusType.SESSION, null);
  return Gio.DBusConnection.new_for_address_sync(
    address,
    Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION,
    null,
    null,
  );
}

function callGetFocus(connection) {
  return new Promise((resolve, reject) => {
    connection.call(
      BRIDGE_NAME,
      BRIDGE_PATH,
      BRIDGE_NAME,
      'GetFocus',
      null,
      null,
      Gio.DBusCallFlags.NONE,
      -1,
      null,
      (source, result) => {
        try {
          resolve(source.call_finish(result));
        } catch (error) {
          reject(error);
        }
      },
    );
  });
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);

  const settings = getAuroraSettings();
  const originalEnabled = settings.get_boolean(MODULE_SETTING);
  if (originalEnabled) throw new Error('Foreground bridge must be disabled by default');

  const consumer = openConnection();
  const stranger = openConnection();
  const received = [];
  const arrival = new Gio.SimpleAction({ name: 'focus-changed' });

  const subscriptionId = consumer.signal_subscribe(
    BRIDGE_NAME,
    BRIDGE_NAME,
    'FocusChanged',
    BRIDGE_PATH,
    null,
    Gio.DBusSignalFlags.NONE,
    (_connection, _sender, _path, _iface, _signal, parameters) => {
      received.push(parameters.deepUnpack());
      arrival.activate(null);
    },
  );
  const ownerId = Gio.bus_own_name_on_connection(
    consumer,
    CONSUMER_NAME,
    Gio.BusNameOwnerFlags.NONE,
    null,
    null,
  );

  let bridgeVanished = false;
  const vanishedAction = new Gio.SimpleAction({ name: 'bridge-vanished' });
  let watchId = 0;

  try {
    settings.set_boolean(MODULE_SETTING, true);
    await waitForModuleState(settings, MODULE_SETTING, MODULE_KEY, true);

    await waitForCondition({
      evaluate: () => received.length > 0,
      signals: [[arrival, 'activate']],
      description: 'bridge to send the current focus to its consumer',
    });

    watchId = Gio.bus_watch_name_on_connection(
      stranger,
      BRIDGE_NAME,
      Gio.BusNameWatcherFlags.NONE,
      null,
      () => {
        bridgeVanished = true;
        vanishedAction.activate(null);
      },
    );

    const [pid, appId] = received[0];
    if (typeof pid !== 'number' || typeof appId !== 'string')
      throw new Error(`Unexpected FocusChanged payload: ${JSON.stringify(received[0])}`);

    const reply = await callGetFocus(consumer);
    const [replyPid, replyAppId] = reply.deepUnpack();
    if (replyPid !== pid || replyAppId !== appId)
      throw new Error('GetFocus disagrees with the last FocusChanged');

    let strangerError = null;
    try {
      await callGetFocus(stranger);
    } catch (error) {
      strangerError = error;
    }
    if (!strangerError || !Gio.DBusError.is_remote_error(strangerError))
      throw new Error('GetFocus must reject callers other than the consumer');
    if (Gio.DBusError.get_remote_error(strangerError) !== 'org.freedesktop.DBus.Error.AccessDenied')
      throw new Error(`Unexpected rejection: ${strangerError.message}`);

    settings.set_boolean(MODULE_SETTING, false);
    await waitForModuleState(settings, MODULE_SETTING, MODULE_KEY, false);
    await waitForCondition({
      evaluate: () => bridgeVanished,
      signals: [[vanishedAction, 'activate']],
      description: 'bridge name to be released after the module is disabled',
    });

    Scripting.scriptEvent('bridgeOk');
  } finally {
    if (watchId) Gio.bus_unwatch_name(watchId);
    consumer.signal_unsubscribe(subscriptionId);
    Gio.bus_unown_name(ownerId);
    settings.set_boolean(MODULE_SETTING, originalEnabled);
    consumer.close_sync(null);
    stranger.close_sync(null);
  }
}

let _bridgeOk = false;

export function script_bridgeOk() {
  _bridgeOk = true;
}

export function finish() {
  if (!_bridgeOk) throw new Error('Foreground bridge contract was not satisfied');
}
