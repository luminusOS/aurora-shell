/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { EXTENSION_UUID, waitForCondition, waitForExtension } from '../support/testUtils.js';

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

  const extension = Main.extensionManager.lookup(EXTENSION_UUID);
  const { DockIntellihide } = await import(`${extension.dir.get_uri()}/dock/intellihide.js`);
  const intellihide = new DockIntellihide(Main.layoutManager.primaryIndex);

  try {
    Main.overview.hide();
    const previous = new Set(global.get_window_actors());
    await Scripting.createTestWindow({ width: 640, height: 400 });
    await Scripting.waitTestWindows();
    await Scripting.waitLeisure();
    const window = await waitForCondition({
      evaluate: () => global.get_window_actors().find((actor) => !previous.has(actor))?.meta_window,
      signals: [[global.stage, 'after-paint']],
      description: 'mapped geometry benchmark window',
    });
    await waitForCondition({
      evaluate: () => {
        intellihide.refresh('await-geometry');
        return intellihide._trackedWindows.has(window);
      },
      signals: [[global.stage, 'after-paint']],
      description: 'test window eligible for overlap tracking',
    });
    const getFrame = window.get_frame_rect;
    let frameReads = 0;
    window.get_frame_rect = function () {
      frameReads++;
      return getFrame.call(this);
    };
    try {
      intellihide.refresh('geometry-budget');
    } finally {
      delete window.get_frame_rect;
    }
    if (frameReads !== 1) throw new Error(`Expected one frame read, got ${frameReads}`);

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
      frameReads,
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
    intellihide.destroy();
    await Scripting.destroyTestWindows();
  }
}

export function script_dockGeometryChecksCoalesced() {
  return METRICS;
}

export function script_dockPendingCheckCancelled() {
  return true;
}
