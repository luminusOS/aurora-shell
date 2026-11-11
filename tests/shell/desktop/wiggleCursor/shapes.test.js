/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { setMonitorScales } from './displayConfig.js';
import { assertDrawnFromTheme, searchThemeFor } from './themeCursor.js';
import {
  EXTENSION_UUID,
  ensureOverviewHidden,
  waitForExtension,
  waitForTiming,
} from '../../support/testUtils.js';

export var METRICS = {};
let completed = false;

// Whole-pixel scales are reproduced exactly; 4/3 is the fractional one, and the hardest, that the
// match limit has to allow for. The 1280x720 monitor of the test session accepts no others.
const SCALES = [1, 1.25, 4 / 3];
// Theme shapes that have an SVG of their own, by the name of their file.
const SHAPES = {
  DEFAULT: 'default',
  POINTER: 'pointer',
  TEXT: 'text',
  CROSSHAIR: 'crosshair',
  HELP: 'help',
  CELL: 'cell',
  ALIAS: 'alias',
  COPY: 'copy',
  GRAB: 'grab',
  GRABBING: 'grabbing',
  NOT_ALLOWED: 'not-allowed',
  ZOOM_IN: 'zoom-in',
  ALL_SCROLL: 'all-scroll',
  COL_RESIZE: 'col-resize',
  ROW_RESIZE: 'row-resize',
  N_RESIZE: 'n-resize',
  E_RESIZE: 'e-resize',
  NE_RESIZE: 'ne-resize',
};
// Animated in the theme: no single SVG reproduces them.
const ANIMATED = ['WAIT', 'PROGRESS'];

export function init() {
  Scripting.defineScriptEvent('wiggleCursorShapesVerified', 'Wiggle cursor shapes verified');
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);
  await ensureOverviewHidden();
  const seat = global.stage.context.get_backend().get_default_seat();
  const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
  const tracker = global.backend.get_cursor_tracker();
  const originalScales = Main.layoutManager.monitors.map((_monitor, index) =>
    global.display.get_monitor_scale(index),
  );
  const [originalX, originalY] = global.get_pointer();
  const surface = new Clutter.Actor({
    x: 300,
    y: 250,
    width: 200,
    height: 100,
    reactive: true,
    cursor_type: Clutter.CursorType.DEFAULT,
  });
  Main.uiGroup.add_child(surface);

  const pointAt = async (cursorType) => {
    surface.cursor_type = Clutter.CursorType[cursorType];
    pointer.notify_absolute_motion(GLib.get_monotonic_time(), 280, 280);
    await waitForTiming(120, 'Delay for the Shell to leave the previous cursor shape');
    pointer.notify_absolute_motion(GLib.get_monotonic_time(), 400, 300);
    await waitForTiming(200, 'Delay for the Shell to apply the new cursor shape');
  };

  try {
    for (const scale of SCALES) {
      await setMonitorScales([scale]);

      for (const [cursorType, name] of Object.entries(SHAPES)) {
        await pointAt(cursorType);
        const cursor = await searchThemeFor(tracker);
        if (!cursor) throw new Error(`${name} found no theme shape at scale ${scale}`);
        try {
          await assertDrawnFromTheme(cursor.content.get_texture(), name);
        } catch (error) {
          throw new Error(`${name} at scale ${scale}: ${error.message}`);
        }
      }

      for (const cursorType of ANIMATED) {
        await pointAt(cursorType);
        if (await searchThemeFor(tracker))
          throw new Error(`${cursorType} was taken for a theme shape at scale ${scale}`);
      }
    }

    Scripting.scriptEvent('wiggleCursorShapesVerified');
  } finally {
    surface.destroy();
    await setMonitorScales(originalScales);
    seat.warp_pointer(originalX, originalY);
  }
}

export function script_wiggleCursorShapesVerified() {
  completed = true;
}

export function finish() {
  if (!completed) throw new Error('Wiggle Cursor shapes were not verified');
}
