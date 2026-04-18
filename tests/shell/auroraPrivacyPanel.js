/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

/**
 * Aurora Shell — PrivacyPanel module test
 *
 * Verifies that:
 *  - _leftBox and _centerBox fade to opacity 0 when screen sharing starts
 *  - The screen sharing indicator stays at opacity 255 while panel is hidden
 *  - All boxes restore to opacity 255 when screen sharing stops
 *
 * If no sharing indicator exists in the test environment, the test skips
 * gracefully and verifies the panel was left untouched.
 *
 * Run with:
 *   gnome-shell-test-tool --headless \
 *     --extension dist/target/aurora-shell@luminusos.github.io.zip \
 *     tests/shell/auroraPrivacyPanel.js
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

const CONTENT_BOXES = ['_leftBox', '_centerBox'];
const ALL_BOXES = ['_leftBox', '_centerBox', '_rightBox'];
const ANIMATION_SETTLE_MS = 400;

export var METRICS = {};

/** @returns {void} */
export function init() {
  Scripting.defineScriptEvent('hiddenOnShare', 'Panel boxes hidden when screen sharing started');
  Scripting.defineScriptEvent('restoredOnShareEnd', 'Panel boxes restored when screen sharing stopped');
  Scripting.defineScriptEvent('indicatorNotFound', 'Screen sharing indicator not available — skipping live test');
}

/** @returns {Promise<void>} */
export async function run() {
  const statusArea = Main.panel.statusArea;
  const indicator = statusArea.screenSharing ?? statusArea.quickSettings?._remoteAccess ?? null;

  if (!indicator) {
    console.debug('[aurora-test] No screen sharing indicator — skipping live PrivacyPanel test');
    Scripting.scriptEvent('indicatorNotFound');

    // Verify module left panel untouched
    for (const box of ALL_BOXES) {
      const opacity = Main.panel[box]?.opacity ?? 255;
      if (opacity !== 255)
        throw new Error(`PrivacyPanel left ${box} at opacity ${opacity} without sharing active`);
    }
    return;
  }

  // Ensure boxes start visible
  for (const box of ALL_BOXES) {
    if (Main.panel[box]) Main.panel[box].opacity = 255;
  }
  await Scripting.sleep(100);

  // --- Simulate screen sharing start ---
  console.debug('[aurora-test] Simulating screen sharing start');
  indicator.visible = true;
  await Scripting.waitLeisure();
  await Scripting.sleep(ANIMATION_SETTLE_MS);

  // _leftBox and _centerBox must be hidden; the sharing indicator must stay visible
  const contentHidden = CONTENT_BOXES.every(b => (Main.panel[b]?.opacity ?? 255) === 0);
  const indicatorVisible =
    (indicator?.opacity ?? 255) === 255 &&
    (indicator?.container?.opacity ?? 255) === 255;
  if (contentHidden && indicatorVisible) Scripting.scriptEvent('hiddenOnShare');

  // --- Simulate screen sharing stop ---
  console.debug('[aurora-test] Simulating screen sharing stop');
  indicator.visible = false;
  await Scripting.waitLeisure();
  await Scripting.sleep(ANIMATION_SETTLE_MS);

  const allRestored = ALL_BOXES.every(b => (Main.panel[b]?.opacity ?? 0) === 255);
  if (allRestored) Scripting.scriptEvent('restoredOnShareEnd');
}

let _indicatorNotFound = false;
let _hiddenOnShare = false;
let _restoredOnShareEnd = false;

/** @returns {void} */
export function script_indicatorNotFound() {
  _indicatorNotFound = true;
}

/** @returns {void} */
export function script_hiddenOnShare() {
  _hiddenOnShare = true;
}

/** @returns {void} */
export function script_restoredOnShareEnd() {
  _restoredOnShareEnd = true;
}

/** @returns {void} */
export function finish() {
  if (_indicatorNotFound) {
    console.debug('[aurora-test] PrivacyPanel live test skipped (no indicator in this environment)');
    return;
  }

  if (!_hiddenOnShare)
    throw new Error('PrivacyPanel did not hide panel boxes when screen sharing started');

  if (!_restoredOnShareEnd)
    throw new Error('PrivacyPanel did not restore panel boxes when screen sharing stopped');
}
