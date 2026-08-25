/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {
  EXTENSION_UUID,
  getAuroraModule,
  getAuroraSettings,
  waitForCondition,
  waitForExtension,
  waitForModuleState,
} from '../../support/testUtils.js';

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
  const extension = await waitForExtension(EXTENSION_UUID);
  Scripting.scriptEvent('extensionEnabled');
  const settings = getAuroraSettings();
  const originalModuleEnabled = settings.get_boolean('module-tray-icons');
  const originalHideBgQuickSettings = settings.get_boolean('tray-icons-hide-bg-quick-settings');

  try {
    settings.set_boolean('module-tray-icons', true);
    await waitForModuleState(settings, 'module-tray-icons', 'tray-icons', true);
    const trayIndicator = await waitForCondition({
      evaluate: () => Main.panel.statusArea[INDICATOR_ID],
      signals: [[Main.panel._rightBox, 'child-added']],
      description: `"${INDICATOR_ID}" indicator to join the panel`,
    });

    const trayIconsModule = getAuroraModule('tray-icons');
    const absoluteIconPath = GLib.build_filenamev([
      extension.path,
      'icons',
      'hicolor',
      'scalable',
      'status',
      'aurora-shell-menu-symbolic.svg',
    ]);
    const absoluteIcon = trayIconsModule._sniHost._resolveIcon({
      g_name: ':test.absolute-icon',
      g_object_path: '/StatusNotifierItem',
      get_cached_property(name) {
        if (name === 'Status') return new GLib.Variant('s', 'Active');
        if (name === 'IconName') return new GLib.Variant('s', absoluteIconPath);
        if (name === 'IconThemePath') return new GLib.Variant('s', '');
        return null;
      },
    });
    if (!(absoluteIcon instanceof Gio.FileIcon))
      throw new Error('Absolute SNI IconName did not resolve to a file icon');
    if (absoluteIcon.get_file().get_path() !== absoluteIconPath)
      throw new Error('Absolute SNI IconName resolved to the wrong file');

    Scripting.scriptEvent('trayFound');

    settings.set_boolean('tray-icons-hide-bg-quick-settings', true);
    await Scripting.waitLeisure();

    const bgAppsToggle = findBackgroundAppsToggle();
    if (!bgAppsToggle) throw new Error(`"${BG_APPS_TOGGLE_CLASS}" not found in Quick Settings`);

    bgAppsToggle.visible = true;
    await Scripting.waitLeisure();

    if (bgAppsToggle.visible)
      throw new Error('Background Apps quick settings toggle remained visible');

    Scripting.scriptEvent('bgAppsHidden');

    settings.set_boolean('tray-icons-hide-bg-quick-settings', false);
    await Scripting.waitLeisure();

    if (trayIndicator._bgAppsToggle)
      throw new Error(
        'Background Apps quick settings toggle was not released after disabling option',
      );

    settings.set_boolean('module-tray-icons', false);
    await Scripting.waitLeisure();

    const afterDisable = Main.panel.statusArea[INDICATOR_ID];
    if (afterDisable)
      throw new Error(`"${INDICATOR_ID}" still present in panel.statusArea after disable`);

    Scripting.scriptEvent('trayGone');
  } finally {
    settings.set_boolean('tray-icons-hide-bg-quick-settings', originalHideBgQuickSettings);
    settings.set_boolean('module-tray-icons', originalModuleEnabled);
    await Scripting.waitLeisure();
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
