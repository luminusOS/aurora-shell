/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { EXTENSION_UUID, getAuroraSettings, waitForExtension } from '../support/testUtils.js';

const MODULE_KEY = 'module-power-menu-avatar';
const AVATAR_STYLE_CLASS = 'aurora-power-menu-avatar';

export var METRICS = {};

export function init() {
  Scripting.defineScriptEvent('avatarShown', 'Power menu shows the current user avatar');
  Scripting.defineScriptEvent(
    'moduleRestored',
    'Power menu is restored when the module is disabled',
  );
  Scripting.defineScriptEvent(
    'moduleReenabled',
    'Power menu avatar survives a disable-enable cycle',
  );
}

function getPowerMenu() {
  const grid = Main.panel.statusArea.quickSettings?.menu?._grid;
  if (!grid) throw new Error('Quick settings grid not found');

  const systemItem = grid.get_children().find((child) => child.constructor.name === 'SystemItem');
  if (!systemItem) throw new Error('SystemItem not found in quick settings grid');

  return systemItem.menu;
}

function getAvatars(menu) {
  return menu.box.get_children().filter((child) => child.has_style_class_name(AVATAR_STYLE_CLASS));
}

async function waitForModuleReconcile() {
  await Scripting.waitLeisure();
  await Scripting.sleep(300);
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);

  const settings = getAuroraSettings();
  const originalEnabled = settings.get_boolean(MODULE_KEY);
  const menu = getPowerMenu();

  try {
    settings.set_boolean(MODULE_KEY, true);
    await waitForModuleReconcile();

    if (getAvatars(menu).length !== 1)
      throw new Error('Power menu does not contain exactly one Aurora avatar');
    if (menu._header.visible) throw new Error('Default power menu header is still visible');
    Scripting.scriptEvent('avatarShown');

    settings.set_boolean(MODULE_KEY, false);
    await waitForModuleReconcile();

    if (getAvatars(menu).length !== 0)
      throw new Error('Power menu avatar was not removed when the module was disabled');
    if (!menu._header.visible) throw new Error('Default power menu header was not restored');
    Scripting.scriptEvent('moduleRestored');

    settings.set_boolean(MODULE_KEY, true);
    await waitForModuleReconcile();

    if (getAvatars(menu).length !== 1)
      throw new Error('Power menu avatar was duplicated after re-enabling the module');
    if (menu._header.visible)
      throw new Error('Default power menu header is visible after re-enabling the module');
    Scripting.scriptEvent('moduleReenabled');
  } finally {
    settings.set_boolean(MODULE_KEY, originalEnabled);
    await waitForModuleReconcile();
  }
}

let _avatarShown = false;
let _moduleRestored = false;
let _moduleReenabled = false;

export function script_avatarShown() {
  _avatarShown = true;
}
export function script_moduleRestored() {
  _moduleRestored = true;
}
export function script_moduleReenabled() {
  _moduleReenabled = true;
}

export function finish() {
  if (!_avatarShown) throw new Error('Power menu avatar was not shown');
  if (!_moduleRestored) throw new Error('Power menu was not restored on disable');
  if (!_moduleReenabled) throw new Error('Power menu avatar did not survive re-enable');
}
