/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import GLib from 'gi://GLib';
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
  const temp = GLib.dir_make_tmp('aurora-menu-test-XXXXXX');
  const result = `${temp}/result`;

  try {
    settings.set_boolean('aurora-menu-show-software', false);
    settings.set_boolean('aurora-menu-show-extensions', false);
    settings.set_boolean('aurora-menu-show-recent-items', false);
    settings.set_strv('aurora-menu-custom-items', [
      'Terminal | ptyxis',
      'Files | nautilus --new-window',
      `Probe | AURORA_TEST_CONFIG="$HOME/profile dir" python3 -c 'import os, pathlib, sys; pathlib.Path(sys.argv[1]).write_text(os.environ["AURORA_TEST_CONFIG"] + sys.argv[2])' ${GLib.shell_quote(result)} ' ARG=value'`,
      'Incomplete | ONLY=value',
    ]);

    await Scripting.waitLeisure();

    const labels = await getAuroraMenuLabels();
    assertIncludes(labels, 'Terminal');
    assertIncludes(labels, 'Files');
    assertExcludes(labels, 'Incomplete');
    const item = Main.panel.statusArea['aurora-menu'].menu
      ._getMenuItems()
      .find((item) => item.label?.text === 'Probe');
    item.emit('activate', null);
    for (let i = 0; i < 50 && !GLib.file_test(result, GLib.FileTest.EXISTS); i++)
      await Scripting.sleep(50);
    const [, bytes] = GLib.file_get_contents(result);
    if (
      new globalThis.TextDecoder().decode(bytes) !== `${GLib.get_home_dir()}/profile dir ARG=value`
    )
      throw new Error('Custom command received unexpected environment or arguments');
    assertExcludes(labels, 'Software');
    assertExcludes(labels, 'Extensions');

    Scripting.scriptEvent('menuVerified');
  } finally {
    GLib.unlink(result);
    GLib.rmdir(temp);
    for (const key of MENU_VISIBILITY_KEYS) settings.set_boolean(key, originalVisibility[key]);
    settings.set_strv('aurora-menu-custom-items', originalCustomItems);
  }
}

async function getAuroraMenuLabels() {
  const button = Main.panel.statusArea['aurora-menu'];
  if (!button?.menu) throw new Error('Aurora Menu button not found');

  button.menu.open();
  await Scripting.waitLeisure();
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
