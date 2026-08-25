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

export async function exerciseCaptureTools(settings, devTool) {
  settings.set_boolean('module-capture-tools', true);
  await Scripting.waitLeisure();

  const tool = devTool.captureToolsTool;
  if (!tool) throw new Error('Capture Tool DevTool section not found');
  if (!(await tool.openPreview())) throw new Error('Capture Tool did not open the preview');
  await waitForCondition({
    evaluate: () => tool.state?.captureVisible && tool.state.toolbarVisible,
    signals: [[Main.uiGroup, 'child-added'], ...actorSignals(Main.screenshotUI)],
    description: 'Capture Tool preview and toolbar to become visible',
  });

  if (!tool.state?.captureVisible || !tool.state.toolbarVisible)
    throw new Error('Capture Tool preview is not visible');
  if (!tool.cycleTool()) throw new Error('Capture Tool did not change tool');
  if (!tool.cycleColor()) throw new Error('Capture Tool did not change color');
  if (!tool.cycleWidth()) throw new Error('Capture Tool did not change width');
  if (!tool.toggleInteraction('selection'))
    throw new Error('Capture Tool did not simulate selection movement');

  await waitForInteractionState(tool, 'selection', 100);
  if (!tool.toggleInteraction('drawing')) throw new Error('Capture Tool did not simulate drawing');

  await waitForInteractionState(tool, 'drawing', 100);
  if (!tool.setTesseractAvailable(false) || tool.state?.ocrAvailable !== false)
    throw new Error('Capture Tool did not simulate unavailable Tesseract');
  if (!tool.setTesseractAvailable(true) || tool.state?.ocrAvailable !== true)
    throw new Error('Capture Tool did not simulate available Tesseract');
  if (!tool.injectOcr() || !tool.state?.ocrHasResult)
    throw new Error('Capture Tool did not inject an OCR result');
  if (!tool.state.searchUri?.includes('Aurora%20simulated%20OCR%20result'))
    throw new Error('Capture Tool did not expose the simulated OCR search URI');
  if (!tool.copyOcr()) throw new Error('Capture Tool did not copy simulated OCR');
  if (!tool.clearAnnotations()) throw new Error('Capture Tool did not clear annotations');
  if (!tool.reset()) throw new Error('Capture Tool did not reset its state');
  if (tool.state?.interaction !== 'idle' || tool.state.ocrAvailabilityOverridden)
    throw new Error('Capture Tool reset left simulated state active');

  Main.screenshotUI.close(true);
}

export async function exerciseClipboardHistory(settings, devTool) {
  settings.set_boolean('module-clipboard-history', true);
  await Scripting.waitLeisure();

  const tool = devTool.clipboardHistoryTool;
  if (!tool) throw new Error('Clipboard History DevTool section not found');

  const previousEntryCount = tool.entryCount;
  if (tool.addRandomMessages(2).length !== 2)
    throw new Error('Clipboard History did not add random messages');
  if (tool.entryCount < previousEntryCount + 2)
    throw new Error('Clipboard History entry count did not increase');
  if (!tool.openPanel()) throw new Error('Clipboard History did not open the panel');

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

  if (!tool.clearHistory()) throw new Error('Clipboard History did not clear the history');
  if (tool.entryCount !== 0) throw new Error('Clipboard History still has entries after clear');
}
