/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {
  EXTENSION_UUID,
  getAuroraModule,
  getAuroraSettings,
  waitForExtension,
} from '../support/testUtils.js';

const MODULE_KEY = 'vela-vpn-quick-settings';
const MODULE_SETTING = 'module-vela-vpn-quick-settings';
const FALLBACK_SETTING = 'vela-vpn-quick-settings-shell-fallback';

export var METRICS = {};

export function init() {
  Scripting.defineScriptEvent(
    'fallbackPolicyOk',
    'Vela VPN integration is opt-in and handles ServiceUnknown fallback',
  );
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);
  const settings = getAuroraSettings();
  const originalModuleEnabled = settings.get_boolean(MODULE_SETTING);
  const originalFallbackEnabled = settings.get_boolean(FALLBACK_SETTING);

  try {
    const defaultModuleEnabled = settings.get_default_value(MODULE_SETTING)?.unpack();
    if (defaultModuleEnabled !== false)
      throw new Error('Vela VPN integration must be disabled by default');

    const defaultFallbackEnabled = settings.get_default_value(FALLBACK_SETTING)?.unpack();
    if (defaultFallbackEnabled !== false)
      throw new Error('Vela VPN Shell fallback must be disabled by default');

    settings.set_boolean(MODULE_SETTING, true);
    await Scripting.waitLeisure();
    await Scripting.sleep(200);

    await waitForExtension(EXTENSION_UUID);
    const module = getAuroraModule(MODULE_KEY);

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

export function script_fallbackPolicyOk() {
  _fallbackPolicyOk = true;
}

export function finish() {
  if (!_fallbackPolicyOk) throw new Error('Vela VPN fallback policy test did not complete');
}
