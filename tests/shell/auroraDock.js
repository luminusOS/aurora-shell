/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

/**
 * Aurora Shell — Dock module integration test
 *
 * Verifies that:
 *  - The dock container actor is added to the stage after enable (I1)
 *  - The top panel remains visible with the dock active (I2)
 *  - Disabling the module removes the dock actor without crash (I3)
 *
 * Run with:
 *   gnome-shell-test-tool --headless \
 *     --extension dist/target/aurora-shell@luminusos.github.io.shell-extension.zip \
 *     tests/shell/auroraDock.js
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { EXTENSION_UUID, getAuroraSettings, waitForExtension } from './testUtils.js';

const DOCK_ACTOR_PREFIX = 'aurora-dock-container-';

function findDockActor() {
  const uiGroup = Main.layoutManager.uiGroup;
  const n = uiGroup.get_n_children();
  for (let i = 0; i < n; i++) {
    const child = uiGroup.get_child_at_index(i);
    if (child?.name?.startsWith(DOCK_ACTOR_PREFIX))
      return child;
  }
  return null;
}

export var METRICS = {};

/** @returns {void} */
export function init() {
  Scripting.defineScriptEvent('dockPresent', 'Dock actor found in stage after enable');
  Scripting.defineScriptEvent('panelIntact', 'Top panel still visible with dock active');
  Scripting.defineScriptEvent('dockRemoved', 'Dock actor removed from stage after disable');
}

/** @returns {Promise<void>} */
export async function run() {
  await waitForExtension(EXTENSION_UUID);

  const settings = getAuroraSettings();

  await Scripting.waitLeisure();
  await Scripting.sleep(500);

  // I1 — dock actor must exist in the stage
  const dockActor = findDockActor();
  if (!dockActor)
    throw new Error(`No actor starting with "${DOCK_ACTOR_PREFIX}" found in Main.layoutManager.uiGroup`);

  Scripting.scriptEvent('dockPresent');

  // I2 — panel must still be visible
  if (!Main.panel.visible)
    throw new Error('Top panel is not visible — dock module may have broken it');

  Scripting.scriptEvent('panelIntact');

  // I3 — disable dock, actor must be removed
  const originalValue = settings.get_boolean('module-dock');
  settings.set_boolean('module-dock', false);
  await Scripting.waitLeisure();
  await Scripting.sleep(400);

  const actorAfterDisable = findDockActor();
  if (actorAfterDisable)
    throw new Error('Dock actor still present in stage after module was disabled');

  Scripting.scriptEvent('dockRemoved');

  // restore
  settings.set_boolean('module-dock', originalValue);
  await Scripting.waitLeisure();
  await Scripting.sleep(300);
}

let _dockPresent = false;
let _panelIntact = false;
let _dockRemoved = false;

/** @returns {void} */
export function script_dockPresent() { _dockPresent = true; }

/** @returns {void} */
export function script_panelIntact() { _panelIntact = true; }

/** @returns {void} */
export function script_dockRemoved() { _dockRemoved = true; }

/** @returns {void} */
export function finish() {
  if (!_dockPresent)
    throw new Error('Dock actor was not found in the stage after extension enable');
  if (!_panelIntact)
    throw new Error('Top panel was not visible while dock was active');
  if (!_dockRemoved)
    throw new Error('Dock actor was not removed after module was disabled');
}
