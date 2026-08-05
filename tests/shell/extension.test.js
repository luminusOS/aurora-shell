/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { EXTENSION_UUID, waitForExtension, ensureOverviewHidden } from './support/testUtils.js';

export var METRICS = {};

export function init() {
  Scripting.defineScriptEvent('extensionEnabled', 'Aurora Shell extension is enabled');
  Scripting.defineScriptEvent('overviewShown', 'Overview shown successfully');
  Scripting.defineScriptEvent('overviewHidden', 'Overview hidden successfully');
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);

  Scripting.scriptEvent('extensionEnabled');
  await Scripting.sleep(500);

  if (!Main.panel.visible)
    throw new Error('Top panel is not visible — extension may have broken it');

  // The startup overview may be visible when the extension loads in GS50.
  // Hide it first so overview.show() is not a no-op.
  await ensureOverviewHidden();

  Main.overview.connect('shown', () => Scripting.scriptEvent('overviewShown'));
  Main.overview.connect('hidden', () => Scripting.scriptEvent('overviewHidden'));

  console.debug('[aurora-test] Showing overview');
  Main.overview.show();
  await Scripting.waitLeisure();
  await Scripting.sleep(300);

  console.debug('[aurora-test] Hiding overview');
  Main.overview.hide();
  await Scripting.waitLeisure();
  await Scripting.sleep(300);
}

let _extensionEnabled = false;
let _overviewShown = false;
let _overviewHidden = false;

export function script_extensionEnabled() {
  _extensionEnabled = true;
}

export function script_overviewShown() {
  _overviewShown = true;
}

export function script_overviewHidden() {
  _overviewHidden = true;
}

export function finish() {
  if (!_extensionEnabled) throw new Error('Aurora Shell extension was not found or not enabled');

  if (!_overviewShown)
    throw new Error('Overview failed to show — dock or another module may have broken it');

  if (!_overviewHidden) throw new Error('Overview failed to hide');
}
