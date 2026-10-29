import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { waitForCondition } from '../../support/testUtils.js';

function callDisplayConfig(method, parameters) {
  return new Promise((resolve, reject) => {
    Gio.DBus.session.call(
      'org.gnome.Mutter.DisplayConfig',
      '/org/gnome/Mutter/DisplayConfig',
      'org.gnome.Mutter.DisplayConfig',
      method,
      parameters,
      null,
      Gio.DBusCallFlags.NONE,
      -1,
      null,
      (connection, result) => {
        try {
          resolve(connection.call_finish(result));
        } catch (error) {
          reject(error);
        }
      },
    );
  });
}

/**
 * Lay the monitors out side by side, each at its own scale, and wait for the Shell to adopt it.
 *
 * @param {number[]} scales One scale per monitor, in the order Mutter lists them.
 */
export async function setMonitorScales(scales) {
  const state = await callDisplayConfig('GetCurrentState', null);
  const [serial, monitors] = state.deepUnpack();
  let x = 0;
  const logicalMonitors = monitors.map((monitor, index) => {
    const connector = monitor[0][0];
    const mode = monitor[1].find((candidate) => candidate[6]['is-current']?.deepUnpack());
    const layout = [x, 0, scales[index], 0, index === 0, [[connector, mode[0], {}]]];
    x += Math.round(mode[1] / scales[index]);

    return layout;
  });

  await callDisplayConfig(
    'ApplyMonitorsConfig',
    new GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})', [serial, 1, logicalMonitors, {}]),
  );
  await waitForCondition({
    evaluate: () =>
      scales.every(
        (scale, index) => Math.abs(global.display.get_monitor_scale(index) - scale) < 0.01,
      ),
    signals: [[Main.layoutManager, 'monitors-changed']],
    description: `monitors to adopt the scales ${scales.join(', ')}`,
  });
}
