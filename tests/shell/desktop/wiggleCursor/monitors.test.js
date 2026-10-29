/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { setMonitorScales } from './displayConfig.js';
import { waitForEnlarged, whileShaking } from './support.js';
import { assertCursorGeometry, assertDrawnFromTheme } from './themeCursor.js';
import {
  EXTENSION_UUID,
  ensureOverviewHidden,
  getAuroraSettings,
  waitForActorState,
  waitForExtension,
  waitForModuleState,
} from '../../support/testUtils.js';

export var METRICS = {};
let completed = false;

// A laptop panel next to an external monitor at a fractional scale, as on many desks.
const MONITOR_SCALES = [1, 4 / 3];

export function init() {
  Scripting.defineScriptEvent(
    'wiggleCursorMonitorsVerified',
    'Wiggle cursor verified on every monitor',
  );
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);
  await ensureOverviewHidden();
  const settings = getAuroraSettings();
  const originalEnabled = settings.get_boolean('module-wiggle-cursor');
  const seat = global.stage.context.get_backend().get_default_seat();
  const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
  const [originalX, originalY] = global.get_pointer();

  let originalScales = null;
  try {
    settings.set_boolean('module-wiggle-cursor', true);
    await waitForModuleState(settings, 'module-wiggle-cursor', 'wiggle-cursor', true);
    originalScales = Main.layoutManager.monitors.map((_monitor, index) =>
      global.display.get_monitor_scale(index),
    );
    await setMonitorScales(MONITOR_SCALES);
    if (Main.layoutManager.monitors.length !== MONITOR_SCALES.length)
      throw new Error(`Expected ${MONITOR_SCALES.length} monitors`);

    const actor = Main.uiGroup
      .get_children()
      .find((child) => child.name === 'aurora-wiggle-cursor');
    const sprite = actor.get_first_child();

    for (const [index, monitor] of Main.layoutManager.monitors.entries()) {
      const origin = { x: monitor.x + 300, y: monitor.y + 300 };
      pointer.notify_absolute_motion(Date.now() * 1000, origin.x, origin.y);

      await whileShaking(
        pointer,
        async () => {
          await waitForEnlarged(actor);
          assertCursorGeometry(sprite, global.backend.get_cursor_tracker());
          await assertDrawnFromTheme(sprite.content.get_texture(), 'default');

          // The default arrow is 32 px wide with its tip at (8, 7) at the default cursor size, and
          // the Shell's truncated texture hotspot must not leak into where the arrow is drawn.
          if (
            Math.abs(sprite.width - 32) > 0.01 ||
            Math.abs(sprite.x + 8) > 0.01 ||
            Math.abs(sprite.y + 7) > 0.01
          )
            throw new Error(
              `Monitor ${index} draws the arrow ${sprite.width} px wide with its tip at ` +
                `(${-sprite.x}, ${-sprite.y})`,
            );
        },
        origin,
      );

      await waitForActorState(actor, (a) => !a.visible, {
        properties: ['visible'],
        description: `cursor to shrink after shaking on monitor ${index}`,
        timeoutMs: 1500,
      });
    }

    Scripting.scriptEvent('wiggleCursorMonitorsVerified');
  } finally {
    if (originalScales) await setMonitorScales(originalScales);
    settings.set_boolean('module-wiggle-cursor', originalEnabled);
    seat.warp_pointer(originalX, originalY);
  }
}

export function script_wiggleCursorMonitorsVerified() {
  completed = true;
}

export function finish() {
  if (!completed) throw new Error('Wiggle Cursor was not verified on every monitor');
}
