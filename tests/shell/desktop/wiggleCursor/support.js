import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { waitForActorState, waitForCondition, waitForTiming } from '../../support/testUtils.js';

export const MAGNIFICATION = 5;

const SHAKE_SAMPLES = 5;

/**
 * Four short strokes, the least that counts as a deliberate shake.
 *
 * @param {Clutter.VirtualInputDevice} pointer
 * @param {number} [settleMs] Delay after the last sample before returning.
 */
export async function shake(pointer, settleMs = 60) {
  const tracker = global.backend.get_cursor_tracker();
  for (let i = 0; i < SHAKE_SAMPLES; i++) {
    const x = 400 + (i % 2) * 100;
    const arrived = waitForCondition({
      evaluate: () => {
        const [position] = tracker.get_pointer();
        return position && position.x === x && position.y === 350;
      },
      signals: [[tracker, 'position-invalidated']],
      description: `deliberate shake sample ${i} to reach the pointer tracker`,
    });
    pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, 350);
    await arrived;

    const last = i === SHAKE_SAMPLES - 1;
    if (!last) await waitForTiming(60, 'Delay each reversal to deliver a shake within 800ms');
    else if (settleMs > 0) await waitForTiming(settleMs, 'Delay settling after the last sample');
  }
}

export function findOverlay() {
  return Main.uiGroup.get_children().find((actor) => actor.name === 'aurora-wiggle-cursor');
}

/**
 * Run `action`, then give an enlargement time to load its image, and throw if the overlay was
 * ever shown. Watching the signal matters: the cursor shrinks again on its own after about 350 ms,
 * so looking at its state afterwards could pass for a cursor that did grow.
 */
export async function expectNoEnlargement(overlay, action, message) {
  let shown = false;
  const shownId = overlay.connect('notify::visible', () => {
    if (overlay.visible) shown = true;
  });

  try {
    await action();
    await waitForTiming(300, 'Negative check: an enlargement loads its image asynchronously');
  } finally {
    overlay.disconnect(shownId);
  }
  if (shown) throw new Error(message);
}

export function waitForEnlarged(actor) {
  return waitForActorState(actor, (a) => a.visible && Math.abs(a.scale_x - MAGNIFICATION) < 0.01, {
    properties: ['visible', 'scale-x'],
    description: `fixed ${MAGNIFICATION}x cursor enlargement`,
  });
}

/**
 * Keep shaking the pointer until `action` settles, so the cursor stays enlarged meanwhile.
 *
 * @param {{x: number, y: number}} [origin] Where the shake is centred on the stage.
 */
export async function whileShaking(pointer, action, origin = { x: 400, y: 350 }) {
  let shaking = true;
  const keepShaking = (async () => {
    for (let i = 0; shaking; i++) {
      pointer.notify_absolute_motion(GLib.get_monotonic_time(), origin.x + (i % 2) * 100, origin.y);
      await waitForTiming(60, 'Delay each reversal of a continuous shake');
    }
  })();

  try {
    return await action();
  } finally {
    shaking = false;
    await keepShaking;
  }
}
