/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

export const EXTENSION_UUID = 'aurora-shell@luminusos.github.io';

const DEFAULT_WAIT_TIMEOUT_MS = 8000;
const DEFAULT_WAIT_SCHEDULER = {
  add(timeoutMs, callback) {
    return GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeoutMs, callback);
  },
  remove(sourceId) {
    GLib.source_remove(sourceId);
  },
};

/**
 * Wait for evaluate() to return a value, waking on the supplied signals.
 * Checks on both sides of signal connection close the missed-event window.
 * The timeout only rejects.
 *
 * @template T
 * @param {object} options
 * @param {() => T | false | null | undefined} options.evaluate
 * @param {Array<[object, string]>} options.signals
 * @param {string} options.description
 * @param {number} [options.timeoutMs=8000]
 * @param {object} [options.scheduler] - Test seam for watchdog source ownership
 * @returns {Promise<T>}
 */
export function waitForCondition({
  evaluate,
  signals,
  description,
  timeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
  scheduler = DEFAULT_WAIT_SCHEDULER,
}) {
  const initial = evaluate();
  if (initial) return Promise.resolve(initial);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0)
    return Promise.reject(new Error(`Invalid timeout for ${description}: ${timeoutMs}`));

  return new Promise((resolve, reject) => {
    const connections = [];
    let watchdogId = 0;
    let settled = false;

    const cleanup = () => {
      for (const [object, signalId] of connections) {
        try {
          object.disconnect(signalId);
        } catch (_error) {
          // Destroyed GObjects may already have released their signal ids.
        }
      }
      connections.length = 0;
      if (watchdogId) {
        scheduler.remove(watchdogId);
        watchdogId = 0;
      }
    };

    const finish = (value, error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    };

    const check = () => {
      try {
        const value = evaluate();
        if (value) finish(value);
      } catch (error) {
        finish(undefined, error);
      }
    };

    try {
      for (const [object, signal] of signals)
        connections.push([object, object.connect(signal, check)]);
    } catch (error) {
      finish(undefined, error);
      return;
    }

    // Close the gap between the initial evaluation and signal connection.
    check();
    if (settled) return;

    try {
      watchdogId = scheduler.add(timeoutMs, () => {
        watchdogId = 0;
        finish(undefined, new Error(`Timed out after ${timeoutMs}ms waiting for ${description}`));
        return GLib.SOURCE_REMOVE;
      });
    } catch (error) {
      finish(undefined, error);
    }
  });
}

/**
 * Wait for an actor property or transition to reach the requested state.
 *
 * @template T
 * @param {Clutter.Actor} actor
 * @param {(actor: Clutter.Actor) => T | false | null | undefined} evaluate
 * @param {object} options
 * @param {string[]} [options.properties=[]]
 * @param {string} options.description
 * @param {number} [options.timeoutMs=8000]
 * @returns {Promise<T>}
 */
export function waitForActorState(
  actor,
  evaluate,
  {
    properties = [],
    description,
    timeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
    scheduler = DEFAULT_WAIT_SCHEDULER,
  },
) {
  return waitForCondition({
    evaluate: () => evaluate(actor),
    signals: [
      ...properties.map((property) => [actor, `notify::${property}`]),
      [actor, 'transition-stopped'],
      [actor, 'transitions-completed'],
      [actor, 'destroy'],
    ],
    description,
    timeoutMs,
    scheduler,
  });
}

/**
 * Wait when elapsed time is part of the assertion, such as debounce or dwell.
 *
 * @param {number} durationMs
 * @param {string} reason
 * @returns {Promise<void>}
 */
export function waitForTiming(durationMs, reason) {
  if (!reason?.trim()) throw new Error('waitForTiming() requires a temporal-contract reason');
  return Scripting.sleep(durationMs);
}

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
  if (!ext) throw new Error(`Extension ${EXTENSION_UUID} not found`);
  if (!ext.stateObj)
    throw new Error(`Extension ${EXTENSION_UUID} has no state object and may not be fully loaded`);

  // Hot reload may remove the extension-local gschemas.compiled. Use the same
  // schema lookup as the extension.
  return ext.stateObj.getSettings();
}

export function getAuroraModule(key) {
  const extension = Main.extensionManager.lookup(EXTENSION_UUID);
  if (!extension?.stateObj)
    throw new Error(`Extension ${EXTENSION_UUID} has no active state object`);

  const runtime = extension.stateObj._runtime;
  if (!runtime) throw new Error(`Extension ${EXTENSION_UUID} has no active runtime`);

  const module = runtime.getModule(key);
  if (!module) throw new Error(`Aurora module ${key} is not active`);

  return module;
}

/**
 * Wait for a module setting and the runtime registry to agree.
 *
 * @param {Gio.Settings} settings
 * @param {string} settingsKey
 * @param {string} moduleKey
 * @param {boolean} enabled
 * @returns {Promise<boolean>}
 */
export function waitForModuleState(settings, settingsKey, moduleKey, enabled) {
  return waitForCondition({
    evaluate: () => {
      const extension = Main.extensionManager.lookup(EXTENSION_UUID);
      const module = extension?.stateObj?._runtime?.getModule(moduleKey);
      return settings.get_boolean(settingsKey) === enabled && Boolean(module) === enabled;
    },
    signals: [
      [settings, `changed::${settingsKey}`],
      [Main.extensionManager, 'extension-state-changed'],
    ],
    description: `${moduleKey} runtime to become ${enabled ? 'enabled' : 'disabled'}`,
  });
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
export async function waitForExtension(uuid, timeoutMs = DEFAULT_WAIT_TIMEOUT_MS) {
  const ACTIVE = 1;
  const ERROR = 3;
  return waitForCondition({
    evaluate: () => {
      const ext = Main.extensionManager.lookup(uuid);
      if (ext?.state === ACTIVE) return ext;
      // Ignore the empty default while loadExtension() is still running.
      if (ext?.state === ERROR && ext.error !== '')
        throw new Error(`Extension ${uuid} failed to load: ${ext.error}`);
      return false;
    },
    signals: [[Main.extensionManager, 'extension-state-changed']],
    description: `extension ${uuid} to become active`,
    timeoutMs,
  });
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
    await waitForCondition({
      evaluate: () => !Main.overview.visible,
      signals: [
        [Main.overview, 'hiding'],
        [Main.overview, 'hidden'],
      ],
      description: 'overview to become hidden',
    });
  }
}
