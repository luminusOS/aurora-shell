/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

/**
 * Shared utilities and constants for Aurora Shell integration tests.
 *
 * Import with:
 *   import { EXTENSION_UUID, getAuroraSettings, waitForExtension, ensureOverviewHidden } from './testUtils.js';
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

export const EXTENSION_UUID = 'aurora-shell@luminusos.github.io';

/**
 * Load the extension's GSettings object from the extension's own schema dir.
 *
 * Always re-looks up the extension from the extension manager to avoid using
 * a stale ext reference after a hot-reload triggered by the extension-updates
 * mechanism in the test tool.
 *
 * @returns {Gio.Settings}
 */
export function getAuroraSettings() {
  const ext = Main.extensionManager.lookup(EXTENSION_UUID);
  if (!ext)
    throw new Error(`Extension ${EXTENSION_UUID} not found`);
  if (!ext.stateObj)
    throw new Error(`Extension ${EXTENSION_UUID} has no state object — not fully loaded`);

  // Delegate to the extension's own getSettings() so that the same schema
  // source used by the extension itself is used here. This avoids issues
  // where gschemas.compiled is absent from the extension dir after the
  // gnome-shell extension-updates hot-reload mechanism processes an update.
  return ext.stateObj.getSettings();
}

/**
 * Wait for extension to reach ACTIVE state.
 *
 * In GNOME Shell 50+, extensions load asynchronously after startup-complete,
 * so the state is undefined when the test script first runs. This helper polls
 * until the extension reaches ACTIVE (1) or fails with ERROR (3).
 *
 * @param {string} uuid - Extension UUID
 * @param {number} [timeoutMs=8000] - Maximum wait in milliseconds
 * @returns {Promise<object>} The extension object
 */
export async function waitForExtension(uuid, timeoutMs = 8000) {
  const ACTIVE = 1;
  const ERROR = 3;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ext = Main.extensionManager.lookup(uuid);
    if (ext?.state === ACTIVE) return ext;
    // ext.error starts as '' (initial default) while loadExtension() runs
    // asynchronously. Only throw if a real error message has been set.
    if (ext?.state === ERROR && ext.error !== '')
      throw new Error(`Extension ${uuid} failed to load: ${ext.error}`);
    await Scripting.sleep(100);
  }
  const ext = Main.extensionManager.lookup(uuid);
  throw new Error(
    `Extension ${uuid} not active after ${timeoutMs}ms (state=${ext?.state ?? 'not found'})`,
  );
}

/**
 * Ensure the overview is hidden before running show/hide tests.
 *
 * In GNOME Shell 50+, extensions load after startup-complete, so the startup
 * overview may still be visible when run() begins. Calling this before
 * overview.show() guarantees we start from a known hidden state.
 *
 * @returns {Promise<void>}
 */
export async function ensureOverviewHidden() {
  if (Main.overview.visible) {
    Main.overview.hide();
    await Scripting.waitLeisure();
    await Scripting.sleep(300);
  }
}
