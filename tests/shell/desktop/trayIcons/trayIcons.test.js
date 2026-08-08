/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { EXTENSION_UUID, getAuroraSettings, waitForExtension } from '../../support/testUtils.js';

const INDICATOR_ID = 'aurora-tray-icons';
const BG_APPS_TOGGLE_CLASS = 'background-apps-quick-toggle';

export var METRICS = {};

export function init() {
  Scripting.defineScriptEvent('extensionEnabled', 'Extension enabled');
  Scripting.defineScriptEvent('trayFound', 'Tray indicator found in panel.statusArea');
  Scripting.defineScriptEvent('bgAppsHidden', 'Background Apps quick settings toggle hidden');
  Scripting.defineScriptEvent('trayGone', 'Tray indicator absent after disable');
}

/**
 * @param {import('@girs/clutter-18').Actor | null | undefined} actor
 * @param {string} styleClass
 * @returns {import('@girs/clutter-18').Actor | null}
 */
function findActorWithStyleClass(actor, styleClass) {
  if (!actor) return null;
  if (actor.has_style_class_name && actor.has_style_class_name(styleClass)) return actor;

  const children = actor.get_children ? actor.get_children() : [];
  for (const child of children) {
    const match = findActorWithStyleClass(child, styleClass);
    if (match) return match;
  }

  return null;
}

/** @returns {import('@girs/clutter-18').Actor | null} */
function findBackgroundAppsToggle() {
  const quickSettings = Main.panel.statusArea.quickSettings;
  const items = quickSettings?._backgroundApps?.quickSettingsItems;
  const directItem = items
    ? items.find(
        (item) =>
          item && item.has_style_class_name && item.has_style_class_name(BG_APPS_TOGGLE_CLASS),
      )
    : undefined;
  if (directItem) return directItem;

  return findActorWithStyleClass(quickSettings?.menu?._grid, BG_APPS_TOGGLE_CLASS);
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);
  Scripting.scriptEvent('extensionEnabled');
  await Scripting.sleep(500);
  const settings = getAuroraSettings();
  const originalModuleEnabled = settings.get_boolean('module-tray-icons');
  const originalHideBgQuickSettings = settings.get_boolean('tray-icons-hide-bg-quick-settings');

  try {
    settings.set_boolean('module-tray-icons', true);
    await Scripting.waitLeisure();
    await Scripting.sleep(300);

    // Wait for the indicator to appear (allows time for hot-reload to settle)
    let trayIndicator = null;
    for (let i = 0; i < 30; i++) {
      trayIndicator = Main.panel.statusArea[INDICATOR_ID];
      if (trayIndicator) break;
      console.log(`[aurora-tray-test] Waiting for indicator... attempt ${i + 1}`);
      await Scripting.sleep(200);
    }

    if (!trayIndicator)
      throw new Error(`"${INDICATOR_ID}" indicator not found in panel.statusArea after retries`);

    Scripting.scriptEvent('trayFound');
    await Scripting.sleep(200);

    settings.set_boolean('tray-icons-hide-bg-quick-settings', true);
    await Scripting.waitLeisure();
    await Scripting.sleep(300);

    const bgAppsToggle = findBackgroundAppsToggle();
    if (!bgAppsToggle) throw new Error(`"${BG_APPS_TOGGLE_CLASS}" not found in Quick Settings`);

    bgAppsToggle.visible = true;
    await Scripting.waitLeisure();
    await Scripting.sleep(200);

    if (bgAppsToggle.visible)
      throw new Error('Background Apps quick settings toggle remained visible');

    Scripting.scriptEvent('bgAppsHidden');

    settings.set_boolean('tray-icons-hide-bg-quick-settings', false);
    await Scripting.waitLeisure();
    await Scripting.sleep(200);

    if (trayIndicator._bgAppsToggle)
      throw new Error(
        'Background Apps quick settings toggle was not released after disabling option',
      );

    settings.set_boolean('module-tray-icons', false);
    await Scripting.waitLeisure();
    await Scripting.sleep(500);

    const afterDisable = Main.panel.statusArea[INDICATOR_ID];
    if (afterDisable)
      throw new Error(`"${INDICATOR_ID}" still present in panel.statusArea after disable`);

    Scripting.scriptEvent('trayGone');
  } finally {
    settings.set_boolean('tray-icons-hide-bg-quick-settings', originalHideBgQuickSettings);
    settings.set_boolean('module-tray-icons', originalModuleEnabled);
    await Scripting.waitLeisure();
    await Scripting.sleep(300);
  }
}

let _extensionEnabled = false;
let _trayFound = false;
let _bgAppsHidden = false;
let _trayGone = false;

export function script_extensionEnabled() {
  _extensionEnabled = true;
}

export function script_trayFound() {
  _trayFound = true;
}

export function script_bgAppsHidden() {
  _bgAppsHidden = true;
}

export function script_trayGone() {
  _trayGone = true;
}

export function finish() {
  if (!_extensionEnabled) throw new Error('Extension was not found or not enabled');
  if (!_trayFound) throw new Error('Tray indicator was not found in panel.statusArea after enable');
  if (!_bgAppsHidden) throw new Error('Background Apps quick settings toggle was not hidden');
  if (!_trayGone)
    throw new Error('Tray indicator was not removed from panel.statusArea after disable');
}
