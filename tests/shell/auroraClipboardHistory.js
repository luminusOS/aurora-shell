/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

/**
 * Aurora Shell — ClipboardHistory module integration test
 *
 * Verifies:
 *  - Module enables and disables without crashing (I1)
 *  - Keybinding is removed cleanly after disable (no crash on re-enable) (I2)
 *  - aurora-clipboard-panel is not present in uiGroup while module is disabled (I3)
 */

import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { EXTENSION_UUID, getAuroraSettings, waitForExtension } from './testUtils.js';

const PANEL_CSS = 'aurora-clipboard-panel';

function findClipboardPanel() {
  for (const child of Main.uiGroup.get_children()) {
    if (child.has_style_class_name?.(PANEL_CSS)) return child;
  }
  return null;
}

function findActorByStyle(root, styleClass) {
  if (root.has_style_class_name?.(styleClass)) return root;
  for (const child of root.get_children?.() ?? []) {
    const match = findActorByStyle(child, styleClass);
    if (match) return match;
  }
  return null;
}

function assertFloatingActions(item, overlayStyle, expectedInset = 0) {
  const overlay = findActorByStyle(item, overlayStyle);
  const actions = findActorByStyle(item, 'aurora-clipboard-item-actions');
  const content = overlay?.first_child;
  if (!overlay || !actions || !content) {
    throw new Error(`Floating action layout not found for ${overlayStyle}`);
  }

  const rightGap = overlay.width - (actions.x + actions.width);
  if (
    actions.y !== expectedInset ||
    rightGap !== expectedInset ||
    content.x !== 0 ||
    content.y !== 0 ||
    content.width !== overlay.width
  ) {
    throw new Error(
      `Actions are not floating in ${overlayStyle}: content=${content.x},${content.y},${content.width}/${overlay.width}, actionsY=${actions.y}, rightGap=${rightGap}`,
    );
  }
}

function getClipboardModule() {
  const ext = Main.extensionManager.lookup(EXTENSION_UUID);
  const module = ext?.stateObj?._modules?.get?.('clipboard-history');
  if (!module) throw new Error('ClipboardHistory module instance not found');
  return module;
}

function clearClipboardRuntime() {
  const runtimeDir = `${GLib.get_user_runtime_dir()}/aurora-shell/${EXTENSION_UUID}`;
  deleteFileIfExists(Gio.File.new_for_path(`${runtimeDir}/clipboard-history.log`));
  deleteDirectoryChildren(Gio.File.new_for_path(`${runtimeDir}/clipboard-media`));
}

function deleteDirectoryChildren(dir) {
  if (!dir.query_exists(null)) return;

  const enumerator = dir.enumerate_children(
    'standard::name,standard::type',
    Gio.FileQueryInfoFlags.NONE,
    null,
  );
  let info;
  while ((info = enumerator.next_file(null))) {
    const child = dir.get_child(info.get_name());
    if (info.get_file_type() === Gio.FileType.DIRECTORY) {
      deleteDirectoryChildren(child);
    } else {
      deleteFileIfExists(child);
    }
  }
  enumerator.close(null);
  deleteFileIfExists(dir);
}

function deleteFileIfExists(file) {
  try {
    if (file.query_exists(null)) file.delete(null);
  } catch {
    // Test cleanup is best effort.
  }
}

function assertPanelInsideWorkArea(panel) {
  const workArea = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
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

export var METRICS = {};

export function init() {
  Scripting.defineScriptEvent('moduleEnabled', 'ClipboardHistory module enabled successfully');
  Scripting.defineScriptEvent('lifecycleOk', 'Module disabled and re-enabled without crash');
  Scripting.defineScriptEvent('panelClean', 'No aurora-clipboard-panel in uiGroup after disable');
  Scripting.defineScriptEvent('clipboardWritten', 'Clipboard text written for monitor test');
  Scripting.defineScriptEvent('clipboardImageWritten', 'Clipboard image written for monitor test');
  Scripting.defineScriptEvent('textCardLayoutOk', 'Text card wraps without growing horizontally');
  Scripting.defineScriptEvent('codeBadgeLayoutOk', 'Code line badge does not increase card height');
  Scripting.defineScriptEvent('panelOpened', 'Clipboard panel opened inside work area');
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);
  const auroraSettings = getAuroraSettings();

  await Scripting.waitLeisure();
  await Scripting.sleep(500);

  Scripting.scriptEvent('moduleEnabled');

  // toggle off
  auroraSettings.set_boolean('module-clipboard-history', false);
  await Scripting.waitLeisure();
  await Scripting.sleep(400);

  if (findClipboardPanel()) {
    throw new Error(`"${PANEL_CSS}" still in uiGroup after module was disabled`);
  }
  clearClipboardRuntime();

  // toggle on
  auroraSettings.set_boolean('module-clipboard-history', true);
  await Scripting.waitLeisure();
  await Scripting.sleep(400);

  Scripting.scriptEvent('lifecycleOk');

  // write something to the clipboard so the monitor has something to pick up
  St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, 'aurora-test-clipboard-entry');
  await Scripting.waitLeisure();
  await Scripting.sleep(1500);

  Scripting.scriptEvent('clipboardWritten');

  const beforeImageCount = getClipboardModule().entryCount;
  St.Clipboard.get_default().set_content(
    St.ClipboardType.CLIPBOARD,
    'image/png',
    new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0,
      0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 255, 255, 255, 127, 0,
      9, 251, 3, 253, 42, 134, 227, 138, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ]),
  );
  await Scripting.waitLeisure();
  await Scripting.sleep(1500);

  if (getClipboardModule().entryCount <= beforeImageCount) {
    throw new Error('Clipboard image was not captured by the monitor');
  }
  Scripting.scriptEvent('clipboardImageWritten');

  const clipboardModule = getClipboardModule();
  const longText =
    'This long clipboard entry must wrap onto several visual lines while remaining inside the fixed panel width. '.repeat(
      6,
    );
  const fiveLineCode = [
    'const a = 1;',
    'const b = 2;',
    'const c = 3;',
    'const d = 4;',
    'const e = 5;',
  ].join('\n');
  const sixLineCode = `${fiveLineCode}\nconst f = 6;`;
  clipboardModule.addText(longText);
  clipboardModule.addText('Short clipboard entry');
  clipboardModule.addText(fiveLineCode);
  clipboardModule.addText(sixLineCode);
  clipboardModule.openPanel();
  await Scripting.waitLeisure();
  await Scripting.sleep(200);

  const panel = findClipboardPanel();
  if (!panel) {
    throw new Error(`"${PANEL_CSS}" did not open`);
  }
  assertPanelInsideWorkArea(panel);

  const list = panel._list;
  const shortItem = list?._items?.find((item) => item.entry.text === 'Short clipboard entry');
  const longItem = list?._items?.find((item) => item.entry.text === longText);
  const fiveLineCodeItem = list?._items?.find((item) => item.entry.text === fiveLineCode);
  const sixLineCodeItem = list?._items?.find((item) => item.entry.text === sixLineCode);
  const imageItem = list?._items?.find((item) => item.entry.kind === 'image');
  if (!shortItem || !longItem) {
    throw new Error('Clipboard text cards were not created for the layout test');
  }
  if (!fiveLineCodeItem || !sixLineCodeItem) {
    throw new Error('Clipboard code cards were not created for the badge layout test');
  }
  if (!imageItem) {
    throw new Error('Clipboard image card was not created for the floating actions test');
  }

  const textOverlay = findActorByStyle(longItem, 'aurora-clipboard-item-text-overlay');
  const textBody = findActorByStyle(longItem, 'aurora-clipboard-item-text-body');
  if (!textOverlay || !textBody) {
    throw new Error('Text card content was not found');
  }
  if (textBody.width !== textOverlay.width) {
    throw new Error(
      `Unselected text does not use the full card width: text=${textBody.width}, overlay=${textOverlay.width}`,
    );
  }

  const widthBeforeSelection = longItem.width;
  if (longItem.height <= shortItem.height) {
    throw new Error(
      `Long text card did not expand vertically: short=${shortItem.height}, long=${longItem.height}`,
    );
  }

  const longItemIndex = list._items.indexOf(longItem);
  list.moveFocus(longItemIndex);
  await Scripting.waitLeisure();
  await Scripting.sleep(100);
  if (longItem.width !== widthBeforeSelection) {
    throw new Error(
      `Text card width changed on keyboard selection: before=${widthBeforeSelection}, after=${longItem.width}`,
    );
  }

  const textActions = findActorByStyle(longItem, 'aurora-clipboard-item-actions');
  if (!textActions) {
    throw new Error('Text card actions were not found');
  }
  const actionsRightGap = textOverlay.width - (textActions.x + textActions.width);
  if (textBody.x !== 0 || textBody.y !== 0 || textActions.y !== 0 || actionsRightGap !== 0) {
    throw new Error(
      `Text card is misaligned: text=${textBody.x},${textBody.y}, actionsY=${textActions.y}, rightGap=${actionsRightGap}`,
    );
  }
  if (textBody.width !== textOverlay.width || textActions.x >= textBody.x + textBody.width) {
    throw new Error(
      `Selected text is not overlaid by actions: textWidth=${textBody.width}, overlayWidth=${textOverlay.width}, actionsX=${textActions.x}`,
    );
  }
  assertFloatingActions(longItem, 'aurora-clipboard-item-text-overlay');

  const shortItemIndex = list._items.indexOf(shortItem);
  list.moveFocus(shortItemIndex - longItemIndex);
  await Scripting.waitLeisure();
  await Scripting.sleep(100);
  const shortOverlay = findActorByStyle(shortItem, 'aurora-clipboard-item-text-overlay');
  const shortActions = findActorByStyle(shortItem, 'aurora-clipboard-item-actions');
  if (!shortOverlay || !shortActions) {
    throw new Error('Short text card actions were not found');
  }
  if (shortActions.y + shortActions.height > shortOverlay.height) {
    throw new Error(
      `Short text card clips actions: actionsBottom=${shortActions.y + shortActions.height}, overlayHeight=${shortOverlay.height}`,
    );
  }

  const sixLineCodeIndex = list._items.indexOf(sixLineCodeItem);
  list.moveFocus(sixLineCodeIndex - shortItemIndex);
  await Scripting.waitLeisure();
  await Scripting.sleep(100);
  assertFloatingActions(sixLineCodeItem, 'aurora-clipboard-item-code-overlay');

  const imageItemIndex = list._items.indexOf(imageItem);
  list.moveFocus(imageItemIndex - sixLineCodeIndex);
  await Scripting.waitLeisure();
  await Scripting.sleep(100);
  assertFloatingActions(imageItem, 'aurora-clipboard-image-overlay', 6);
  Scripting.scriptEvent('textCardLayoutOk');

  if (sixLineCodeItem.height !== fiveLineCodeItem.height) {
    throw new Error(
      `Code badge changed card height: five=${fiveLineCodeItem.height}, six=${sixLineCodeItem.height}`,
    );
  }

  const codeOverlay = findActorByStyle(sixLineCodeItem, 'aurora-clipboard-item-code-overlay');
  const codeBadge = findActorByStyle(sixLineCodeItem, 'aurora-clipboard-item-code-badge');
  if (!codeOverlay || !codeBadge) {
    throw new Error('Code badge or overlay was not found');
  }
  const rightGap = codeOverlay.width - (codeBadge.x + codeBadge.width);
  const bottomGap = codeOverlay.height - (codeBadge.y + codeBadge.height);
  if (rightGap < 0 || rightGap > 2 || bottomGap < 0 || bottomGap > 2) {
    throw new Error(
      `Code badge is not bottom-right aligned: rightGap=${rightGap}, bottomGap=${bottomGap}`,
    );
  }
  Scripting.scriptEvent('codeBadgeLayoutOk');

  panel.close?.();
  Scripting.scriptEvent('panelOpened');

  // disable again and verify no panel leaked into the scene graph
  auroraSettings.set_boolean('module-clipboard-history', false);
  await Scripting.waitLeisure();
  await Scripting.sleep(400);

  if (findClipboardPanel()) {
    throw new Error(`"${PANEL_CSS}" leaked into uiGroup after second disable`);
  }

  Scripting.scriptEvent('panelClean');

  // restore
  auroraSettings.set_boolean('module-clipboard-history', true);
  await Scripting.waitLeisure();
  await Scripting.sleep(200);
}

let _moduleEnabled = false;
let _lifecycleOk = false;
let _panelClean = false;
let _clipboardWritten = false;
let _clipboardImageWritten = false;
let _textCardLayoutOk = false;
let _codeBadgeLayoutOk = false;
let _panelOpened = false;

export function script_moduleEnabled() {
  _moduleEnabled = true;
}
export function script_lifecycleOk() {
  _lifecycleOk = true;
}
export function script_panelClean() {
  _panelClean = true;
}
export function script_clipboardWritten() {
  _clipboardWritten = true;
}
export function script_clipboardImageWritten() {
  _clipboardImageWritten = true;
}
export function script_textCardLayoutOk() {
  _textCardLayoutOk = true;
}
export function script_codeBadgeLayoutOk() {
  _codeBadgeLayoutOk = true;
}
export function script_panelOpened() {
  _panelOpened = true;
}

export function finish() {
  if (!_moduleEnabled) throw new Error('ClipboardHistory module did not enable');
  if (!_lifecycleOk) throw new Error('Shell crashed during module enable/disable cycle');
  if (!_clipboardWritten) throw new Error('Clipboard write step did not complete');
  if (!_clipboardImageWritten) throw new Error('Clipboard image write step did not complete');
  if (!_textCardLayoutOk) throw new Error('Clipboard text card layout check did not complete');
  if (!_codeBadgeLayoutOk) throw new Error('Clipboard code badge layout check did not complete');
  if (!_panelOpened) throw new Error('Clipboard panel did not open inside the work area');
  if (!_panelClean) throw new Error(`"${PANEL_CSS}" was not cleaned up after module disable`);
}
