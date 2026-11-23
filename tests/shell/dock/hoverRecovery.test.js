/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {
  ensureOverviewHidden,
  EXTENSION_UUID,
  getAuroraModule,
  getAuroraSettings,
  waitForActorState,
  waitForCondition,
  waitForExtension,
  waitForTiming,
} from '../support/testUtils.js';

export function init() {
  Scripting.defineScriptEvent(
    'dockLostLeaveRecovered',
    'Dock recovers a missing pointer leave without another hover notification',
  );
  Scripting.defineScriptEvent(
    'dockStaleHoverRecovered',
    'Dock ignores stale hover when the pointer is outside its mapped geometry',
  );
  Scripting.defineScriptEvent(
    'dockVisibilityHoldsPreserved',
    'Pointer reconciliation preserves open menus, icon drags and pinned visibility',
  );
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);
  await ensureOverviewHidden();

  const settings = getAuroraSettings();
  const originalSettings = new Map(
    ['module-dock', 'dock-always-show', 'dock-intellihide', 'dock-show-on-all-monitors'].map(
      (key) => [key, settings.get_boolean(key)],
    ),
  );
  const originalGetPointer = global.get_pointer;
  let visibility = null;
  let originalMenuCheck = null;

  try {
    settings.set_boolean('module-dock', true);
    settings.set_boolean('dock-always-show', false);
    settings.set_boolean('dock-intellihide', false);
    settings.set_boolean('dock-show-on-all-monitors', false);
    await Scripting.waitLeisure();

    const dock = getAuroraModule('dock');
    const binding = dock.bindings[0];
    const dash = binding.dash;
    visibility = dash._visibility;
    originalMenuCheck = visibility._options.isMenuOpen;
    visibility.blockAutoHide(true);
    dash.show(false);
    await Scripting.waitLeisure();
    await waitForCondition({
      evaluate: () => dash._dashContainer.mapped && dash._dashContainer.width > 0,
      signals: [
        [dash._dashContainer, 'notify::mapped'],
        [dash._dashContainer, 'notify::allocation'],
      ],
      description: 'Dock hover region to be mapped and allocated',
    });

    const [x, y] = dash._dashContainer.get_transformed_position();
    let pointer = [x + dash._dashContainer.width / 2, y + dash._dashContainer.height / 2, 0];
    global.get_pointer = () => pointer;
    dash._dashContainer.set_hover(true);
    visibility.blockAutoHide(false);
    await waitForTiming(450, 'keep the pointer over the Dock beyond the autohide deadline');
    if (!dash.visible || !visibility._autohideTimeout.active)
      throw new Error(
        `Hovered Dock did not retain visibility: visible=${dash.visible} ` +
          `hovered=${visibility.hovered} target=${visibility._target} ` +
          `blocked=${visibility._blockAutoHide} timer=${visibility._autohideTimeout.active} ` +
          `pointer=${pointer} mapped=${dash._dashContainer.mapped} ` +
          `position=${dash._dashContainer.get_transformed_position()} ` +
          `size=${dash._dashContainer.width},${dash._dashContainer.height}`,
      );

    // Change only the pointer sample: no leave event or hover notification.
    pointer = [x - 100, y - 100, 0];
    await waitForActorState(dash, (actor) => !actor.visible, {
      properties: ['visible'],
      description: 'Dock to recover the lost pointer leave automatically',
    });
    if (visibility.hovered) throw new Error('Recovered Dock retained its stale hover state');
    Scripting.scriptEvent('dockLostLeaveRecovered');

    visibility.blockAutoHide(true);
    dash.show(false);
    dash._dashContainer.set_hover(true);
    visibility.blockAutoHide(false);
    await waitForActorState(dash, (actor) => !actor.visible, {
      properties: ['visible'],
      description: 'Dock to hide despite a stale native hover value',
    });
    Scripting.scriptEvent('dockStaleHoverRecovered');

    let menuOpen = true;
    visibility._options.isMenuOpen = () => menuOpen;
    visibility.blockAutoHide(true);
    dash.show(false);
    visibility.blockAutoHide(false);
    await waitForTiming(450, 'keep an open Dock menu beyond the autohide deadline');
    if (!dash.visible) throw new Error('Pointer reconciliation hid the Dock with its menu open');
    menuOpen = false;
    await waitForActorState(dash, (actor) => !actor.visible, {
      properties: ['visible'],
      description: 'Dock to hide after its menu closes without a hover notification',
    });

    visibility.blockAutoHide(true);
    dash.show(false);
    visibility.beginItemDrag();
    visibility.blockAutoHide(false);
    await waitForTiming(450, 'hold an icon drag beyond the autohide deadline');
    if (!dash.visible) throw new Error('Pointer reconciliation hid the Dock during an icon drag');
    visibility.endItemDrag();
    await waitForActorState(dash, (actor) => !actor.visible, {
      properties: ['visible'],
      description: 'Dock to restore autohide after its icon drag ends',
    });

    visibility.blockAutoHide(true);
    dash.show(false);
    await waitForTiming(450, 'keep pinned visibility beyond the autohide deadline');
    if (!dash.visible || visibility._autohideTimeout.active)
      throw new Error('Pinned Dock lost visibility or kept polling the pointer unnecessarily');
    Scripting.scriptEvent('dockVisibilityHoldsPreserved');
  } finally {
    global.get_pointer = originalGetPointer;
    if (visibility) {
      visibility._options.isMenuOpen = originalMenuCheck;
      visibility.endItemDrag();
      visibility.blockAutoHide(false);
    }
    for (const [key, value] of originalSettings) settings.set_boolean(key, value);
    await Scripting.waitLeisure();
  }
}

export function script_dockLostLeaveRecovered() {
  return true;
}

export function script_dockStaleHoverRecovered() {
  return true;
}

export function script_dockVisibilityHoldsPreserved() {
  return true;
}
