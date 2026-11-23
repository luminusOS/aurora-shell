/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {
  waitForCondition,
  waitForTiming,
  EXTENSION_UUID,
  getAuroraSettings,
  waitForExtension,
} from '../support/testUtils.js';
import {
  assertPanelInsideWorkArea,
  assertPanelTrackedAboveFullscreen,
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

async function waitForFloatingActions(
  item,
  overlayStyle,
  expectedInset = 0,
  expectedItemWidth = null,
) {
  const overlay = findActorByStyle(item, overlayStyle);
  const actions = findActorByStyle(item, 'aurora-clipboard-item-actions');
  if (!overlay || !actions) throw new Error(`Floating action layout not found for ${overlayStyle}`);

  await waitForCondition({
    evaluate: () => {
      const content = overlay.first_child;
      const rightGap = overlay.width - (actions.x + actions.width);
      return (
        content &&
        actions.y === expectedInset &&
        rightGap === expectedInset &&
        content.x === 0 &&
        content.y === 0 &&
        content.width === overlay.width &&
        (expectedItemWidth === null || item.width === expectedItemWidth)
      );
    },
    signals: [
      [item, 'notify::allocation'],
      [overlay, 'notify::allocation'],
      [actions, 'notify::allocation'],
      [item, 'style-changed'],
      [global.stage, 'after-paint'],
    ],
    description: `${overlayStyle} floating actions to finish layout`,
  });
}

async function waitForHistoryWrite(evaluate, description) {
  const historyFile = Gio.File.new_for_path(
    `${GLib.get_user_data_dir()}/aurora-shell/${EXTENSION_UUID}/clipboard-history.log`,
  );
  const historyMonitor = historyFile.monitor_file(Gio.FileMonitorFlags.NONE, null);
  try {
    await waitForCondition({ evaluate, signals: [[historyMonitor, 'changed']], description });
  } finally {
    historyMonitor.cancel();
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

  Scripting.scriptEvent('moduleEnabled');

  auroraSettings.set_boolean('module-clipboard-history', false);
  await Scripting.waitLeisure();

  if (findClipboardPanel()) {
    throw new Error(`"${PANEL_CSS}" still in uiGroup after module was disabled`);
  }

  auroraSettings.set_boolean('module-clipboard-history', true);
  auroraSettings.set_boolean('clipboard-history-persist', true);
  await Scripting.waitLeisure();

  Scripting.scriptEvent('lifecycleOk');

  await exercisePostUnlockPanel();
  Scripting.scriptEvent('postUnlockExternalPanelOk');

  await exerciseWorkspacePanel();
  Scripting.scriptEvent('workspacePanelOk');

  const beforeTextCount = getClipboardModule().entryCount;
  St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, 'aurora-test-clipboard-entry');
  await waitForHistoryWrite(
    () => getClipboardModule().entryCount > beforeTextCount,
    'clipboard text to be persisted by the monitor',
  );

  Scripting.scriptEvent('clipboardWritten');

  const historyDir = `${GLib.get_user_data_dir()}/aurora-shell/${EXTENSION_UUID}`;
  const log = Gio.File.new_for_path(`${historyDir}/clipboard-history.log`);
  await waitForHistoryWrite(() => {
    if (!log.query_exists(null)) return false;
    return new globalThis.TextDecoder()
      .decode(log.load_contents(null)[1])
      .includes('aurora-test-clipboard-entry');
  }, 'clipboard log in the persistent data directory');
  const restored = new (getClipboardModule()._store.constructor)(
    `${historyDir}/clipboard-history.log`,
    `${historyDir}/clipboard-media`,
  );
  try {
    await restored.load();
    if (!restored.getHistory().some((entry) => entry.text === 'aurora-test-clipboard-entry'))
      throw new Error('New clipboard store failed to restore the persisted text');
  } finally {
    restored.destroy();
  }

  const clipboard = St.Clipboard.get_default();
  const clipboardModule = getClipboardModule();
  const newestEntry = () => clipboardModule._store.getHistory()[0];

  const screenshot = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, false, 8, 3840, 2160);
  screenshot.fill(0x3366ccff);
  const [, screenshotPng] = screenshot.save_to_bufferv('png', [], []);
  const beforeImageCount = clipboardModule.entryCount;
  clipboard.set_content(St.ClipboardType.CLIPBOARD, 'image/png', screenshotPng);
  await waitForHistoryWrite(
    () => clipboardModule.entryCount > beforeImageCount,
    'screenshot-sized clipboard image to be captured by the monitor',
  );

  const imageEntry = newestEntry();
  if (imageEntry?.kind !== 'image') throw new Error('Newest clipboard entry is not the image');
  const thumbnailPath = imageEntry.filePath.replace(/\.[^./]+$/, '') + '.thumb.png';
  const [, thumbnailWidth, thumbnailHeight] = GdkPixbuf.Pixbuf.get_file_info(thumbnailPath);
  if (!thumbnailWidth || Math.max(thumbnailWidth, thumbnailHeight) > 640) {
    throw new Error(`Image thumbnail has wrong size: ${thumbnailWidth}x${thumbnailHeight}`);
  }

  const store = clipboardModule._store;
  const originalWriteThumbnail = store._writeThumbnail;
  store._writeThumbnail = async () => {
    throw new Error('Injected thumbnail failure');
  };
  let imageWithoutThumbnailAdded;
  try {
    imageWithoutThumbnailAdded = await clipboardModule.addImage({
      mimeType: 'image/png',
      bytes: new GLib.Bytes(screenshotPng),
      fingerprint: `thumbnail-failure-${Date.now()}`,
    });
  } finally {
    store._writeThumbnail = originalWriteThumbnail;
  }
  const imageWithoutThumbnail = newestEntry();
  if (!imageWithoutThumbnailAdded || imageWithoutThumbnail?.kind !== 'image')
    throw new Error('Valid image was dropped when thumbnail generation failed');
  if (!Gio.File.new_for_path(imageWithoutThumbnail.filePath).query_exists(null))
    throw new Error('Original image was removed when thumbnail generation failed');
  if (
    Gio.File.new_for_path(
      imageWithoutThumbnail.filePath.replace(/\.[^./]+$/, '') + '.thumb.png',
    ).query_exists(null)
  )
    throw new Error('Failed thumbnail unexpectedly exists');

  const marker = 'aurora-test-before-image-restore';
  clipboard.set_text(St.ClipboardType.CLIPBOARD, marker);
  await waitForHistoryWrite(() => newestEntry()?.text === marker, 'marker text to be captured');

  clipboardModule._onActivate(imageEntry);
  await waitForCondition({
    evaluate: () => clipboard.get_mimetypes(St.ClipboardType.CLIPBOARD).includes('image/png'),
    signals: [[global.display.get_selection(), 'owner-changed']],
    description: 'restored image to own the clipboard',
  });

  const markerAfterRestore = 'aurora-test-after-image-restore';
  clipboard.set_text(St.ClipboardType.CLIPBOARD, markerAfterRestore);
  await waitForHistoryWrite(
    () => newestEntry()?.text === markerAfterRestore,
    'capture to continue after an image restore',
  );
  if (store.getHistory()[1]?.text !== marker)
    throw new Error('Restoring an image moved it to the front of history');

  Scripting.scriptEvent('clipboardImageWritten');

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
  const mediumText =
    'This clipboard entry wraps across multiple lines while remaining shorter than the maximum card height.';
  clipboardModule.addText(longText);
  clipboardModule.addText(mediumText);
  clipboardModule.addText('Short clipboard entry');
  clipboardModule.addText(fiveLineCode);
  clipboardModule.addText(sixLineCode);
  clipboardModule.openPanel();
  await Scripting.waitLeisure();

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

  const extension = Main.extensionManager.lookup(EXTENSION_UUID);
  const { ClipboardItem } = await import(`${extension.dir.get_uri()}/clipboard/clipboardItem.js`);
  const callbacks = { onActivate() {}, onRemove() {}, onTogglePin() {} };
  const entry = {
    id: 'thumbnail-test',
    kind: 'text',
    text: 'https://example.com/path',
    pinned: false,
  };
  const plainLink = new ClipboardItem(entry, callbacks);
  const previewLink = new ClipboardItem(
    {
      ...entry,
      preview: {
        title: 'Example title',
        description: 'Example description',
        thumbnail: new GLib.Bytes(new Uint8Array(96 * 96 * 4).fill(255)),
      },
    },
    callbacks,
  );
  Main.uiGroup.add_child(plainLink);
  Main.uiGroup.add_child(previewLink);
  await Scripting.waitLeisure();
  const thumbnail = findActorByStyle(previewLink, 'aurora-clipboard-item-link-thumb');
  if (!thumbnail || !(thumbnail.get_content() instanceof St.ImageContent)) {
    throw new Error('Link preview thumbnail is missing image content');
  }
  if (thumbnail.width !== 56 || thumbnail.height !== 56) {
    throw new Error(
      `Link preview thumbnail has incorrect size: ${thumbnail.width}x${thumbnail.height}`,
    );
  }
  if (
    findActorByStyle(plainLink, 'aurora-clipboard-item-link-thumb') ||
    findActorByStyle(plainLink, 'aurora-clipboard-item-link-title')?.text !== 'example.com'
  ) {
    throw new Error('Link without preview did not fall back to its hostname');
  }
  previewLink.destroy();
  plainLink.destroy();

  const panelChildren = panel.get_children();
  const searchRow = panelChildren[0];
  if (
    panelChildren.length !== 2 ||
    searchRow.get_children()[0] !== panel._searchEntry ||
    searchRow.get_children()[1] !== panel._incognitoButton
  ) {
    throw new Error('Clipboard panel must contain the search row and history list');
  }

  const list = panel._list;
  const shortItem = list?._items?.find((item) => item.entry.text === 'Short clipboard entry');
  const longItem = list?._items?.find((item) => item.entry.text === longText);
  const mediumItem = list?._items?.find((item) => item.entry.text === mediumText);
  const fiveLineCodeItem = list?._items?.find((item) => item.entry.text === fiveLineCode);
  const sixLineCodeItem = list?._items?.find((item) => item.entry.text === sixLineCode);
  const imageItem = list?._items?.find((item) => item.entry.kind === 'image');
  if (!shortItem || !mediumItem || !longItem) {
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
  if (mediumItem.height <= shortItem.height || longItem.height <= mediumItem.height)
    throw new Error(
      `Text cards did not grow: short=${shortItem.height}, medium=${mediumItem.height}, long=${longItem.height}`,
    );
  if (longItem.height > 100 || longItem.height > imageItem.height) {
    throw new Error(
      `Text card exceeds height limit: text=${longItem.height}, image=${imageItem.height}`,
    );
  }
  if (!longTextLabel.clutter_text.get_layout().is_ellipsized())
    throw new Error('Long text card should show an ellipsis');
  const [, textHeight] = longTextLabel.clutter_text.get_layout().get_pixel_size();
  if (
    textHeight > longTextLabel.clutter_text.height ||
    textHeight > textBody.height ||
    textHeight > textOverlay.height ||
    textHeight > longItem.height
  )
    throw new Error(
      `Text layout exceeds its allocation: ${textHeight} > ${longTextLabel.clutter_text.height}`,
    );
  const shortTextLabel = findActorByStyle(shortItem, 'aurora-clipboard-item-label');
  if (!shortTextLabel || shortTextLabel.clutter_text.get_layout().is_ellipsized())
    throw new Error('Short text card should not be ellipsized');
  const mediumTextLabel = findActorByStyle(mediumItem, 'aurora-clipboard-item-label');
  if (!mediumTextLabel || mediumTextLabel.clutter_text.get_layout().is_ellipsized())
    throw new Error('Medium text card should not be ellipsized');

  const longItemIndex = list._items.indexOf(longItem);
  list.moveFocus(longItemIndex);
  await waitForFloatingActions(
    longItem,
    'aurora-clipboard-item-text-overlay',
    0,
    widthBeforeSelection,
  );
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
  const shortOverlay = findActorByStyle(shortItem, 'aurora-clipboard-item-text-overlay');
  const shortActions = findActorByStyle(shortItem, 'aurora-clipboard-item-actions');
  if (!shortOverlay || !shortActions) {
    throw new Error('Short text card actions were not found');
  }
  await waitForCondition({
    evaluate: () =>
      shortItem.height === shortHeightBeforeSelection &&
      shortActions.y + shortActions.height <= shortOverlay.height,
    signals: [
      [shortItem, 'notify::allocation'],
      [shortOverlay, 'notify::allocation'],
      [shortActions, 'notify::allocation'],
      [shortItem, 'style-changed'],
      [global.stage, 'after-paint'],
    ],
    description: 'short text card to finish its selected layout',
  });
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
  await waitForFloatingActions(sixLineCodeItem, 'aurora-clipboard-item-code-overlay');
  assertFloatingActions(sixLineCodeItem, 'aurora-clipboard-item-code-overlay');

  const imageItemIndex = list._items.indexOf(imageItem);
  list.moveFocus(imageItemIndex - sixLineCodeIndex);
  await waitForFloatingActions(imageItem, 'aurora-clipboard-image-overlay', 6);
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
  const refreshedList = panel._list;
  const pinnedItem = refreshedList._items.find(
    (item) => item.entry.text === 'Short clipboard entry',
  );
  const hoveredHistoryItem = refreshedList._items.find((item) => item.entry.text === longText);
  if (!pinnedItem?.entry.pinned || !hoveredHistoryItem || hoveredHistoryItem.entry.pinned) {
    throw new Error('Could not prepare pinned and history items for the hover actions test');
  }
  if (
    refreshedList._items.indexOf(pinnedItem) >= refreshedList._items.indexOf(hoveredHistoryItem)
  ) {
    throw new Error('Pinned clipboard items must appear before history items');
  }
  hoveredHistoryItem.set_hover(true);
  await Scripting.waitLeisure();
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
    await waitForCondition({
      evaluate: () =>
        targetActivationCount === 1 &&
        Main.inputMethod.currentFocus === pasteTargetInputFocus &&
        pasteProbe.get_text() === 'aurora-auto-paste-enabled',
      signals: [[pasteProbe.clutter_text, 'text-changed']],
      description: 'automatic paste to restore and fill the Wayland input focus',
    });

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
    await waitForTiming(
      200,
      'negative assertion window proving disabled automatic paste never runs',
    );

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

  if (findClipboardPanel()) {
    throw new Error(`"${PANEL_CSS}" leaked into uiGroup after second disable`);
  }

  Scripting.scriptEvent('panelClean');

  auroraSettings.set_boolean('module-clipboard-history', true);
  await Scripting.waitLeisure();

  const reenabledModule = getClipboardModule();
  const beforeReenabledCapture = reenabledModule.entryCount;
  clipboard.set_text(St.ClipboardType.CLIPBOARD, 'aurora-test-after-reenable');
  await waitForHistoryWrite(
    () => getClipboardModule().entryCount > beforeReenabledCapture,
    'clipboard monitor to resume after re-enable',
  );
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
