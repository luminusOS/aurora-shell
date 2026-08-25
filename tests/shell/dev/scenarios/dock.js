import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { getAuroraModule, waitForCondition } from '../../support/testUtils.js';

function collectText(actor) {
  const text = typeof actor?.text === 'string' ? [actor.text] : [];
  const children = actor && actor.get_children ? actor.get_children() : [];
  for (const child of children) text.push(...collectText(child));
  return text;
}

export async function exerciseDock(settings, devTool) {
  settings.set_boolean('module-dock', true);
  await Scripting.waitLeisure();

  const tool = devTool.dockTool;
  if (!tool) throw new Error('Dock DevTool section not found');
  if (tool.iconName !== 'view-app-grid-symbolic')
    throw new Error(`Unexpected Dock DevTool icon: ${tool.iconName}`);

  const dock = getAuroraModule('dock');
  if (dock.bindings.length === 0) throw new Error('Dock test requires at least one binding');
  const bindingSignals = dock.bindings.flatMap((binding) => [
    [binding.dash, 'notify::visible'],
    [binding.dash, 'transitions-completed'],
    [binding.container, 'notify::reactive'],
    ...(binding.hotArea ? [[binding.hotArea, 'notify::reactive']] : []),
  ]);

  if (!tool.revealAll()) throw new Error('Dock revealAll returned false');
  await waitForCondition({
    evaluate: () =>
      dock.bindings.every((binding) => binding.dash.visible) &&
      dock.bindings.every((binding) => !binding.hotArea?.reactive),
    signals: bindingSignals,
    description: 'all Dock bindings to finish revealing',
  });
  if (!dock.bindings.every((binding) => binding.dash.visible))
    throw new Error('Dock revealAll did not show every dock');
  if (dock.bindings.some((binding) => binding.hotArea?.reactive))
    throw new Error('Dock revealAll left a hot area above a visible dock');

  if (!tool.triggerHotArea()) throw new Error('Dock triggerHotArea returned false');
  await waitForCondition({
    evaluate: () => dock.bindings.some((binding) => binding.hotAreaActive),
    signals: bindingSignals,
    description: 'a Dock hot area to become active',
  });
  if (!tool.hideAll()) throw new Error('Dock hideAll returned false');
  await waitForCondition({
    evaluate: () =>
      dock.bindings.every((binding) => !binding.dash.visible) &&
      dock.bindings.every((binding) => !binding.container.reactive),
    signals: bindingSignals,
    description: 'all Dock bindings to finish hiding',
  });
  if (dock.bindings.some((binding) => binding.dash.visible))
    throw new Error('Dock hideAll did not hide every dock');
  if (dock.bindings.some((binding) => binding.container.reactive))
    throw new Error('Dock hideAll left a hidden container reactive');

  const binding = dock.bindings[0];
  const monitorIndex = binding.monitorIndex;
  if (!tool.showMonitor(monitorIndex)) throw new Error('Dock showMonitor returned false');
  await waitForCondition({
    evaluate: () => binding.dash.visible,
    signals: bindingSignals,
    description: 'selected monitor Dock to become visible',
  });

  if (!tool.hideMonitor(monitorIndex)) throw new Error('Dock hideMonitor returned false');
  await waitForCondition({
    evaluate: () =>
      !binding.dash.visible && !binding.hotAreaActive && binding.hotArea?.reactive === true,
    signals: bindingSignals,
    description: 'selected monitor Dock to hide and rearm its hot area',
  });

  if (binding.hotArea) {
    if (!tool.triggerMonitorHotArea(monitorIndex))
      throw new Error('Dock triggerMonitorHotArea returned false');
    await waitForCondition({
      evaluate: () => binding.hotAreaActive,
      signals: bindingSignals,
      description: 'selected monitor hot area to become active',
      timeoutMs: 1000,
    });
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
  if (settings.get_boolean('dock-always-show') === alwaysShowBefore)
    throw new Error('Dock toggleAlwaysShow did not change the setting');

  const panelAfterToggle = tool.buildPanel();
  const textsAfterToggle = collectText(panelAfterToggle);
  panelAfterToggle.destroy();
  if (!textsAfterToggle.includes(`Always Show: ${alwaysShowBefore ? 'Off' : 'On'}`))
    throw new Error('Dock Always Show control did not update');

  if (!tool.toggleAlwaysShow()) throw new Error('Dock toggleAlwaysShow restore returned false');
  await Scripting.waitLeisure();
  if (settings.get_boolean('dock-always-show') !== alwaysShowBefore)
    throw new Error('Dock toggleAlwaysShow did not restore the setting');

  const originalPosition = settings.get_user_value('dock-position');
  settings.set_string('dock-position', 'bottom');
  await Scripting.waitLeisure();

  const positionPanel = tool.buildPanel();
  const positionTexts = collectText(positionPanel);
  positionPanel.destroy();
  if (!positionTexts.some((text) => text.includes('Position: Bottom')))
    throw new Error('Dock DevTool summary did not display the configured position');
  for (const label of ['Left', 'Right'])
    if (!positionTexts.includes(label))
      throw new Error(`Dock DevTool did not render the ${label} position control`);

  if (tool.setPosition('bottom'))
    throw new Error('Dock setPosition re-applied the active position');

  if (!tool.setPosition('left')) throw new Error('Dock setPosition returned false');
  await Scripting.waitLeisure();
  if (settings.get_string('dock-position') !== 'left')
    throw new Error('Dock setPosition did not persist the position');
  if (getAuroraModule('dock').bindings.some((candidate) => candidate.dash._position !== 'left'))
    throw new Error('Dock setPosition did not rebuild the dash on the new edge');

  if (!tool.cyclePosition()) throw new Error('Dock cyclePosition returned false');
  await Scripting.waitLeisure();
  if (settings.get_string('dock-position') !== 'right')
    throw new Error('Dock cyclePosition did not advance to the next edge');

  if (!tool.cyclePosition()) throw new Error('Dock cyclePosition wrap returned false');
  await Scripting.waitLeisure();
  if (settings.get_string('dock-position') !== 'bottom')
    throw new Error('Dock cyclePosition did not wrap back to the bottom edge');

  if (originalPosition === null) {
    settings.reset('dock-position');
  } else {
    settings.set_value('dock-position', originalPosition);
  }
  await Scripting.waitLeisure();

  const originalIconSize = settings.get_user_value('dock-icon-size');
  settings.set_int('dock-icon-size', 32);
  await Scripting.waitLeisure();

  const iconSizePanel = tool.buildPanel();
  const iconSizeTexts = collectText(iconSizePanel);
  iconSizePanel.destroy();
  if (!iconSizeTexts.some((text) => text.includes('Icon size: 32px')))
    throw new Error('Dock DevTool summary did not display the configured icon size');
  if (!iconSizeTexts.includes('Smaller Icons') || !iconSizeTexts.includes('Larger Icons'))
    throw new Error('Dock DevTool did not render both icon size controls');

  if (!tool.decreaseIconSize()) throw new Error('Dock decreaseIconSize returned false');
  await Scripting.waitLeisure();
  if (settings.get_int('dock-icon-size') !== 31)
    throw new Error('Dock decreaseIconSize did not decrease the persisted size');

  if (!tool.increaseIconSize()) throw new Error('Dock increaseIconSize returned false');
  await Scripting.waitLeisure();
  if (settings.get_int('dock-icon-size') !== 32)
    throw new Error('Dock increaseIconSize did not increase the persisted size');

  settings.set_int('dock-icon-size', 63);
  if (!tool.increaseIconSize()) throw new Error('Dock increaseIconSize rejected 63px');
  if (!tool.decreaseIconSize()) throw new Error('Dock decreaseIconSize rejected 64px');
  if (settings.get_int('dock-icon-size') !== 63)
    throw new Error(
      'Dock icon size controls did not preserve an unaligned value after a round trip',
    );

  settings.set_int('dock-icon-size', 16);
  if (!tool.decreaseIconSize()) throw new Error('Dock decreaseIconSize rejected the lower bound');
  if (settings.get_int('dock-icon-size') !== 16)
    throw new Error('Dock decreaseIconSize crossed the 16px lower bound');

  settings.set_int('dock-icon-size', 64);
  if (!tool.increaseIconSize()) throw new Error('Dock increaseIconSize rejected the upper bound');
  if (settings.get_int('dock-icon-size') !== 64)
    throw new Error('Dock increaseIconSize crossed the 64px upper bound');

  if (originalIconSize === null) {
    settings.reset('dock-icon-size');
  } else {
    settings.set_value('dock-icon-size', originalIconSize);
  }
}
