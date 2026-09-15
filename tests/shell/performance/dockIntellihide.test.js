/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {
  EXTENSION_UUID,
  getAuroraModule,
  getAuroraSettings,
  waitForCondition,
  waitForExtension,
} from '../support/testUtils.js';

export var METRICS = {};

export function init() {
  Scripting.defineScriptEvent(
    'dockGeometryChecksCoalesced',
    'Dock geometry bursts produce at most one overlap check per frame',
  );
  Scripting.defineScriptEvent(
    'dockPendingCheckCancelled',
    'Dock teardown cancels its pending overlap check',
  );
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);

  const settings = getAuroraSettings();
  const originalIntellihide = settings.get_boolean('dock-intellihide');
  settings.set_boolean('dock-intellihide', true);
  await Scripting.waitLeisure();

  try {
    const dock = getAuroraModule('dock');
    const intellihide = dock?.bindings?.[0]?.intellihide;
    if (!intellihide) throw new Error('Dock intellihide is unavailable');

    intellihide._queuedRefreshes.clear();
    intellihide._settle.clear();

    const originalCheckOverlap = intellihide._checkOverlap;
    let overlapChecks = 0;
    intellihide._checkOverlap = () => {
      overlapChecks++;
    };

    const inputSignals = 1_000;
    try {
      for (let index = 0; index < inputSignals; index++) intellihide._markDirty('benchmark');
      await waitForCondition({
        evaluate: () => overlapChecks >= 1,
        signals: [[global.stage, 'after-paint']],
        description: 'coalesced Dock overlap check',
      });
    } finally {
      intellihide._checkOverlap = originalCheckOverlap;
    }
    if (overlapChecks !== 1)
      throw new Error(`${inputSignals} geometry signals produced ${overlapChecks} overlap checks`);

    METRICS = {
      inputSignals,
      uncoalescedPotentialChecks: inputSignals,
      optimizedChecks: overlapChecks,
      reductionPercent: ((inputSignals - overlapChecks) / inputSignals) * 100,
    };
    Scripting.scriptEvent('dockGeometryChecksCoalesced');

    let mixedBurstChecks = 0;
    intellihide._checkOverlap = function (...args) {
      mixedBurstChecks++;
      return originalCheckOverlap.apply(this, args);
    };
    try {
      intellihide._markDirty('geometry-before-state');
      intellihide.refresh('discrete-state');
      await Scripting.waitLeisure();
    } finally {
      intellihide._checkOverlap = originalCheckOverlap;
    }
    if (mixedBurstChecks !== 1)
      throw new Error(`Mixed geometry/state burst produced ${mixedBurstChecks} overlap checks`);

    const teardownSubject = new intellihide.constructor(0);
    teardownSubject._queuedRefreshes.clear();
    teardownSubject._settle.clear();
    let postDestroyChecks = 0;
    teardownSubject._checkOverlap = () => {
      postDestroyChecks++;
    };
    teardownSubject._markDirty('teardown-benchmark');
    teardownSubject.destroy();
    await Scripting.waitLeisure();
    if (postDestroyChecks !== 0)
      throw new Error(`Dock teardown allowed ${postDestroyChecks} pending overlap checks`);
    Scripting.scriptEvent('dockPendingCheckCancelled');
  } finally {
    settings.set_boolean('dock-intellihide', originalIntellihide);
    await Scripting.waitLeisure();
  }
}

export function script_dockGeometryChecksCoalesced() {
  return METRICS;
}

export function script_dockPendingCheckCancelled() {
  return true;
}
