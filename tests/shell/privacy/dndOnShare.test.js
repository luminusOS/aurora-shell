/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { EXTENSION_UUID, waitForExtension, waitForCondition } from '../support/testUtils.js';

const NOTIFICATIONS_SCHEMA = 'org.gnome.desktop.notifications';
const SHOW_BANNERS_KEY = 'show-banners';

export var METRICS = {};

export function init() {
  Scripting.defineScriptEvent('dndActivated', 'DND activated when screen sharing started');
  Scripting.defineScriptEvent(
    'dndRestored',
    'Notification banners restored when screen sharing stopped',
  );
  Scripting.defineScriptEvent(
    'indicatorNotFound',
    'Skipping live test because the screen sharing indicator is unavailable',
  );
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);
  await Scripting.waitLeisure();

  const notifSettings = new Gio.Settings({ schema_id: NOTIFICATIONS_SCHEMA });

  // finish() verifies that cleanup restored this value.
  const originalShowBanners = notifSettings.get_boolean(SHOW_BANNERS_KEY);

  notifSettings.set_boolean(SHOW_BANNERS_KEY, true);

  const statusArea = Main.panel.statusArea;
  const indicator = statusArea.screenSharing || statusArea.quickSettings?._remoteAccess;

  if (!indicator) {
    console.debug(
      '[aurora-test] Skipping live DND toggle test because no screen sharing indicator was found',
    );
    Scripting.scriptEvent('indicatorNotFound');

    const current = notifSettings.get_boolean(SHOW_BANNERS_KEY);
    if (!current)
      throw new Error(
        'show-banners was disabled by DndOnShare even though screen sharing was not active',
      );

    notifSettings.set_boolean(SHOW_BANNERS_KEY, originalShowBanners);
    return;
  }

  console.debug('[aurora-test] Simulating screen sharing start (indicator.visible = true)');
  indicator.visible = true;
  await waitForCondition({
    evaluate: () => !notifSettings.get_boolean(SHOW_BANNERS_KEY),
    signals: [
      [indicator, 'notify::visible'],
      [notifSettings, `changed::${SHOW_BANNERS_KEY}`],
    ],
    description: 'notification banners to disable after sharing starts',
  });

  const bannersAfterStart = notifSettings.get_boolean(SHOW_BANNERS_KEY);
  if (!bannersAfterStart) Scripting.scriptEvent('dndActivated');

  console.debug('[aurora-test] Simulating screen sharing stop (indicator.visible = false)');
  indicator.visible = false;
  await waitForCondition({
    evaluate: () => notifSettings.get_boolean(SHOW_BANNERS_KEY),
    signals: [
      [indicator, 'notify::visible'],
      [notifSettings, `changed::${SHOW_BANNERS_KEY}`],
    ],
    description: 'notification banners to restore after sharing stops',
  });

  const bannersAfterStop = notifSettings.get_boolean(SHOW_BANNERS_KEY);
  if (bannersAfterStop) Scripting.scriptEvent('dndRestored');

  // Do not rely on module cleanup to restore test state.
  notifSettings.set_boolean(SHOW_BANNERS_KEY, originalShowBanners);
}

let _indicatorNotFound = false;
let _dndActivated = false;
let _dndRestored = false;

export function script_indicatorNotFound() {
  _indicatorNotFound = true;
}

export function script_dndActivated() {
  _dndActivated = true;
}

export function script_dndRestored() {
  _dndRestored = true;
}

export function finish() {
  if (_indicatorNotFound) {
    // Headless sessions may not expose a screen-sharing indicator.
    console.debug('[aurora-test] DND live test skipped (no indicator in this environment)');
    return;
  }

  if (!_dndActivated)
    throw new Error('DndOnShare did not disable notification banners when screen sharing started');

  if (!_dndRestored)
    throw new Error('DndOnShare did not restore notification banners when screen sharing stopped');
}
