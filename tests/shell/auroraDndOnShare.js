/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

/**
 * Aurora Shell — DndOnShare module test
 *
 * Verifies that the DndOnShare module correctly:
 *  - Disables notification banners (show-banners = false) when screen sharing starts
 *  - Restores the original show-banners value when screen sharing stops
 *
 * If the screen sharing indicator is not present in the test environment
 * (e.g. headless without a screen share session), the test skips gracefully
 * by verifying that GSettings were left untouched.
 *
 * Run with:
 *   gnome-shell-test-tool --headless \
 *     --extension dist/target/aurora-shell@luminusos.github.io.zip \
 *     tests/shell/auroraDndOnShare.js
 */

import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

const NOTIFICATIONS_SCHEMA = 'org.gnome.desktop.notifications';
const SHOW_BANNERS_KEY = 'show-banners';

export var METRICS = {};

/** @returns {void} */
export function init() {
  Scripting.defineScriptEvent('dndActivated', 'DND activated when screen sharing started');
  Scripting.defineScriptEvent('dndRestored', 'Notification banners restored when screen sharing stopped');
  Scripting.defineScriptEvent('indicatorNotFound', 'Screen sharing indicator not available — skipping live test');
}

/** @returns {Promise<void>} */
export async function run() {
  const notifSettings = new Gio.Settings({ schema_id: NOTIFICATIONS_SCHEMA });

  // Save original state so we can assert at finish() and never leave dirty state.
  const originalShowBanners = notifSettings.get_boolean(SHOW_BANNERS_KEY);

  // Ensure banners are ON before we begin so the module has something to disable.
  notifSettings.set_boolean(SHOW_BANNERS_KEY, true);
  await Scripting.sleep(200);

  const statusArea = Main.panel.statusArea;
  const indicator = statusArea.screenSharing ?? statusArea.quickSettings?._remoteAccess ?? null;

  if (!indicator) {
    console.debug('[aurora-test] Screen sharing indicator not found — skipping live DND toggle test');
    Scripting.scriptEvent('indicatorNotFound');

    // Still verify that DndOnShare did not accidentally flip show-banners on load.
    const current = notifSettings.get_boolean(SHOW_BANNERS_KEY);
    if (!current)
      throw new Error('show-banners was disabled by DndOnShare even though screen sharing was not active');

    // Restore original value.
    notifSettings.set_boolean(SHOW_BANNERS_KEY, originalShowBanners);
    return;
  }

  // --- Simulate screen sharing starting ---
  console.debug('[aurora-test] Simulating screen sharing start (indicator.visible = true)');
  indicator.visible = true;
  await Scripting.waitLeisure();
  await Scripting.sleep(300);

  const bannersAfterStart = notifSettings.get_boolean(SHOW_BANNERS_KEY);
  if (!bannersAfterStart)
    Scripting.scriptEvent('dndActivated');

  // --- Simulate screen sharing stopping ---
  console.debug('[aurora-test] Simulating screen sharing stop (indicator.visible = false)');
  indicator.visible = false;
  await Scripting.waitLeisure();
  await Scripting.sleep(300);

  const bannersAfterStop = notifSettings.get_boolean(SHOW_BANNERS_KEY);
  if (bannersAfterStop)
    Scripting.scriptEvent('dndRestored');

  // Restore original value in case the module didn't (defensive).
  notifSettings.set_boolean(SHOW_BANNERS_KEY, originalShowBanners);
}

let _indicatorNotFound = false;
let _dndActivated = false;
let _dndRestored = false;

/** @returns {void} */
export function script_indicatorNotFound() {
  _indicatorNotFound = true;
}

/** @returns {void} */
export function script_dndActivated() {
  _dndActivated = true;
}

/** @returns {void} */
export function script_dndRestored() {
  _dndRestored = true;
}

/** @returns {void} */
export function finish() {
  if (_indicatorNotFound) {
    // Graceful skip — the test environment doesn't have a screen sharing indicator.
    console.debug('[aurora-test] DND live test skipped (no indicator in this environment)');
    return;
  }

  if (!_dndActivated)
    throw new Error('DndOnShare did not disable notification banners when screen sharing started');

  if (!_dndRestored)
    throw new Error('DndOnShare did not restore notification banners when screen sharing stopped');
}
