import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { waitForCondition, waitForTiming } from '../../support/testUtils.js';

export async function exerciseMonitorScope(settings, dock) {
  if (
    dock?.bindings?.length !== 1 ||
    dock.bindings[0]?.monitorIndex !== Main.layoutManager.primaryIndex
  )
    throw new Error(`Primary-only Dock has invalid bindings`);

  const monitorIndex = Main.layoutManager.monitors.findIndex(
    (_monitor, index) => index !== Main.layoutManager.primaryIndex,
  );
  if (monitorIndex < 0) throw new Error('Dock scope test requires an external monitor');

  const externalWindow = {
    get_monitor: () => monitorIndex,
    is_on_all_workspaces: () => false,
    get_workspace: () => global.workspace_manager.get_active_workspace(),
    is_skip_taskbar: () => false,
  };
  if (!dock.bindings[0].dash._applications.isWindowRelevant(externalWindow))
    throw new Error('Primary-only Dock excluded an external-monitor app');
  Scripting.scriptEvent('primaryMonitorOnly');

  settings.set_boolean('dock-show-on-all-monitors', true);
  await Scripting.waitLeisure();
  if (dock.bindings.length !== Main.layoutManager.monitors.length)
    throw new Error(`All-monitors Dock created ${dock.bindings.length} bindings`);

  const primary = dock.bindings.find(
    (binding) => binding.monitorIndex === Main.layoutManager.primaryIndex,
  );
  const external = dock.bindings.find((binding) => binding.monitorIndex === monitorIndex);
  if (!primary || !external) throw new Error('All-monitors Dock did not create required bindings');
  if (primary.dash._applications.isWindowRelevant(externalWindow))
    throw new Error('Primary Dock included an external-monitor app');
  if (!external.dash._applications.isWindowRelevant(externalWindow))
    throw new Error('External Dock excluded its monitor app');
  Scripting.scriptEvent('allMonitorsEnabled');
}

function assertStable(binding, bounds) {
  const dash = binding.dash;
  const current = dash.targetBox;
  if (
    !dash.visible ||
    !dash.mapped ||
    !dash.get_paint_visibility() ||
    dash.opacity !== 255 ||
    dash.translation_y !== 0 ||
    dash.scale_x !== 1 ||
    dash.scale_y !== 1 ||
    !binding.container.visible ||
    !current ||
    current.x !== bounds.x ||
    current.y !== bounds.y ||
    current.width !== bounds.width ||
    current.height !== bounds.height
  )
    throw new Error(`Dock actor changed on monitor ${binding.monitorIndex}`);
}

async function exerciseBinding(dock, binding) {
  const previousWindows = new Set(global.get_window_actors().map((actor) => actor.meta_window));
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

  window.move_to_monitor(binding.monitorIndex);
  window.maximize();
  await Scripting.waitLeisure();

  const hovered = binding.dash._visibility._hovered;
  binding.dash.hide(false);
  binding.hotAreaActive = false;
  binding.dash._visibility._hovered = true;
  try {
    if (!dock.revealMonitorFromHotArea(binding.monitorIndex))
      throw new Error(`Could not reveal Dock on monitor ${binding.monitorIndex}`);
    await waitForTiming(
      1900,
      'cross the external-monitor hot-area reveal grace before stability sampling',
    );

    const bounds = binding.dash.targetBox;
    if (!bounds) throw new Error(`Dock on monitor ${binding.monitorIndex} lost its bounds`);
    for (let sample = 0; sample < 8; sample++) {
      assertStable(binding, bounds);
      await waitForTiming(
        120,
        'sample external-monitor Dock invariance across the animation clock',
      );
    }
  } finally {
    binding.dash._visibility._hovered = hovered;
  }
  await Scripting.waitLeisure();
}

export async function exerciseExternalWorkspace(dock) {
  // Virtual monitors cover actor placement, not physical scanout.
  if (Main.layoutManager.monitors.length < 3)
    throw new Error('External workspace test requires 3 monitors');

  const manager = global.workspace_manager;
  const originalWorkspace = manager.get_active_workspace();
  const mutterSettings = new Gio.Settings({ schema_id: 'org.gnome.mutter' });
  const wmSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.wm.preferences' });
  const dynamicWorkspaces = mutterSettings.get_boolean('dynamic-workspaces');
  const workspaceCount = wmSettings.get_int('num-workspaces');
  mutterSettings.set_boolean('dynamic-workspaces', false);
  wmSettings.set_int('num-workspaces', Math.max(2, workspaceCount));
  await Scripting.waitLeisure();

  const workspace = manager.get_workspace_by_index(1);
  if (!workspace) throw new Error('Could not create the second workspace');
  try {
    workspace.activate(global.get_current_time());
    await Scripting.waitLeisure();

    const bindings = dock.bindings.filter(
      (binding) => binding.monitorIndex !== Main.layoutManager.primaryIndex,
    );
    if (bindings.length !== 2) throw new Error(`Expected 2 external bindings`);
    for (const binding of bindings) await exerciseBinding(dock, binding);
  } finally {
    originalWorkspace.activate(global.get_current_time());
    await Scripting.waitLeisure();
    await Scripting.destroyTestWindows();
    await Scripting.waitLeisure();
    wmSettings.set_int('num-workspaces', workspaceCount);
    mutterSettings.set_boolean('dynamic-workspaces', dynamicWorkspaces);
  }

  Scripting.scriptEvent('externalWorkspaceActorStable');
}
