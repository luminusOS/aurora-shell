/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {
  EXTENSION_UUID,
  waitForCondition,
  waitForExtension,
  ensureOverviewHidden,
} from '../support/testUtils.js';

export var METRICS = {};

export function init() {
  Scripting.defineScriptEvent('overviewHiddenAtStartup', 'Overview was not shown at startup');
  Scripting.defineScriptEvent('hasOverviewRestored', 'sessionMode.hasOverview restored to true');
  Scripting.defineScriptEvent('overviewShownManually', 'Overview shown manually after startup');
  Scripting.defineScriptEvent('overviewHiddenManually', 'Overview hidden manually after startup');
}

export async function run() {
  // Extension loading is asynchronous in GNOME Shell 50.
  await waitForExtension(EXTENSION_UUID);

  await waitForCondition({
    evaluate: () => Main.sessionMode.hasOverview,
    signals: [[Main.sessionMode, 'updated']],
    description: 'session mode overview capability to be restored after startup',
  });

  // GNOME Shell 50 may finish startup before the extension loads.
  if (!Main.overview.visible) Scripting.scriptEvent('overviewHiddenAtStartup');

  // The patch suppresses startup animation, not later overview access.
  if (Main.sessionMode.hasOverview) Scripting.scriptEvent('hasOverviewRestored');

  await ensureOverviewHidden();

  Main.overview.connect('shown', () => Scripting.scriptEvent('overviewShownManually'));
  Main.overview.connect('hidden', () => Scripting.scriptEvent('overviewHiddenManually'));

  console.debug('[aurora-test] Showing overview manually');
  Main.overview.show();
  await waitForCondition({
    evaluate: () => Main.overview.visible && !Main.overview.animationInProgress,
    signals: [
      [Main.overview, 'showing'],
      [Main.overview, 'shown'],
    ],
    description: 'manual overview show animation to complete',
  });

  console.debug('[aurora-test] Hiding overview manually');
  Main.overview.hide();
  await waitForCondition({
    evaluate: () => !Main.overview.visible && !Main.overview.animationInProgress,
    signals: [
      [Main.overview, 'hiding'],
      [Main.overview, 'hidden'],
    ],
    description: 'manual overview hide animation to complete',
  });
}

let _overviewHiddenAtStartup = false;
let _hasOverviewRestored = false;
let _overviewShownManually = false;
let _overviewHiddenManually = false;

export function script_overviewHiddenAtStartup() {
  _overviewHiddenAtStartup = true;
}

export function script_hasOverviewRestored() {
  _hasOverviewRestored = true;
}

export function script_overviewShownManually() {
  _overviewShownManually = true;
}

export function script_overviewHiddenManually() {
  _overviewHiddenManually = true;
}

export function finish() {
  // overviewHiddenAtStartup is informational and not required in GS50.

  if (!_hasOverviewRestored)
    throw new Error(
      'sessionMode.hasOverview was not restored after startup; overview may be permanently disabled',
    );

  if (!_overviewShownManually) throw new Error('Overview cannot be shown manually after startup');

  if (!_overviewHiddenManually) throw new Error('Overview cannot be hidden manually after startup');
}
