import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { waitForCondition } from '../../support/testUtils.js';

function findDescendant(actor, predicate) {
  if (predicate(actor)) return actor;
  if (!actor?.get_children) return null;
  for (const child of actor.get_children()) {
    const match = findDescendant(child, predicate);
    if (match) return match;
  }
  return null;
}

async function openDevToolSection(panelButton, key) {
  if (panelButton.menu.isOpen) panelButton.menu.close();
  panelButton.menu.open();
  await Scripting.waitLeisure();

  const devTools = findDescendant(
    panelButton.menu.box,
    (actor) => actor.name === 'aurora-devtool-focus-view-devtools',
  );
  if (!devTools) throw new Error('Dev Tools view button not found');
  devTools.emit('clicked', 1);
  await Scripting.waitLeisure();

  const section = findDescendant(
    panelButton.menu.box,
    (actor) => actor.name === `aurora-devtool-focus-devtool-${key}`,
  );
  if (!section) throw new Error(`${key} DevTool section button not found`);
  section.emit('clicked', 1);
  await Scripting.waitLeisure();
}

async function clickAction(panelButton, accessibleName, expectedFocusName = null) {
  const button = findDescendant(
    panelButton.menu.box,
    (actor) => actor.accessible_name === accessibleName,
  );
  if (!button) throw new Error(`${accessibleName} action not found`);

  if (expectedFocusName) button.grab_key_focus();
  button.emit('clicked', 1);
  await Scripting.waitLeisure();

  if (expectedFocusName && global.stage.get_key_focus()?.name !== expectedFocusName)
    throw new Error(`${accessibleName} action did not restore focus to ${expectedFocusName}`);
}

function actorSignals(root) {
  if (!root) return [];
  const children = root.get_children ? root.get_children() : [];
  return [
    [root, 'notify::opacity'],
    [root, 'notify::visible'],
    [root, 'transitions-completed'],
    ...children.flatMap(actorSignals),
  ];
}

function waitForInteractionState(tool, interaction, opacity) {
  return waitForCondition({
    evaluate: () => {
      const state = tool.state;
      return state?.interaction === interaction && state.controlsOpacity === opacity;
    },
    signals: actorSignals(Main.screenshotUI),
    description: `Capture Tool interaction ${interaction} at opacity ${opacity}`,
  });
}

export async function exerciseCaptureTools(panelButton, settings, devTool) {
  settings.set_boolean('module-capture-tools', true);
  await Scripting.waitLeisure();

  const tool = devTool.captureToolsTool;
  if (!tool) throw new Error('Capture Tool DevTool section not found');
  await openDevToolSection(panelButton, 'capture-tools');
  await clickAction(panelButton, 'Open Preview');
  await waitForCondition({
    evaluate: () => tool.state?.captureVisible && tool.state.toolbarVisible,
    signals: [[Main.uiGroup, 'child-added'], ...actorSignals(Main.screenshotUI)],
    description: 'Capture Tool preview and toolbar to become visible',
  });

  if (!tool.state?.captureVisible || !tool.state.toolbarVisible)
    throw new Error('Capture Tool preview is not visible');

  const initialTool = tool.state.tool;
  const initialColor = tool.state.color;
  const initialWidth = tool.state.width;
  await clickAction(panelButton, `Tool: ${initialTool}`, 'aurora-devtool-focus-capture-tool');
  await clickAction(panelButton, `Color: ${initialColor}`, 'aurora-devtool-focus-capture-color');
  await clickAction(panelButton, `Width: ${initialWidth}`, 'aurora-devtool-focus-capture-width');
  if (
    tool.state?.tool === initialTool ||
    tool.state?.color === initialColor ||
    tool.state?.width === initialWidth
  )
    throw new Error('Capture Tool appearance controls did not update runtime state');

  await clickAction(panelButton, 'Move Selection');

  await waitForInteractionState(tool, 'selection', 100);
  await clickAction(panelButton, 'Draw');

  await waitForInteractionState(tool, 'drawing', 100);
  await clickAction(panelButton, 'Tesseract Off');
  if (tool.state?.ocrAvailable !== false)
    throw new Error('Capture Tool did not simulate unavailable Tesseract');
  await clickAction(panelButton, 'Tesseract On');
  if (tool.state?.ocrAvailable !== true)
    throw new Error('Capture Tool did not simulate available Tesseract');
  await clickAction(panelButton, 'Inject OCR');
  if (!tool.state?.ocrHasResult) throw new Error('Capture Tool did not inject an OCR result');
  if (!tool.state.searchUri?.includes('Aurora%20simulated%20OCR%20result'))
    throw new Error('Capture Tool did not expose the simulated OCR search URI');
  await clickAction(panelButton, 'Copy OCR');
  await clickAction(panelButton, 'Clear Annotations');
  await clickAction(panelButton, 'Reset');
  if (tool.state?.interaction !== 'idle' || tool.state.ocrAvailabilityOverridden)
    throw new Error('Capture Tool reset left simulated state active');

  Main.screenshotUI.close(true);
}

export async function exerciseClipboardHistory(panelButton, settings, devTool) {
  settings.set_boolean('module-clipboard-history', true);
  await Scripting.waitLeisure();

  const tool = devTool.clipboardHistoryTool;
  if (!tool) throw new Error('Clipboard History DevTool section not found');

  await openDevToolSection(panelButton, 'clipboard-history');
  const previousEntryCount = tool.entryCount;
  await clickAction(panelButton, 'Add 5 Messages');
  if (tool.entryCount < previousEntryCount + 5)
    throw new Error('Clipboard History entry count did not increase');
  await clickAction(panelButton, 'Open Panel');

  await waitForCondition({
    evaluate: () => tool.isPanelOpen,
    signals: [[Main.uiGroup, 'child-added']],
    description: 'Clipboard History panel to open',
  });
  if (!tool.isPanelOpen) throw new Error('Clipboard History panel state was not updated');

  const panel = Main.uiGroup
    .get_children()
    .find(
      (actor) => actor.has_style_class_name && actor.has_style_class_name('aurora-clipboard-panel'),
    );
  if (panel && panel.close) panel.close();

  await openDevToolSection(panelButton, 'clipboard-history');
  await clickAction(panelButton, 'Clear History');
  if (tool.entryCount !== 0) throw new Error('Clipboard History still has entries after clear');
}
