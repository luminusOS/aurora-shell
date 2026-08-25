/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import Shell from 'gi://Shell';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { EXTENSION_UUID, getAuroraSettings, waitForExtension } from '../support/testUtils.js';

export var METRICS = {};

export function init() {
  Scripting.defineScriptEvent(
    'prototypePatched',
    'WindowTracker.get_window_app is patched while enabled',
  );
  Scripting.defineScriptEvent(
    'prototypeRestored',
    'WindowTracker.get_window_app restored after disable',
  );
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);

  const auroraSettings = getAuroraSettings();

  await Scripting.waitLeisure();

  // I19/I20: capture patched function while module is enabled
  const patchedFn = Shell.WindowTracker.prototype.get_window_app;

  auroraSettings.set_boolean('module-icon-weave', false);
  await Scripting.waitLeisure();

  const restoredFn = Shell.WindowTracker.prototype.get_window_app;

  if (patchedFn === restoredFn) {
    auroraSettings.set_boolean('module-icon-weave', true);
    throw new Error(
      'Shell.WindowTracker.prototype.get_window_app was NOT restored after icon-weave was disabled; ' +
        'the patched function is still in place',
    );
  }

  Scripting.scriptEvent('prototypePatched');
  Scripting.scriptEvent('prototypeRestored');

  // Re-enable and verify I19: re-enabling must not crash.
  auroraSettings.set_boolean('module-icon-weave', true);
  await Scripting.waitLeisure();

  const repatchedFn = Shell.WindowTracker.prototype.get_window_app;
  if (repatchedFn === restoredFn)
    throw new Error(
      'Shell.WindowTracker.prototype.get_window_app was not re-patched after re-enable',
    );

  // A later extension owns its wrapper. IconWeave must not overwrite that
  // external patch while it tears down its own resources.
  const externalWrapper = function (window) {
    return repatchedFn.call(this, window);
  };
  Shell.WindowTracker.prototype.get_window_app = externalWrapper;

  auroraSettings.set_boolean('module-icon-weave', false);
  await Scripting.waitLeisure();

  if (Shell.WindowTracker.prototype.get_window_app !== externalWrapper)
    throw new Error('IconWeave overwrote a prototype patch installed after its own wrapper');

  Shell.WindowTracker.prototype.get_window_app = restoredFn;
  auroraSettings.set_boolean('module-icon-weave', true);
  await Scripting.waitLeisure();
}

let _prototypePatched = false;
let _prototypeRestored = false;

export function script_prototypePatched() {
  _prototypePatched = true;
}

export function script_prototypeRestored() {
  _prototypeRestored = true;
}

export function finish() {
  if (!_prototypePatched)
    throw new Error(
      'IconWeave did not patch Shell.WindowTracker.prototype.get_window_app on enable',
    );
  if (!_prototypeRestored)
    throw new Error(
      'IconWeave did not restore Shell.WindowTracker.prototype.get_window_app on disable',
    );
}
