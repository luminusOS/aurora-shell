/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { EXTENSION_UUID, waitForExtension, waitForCondition } from '../support/testUtils.js';

const CONTENT_BOXES = ['_leftBox', '_centerBox'];
const ALL_BOXES = ['_leftBox', '_centerBox', '_rightBox'];

function actorOpacity(actor, fallback) {
  if (!actor) return fallback;
  return actor.opacity;
}

export var METRICS = {};

export function init() {
  Scripting.defineScriptEvent('hiddenOnShare', 'Panel boxes hidden when screen sharing started');
  Scripting.defineScriptEvent(
    'restoredOnShareEnd',
    'Panel boxes restored when screen sharing stopped',
  );
  Scripting.defineScriptEvent(
    'indicatorNotFound',
    'Skipping live test because the screen sharing indicator is unavailable',
  );
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);
  await Scripting.waitLeisure();

  const statusArea = Main.panel.statusArea;
  const indicator = statusArea.screenSharing || statusArea.quickSettings?._remoteAccess;

  if (!indicator) {
    console.debug(
      '[aurora-test] Skipping live PrivacyPanel test because no screen sharing indicator was found',
    );
    Scripting.scriptEvent('indicatorNotFound');

    // Verify module left panel untouched
    for (const box of ALL_BOXES) {
      const opacity = actorOpacity(Main.panel[box], 255);
      if (opacity !== 255)
        throw new Error(`PrivacyPanel left ${box} at opacity ${opacity} without sharing active`);
    }
    return;
  }

  for (const box of ALL_BOXES) {
    if (Main.panel[box]) Main.panel[box].opacity = 255;
  }
  const panelSignals = ALL_BOXES.flatMap((box) => {
    const actor = Main.panel[box];
    return actor
      ? [
          [actor, 'notify::opacity'],
          [actor, 'transitions-completed'],
        ]
      : [];
  });
  for (const actor of [indicator, indicator.container].filter(Boolean)) {
    panelSignals.push([actor, 'notify::opacity'], [actor, 'transitions-completed']);
  }
  await waitForCondition({
    evaluate: () => ALL_BOXES.every((box) => actorOpacity(Main.panel[box], 0) === 255),
    signals: panelSignals,
    description: 'panel opacity normalization to complete',
  });

  console.debug('[aurora-test] Simulating screen sharing start');
  indicator.visible = true;
  await waitForCondition({
    evaluate: () =>
      CONTENT_BOXES.every((box) => actorOpacity(Main.panel[box], 255) === 0) &&
      actorOpacity(indicator, 255) === 255 &&
      actorOpacity(indicator?.container, 255) === 255,
    signals: [[indicator, 'notify::visible'], ...panelSignals],
    description: 'panel content to hide while preserving the sharing indicator',
  });

  // _leftBox and _centerBox must be hidden; the sharing indicator must stay visible
  const contentHidden = CONTENT_BOXES.every((box) => actorOpacity(Main.panel[box], 255) === 0);
  const indicatorVisible =
    actorOpacity(indicator, 255) === 255 && actorOpacity(indicator?.container, 255) === 255;
  if (contentHidden && indicatorVisible) Scripting.scriptEvent('hiddenOnShare');

  console.debug('[aurora-test] Simulating screen sharing stop');
  indicator.visible = false;
  await waitForCondition({
    evaluate: () => ALL_BOXES.every((box) => actorOpacity(Main.panel[box], 0) === 255),
    signals: [[indicator, 'notify::visible'], ...panelSignals],
    description: 'panel content to restore after sharing stops',
  });

  const allRestored = ALL_BOXES.every((box) => actorOpacity(Main.panel[box], 0) === 255);
  if (allRestored) Scripting.scriptEvent('restoredOnShareEnd');
}

let _indicatorNotFound = false;
let _hiddenOnShare = false;
let _restoredOnShareEnd = false;

export function script_indicatorNotFound() {
  _indicatorNotFound = true;
}

export function script_hiddenOnShare() {
  _hiddenOnShare = true;
}

export function script_restoredOnShareEnd() {
  _restoredOnShareEnd = true;
}

export function finish() {
  if (_indicatorNotFound) {
    console.debug(
      '[aurora-test] PrivacyPanel live test skipped (no indicator in this environment)',
    );
    return;
  }

  if (!_hiddenOnShare)
    throw new Error('PrivacyPanel did not hide panel boxes when screen sharing started');

  if (!_restoredOnShareEnd)
    throw new Error('PrivacyPanel did not restore panel boxes when screen sharing stopped');
}
