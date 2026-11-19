import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { waitForCondition } from '../../support/testUtils.js';

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

export async function exerciseCaptureTools(runAction, settings, devTool) {
  settings.set_boolean('module-capture-tools', true);
  await Scripting.waitLeisure();

  const tool = devTool.capture;
  if (!tool) throw new Error('Capture Tool DevTool section not found');
  await runAction(tool.key, 'Open Preview');
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
  await runAction(tool.key, `Tool: ${initialTool}`);
  await runAction(tool.key, `Color: ${initialColor}`);
  await runAction(tool.key, `Width: ${initialWidth}`);
  if (
    tool.state?.tool === initialTool ||
    tool.state?.color === initialColor ||
    tool.state?.width === initialWidth
  )
    throw new Error('Capture Tool appearance controls did not update runtime state');

  await runAction(tool.key, 'Move Selection');

  await waitForInteractionState(tool, 'selection', 100);
  await runAction(tool.key, 'Draw');

  await waitForInteractionState(tool, 'drawing', 100);
  await runAction(tool.key, 'Tesseract Off');
  if (tool.state?.ocrAvailable !== false)
    throw new Error('Capture Tool did not simulate unavailable Tesseract');
  await runAction(tool.key, 'Tesseract On');
  if (tool.state?.ocrAvailable !== true)
    throw new Error('Capture Tool did not simulate available Tesseract');
  await runAction(tool.key, 'Inject OCR');
  if (!tool.state?.ocrHasResult) throw new Error('Capture Tool did not inject an OCR result');
  if (!tool.state.searchUri?.includes('Aurora%20simulated%20OCR%20result'))
    throw new Error('Capture Tool did not expose the simulated OCR search URI');
  await runAction(tool.key, 'Copy OCR');
  await runAction(tool.key, 'Clear Annotations');
  await runAction(tool.key, 'Reset');
  if (tool.state?.interaction !== 'idle' || tool.state.ocrAvailabilityOverridden)
    throw new Error('Capture Tool reset left simulated state active');

  Main.screenshotUI.close(true);
}

export async function exerciseClipboardHistory(runAction, settings, devTool) {
  settings.set_boolean('module-clipboard-history', true);
  await Scripting.waitLeisure();

  const tool = devTool.clipboard;
  if (!tool) throw new Error('Clipboard History DevTool section not found');

  const previousEntryCount = tool.entryCount;
  await runAction(tool.key, 'Add 5 Messages');
  if (tool.entryCount < previousEntryCount + 5)
    throw new Error('Clipboard History entry count did not increase');
  await runAction(tool.key, 'Open Panel');

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

  await runAction(tool.key, 'Clear History');
  if (tool.entryCount !== 0) throw new Error('Clipboard History still has entries after clear');
}
