/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {
  EXTENSION_UUID,
  ensureOverviewHidden,
  getAuroraSettings,
  waitForCondition,
  waitForExtension,
} from '../support/testUtils.js';
import { getClipboardModule } from './scenarios/panelEnvironment.js';

export var METRICS = {};
export function init() {}

async function openItemMenu(item) {
  item.setActionsVisible(true);
  global.stage.queue_redraw();
  await waitForCondition({
    evaluate: () => item._menuButton.get_transformed_position().every(Number.isFinite),
    signals: [[global.stage, 'after-paint']],
    description: 'clipboard menu button to be allocated',
  });
  item._openMenu();
  await Scripting.waitLeisure();
}

function waitForPaint() {
  let painted = false;
  const paintId = global.stage.connect('after-paint', () => {
    painted = true;
    global.stage.disconnect(paintId);
  });
  global.stage.queue_redraw();
  return waitForCondition({
    evaluate: () => painted,
    signals: [[global.stage, 'after-paint']],
    description: 'stage to paint after clipboard menu teardown',
  });
}

function waitForMenuDestroy(menu) {
  let destroyed = false;
  menu.actor.connect('destroy', () => {
    destroyed = true;
  });
  return waitForCondition({
    evaluate: () => destroyed,
    signals: [[menu.actor, 'destroy']],
    description: 'clipboard menu to be destroyed',
  });
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);
  await ensureOverviewHidden();
  const settings = getAuroraSettings();
  for (const key of settings.settings_schema.list_keys()) {
    if (key.startsWith('module-') && key !== 'module-clipboard-history')
      settings.set_boolean(key, false);
  }
  settings.set_boolean('clipboard-history-persist', false);
  settings.set_boolean('module-clipboard-history', true);
  await Scripting.waitLeisure();
  const module = getClipboardModule();
  const redrawId = global.stage.connect('after-paint', () => global.stage.queue_redraw());
  try {
    global.stage.queue_redraw();
    await waitForCondition({
      evaluate: () => !module._monitor._persisting,
      signals: [[global.stage, 'after-paint']],
      description: 'clipboard store to finish loading',
    });
  } finally {
    global.stage.disconnect(redrawId);
  }
  const baseline = Main.modalCount;
  for (const [action, callbackName] of [
    ['Copy', 'onActivate'],
    ['Pin', 'onTogglePin'],
    ['Delete', 'onRemove'],
  ]) {
    const text = `menu-action-${action}-${Date.now()}`;
    module.addText(text);
    module.openPanel();
    module._panel._searchEntry.set_text(text);
    await Scripting.waitLeisure();
    const panel = module._panel;
    const item = panel._list._items.find((entry) => entry.entry.text === text);
    if (!item) throw new Error(`Missing item for ${action}`);
    let calls = 0;
    let beforeRelease = false;
    const original = panel._callbacks[callbackName];
    panel._callbacks[callbackName] = (value) => {
      calls++;
      beforeRelease = Main.modalCount !== baseline;
      original(value);
    };
    await openItemMenu(item);
    const menu = item._menu.popup;
    if (!menu.isOpen || Main.modalCount !== baseline + 1)
      throw new Error(`${action} menu did not acquire a grab`);
    const actionItem = menu._getMenuItems().find((entry) => entry.label.text === action);
    await waitForCondition({
      evaluate: () => {
        const [x, y] = actionItem.get_transformed_position();
        const [width, height] = actionItem.get_transformed_size();
        const pickedActor = global.stage.get_actor_at_pos(
          Clutter.PickMode.REACTIVE,
          x + width / 2,
          y + height / 2,
        );
        return width > 0 && height > 0 && pickedActor && actionItem.contains(pickedActor);
      },
      signals: [[global.stage, 'after-paint']],
      description: `${action} menu item to be pickable at its transformed position`,
    });
    const menuDestroyed = waitForMenuDestroy(menu);
    actionItem.activate(null);
    panel.refresh();
    await waitForPaint();
    await menuDestroyed;
    await Scripting.waitLeisure();
    panel._callbacks[callbackName] = original;
    if (calls !== 1 || beforeRelease || Main.modalCount !== baseline)
      throw new Error(
        `${action}: calls=${calls}, beforeRelease=${beforeRelease}, grabs=${Main.modalCount - baseline}`,
      );
    const entry = [...module._store.getPinned(), ...module._store.getHistory()].find(
      (entry) => entry.text === text,
    );
    if (action === 'Pin' && !entry?.pinned) throw new Error('Pin did not update the entry');
    if (action === 'Delete' && entry) throw new Error('Delete did not remove the entry');
  }
  const destroyText = `menu-destroy-test-${Date.now()}`;
  module.addText(destroyText);
  module.openPanel();
  module._panel._searchEntry.set_text(destroyText);
  await Scripting.waitLeisure();
  const panel = module._panel;
  let item = panel._list._items.find((entry) => entry.entry.text === destroyText);
  await openItemMenu(item);
  item._menu.popup.close();
  panel.refresh();
  await Scripting.waitLeisure();
  if (Main.modalCount !== baseline) throw new Error('Animated close left a modal grab');
  item = panel._list._items.find((entry) => entry.entry.text === destroyText);
  await openItemMenu(item);
  item._menu.popup.close({ animate: false });
  item._openMenu();
  panel.refresh();
  await waitForPaint();
  if (Main.modalCount !== baseline) throw new Error('External destroy left a modal grab');

  const store = module._store;
  const entry = store.entryForText(destroyText);
  if (!entry || entry.pinned) throw new Error('Disable test requires an unpinned entry');

  item = panel._list._items.find((entry) => entry.entry.text === destroyText);
  let disabledCalls = 0;
  const originalTogglePin = panel._callbacks.onTogglePin;
  panel._callbacks.onTogglePin = (id) => {
    disabledCalls++;
    originalTogglePin(id);
  };
  await openItemMenu(item);
  const disabledMenu = item._menu.popup;
  const disabledMenuDestroyed = waitForMenuDestroy(disabledMenu);
  disabledMenu
    ._getMenuItems()
    .find((entry) => entry.label.text === 'Pin')
    .activate(null);
  let paintsAfterDisable = 0;
  const paintId = global.stage.connect('after-paint', () => paintsAfterDisable++);
  settings.set_boolean('module-clipboard-history', false);
  try {
    await disabledMenuDestroyed;
  } finally {
    global.stage.disconnect(paintId);
  }
  if (paintsAfterDisable) throw new Error('Menu teardown depended on a subsequent paint');
  await waitForPaint();
  await new Promise((resolve) => {
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      resolve();
      return GLib.SOURCE_REMOVE;
    });
  });
  if (disabledCalls)
    throw new Error(`Disable failed to cancel pending Pin: calls=${disabledCalls}`);
  if (store.entryForText(destroyText) !== entry || entry.pinned)
    throw new Error('Disable changed the unpinned clipboard entry');
  if (Main.modalCount !== baseline) throw new Error('Disable left a modal grab');
}
export function finish() {
  console.log('Clipboard menu lifecycle completed');
}
