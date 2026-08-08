import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { EXTENSION_UUID, getAuroraModule } from '../../support/testUtils.js';

const PANEL_CSS = 'aurora-clipboard-panel';

export function findClipboardPanel() {
  return (
    Main.uiGroup.get_children().find((child) => child.has_style_class_name?.(PANEL_CSS)) ?? null
  );
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
  await Scripting.sleep(400);
  if (Main.sessionMode.currentMode !== 'unlock-dialog')
    throw new Error(`Session did not enter unlock-dialog mode: ${Main.sessionMode.currentMode}`);

  // Authentication is outside this test; use the successful-authentication teardown path.
  Main.screenShield._continueDeactivate(false);
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!Main.screenShield.active && Main.sessionMode.currentMode !== 'unlock-dialog') return;
    await Scripting.sleep(100);
  }
  throw new Error(`Session did not unlock: mode=${Main.sessionMode.currentMode}`);
}

async function waitForWindowState(window, monitorIndex, timeoutMs = 5000) {
  const deadline = GLib.get_monotonic_time() + timeoutMs * 1000;
  while (
    window.get_monitor() !== monitorIndex ||
    !window.maximized_horizontally ||
    !window.maximized_vertically
  ) {
    if (GLib.get_monotonic_time() >= deadline) {
      throw new Error(
        `Window did not settle on monitor ${monitorIndex}: monitor=${window.get_monitor()} horizontal=${window.maximized_horizontally} vertical=${window.maximized_vertically}`,
      );
    }
    await Scripting.sleep(100);
  }
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

  try {
    await Scripting.createTestWindow({ width: 900, height: 650, maximized: false });
    await Scripting.waitTestWindows();
    await Scripting.sleep(200);

    const window = global
      .get_window_actors()
      .map((actor) => actor.meta_window)
      .find((candidate) => !previousWindows.has(candidate));
    if (!window) throw new Error('Could not create the external-monitor test window');

    window.move_to_monitor(monitorIndex);
    window.activate(global.get_current_time());
    window.maximize();
    await waitForWindowState(window, monitorIndex);
    await lockAndUnlockSession();
    await waitForWindowState(window, monitorIndex);

    seat.warp_pointer(
      monitor.x + Math.floor(monitor.width / 2),
      monitor.y + Math.floor(monitor.height / 2),
    );
    await Scripting.sleep(100);

    const module = getClipboardModule();
    module.openPanel();
    await Scripting.waitLeisure();
    await Scripting.sleep(300);
    const openedPanel = findClipboardPanel();
    if (!openedPanel?.visible || !openedPanel.mapped || !openedPanel.get_paint_visibility())
      throw new Error('Clipboard panel is not painted after unlock');
    assertPanelInsideWorkArea(openedPanel, monitorIndex);
    assertPanelAboveWindows(openedPanel);
  } finally {
    getClipboardModule().closePanel();
    seat.warp_pointer(originalPointerX, originalPointerY);
    await Scripting.destroyTestWindows();
    await Scripting.waitLeisure();
    await Scripting.sleep(300);
  }
}

export async function exerciseWorkspacePanel() {
  const manager = global.workspace_manager;
  const originalWorkspace = manager.get_active_workspace();
  const workspace = manager.append_new_workspace(false, global.get_current_time());

  try {
    workspace.activate(global.get_current_time());
    await Scripting.waitLeisure();
    await Scripting.sleep(300);
    if (manager.get_active_workspace_index() !== workspace.index())
      throw new Error('Could not activate the Clipboard test workspace');

    const module = getClipboardModule();
    module.openPanel();
    await Scripting.waitLeisure();
    await Scripting.sleep(200);
    const panel = findClipboardPanel();
    if (!panel?.visible || !panel.mapped)
      throw new Error('Clipboard panel is not visible on the active workspace');
    module.closePanel();
  } finally {
    originalWorkspace.activate(global.get_current_time());
    await Scripting.waitLeisure();
    await Scripting.sleep(300);
    manager.remove_workspace(workspace, global.get_current_time());
  }
}
