/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { EXTENSION_UUID, getAuroraSettings, waitForExtension } from '../support/testUtils.js';

export var METRICS = {};

export function init() {
  Scripting.defineScriptEvent(
    'lifecycleOk',
    'PipOnTop enable/disable cycle completed without crash',
  );
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);

  const auroraSettings = getAuroraSettings();

  await Scripting.waitLeisure();
  await Scripting.sleep(200);

  auroraSettings.set_boolean('module-pip-on-top', false);
  await Scripting.waitLeisure();
  await Scripting.sleep(200);

  auroraSettings.set_boolean('module-pip-on-top', true);
  await Scripting.waitLeisure();
  await Scripting.sleep(200);

  Scripting.scriptEvent('lifecycleOk');
}

let _lifecycleOk = false;

export function script_lifecycleOk() {
  _lifecycleOk = true;
}

export function finish() {
  if (!_lifecycleOk) throw new Error('PipOnTop enable/disable cycle crashed the shell');
}
