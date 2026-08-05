/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { EXTENSION_UUID, getAuroraSettings, waitForExtension } from '../support/testUtils.js';

const MENU_VISIBILITY_KEYS = [
  'aurora-menu-show-about',
  'aurora-menu-show-home',
  'aurora-menu-show-downloads',
  'aurora-menu-show-recent-items',
  'aurora-menu-show-settings',
  'aurora-menu-show-software',
  'aurora-menu-show-extensions',
];

export var METRICS = {};

export function init() {
  Scripting.defineScriptEvent('menuVerified', 'Aurora Menu settings verified');
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);

  const settings = getAuroraSettings();
  const originalVisibility = {};
  for (const key of MENU_VISIBILITY_KEYS) originalVisibility[key] = settings.get_boolean(key);
  const originalCustomItems = settings.get_strv('aurora-menu-custom-items');

  try {
    settings.set_boolean('aurora-menu-show-software', false);
    settings.set_boolean('aurora-menu-show-extensions', false);
    settings.set_boolean('aurora-menu-show-recent-items', false);
    settings.set_strv('aurora-menu-custom-items', [
      'Terminal | ptyxis',
      'Files | nautilus --new-window',
    ]);

    await Scripting.waitLeisure();
    await Scripting.sleep(300);

    const labels = await getAuroraMenuLabels();
    assertIncludes(labels, 'Terminal');
    assertIncludes(labels, 'Files');
    assertExcludes(labels, 'Software');
    assertExcludes(labels, 'Extensions');

    Scripting.scriptEvent('menuVerified');
  } finally {
    for (const key of MENU_VISIBILITY_KEYS) settings.set_boolean(key, originalVisibility[key]);
    settings.set_strv('aurora-menu-custom-items', originalCustomItems);
  }
}

async function getAuroraMenuLabels() {
  const button = Main.panel.statusArea['aurora-menu'];
  if (!button?.menu) throw new Error('Aurora Menu button not found');

  button.menu.open();
  await Scripting.waitLeisure();
  await Scripting.sleep(300);
  const items = button.menu._getMenuItems();
  const labels = items.map((item) => item.label?.text).filter((label) => label);
  button.menu.close();
  return labels;
}

function assertIncludes(labels, expected) {
  if (!labels.includes(expected))
    throw new Error(`Aurora Menu is missing "${expected}". Labels: ${labels.join(', ')}`);
}

function assertExcludes(labels, unexpected) {
  if (labels.includes(unexpected))
    throw new Error(`Aurora Menu still shows "${unexpected}". Labels: ${labels.join(', ')}`);
}

let _menuVerified = false;

export function script_menuVerified() {
  _menuVerified = true;
}

export function finish() {
  if (!_menuVerified) throw new Error('Aurora Menu settings were not verified');
}
