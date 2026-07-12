/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

/**
 * Aurora Shell — Vela VPN fallback integration test
 *
 * The test session has no Vela Agent bus owner, so calls to its real D-Bus
 * name fail with ServiceUnknown. Verify that this known-safe condition only
 * reaches GNOME Shell when the opt-in fallback setting is enabled.
 */

import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { EXTENSION_UUID, getAuroraSettings, waitForExtension } from './testUtils.js';

const MODULE_KEY = 'vela-vpn-quick-settings';
const MODULE_SETTING = 'module-vela-vpn-quick-settings';
const FALLBACK_SETTING = 'vela-vpn-quick-settings-shell-fallback';

export var METRICS = {};

/** @returns {void} */
export function init() {
  Scripting.defineScriptEvent(
    'fallbackPolicyOk',
    'Vela VPN fallback is opt-in and handles ServiceUnknown',
  );
}

/** @returns {Promise<void>} */
export async function run() {
  let extension = await waitForExtension(EXTENSION_UUID);
  const settings = getAuroraSettings();
  const originalModuleEnabled = settings.get_boolean(MODULE_SETTING);
  const originalFallbackEnabled = settings.get_boolean(FALLBACK_SETTING);

  try {
    const defaultValue = settings.get_default_value(FALLBACK_SETTING)?.unpack();
    if (defaultValue !== false)
      throw new Error('Vela VPN Shell fallback must be disabled by default');

    settings.set_boolean(MODULE_SETTING, true);
    await Scripting.waitLeisure();
    await Scripting.sleep(200);

    extension = await waitForExtension(EXTENSION_UUID);
    const module = extension.stateObj?._modules?.get(MODULE_KEY);
    if (!module) throw new Error('Vela VPN Quick Settings module is not active');

    const connection = {
      get_path: () => '/org/freedesktop/NetworkManager/Settings/999999',
    };
    let fallbackCalls = 0;
    const fallback = () => fallbackCalls++;

    settings.set_boolean(FALLBACK_SETTING, false);
    module._setConnectionActive(connection, true, fallback);
    await Scripting.sleep(500);
    if (fallbackCalls !== 0)
      throw new Error('GNOME Shell fallback ran while the setting was disabled');

    settings.set_boolean(FALLBACK_SETTING, true);
    module._setConnectionActive(connection, true, fallback);
    await Scripting.sleep(500);
    if (fallbackCalls !== 1)
      throw new Error(`Expected one fallback for ServiceUnknown, got ${fallbackCalls}`);

    Scripting.scriptEvent('fallbackPolicyOk');
  } finally {
    settings.set_boolean(FALLBACK_SETTING, originalFallbackEnabled);
    settings.set_boolean(MODULE_SETTING, originalModuleEnabled);
  }
}

let _fallbackPolicyOk = false;

/** @returns {void} */
export function script_fallbackPolicyOk() {
  _fallbackPolicyOk = true;
}

/** @returns {void} */
export function finish() {
  if (!_fallbackPolicyOk) throw new Error('Vela VPN fallback policy test did not complete');
}
