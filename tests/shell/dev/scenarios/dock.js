import GLib from 'gi://GLib';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { getAuroraModule } from '../../support/testUtils.js';

function collectText(actor) {
  const text = typeof actor?.text === 'string' ? [actor.text] : [];
  const children = actor && actor.get_children ? actor.get_children() : [];
  for (const child of children) text.push(...collectText(child));
  return text;
}

async function waitForCondition(condition, timeoutMs = 3000) {
  const deadline = GLib.get_monotonic_time() + timeoutMs * 1000;
  while (GLib.get_monotonic_time() < deadline) {
    if (condition()) return true;
    await Scripting.sleep(50);
  }
  return condition();
}

export async function exerciseDock(settings, devTool) {
  settings.set_boolean('module-dock', true);
  await Scripting.waitLeisure();
  await Scripting.sleep(500);

  const tool = devTool.dockTool;
  if (!tool) throw new Error('Dock DevTool section not found');
  if (tool.iconName !== 'view-app-grid-symbolic')
    throw new Error(`Unexpected Dock DevTool icon: ${tool.iconName}`);

  const dock = getAuroraModule('dock');
  if (dock.bindings.length === 0) throw new Error('Dock test requires at least one binding');

  if (!tool.revealAll()) throw new Error('Dock revealAll returned false');
  await Scripting.sleep(300);
  if (!dock.bindings.every((binding) => binding.dash.visible))
    throw new Error('Dock revealAll did not show every dock');
  if (dock.bindings.some((binding) => binding.hotArea?.reactive))
    throw new Error('Dock revealAll left a hot area above a visible dock');

  if (!tool.triggerHotArea()) throw new Error('Dock triggerHotArea returned false');
  await Scripting.sleep(100);
  if (!tool.hideAll()) throw new Error('Dock hideAll returned false');
  await Scripting.sleep(300);
  if (dock.bindings.some((binding) => binding.dash.visible))
    throw new Error('Dock hideAll did not hide every dock');
  if (dock.bindings.some((binding) => binding.container.reactive))
    throw new Error('Dock hideAll left a hidden container reactive');

  const binding = dock.bindings[0];
  const monitorIndex = binding.monitorIndex;
  if (!tool.showMonitor(monitorIndex)) throw new Error('Dock showMonitor returned false');
  if (!(await waitForCondition(() => binding.dash.visible)))
    throw new Error('Dock showMonitor did not show the selected monitor');

  if (!tool.hideMonitor(monitorIndex)) throw new Error('Dock hideMonitor returned false');
  if (
    !(await waitForCondition(
      () => !binding.dash.visible && !binding.hotAreaActive && binding.hotArea?.reactive === true,
    ))
  )
    throw new Error('Dock did not hide the monitor and rearm its hot area');

  if (binding.hotArea) {
    if (!tool.triggerMonitorHotArea(monitorIndex))
      throw new Error('Dock triggerMonitorHotArea returned false');
    if (!(await waitForCondition(() => binding.hotAreaActive, 1000)))
      throw new Error('Dock did not trigger the selected monitor hot area');
  }
  if (tool.showMonitor(-1)) throw new Error('Dock showMonitor accepted an invalid monitor');

  const alwaysShowBefore = settings.get_boolean('dock-always-show');
  if (dock.alwaysShow !== alwaysShowBefore)
    throw new Error('Dock alwaysShow does not reflect the persisted setting');

  const panelBeforeToggle = tool.buildPanel();
  const textsBeforeToggle = collectText(panelBeforeToggle);
  panelBeforeToggle.destroy();
  if (!textsBeforeToggle.includes(`Always Show: ${alwaysShowBefore ? 'On' : 'Off'}`))
    throw new Error('Dock Always Show control does not display the persisted state');
  if (!textsBeforeToggle.some((text) => text.startsWith(`Monitor ${monitorIndex + 1}:`)))
    throw new Error('Dock did not render controls for the selected monitor');

  if (!tool.toggleAlwaysShow()) throw new Error('Dock toggleAlwaysShow returned false');
  await Scripting.waitLeisure();
  await Scripting.sleep(500);
  if (settings.get_boolean('dock-always-show') === alwaysShowBefore)
    throw new Error('Dock toggleAlwaysShow did not change the setting');

  const panelAfterToggle = tool.buildPanel();
  const textsAfterToggle = collectText(panelAfterToggle);
  panelAfterToggle.destroy();
  if (!textsAfterToggle.includes(`Always Show: ${alwaysShowBefore ? 'Off' : 'On'}`))
    throw new Error('Dock Always Show control did not update');

  if (!tool.toggleAlwaysShow()) throw new Error('Dock toggleAlwaysShow restore returned false');
  await Scripting.waitLeisure();
  await Scripting.sleep(500);
  if (settings.get_boolean('dock-always-show') !== alwaysShowBefore)
    throw new Error('Dock toggleAlwaysShow did not restore the setting');
}
