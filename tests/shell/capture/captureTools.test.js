/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { EXTENSION_UUID, getAuroraSettings, waitForExtension } from '../support/testUtils.js';

const TOOLBAR_CLASS = 'capture-tools-toolbar';
const CANVAS_CLASS = 'capture-tools-canvas';
const WIDTH_SLIDER_CLASS = 'capture-tools-width-slider';
const COLOR_BUTTON_CLASS = 'capture-tools-ring-button';
const OCR_BUTTON_CLASS = 'capture-tools-native-ocr-button';
const OCR_TOOLTIP_CLASS = 'capture-tools-ocr-tooltip';
const OCR_PANEL_CLASS = 'capture-tools-ocr-panel';
const OCR_COPY_BUTTON_CLASS = 'capture-tools-ocr-copy-button';
const OCR_SEARCH_BUTTON_CLASS = 'capture-tools-ocr-search-button';
const TEXT_ENTRY_CLASS = 'capture-tools-text-entry';
const DRAG_HANDLE_CLASS = 'capture-tools-drag-handle';
const SEPARATOR_CLASS = 'capture-tools-separator';
const SELECTION_TOOL_CLASS = 'capture-tools-tool-select';
const POINTER_TOOL_CLASS = 'capture-tools-tool-pointer';
const FREEHAND_TOOL_CLASS = 'capture-tools-tool-freehand';
const TEXT_TOOL_CLASS = 'capture-tools-tool-text';

function findActors(root, styleClass) {
  const found = [];
  if (root && root.has_style_class_name && root.has_style_class_name(styleClass)) found.push(root);
  const children = root && root.get_children ? root.get_children() : [];
  for (const child of children) found.push(...findActors(child, styleClass));
  return found;
}

function resolvedIconPath(button) {
  const icon = button.get_child()?.gicon;
  if (!icon?.get_file) throw new Error('Icon does not expose a theme file');
  const file = icon.get_file();
  if (!file?.get_path) throw new Error('Icon theme file does not expose a path');
  const path = file.get_path();
  if (!path) throw new Error('Icon was not resolved to a theme file');
  return path;
}

function actorsOverlap(first, second) {
  const firstBox = first.get_transformed_extents();
  const secondBox = second.get_transformed_extents();
  return (
    firstBox.get_x() < secondBox.get_x() + secondBox.get_width() &&
    firstBox.get_x() + firstBox.get_width() > secondBox.get_x() &&
    firstBox.get_y() < secondBox.get_y() + secondBox.get_height() &&
    firstBox.get_y() + firstBox.get_height() > secondBox.get_y()
  );
}

export var METRICS = {};

export function init() {
  Scripting.defineScriptEvent('attachedOnce', 'Capture toolbar and canvas attached exactly once');
  Scripting.defineScriptEvent('visibleOnOpen', 'Floating toolbar visible immediately on open');
  Scripting.defineScriptEvent(
    'externalMonitorPlacement',
    'Floating toolbar follows a selection onto an external monitor',
  );
  Scripting.defineScriptEvent(
    'nativeControlsAvoided',
    'Floating toolbar avoids the native screenshot controls',
  );
  Scripting.defineScriptEvent(
    'recordingPointerEnabled',
    'Screen recording enables pointer capture automatically',
  );
  Scripting.defineScriptEvent('drawingMode', 'Drawing tool activates the capture canvas');
  Scripting.defineScriptEvent(
    'lifecycleRestored',
    'Screenshot hooks and actors restored across disable and enable',
  );
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);
  const settings = getAuroraSettings();
  settings.set_boolean('module-capture-tools', true);
  await Scripting.sleep(250);

  const ui = Main.screenshotUI;
  const toolbars = findActors(ui, TOOLBAR_CLASS);
  const canvases = findActors(ui, CANVAS_CLASS);
  const widthSliders = findActors(ui, WIDTH_SLIDER_CLASS);
  const ocrButtons = findActors(ui, OCR_BUTTON_CLASS);
  const ocrTooltips = findActors(ui, OCR_TOOLTIP_CLASS);
  const ocrPanels = findActors(ui, OCR_PANEL_CLASS);
  const ocrCopyButtons = findActors(ui, OCR_COPY_BUTTON_CLASS);
  const ocrSearchButtons = findActors(ui, OCR_SEARCH_BUTTON_CLASS);
  if (toolbars.length !== 1) throw new Error('Capture toolbar was not attached exactly once');
  if (canvases.length !== 1) throw new Error('Capture canvas was not attached exactly once');
  if (widthSliders.length !== 1) throw new Error('Annotation width slider is missing');
  if (ocrButtons.length !== 1) throw new Error('Native OCR button is missing');
  if (ocrTooltips.length !== 3) throw new Error('OCR action tooltips are missing');
  if (ocrPanels.length !== 1 || ocrCopyButtons.length !== 1 || ocrSearchButtons.length !== 1)
    throw new Error('OCR result actions are missing');
  if (
    ocrPanels[0].get_children().length !== 2 ||
    ocrCopyButtons[0].get_parent() !== ocrPanels[0] ||
    ocrSearchButtons[0].get_parent() !== ocrPanels[0]
  )
    throw new Error('OCR copy and web search actions are not grouped together');
  if (!resolvedIconPath(ocrCopyButtons[0]).endsWith('/edit-copy-symbolic.svg'))
    throw new Error('OCR copy action does not use the themed copy icon');
  if (!resolvedIconPath(ocrSearchButtons[0]).endsWith('/system-search-symbolic.svg'))
    throw new Error('OCR web search action does not use the themed search icon');
  for (const button of [ocrButtons[0], ocrCopyButtons[0], ocrSearchButtons[0]]) {
    if (!ocrTooltips.some((tooltip) => tooltip._anchor === button))
      throw new Error('An OCR action is missing its tooltip');
  }
  const toolbar = toolbars[0];
  const canvas = canvases[0];
  const widthSlider = widthSliders[0];
  const ocrButton = ocrButtons[0];
  const ocrButtonTooltip = ocrTooltips.find((tooltip) => tooltip._anchor === ocrButton);
  const dragHandle = findActors(toolbar, DRAG_HANDLE_CLASS)[0];
  const selectionButton = findActors(toolbar, SELECTION_TOOL_CLASS)[0];
  const pointerButton = findActors(toolbar, POINTER_TOOL_CLASS)[0];
  const toolbarChildren = toolbar.get_children();
  if (!dragHandle || !selectionButton || !pointerButton)
    throw new Error('Toolbar movement, selection, or pointer control is missing');
  const locale = GLib.getenv('LANGUAGE') || GLib.getenv('LC_ALL') || GLib.getenv('LANG') || 'C';
  const expectedSelectionLabel = locale.toLowerCase().startsWith('pt_br') ? 'Seleção' : 'Selection';
  if (selectionButton.accessible_name !== expectedSelectionLabel)
    throw new Error(
      `Capture Tools translation mismatch: expected ${expectedSelectionLabel}, got ${selectionButton.accessible_name}`,
    );
  if (!resolvedIconPath(dragHandle).endsWith('/list-drag-handle-symbolic.svg'))
    throw new Error('Toolbar movement handle did not use the native themed GNOME icon');
  if (
    !resolvedIconPath(selectionButton).endsWith(
      '/icons/hicolor/scalable/actions/selection-opaque-3-symbolic.svg',
    )
  )
    throw new Error('Custom selection icon was not resolved through the bundled hicolor theme');
  if (toolbarChildren[0] !== dragHandle)
    throw new Error('Toolbar movement handle is not at the far left');
  if (
    toolbarChildren[1] !== selectionButton ||
    toolbarChildren[2] !== pointerButton ||
    !toolbarChildren[3]?.has_style_class_name(SEPARATOR_CLASS)
  )
    throw new Error('Movement, selection, and pointer controls are not grouped before a divider');
  if (toolbar.get_parent() !== ui._primaryMonitorBin)
    throw new Error('Capture toolbar is not attached to the primary monitor container');
  if (ocrButton.get_parent() !== ui._showPointerButtonContainer)
    throw new Error('OCR button is not in the native pointer control container');
  const pointerControls = ui._showPointerButtonContainer.get_children();
  if (
    Math.abs(
      pointerControls.indexOf(ocrButton) - pointerControls.indexOf(ui._showPointerButton),
    ) !== 1
  )
    throw new Error('OCR button is not beside the native pointer button');
  if (findActors(toolbar, OCR_BUTTON_CLASS).length !== 0)
    throw new Error('OCR button remained in the floating annotation toolbar');
  widthSlider.value = 1;
  await Scripting.sleep(50);
  if (settings.get_int('capture-tools-stroke-width') !== 16)
    throw new Error('Annotation width slider did not update the stroke width');
  Scripting.scriptEvent('attachedOnce');

  await ui.open();
  await Scripting.sleep(350);
  if (!toolbar.visible) throw new Error('Capture toolbar is hidden after opening ScreenshotUI');
  if (!toolbar.mapped) throw new Error('Capture toolbar is not mapped after opening ScreenshotUI');
  if (![toolbar.translation_x, toolbar.translation_y].every(Number.isFinite))
    throw new Error('Capture toolbar produced a non-finite translation');
  if (!toolbar.has_style_class_name('screenshot-ui-panel'))
    throw new Error('Capture toolbar does not use the native screenshot panel styling');

  ui._showPointerButton.checked = false;
  ui._castButton.checked = true;
  await Scripting.sleep(50);
  if (!ui._showPointerButton.checked)
    throw new Error('Record Screen did not enable pointer capture automatically');
  ui._shotButton.checked = true;
  await Scripting.sleep(50);
  Scripting.scriptEvent('recordingPointerEnabled');

  const primaryMonitor = Main.layoutManager.primaryMonitor;
  const originalPrimarySelection = [
    ui._areaSelector._startX,
    ui._areaSelector._startY,
    ui._areaSelector._lastX,
    ui._areaSelector._lastY,
  ];
  ui._areaSelector._startX = primaryMonitor.x + 1;
  ui._areaSelector._startY = primaryMonitor.y + 1;
  ui._areaSelector._lastX = primaryMonitor.x + primaryMonitor.width - 1;
  ui._areaSelector._lastY = primaryMonitor.y + primaryMonitor.height - 1;
  ui._areaSelector._updateSelectionRect();
  ui._areaSelector.emit('drag-ended');
  await Scripting.sleep(250);
  if (actorsOverlap(toolbar, ui._panel))
    throw new Error('Capture toolbar overlaps the native screenshot controls');
  [
    ui._areaSelector._startX,
    ui._areaSelector._startY,
    ui._areaSelector._lastX,
    ui._areaSelector._lastY,
  ] = originalPrimarySelection;
  ui._areaSelector._updateSelectionRect();
  ui._areaSelector.emit('drag-ended');
  await Scripting.sleep(250);
  Scripting.scriptEvent('nativeControlsAvoided');

  const externalMonitor = Main.layoutManager.monitors.find(
    (_monitor, index) => index !== Main.layoutManager.primaryIndex,
  );
  if (externalMonitor) {
    const originalSelection = [
      ui._areaSelector._startX,
      ui._areaSelector._startY,
      ui._areaSelector._lastX,
      ui._areaSelector._lastY,
    ];
    ui._areaSelector._startX = externalMonitor.x + Math.floor(externalMonitor.width / 4);
    ui._areaSelector._startY = externalMonitor.y + Math.floor(externalMonitor.height / 4);
    ui._areaSelector._lastX = externalMonitor.x + Math.floor((externalMonitor.width * 3) / 4);
    ui._areaSelector._lastY = externalMonitor.y + Math.floor((externalMonitor.height * 3) / 4);
    ui._areaSelector._updateSelectionRect();
    ui._areaSelector.emit('drag-ended');
    await Scripting.sleep(250);
    const [externalToolbarX, externalToolbarY] = toolbar.get_transformed_position();
    if (
      externalToolbarX < externalMonitor.x ||
      externalToolbarX + toolbar.width > externalMonitor.x + externalMonitor.width ||
      externalToolbarY < externalMonitor.y ||
      externalToolbarY + toolbar.height > externalMonitor.y + externalMonitor.height
    )
      throw new Error('Capture toolbar did not follow the selection onto the external monitor');
    [
      ui._areaSelector._startX,
      ui._areaSelector._startY,
      ui._areaSelector._lastX,
      ui._areaSelector._lastY,
    ] = originalSelection;
    ui._areaSelector._updateSelectionRect();
    ui._areaSelector.emit('drag-ended');
    await Scripting.sleep(250);
  }
  Scripting.scriptEvent('externalMonitorPlacement');

  const colorButtons = findActors(toolbar, COLOR_BUTTON_CLASS);
  const selectedColorButtons = colorButtons.filter((button) => button.checked);
  const activeColor = settings.get_string('capture-tools-color');
  if (colorButtons.length !== 8) throw new Error('Annotation color palette is incomplete');
  if (selectedColorButtons.length !== 1)
    throw new Error('Active annotation color is not visibly selected');
  if (!selectedColorButtons[0].get_child()?.get_style()?.includes(activeColor))
    throw new Error('Selected annotation color does not match the persisted color');
  if (!selectedColorButtons[0].get_style()?.includes(`border-color: ${activeColor}`))
    throw new Error('Active annotation color ring does not match the selected color');
  if (selectedColorButtons[0].get_style()?.includes('outline-color'))
    throw new Error('Active annotation color uses a square outline instead of a circular border');
  if (!GLib.find_program_in_path('tesseract') && ocrButton.visible)
    throw new Error('OCR button is visible without Tesseract installed');
  if (ocrButton.visible) {
    ocrButton.set_hover(true);
    await Scripting.sleep(500);
    if (!ocrButtonTooltip?.visible || ocrButtonTooltip.opacity !== 255)
      throw new Error('OCR tooltip did not appear on hover');
    ocrButton.set_hover(false);
    await Scripting.sleep(150);
    if (ocrButtonTooltip.visible) throw new Error('OCR tooltip did not close after hover');
  }
  ocrPanels[0].show();
  for (const button of [ocrCopyButtons[0], ocrSearchButtons[0]]) {
    const tooltip = ocrTooltips.find((candidate) => candidate._anchor === button);
    button.set_hover(true);
    await Scripting.sleep(500);
    if (!tooltip?.visible || tooltip.opacity !== 255)
      throw new Error('OCR result action tooltip did not appear on hover');
    button.set_hover(false);
    await Scripting.sleep(150);
    if (tooltip.visible) throw new Error('OCR result action tooltip did not close after hover');
  }
  ocrPanels[0].hide();

  ui._areaSelector.emit('drag-started');
  await Scripting.sleep(250);
  if (toolbar.opacity !== 100 || ui._panel.opacity !== 100 || ui._closeButton.opacity !== 100)
    throw new Error('Capture and native controls do not match native drag opacity');
  ui._areaSelector.emit('drag-ended');
  await Scripting.sleep(250);
  if (toolbar.opacity !== 255 || ui._panel.opacity !== 255 || ui._closeButton.opacity !== 255)
    throw new Error('Capture and native control opacity was not restored');
  Scripting.scriptEvent('visibleOnOpen');

  const freehandButton = findActors(toolbar, FREEHAND_TOOL_CLASS)[0];
  freehandButton.emit('clicked', freehandButton);
  if (!canvas.reactive) throw new Error('Drawing tool did not activate the capture canvas');
  canvas._drawingStateChanged(true);
  await Scripting.sleep(250);
  if (toolbar.opacity !== 100 || ui._panel.opacity !== 100 || ui._closeButton.opacity !== 100)
    throw new Error('Capture and native controls did not become translucent while drawing');
  canvas._drawingStateChanged(false);
  await Scripting.sleep(250);
  if (toolbar.opacity !== 255 || ui._panel.opacity !== 255 || ui._closeButton.opacity !== 255)
    throw new Error('Capture and native control opacity was not restored after drawing');
  pointerButton.emit('clicked', pointerButton);
  if (!canvas.reactive) throw new Error('Pointer tool did not activate annotation movement');
  const textButton = findActors(toolbar, TEXT_TOOL_CLASS)[0];
  textButton.emit('clicked', textButton);
  canvas._requestText({ x: 320, y: 240 });
  const textEntries = findActors(ui, TEXT_ENTRY_CLASS);
  if (textEntries.length !== 1) throw new Error('Text annotation entry was not created');
  const textEntry = textEntries[0];
  textEntry.set_text('Aurora text annotation');
  textEntry.clutter_text.emit('activate');
  if (findActors(ui, TEXT_ENTRY_CLASS).length !== 0)
    throw new Error('Text annotation was not committed by the Enter key');
  selectionButton.emit('clicked', selectionButton);
  if (canvas.reactive) throw new Error('Selection tool did not release the capture canvas');
  Scripting.scriptEvent('drawingMode');

  ui.close(true);
  const hookedOpen = ui.open;
  const hookedSave = ui._saveScreenshot;
  settings.set_boolean('module-capture-tools', false);
  await Scripting.sleep(250);
  if (ui.open === hookedOpen) throw new Error('Screenshot open hook was not restored');
  if (ui._saveScreenshot === hookedSave) throw new Error('Screenshot save hook was not restored');
  if (findActors(ui, TOOLBAR_CLASS).length !== 0)
    throw new Error('Capture toolbar remained after disable');
  if (findActors(ui, CANVAS_CLASS).length !== 0)
    throw new Error('Capture canvas remained after disable');
  if (findActors(ui, OCR_BUTTON_CLASS).length !== 0)
    throw new Error('Native OCR button remained after disable');
  if (findActors(ui, OCR_TOOLTIP_CLASS).length !== 0)
    throw new Error('OCR tooltip remained after disable');
  if (findActors(ui, DRAG_HANDLE_CLASS).length !== 0)
    throw new Error('Toolbar movement handle remained after disable');

  settings.set_boolean('module-capture-tools', true);
  await Scripting.sleep(250);
  if (ui.open === hookedOpen) throw new Error('Screenshot open hook was not reinstalled');
  if (ui._saveScreenshot === hookedSave)
    throw new Error('Screenshot save hook was not reinstalled');
  if (findActors(ui, TOOLBAR_CLASS).length !== 1)
    throw new Error('Capture toolbar was duplicated or missing after re-enable');
  if (findActors(ui, CANVAS_CLASS).length !== 1)
    throw new Error('Capture canvas was duplicated or missing after re-enable');
  if (findActors(ui, WIDTH_SLIDER_CLASS).length !== 1)
    throw new Error('Annotation width slider was duplicated or missing after re-enable');
  if (findActors(ui, OCR_BUTTON_CLASS).length !== 1)
    throw new Error('Native OCR button was duplicated or missing after re-enable');
  if (findActors(ui, OCR_TOOLTIP_CLASS).length !== 3)
    throw new Error('OCR action tooltips were duplicated or missing after re-enable');
  if (findActors(ui, DRAG_HANDLE_CLASS).length !== 1)
    throw new Error('Toolbar movement handle was duplicated or missing after re-enable');
  Scripting.scriptEvent('lifecycleRestored');
}

let _attachedOnce = false;
let _visibleOnOpen = false;
let _externalMonitorPlacement = false;
let _nativeControlsAvoided = false;
let _recordingPointerEnabled = false;
let _drawingMode = false;
let _lifecycleRestored = false;

export function script_attachedOnce() {
  _attachedOnce = true;
}

export function script_visibleOnOpen() {
  _visibleOnOpen = true;
}

export function script_externalMonitorPlacement() {
  _externalMonitorPlacement = true;
}

export function script_nativeControlsAvoided() {
  _nativeControlsAvoided = true;
}

export function script_recordingPointerEnabled() {
  _recordingPointerEnabled = true;
}

export function script_drawingMode() {
  _drawingMode = true;
}

export function script_lifecycleRestored() {
  _lifecycleRestored = true;
}

export function finish() {
  if (!_attachedOnce) throw new Error('Capture Tools attachment was not verified');
  if (!_visibleOnOpen) throw new Error('Immediate toolbar visibility was not verified');
  if (!_externalMonitorPlacement)
    throw new Error('External-monitor toolbar placement was not verified');
  if (!_nativeControlsAvoided)
    throw new Error('Native screenshot control avoidance was not verified');
  if (!_recordingPointerEnabled)
    throw new Error('Automatic recording pointer selection was not verified');
  if (!_drawingMode) throw new Error('Capture Tools drawing mode was not verified');
  if (!_lifecycleRestored) throw new Error('Capture Tools lifecycle restoration was not verified');
}
