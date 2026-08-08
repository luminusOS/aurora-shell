/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { EXTENSION_UUID, getAuroraSettings, waitForExtension } from '../support/testUtils.js';

const TOOLTIP_CSS_CLASS = 'app-search-tooltip';

function tooltipExistsInUiGroup() {
  const uiGroup = Main.uiGroup;
  const n = uiGroup.get_n_children();
  for (let i = 0; i < n; i++) {
    const child = uiGroup.get_child_at_index(i);
    if (child && child.has_style_class_name && child.has_style_class_name(TOOLTIP_CSS_CLASS))
      return true;
  }
  return false;
}

export var METRICS = {};

export function init() {
  Scripting.defineScriptEvent('noStrayTooltip', 'No app-search-tooltip label at startup');
  Scripting.defineScriptEvent('lifecycleOk', 'enable/disable cycle completed without crash');
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);

  const auroraSettings = getAuroraSettings();

  await Scripting.waitLeisure();
  await Scripting.sleep(300);

  if (tooltipExistsInUiGroup())
    throw new Error(
      `"${TOOLTIP_CSS_CLASS}" label found in Main.uiGroup at startup — should only appear on hover`,
    );

  Scripting.scriptEvent('noStrayTooltip');

  auroraSettings.set_boolean('module-app-search-tooltip', false);
  await Scripting.waitLeisure();
  await Scripting.sleep(200);

  auroraSettings.set_boolean('module-app-search-tooltip', true);
  await Scripting.waitLeisure();
  await Scripting.sleep(200);

  if (tooltipExistsInUiGroup())
    throw new Error(
      `"${TOOLTIP_CSS_CLASS}" label appeared after re-enable without any hover event`,
    );

  Scripting.scriptEvent('lifecycleOk');
}

let _noStrayTooltip = false;
let _lifecycleOk = false;

export function script_noStrayTooltip() {
  _noStrayTooltip = true;
}

export function script_lifecycleOk() {
  _lifecycleOk = true;
}

export function finish() {
  if (!_noStrayTooltip)
    throw new Error('A stray app-search-tooltip label was found in Main.uiGroup at startup');
  if (!_lifecycleOk) throw new Error('AppSearchTooltip enable/disable cycle crashed the shell');
}
