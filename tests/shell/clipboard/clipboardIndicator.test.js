/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */
import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {
  EXTENSION_UUID,
  ensureOverviewHidden,
  getAuroraModule,
  getAuroraSettings,
  waitForExtension,
} from '../support/testUtils.js';

export var METRICS = {};

export function init() {
  Scripting.defineScriptEvent('indicatorVerified', 'Clipboard indicator verified');
}

function dispatchInput(dispatch) {
  return new Promise((resolve) => {
    const id = global.stage.connect('after-paint', () => {
      global.stage.disconnect(id);
      resolve();
    });
    dispatch();
    global.stage.queue_redraw();
  });
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);
  await ensureOverviewHidden();
  const settings = getAuroraSettings();
  settings.set_boolean('clipboard-history-persist', false);
  settings.set_boolean('module-tray-icons', false);
  settings.set_boolean('module-lock-key-indicators', false);
  settings.set_boolean('clipboard-history-indicator', true);
  settings.set_boolean('module-clipboard-history', true);
  await Scripting.waitLeisure();

  const indicator = Main.panel.statusArea['aurora-clipboard-history'];
  if (!indicator) throw new Error('Clipboard indicator missing');
  if (indicator.accessible_role !== Atk.Role.PUSH_BUTTON || !indicator.can_focus)
    throw new Error('Indicator is not a focusable accessible button');

  settings.set_boolean('module-tray-icons', true);
  settings.set_boolean('module-lock-key-indicators', true);
  await Scripting.waitLeisure();
  const children = Main.panel._rightBox.get_children();
  for (const id of ['aurora-tray-icons', 'aurora-lock-key-indicators']) {
    const other = Main.panel.statusArea[id];
    if (!other) throw new Error(`Required indicator ${id} missing`);
    if (children.indexOf(indicator.container) <= children.indexOf(other.container))
      throw new Error(`Clipboard indicator is not after ${id}`);
  }
  const quickSettings = Main.panel.statusArea.quickSettings;
  if (children.indexOf(indicator.container) + 1 !== children.indexOf(quickSettings.container))
    throw new Error('Clipboard indicator is not immediately before Quick Settings');
  const unrelated = new St.Widget();
  Main.panel._rightBox.insert_child_at_index(unrelated, 0);
  if (Main.panel._rightBox.get_first_child() !== unrelated)
    throw new Error('Unrelated indicator was moved behind clipboard');

  const keyboard = global.stage.context
    .get_backend()
    .get_default_seat()
    .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
  indicator.grab_key_focus();
  await Scripting.waitLeisure();
  if (global.stage.get_key_focus() !== indicator)
    throw new Error(
      `Indicator focus failed: mapped=${indicator.mapped} visible=${indicator.visible}`,
    );
  await dispatchInput(() =>
    keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Return, Clutter.KeyState.PRESSED),
  );
  await dispatchInput(() =>
    keyboard.notify_keyval(
      GLib.get_monotonic_time(),
      Clutter.KEY_Return,
      Clutter.KeyState.RELEASED,
    ),
  );
  if (!getAuroraModule('clipboard-history').isPanelOpen)
    throw new Error('Return did not open clipboard');
  const panel = Main.uiGroup
    .get_children()
    .find(
      (actor) => actor instanceof St.Widget && actor.has_style_class_name('aurora-clipboard-panel'),
    );
  if (!panel) throw new Error('Clipboard panel missing');
  const keyboardPosition = panel.get_position();
  const panelColor = panel.get_theme_node().get_background_color().to_string();
  const quickColor = quickSettings.menu.box.get_theme_node().get_background_color().to_string();
  if (panelColor !== quickColor)
    throw new Error(`Clipboard background ${panelColor} differs from Quick Settings ${quickColor}`);
  getAuroraModule('clipboard-history').closePanel();

  const pointer = global.stage.context
    .get_backend()
    .get_default_seat()
    .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
  const [x, y] = indicator.get_transformed_position();
  const [width, height] = indicator.get_transformed_size();
  await dispatchInput(() =>
    pointer.notify_absolute_motion(GLib.get_monotonic_time(), x + width / 2, y + height / 2),
  );
  const picked = global.stage.get_actor_at_pos(
    Clutter.PickMode.REACTIVE,
    x + width / 2,
    y + height / 2,
  );
  if (picked !== indicator)
    throw new Error(
      `Pointer picked ${picked} instead of indicator at ${x},${y} ${width}x${height}`,
    );
  await dispatchInput(() =>
    pointer.notify_button(
      GLib.get_monotonic_time(),
      Clutter.BUTTON_PRIMARY,
      Clutter.ButtonState.PRESSED,
    ),
  );
  await dispatchInput(() =>
    pointer.notify_button(
      GLib.get_monotonic_time(),
      Clutter.BUTTON_PRIMARY,
      Clutter.ButtonState.RELEASED,
    ),
  );
  if (!getAuroraModule('clipboard-history').isPanelOpen)
    throw new Error('Pointer click did not open clipboard');
  const clickPosition = panel.get_position();
  if (clickPosition[0] !== keyboardPosition[0] || clickPosition[1] !== keyboardPosition[1])
    throw new Error('Indicator panel position depends on pointer position');
  await dispatchInput(() =>
    pointer.notify_button(
      GLib.get_monotonic_time(),
      Clutter.BUTTON_PRIMARY,
      Clutter.ButtonState.PRESSED,
    ),
  );
  await dispatchInput(() =>
    pointer.notify_button(
      GLib.get_monotonic_time(),
      Clutter.BUTTON_PRIMARY,
      Clutter.ButtonState.RELEASED,
    ),
  );
  if (getAuroraModule('clipboard-history').isPanelOpen)
    throw new Error('Second pointer click did not close clipboard');

  settings.set_boolean('clipboard-history-indicator', false);
  await Scripting.waitLeisure();
  if (Main.panel.statusArea['aurora-clipboard-history'])
    throw new Error('Indicator remains after option disabled');
  settings.set_boolean('clipboard-history-indicator', true);
  await Scripting.waitLeisure();
  settings.set_boolean('module-clipboard-history', false);
  await Scripting.waitLeisure();
  if (Main.panel.statusArea['aurora-clipboard-history'])
    throw new Error('Indicator remains after module disabled');
  unrelated.destroy();
  Scripting.scriptEvent('indicatorVerified');
}

export function script_indicatorVerified() {}
export function finish() {}
