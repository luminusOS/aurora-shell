/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { EXTENSION_UUID, getAuroraSettings, waitForExtension } from '../support/testUtils.js';
import {
  assertPanelInsideWorkArea,
  assertPanelTrackedAboveFullscreen,
  clearClipboardRuntime,
  exercisePostUnlockPanel,
  exerciseWorkspacePanel,
  findClipboardPanel,
  getClipboardModule,
} from './scenarios/panelEnvironment.js';

const PANEL_CSS = 'aurora-clipboard-panel';

function findActorByStyle(root, styleClass) {
  if (root.has_style_class_name && root.has_style_class_name(styleClass)) return root;
  const children = root.get_children ? root.get_children() : [];
  for (const child of children) {
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

export var METRICS = {};

export function init() {
  Scripting.defineScriptEvent('moduleEnabled', 'ClipboardHistory module enabled successfully');
  Scripting.defineScriptEvent('lifecycleOk', 'Module disabled and re-enabled without crash');
  Scripting.defineScriptEvent('panelClean', 'No aurora-clipboard-panel in uiGroup after disable');
  Scripting.defineScriptEvent('clipboardWritten', 'Clipboard text written for monitor test');
  Scripting.defineScriptEvent('clipboardImageWritten', 'Clipboard image written for monitor test');
  Scripting.defineScriptEvent('textCardLayoutOk', 'Text card wraps without growing horizontally');
  Scripting.defineScriptEvent('codeBadgeLayoutOk', 'Code line badge does not increase card height');
  Scripting.defineScriptEvent(
    'pinnedHoverActionsOk',
    'Hover reveals actions on history items when a pinned item exists',
  );
  Scripting.defineScriptEvent('panelOpened', 'Clipboard panel opened inside work area');
  Scripting.defineScriptEvent(
    'autoPasteOk',
    'Automatic paste honors its setting and restores focus',
  );
  Scripting.defineScriptEvent('workspacePanelOk', 'Clipboard panel opens on the active workspace');
  Scripting.defineScriptEvent(
    'postUnlockExternalPanelOk',
    'Clipboard panel opens above a maximized window on an external monitor after unlock',
  );
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);
  const auroraSettings = getAuroraSettings();

  await Scripting.waitLeisure();
  await Scripting.sleep(500);

  Scripting.scriptEvent('moduleEnabled');

  auroraSettings.set_boolean('module-clipboard-history', false);
  await Scripting.waitLeisure();
  await Scripting.sleep(400);

  if (findClipboardPanel()) {
    throw new Error(`"${PANEL_CSS}" still in uiGroup after module was disabled`);
  }
  clearClipboardRuntime();

  auroraSettings.set_boolean('module-clipboard-history', true);
  await Scripting.waitLeisure();
  await Scripting.sleep(400);

  Scripting.scriptEvent('lifecycleOk');

  await exercisePostUnlockPanel();
  Scripting.scriptEvent('postUnlockExternalPanelOk');

  await exerciseWorkspacePanel();
  Scripting.scriptEvent('workspacePanelOk');

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
  if (!panel.mapped || !panel._unredirectInhibitor?.inhibited) {
    throw new Error(
      `Mapped Clipboard panel did not inhibit unredirect: mapped=${panel.mapped} inhibited=${panel._unredirectInhibitor?.inhibited}`,
    );
  }
  assertPanelInsideWorkArea(panel);
  assertPanelTrackedAboveFullscreen(panel);

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
  const longTextLabel = findActorByStyle(longItem, 'aurora-clipboard-item-label');
  if (!textOverlay || !textBody || !longTextLabel) {
    throw new Error('Text card content was not found');
  }
  if (textBody.width !== textOverlay.width) {
    throw new Error(
      `Unselected text does not use the full card width: text=${textBody.width}, overlay=${textOverlay.width}`,
    );
  }

  const widthBeforeSelection = longItem.width;
  if (longTextLabel.clutter_text.get_layout().get_line_count() <= 1)
    throw new Error('Long text card did not wrap onto multiple lines');

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
  const shortHeightBeforeSelection = shortItem.height;
  list.moveFocus(shortItemIndex - longItemIndex);
  await Scripting.waitLeisure();
  await Scripting.sleep(100);
  const shortOverlay = findActorByStyle(shortItem, 'aurora-clipboard-item-text-overlay');
  const shortActions = findActorByStyle(shortItem, 'aurora-clipboard-item-actions');
  if (!shortOverlay || !shortActions) {
    throw new Error('Short text card actions were not found');
  }
  if (shortItem.height !== shortHeightBeforeSelection) {
    throw new Error(
      `Short text card height changed on focus: before=${shortHeightBeforeSelection}, after=${shortItem.height}`,
    );
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

  clipboardModule._onTogglePin(shortItem.entry.id);
  await Scripting.waitLeisure();
  await Scripting.sleep(100);
  const refreshedList = panel._list;
  const pinnedItem = refreshedList._items.find(
    (item) => item.entry.text === 'Short clipboard entry',
  );
  const hoveredHistoryItem = refreshedList._items.find((item) => item.entry.text === longText);
  if (!pinnedItem?.entry.pinned || !hoveredHistoryItem || hoveredHistoryItem.entry.pinned) {
    throw new Error('Could not prepare pinned and history items for the hover actions test');
  }
  hoveredHistoryItem.set_hover(true);
  await Scripting.waitLeisure();
  await Scripting.sleep(100);
  if (
    refreshedList.selectedItem !== hoveredHistoryItem ||
    !hoveredHistoryItem._removeButton.visible ||
    !hoveredHistoryItem._menuButton.visible
  ) {
    throw new Error('Hover did not reveal actions on a history item beside a pinned item');
  }
  if (
    !pinnedItem._actions.has_style_class_name('pinned-badge') ||
    pinnedItem._pinButton.reactive ||
    pinnedItem._pinButton.can_focus
  ) {
    throw new Error('Inactive pinned item did not become a passive borderless badge');
  }
  const pinnedActionsTheme = pinnedItem._actions.get_theme_node();
  const pinnedActionsBackground = pinnedActionsTheme.get_background_color();
  if (
    pinnedActionsBackground.alpha !== 0 ||
    [St.Side.TOP, St.Side.RIGHT, St.Side.BOTTOM, St.Side.LEFT].some(
      (side) => pinnedActionsTheme.get_padding(side) !== 0,
    )
  ) {
    throw new Error('Inactive pinned badge retained the action container background or padding');
  }
  const pinnedHeightBeforeFocus = pinnedItem.height;
  pinnedItem.set_hover(true);
  await Scripting.waitLeisure();
  await Scripting.sleep(100);
  if (pinnedItem.height !== pinnedHeightBeforeFocus) {
    throw new Error(
      `Pinned short card height changed on focus: before=${pinnedHeightBeforeFocus}, after=${pinnedItem.height}`,
    );
  }
  pinnedItem.set_hover(false);
  hoveredHistoryItem.set_hover(false);
  Scripting.scriptEvent('pinnedHoverActionsOk');

  let targetActivationCount = 0;
  const pasteProbe = new St.Entry({ can_focus: true });
  const focusThief = new St.Entry({ can_focus: true });
  Main.layoutManager.addTopChrome(pasteProbe, { trackFullscreen: false });
  Main.layoutManager.addTopChrome(focusThief, { trackFullscreen: false });
  try {
    const pasteTarget = {
      activate() {
        targetActivationCount++;
        pasteProbe.clutter_text.grab_key_focus();
      },
      has_focus() {
        return true;
      },
    };

    auroraSettings.set_boolean('clipboard-history-auto-paste', true);
    pasteProbe.set_text('');
    pasteProbe.clutter_text.grab_key_focus();
    const pasteTargetInputFocus = Main.inputMethod.currentFocus;
    if (!pasteTargetInputFocus) throw new Error('Could not capture the target input focus');
    focusThief.clutter_text.grab_key_focus();
    clipboardModule._pasteTargetWindow = pasteTarget;
    clipboardModule._pasteTargetInputFocus = pasteTargetInputFocus;
    clipboardModule._onActivate({ kind: 'text', text: 'aurora-auto-paste-enabled' });
    await Scripting.sleep(200);

    if (
      targetActivationCount !== 1 ||
      Main.inputMethod.currentFocus !== pasteTargetInputFocus ||
      pasteProbe.get_text() !== 'aurora-auto-paste-enabled'
    ) {
      throw new Error(
        `Automatic paste did not restore and fill the Wayland input focus: activations=${targetActivationCount}, focusRestored=${Main.inputMethod.currentFocus === pasteTargetInputFocus}, text=${pasteProbe.get_text()}`,
      );
    }

    auroraSettings.set_boolean('clipboard-history-auto-paste', false);
    pasteProbe.set_text('');
    clipboardModule._pasteTargetWindow = pasteTarget;
    clipboardModule._pasteTargetInputFocus = pasteTargetInputFocus;
    clipboardModule._onActivate({ kind: 'text', text: 'aurora-auto-paste-disabled' });
    await Scripting.sleep(200);

    if (targetActivationCount !== 1 || pasteProbe.get_text() !== '') {
      throw new Error('Automatic paste ran while its setting was disabled');
    }
  } finally {
    auroraSettings.set_boolean('clipboard-history-auto-paste', true);
    Main.layoutManager.removeChrome(focusThief);
    focusThief.destroy();
    Main.layoutManager.removeChrome(pasteProbe);
    pasteProbe.destroy();
  }
  Scripting.scriptEvent('autoPasteOk');

  if (panel.close) panel.close();
  if (panel._unredirectInhibitor?.inhibited) {
    throw new Error('Closed Clipboard panel retained its unredirect inhibitor');
  }
  Scripting.scriptEvent('panelOpened');

  auroraSettings.set_boolean('module-clipboard-history', false);
  await Scripting.waitLeisure();
  await Scripting.sleep(400);

  if (findClipboardPanel()) {
    throw new Error(`"${PANEL_CSS}" leaked into uiGroup after second disable`);
  }

  Scripting.scriptEvent('panelClean');

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
let _pinnedHoverActionsOk = false;
let _panelOpened = false;
let _autoPasteOk = false;
let _workspacePanelOk = false;
let _postUnlockExternalPanelOk = false;

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
export function script_pinnedHoverActionsOk() {
  _pinnedHoverActionsOk = true;
}
export function script_panelOpened() {
  _panelOpened = true;
}
export function script_autoPasteOk() {
  _autoPasteOk = true;
}
export function script_workspacePanelOk() {
  _workspacePanelOk = true;
}
export function script_postUnlockExternalPanelOk() {
  _postUnlockExternalPanelOk = true;
}

export function finish() {
  if (!_moduleEnabled) throw new Error('ClipboardHistory module did not enable');
  if (!_lifecycleOk) throw new Error('Shell crashed during module enable/disable cycle');
  if (!_clipboardWritten) throw new Error('Clipboard write step did not complete');
  if (!_clipboardImageWritten) throw new Error('Clipboard image write step did not complete');
  if (!_textCardLayoutOk) throw new Error('Clipboard text card layout check did not complete');
  if (!_codeBadgeLayoutOk) throw new Error('Clipboard code badge layout check did not complete');
  if (!_pinnedHoverActionsOk)
    throw new Error('Clipboard pinned-item hover actions check did not complete');
  if (!_panelOpened) throw new Error('Clipboard panel did not open inside the work area');
  if (!_autoPasteOk) throw new Error('Clipboard automatic paste check did not complete');
  if (!_workspacePanelOk) throw new Error('Clipboard workspace visibility check did not complete');
  if (!_postUnlockExternalPanelOk)
    throw new Error('Clipboard post-unlock external monitor check did not complete');
  if (!_panelClean) throw new Error(`"${PANEL_CSS}" was not cleaned up after module disable`);
}
