/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { EXTENSION_UUID, getAuroraSettings, waitForExtension } from '../../support/testUtils.js';

const MIXER_CSS_CLASS = 'aurora-volume-mixer';

function findOutputSlider() {
  const grid = Main.panel.statusArea.quickSettings?.menu?._grid;
  if (!grid) return null;
  return grid.get_children().find((c) => c.constructor.name === 'OutputStreamSlider') ?? null;
}

function findMixerPanelInSlider(slider) {
  if (!slider?.menu?._getMenuItems) return null;
  for (const item of slider.menu._getMenuItems()) {
    const box = item.actor ?? item;
    const n = box.get_n_children?.() ?? 0;
    for (let i = 0; i < n; i++) {
      const child = box.get_child_at_index(i);
      if (child?.has_style_class_name?.(MIXER_CSS_CLASS)) return child;
    }
  }
  return null;
}

function findMixerToggle(slider) {
  return (
    slider?.child?.get_children?.().find((child) => child.accessible_name === 'Volume Mixer') ??
    null
  );
}

export var METRICS = {};

export function init() {
  Scripting.defineScriptEvent(
    'mixerAttached',
    'aurora-volume-mixer found in OutputStreamSlider menu',
  );
  Scripting.defineScriptEvent('mixerRemoved', 'aurora-volume-mixer removed after disable');
  Scripting.defineScriptEvent('visibilityOk', 'Volume Mixer contextual visibility works');
  Scripting.defineScriptEvent(
    'lifecycleOk',
    'enable/disable cycle completed (no slider in environment)',
  );
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);

  const auroraSettings = getAuroraSettings();

  await Scripting.waitLeisure();
  await Scripting.sleep(500);

  const slider = findOutputSlider();

  if (!slider) {
    // Headless environment has no audio — verify lifecycle only
    console.debug('[aurora-test] No OutputStreamSlider in environment; testing lifecycle only');

    auroraSettings.set_boolean('module-volume-mixer', false);
    await Scripting.waitLeisure();
    await Scripting.sleep(300);

    auroraSettings.set_boolean('module-volume-mixer', true);
    await Scripting.waitLeisure();
    await Scripting.sleep(200);

    Scripting.scriptEvent('lifecycleOk');
    return;
  }

  const panelAfterEnable = findMixerPanelInSlider(slider);
  if (!panelAfterEnable)
    throw new Error(
      `No actor with CSS class "${MIXER_CSS_CLASS}" found in OutputStreamSlider menu`,
    );

  Scripting.scriptEvent('mixerAttached');

  // Always Show must reveal the toggle; contextual mode must then match
  // whether the panel has any adjustable application streams.
  const mixerToggle = findMixerToggle(slider);
  if (!mixerToggle) throw new Error('Volume Mixer toggle was not attached to OutputStreamSlider');

  auroraSettings.set_boolean('volume-mixer-always-show', true);
  await Scripting.waitLeisure();
  if (!mixerToggle.visible) throw new Error('Always Show did not reveal the Volume Mixer toggle');

  auroraSettings.set_boolean('volume-mixer-always-show', false);
  await Scripting.waitLeisure();
  if (mixerToggle.visible !== panelAfterEnable.should_show)
    throw new Error('Volume Mixer toggle visibility does not match adjustable stream availability');

  Scripting.scriptEvent('visibilityOk');

  auroraSettings.set_boolean('module-volume-mixer', false);
  await Scripting.waitLeisure();
  await Scripting.sleep(400);

  const panelAfterDisable = findMixerPanelInSlider(slider);
  if (panelAfterDisable)
    throw new Error(`"${MIXER_CSS_CLASS}" actor still present after module was disabled`);

  Scripting.scriptEvent('mixerRemoved');

  auroraSettings.set_boolean('module-volume-mixer', true);
  await Scripting.waitLeisure();
  await Scripting.sleep(200);
}

let _mixerAttached = false;
let _mixerRemoved = false;
let _lifecycleOk = false;
let _visibilityOk = false;

export function script_mixerAttached() {
  _mixerAttached = true;
}

export function script_mixerRemoved() {
  _mixerRemoved = true;
}

export function script_lifecycleOk() {
  _lifecycleOk = true;
}

export function script_visibilityOk() {
  _visibilityOk = true;
}

export function finish() {
  const sliderPresent = _mixerAttached || _mixerRemoved;
  if (!sliderPresent && !_lifecycleOk)
    throw new Error('VolumeMixer module test did not complete — shell may have crashed');
  if (_mixerAttached && !_mixerRemoved)
    throw new Error('aurora-volume-mixer actor was not removed after module was disabled');
  if (_mixerAttached && !_visibilityOk)
    throw new Error('Volume Mixer contextual visibility was not verified');
}
