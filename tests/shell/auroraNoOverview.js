/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

/**
 * Aurora Shell — NoOverview module test
 *
 * Verifies that:
 *  - sessionMode.hasOverview is true after startup completes (so the overview
 *    remains accessible via hotkeys/gestures)
 *  - The overview can still be shown and hidden manually after startup
 *
 * Note: In GNOME Shell 50+, extensions load asynchronously after
 * startup-complete, so the NoOverview module cannot suppress the startup
 * animation in the test environment. The overviewHiddenAtStartup event is
 * fired only when the overview happens to be hidden; it is informational and
 * NOT required for the test to pass.
 *
 * Run with:
 *   gnome-shell-test-tool --headless \
 *     --extension dist/target/aurora-shell@luminusos.github.io.zip \
 *     tests/shell/auroraNoOverview.js
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { EXTENSION_UUID, waitForExtension, ensureOverviewHidden } from './testUtils.js';

export var METRICS = {};

/** @returns {void} */
export function init() {
  Scripting.defineScriptEvent('overviewHiddenAtStartup', 'Overview was not shown at startup');
  Scripting.defineScriptEvent('hasOverviewRestored', 'sessionMode.hasOverview restored to true');
  Scripting.defineScriptEvent('overviewShownManually', 'Overview shown manually after startup');
  Scripting.defineScriptEvent('overviewHiddenManually', 'Overview hidden manually after startup');
}

/** @returns {Promise<void>} */
export async function run() {
  // Wait for the extension to finish loading (async in GS50).
  await waitForExtension(EXTENSION_UUID);

  await Scripting.sleep(500);

  // --- 1. Overview startup state (informational) ---
  // In GS50 the extension loads after startup-complete, so the startup
  // animation may already have run. We record the state but do not fail.
  if (!Main.overview.visible)
    Scripting.scriptEvent('overviewHiddenAtStartup');

  // --- 2. sessionMode.hasOverview must be restored to true ---
  // NoOverview only suppresses the startup animation; the overview must remain
  // fully accessible afterward. If hasOverview is still false, users cannot
  // invoke the overview via the Activities button or gestures.
  if (Main.sessionMode.hasOverview)
    Scripting.scriptEvent('hasOverviewRestored');

  // --- 3. Manually open and close the overview ---
  // Ensure we start from a known hidden state before testing show/hide.
  await ensureOverviewHidden();

  Main.overview.connect('shown', () => Scripting.scriptEvent('overviewShownManually'));
  Main.overview.connect('hidden', () => Scripting.scriptEvent('overviewHiddenManually'));

  console.debug('[aurora-test] Showing overview manually');
  Main.overview.show();
  await Scripting.waitLeisure();
  await Scripting.sleep(300);

  console.debug('[aurora-test] Hiding overview manually');
  Main.overview.hide();
  await Scripting.waitLeisure();
  await Scripting.sleep(300);
}

let _overviewHiddenAtStartup = false;
let _hasOverviewRestored = false;
let _overviewShownManually = false;
let _overviewHiddenManually = false;

/** @returns {void} */
export function script_overviewHiddenAtStartup() {
  _overviewHiddenAtStartup = true;
}

/** @returns {void} */
export function script_hasOverviewRestored() {
  _hasOverviewRestored = true;
}

/** @returns {void} */
export function script_overviewShownManually() {
  _overviewShownManually = true;
}

/** @returns {void} */
export function script_overviewHiddenManually() {
  _overviewHiddenManually = true;
}

/** @returns {void} */
export function finish() {
  // overviewHiddenAtStartup is informational in GS50 — not required.

  if (!_hasOverviewRestored)
    throw new Error('sessionMode.hasOverview was not restored after startup — overview may be permanently disabled');

  if (!_overviewShownManually)
    throw new Error('Overview cannot be shown manually after startup');

  if (!_overviewHiddenManually)
    throw new Error('Overview cannot be hidden manually after startup');
}
