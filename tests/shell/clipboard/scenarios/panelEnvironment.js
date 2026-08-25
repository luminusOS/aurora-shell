import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { waitForCondition, EXTENSION_UUID, getAuroraModule } from '../../support/testUtils.js';

const PANEL_CSS = 'aurora-clipboard-panel';

export function findClipboardPanel() {
  return Main.uiGroup
    .get_children()
    .find((child) => child.has_style_class_name && child.has_style_class_name(PANEL_CSS));
}

export function getClipboardModule() {
  return getAuroraModule('clipboard-history');
}

function deleteFileIfExists(file) {
  try {
    if (file.query_exists(null)) file.delete(null);
  } catch {
    // Cleanup must not hide the assertion that originally failed.
  }
}

function deleteDirectoryChildren(directory) {
  if (!directory.query_exists(null)) return;

  const enumerator = directory.enumerate_children(
    'standard::name,standard::type',
    Gio.FileQueryInfoFlags.NONE,
    null,
  );
  let info;
  while ((info = enumerator.next_file(null))) {
    const child = directory.get_child(info.get_name());
    if (info.get_file_type() === Gio.FileType.DIRECTORY) deleteDirectoryChildren(child);
    else deleteFileIfExists(child);
  }
  enumerator.close(null);
  deleteFileIfExists(directory);
}

export function clearClipboardRuntime() {
  const runtimeDir = `${GLib.get_user_runtime_dir()}/aurora-shell/${EXTENSION_UUID}`;
  deleteFileIfExists(Gio.File.new_for_path(`${runtimeDir}/clipboard-history.log`));
  deleteDirectoryChildren(Gio.File.new_for_path(`${runtimeDir}/clipboard-media`));
}

export function assertPanelInsideWorkArea(panel, monitorIndex = Main.layoutManager.primaryIndex) {
  const workArea = Main.layoutManager.getWorkAreaForMonitor(monitorIndex);
  if (
    panel.x < workArea.x ||
    panel.y < workArea.y ||
    panel.x + panel.width > workArea.x + workArea.width ||
    panel.y + panel.height > workArea.y + workArea.height
  ) {
    throw new Error(
      `Clipboard panel is outside work area: panel=${panel.x},${panel.y},${panel.width}x${panel.height} workArea=${workArea.x},${workArea.y},${workArea.width}x${workArea.height}`,
    );
  }
}

export function assertPanelAboveWindows(panel) {
  const children = Main.uiGroup.get_children();
  const panelIndex = children.indexOf(panel);
  const windowGroupIndex = children.indexOf(global.window_group);
  const topWindowGroupIndex = children.indexOf(global.top_window_group);
  if (panelIndex <= windowGroupIndex || panelIndex <= topWindowGroupIndex) {
    throw new Error(
      `Clipboard panel is behind a window group: panel=${panelIndex}, windows=${windowGroupIndex}, topWindows=${topWindowGroupIndex}`,
    );
  }
}

export function assertPanelTrackedAboveFullscreen(panel) {
  const trackedPanel = Main.layoutManager._trackedActors?.find((data) => data.actor === panel);
  if (!trackedPanel || trackedPanel.trackFullscreen !== false)
    throw new Error('Clipboard panel is not registered as top chrome visible in fullscreen');
}

async function lockAndUnlockSession() {
  if (!Main.screenShield) throw new Error('GNOME Screen Shield is unavailable');

  Main.screenShield.activate(false);
  await waitForCondition({
    evaluate: () => Main.sessionMode.currentMode === 'unlock-dialog',
    signals: [
      [Main.screenShield, 'active-changed'],
      [Main.sessionMode, 'updated'],
    ],
    description: 'session to enter unlock-dialog mode',
  });
  if (Main.sessionMode.currentMode !== 'unlock-dialog')
    throw new Error(`Session did not enter unlock-dialog mode: ${Main.sessionMode.currentMode}`);

  // Authentication is outside this test; use the successful-authentication teardown path.
  Main.screenShield._continueDeactivate(false);
  await waitForCondition({
    evaluate: () => !Main.screenShield.active && Main.sessionMode.currentMode !== 'unlock-dialog',
    signals: [
      [Main.screenShield, 'active-changed'],
      [Main.sessionMode, 'updated'],
    ],
    description: 'session to leave unlock-dialog mode',
  });
}

async function waitForWindowState(window, monitorIndex, timeoutMs = 5000) {
  await waitForCondition({
    evaluate: () =>
      window.get_monitor() === monitorIndex &&
      window.maximized_horizontally &&
      window.maximized_vertically,
    signals: [
      [window, 'position-changed'],
      [window, 'size-changed'],
      [window, 'notify::maximized-horizontally'],
      [window, 'notify::maximized-vertically'],
      [global.display, 'window-entered-monitor'],
    ],
    description: `test window to maximize on monitor ${monitorIndex}`,
    timeoutMs,
  });
}

async function focusWindow(window, timeoutMs = 5000) {
  window.activate(global.get_current_time());
  await waitForCondition({
    evaluate: () => global.display.focus_window === window,
    signals: [[global.display, 'notify::focus-window']],
    description: 'external-monitor test window to regain focus after unlock',
    timeoutMs,
  });
}

async function movePointerToMonitor(seat, monitor, timeoutMs = 5000) {
  const targetX = monitor.x + Math.floor(monitor.width / 2);
  const targetY = monitor.y + Math.floor(monitor.height / 2);
  await waitForCondition({
    evaluate: () => {
      const [pointerX, pointerY] = global.get_pointer();
      const inside =
        pointerX >= monitor.x &&
        pointerX < monitor.x + monitor.width &&
        pointerY >= monitor.y &&
        pointerY < monitor.y + monitor.height;
      if (!inside) {
        seat.warp_pointer(targetX, targetY);
        global.stage.queue_redraw(); // Guarantee another after-paint retry.
      }
      return inside;
    },
    // Mutter may ignore a warp while monitor and focus state settle.
    signals: [[global.stage, 'after-paint']],
    description: 'pointer to enter the external monitor',
    timeoutMs,
  });
}

export async function exercisePostUnlockPanel() {
  if (Main.layoutManager.monitors.length < 2)
    throw new Error(`Clipboard unlock test requires 2 monitors`);

  const monitorIndex = Main.layoutManager.monitors.findIndex(
    (_monitor, index) => index !== Main.layoutManager.primaryIndex,
  );
  const monitor = Main.layoutManager.monitors[monitorIndex];
  const seat = Clutter.get_default_backend().get_default_seat();
  const [originalPointerX, originalPointerY] = global.get_pointer();
  const previousWindows = new Set(global.get_window_actors().map((actor) => actor.meta_window));
  let module = null;

  try {
    await Scripting.createTestWindow({ width: 900, height: 650, maximized: false });
    await Scripting.waitTestWindows();
    const window = await waitForCondition({
      evaluate: () =>
        global
          .get_window_actors()
          .map((actor) => actor.meta_window)
          .find((candidate) => !previousWindows.has(candidate)),
      signals: [[global.display, 'window-created']],
      description: 'external-monitor test window to be tracked',
    });

    window.move_to_monitor(monitorIndex);
    window.activate(global.get_current_time());
    window.maximize();
    await waitForWindowState(window, monitorIndex);
    await lockAndUnlockSession();
    await waitForWindowState(window, monitorIndex);
    await focusWindow(window);
    await movePointerToMonitor(seat, monitor);

    module = getClipboardModule();
    module.openPanel();
    await Scripting.waitLeisure();
    const openedPanel = findClipboardPanel();
    if (!openedPanel?.visible || !openedPanel.mapped || !openedPanel.get_paint_visibility())
      throw new Error('Clipboard panel is not painted after unlock');
    assertPanelInsideWorkArea(openedPanel, monitorIndex);
    assertPanelAboveWindows(openedPanel);
  } finally {
    try {
      module?.closePanel();
    } finally {
      seat.warp_pointer(originalPointerX, originalPointerY);
      await Scripting.destroyTestWindows();
      await Scripting.waitLeisure();
    }
  }
}

export async function exerciseWorkspacePanel() {
  const manager = global.workspace_manager;
  const originalWorkspace = manager.get_active_workspace();
  const workspace = manager.append_new_workspace(false, global.get_current_time());

  try {
    workspace.activate(global.get_current_time());
    await Scripting.waitLeisure();
    if (manager.get_active_workspace_index() !== workspace.index())
      throw new Error('Could not activate the Clipboard test workspace');

    const module = getClipboardModule();
    module.openPanel();
    await Scripting.waitLeisure();
    const panel = findClipboardPanel();
    if (!panel?.visible || !panel.mapped)
      throw new Error('Clipboard panel is not visible on the active workspace');
    module.closePanel();
  } finally {
    originalWorkspace.activate(global.get_current_time());
    await Scripting.waitLeisure();
    manager.remove_workspace(workspace, global.get_current_time());
  }
}
