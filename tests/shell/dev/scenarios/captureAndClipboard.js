import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

export async function exerciseCaptureTools(settings, devTool) {
  settings.set_boolean('module-capture-tools', true);
  await Scripting.waitLeisure();
  await Scripting.sleep(500);

  const tool = devTool.captureToolsTool;
  if (!tool) throw new Error('Capture Tool DevTool section not found');
  if (!(await tool.openPreview())) throw new Error('Capture Tool did not open the preview');
  await Scripting.sleep(300);

  if (!tool.state?.captureVisible || !tool.state.toolbarVisible)
    throw new Error('Capture Tool preview is not visible');
  if (!tool.cycleTool()) throw new Error('Capture Tool did not change tool');
  if (!tool.cycleColor()) throw new Error('Capture Tool did not change color');
  if (!tool.cycleWidth()) throw new Error('Capture Tool did not change width');
  if (!tool.toggleInteraction('selection'))
    throw new Error('Capture Tool did not simulate selection movement');

  await Scripting.sleep(250);
  if (tool.state?.interaction !== 'selection' || tool.state.controlsOpacity !== 100)
    throw new Error('Capture Tool selection did not make controls translucent');
  if (!tool.toggleInteraction('drawing')) throw new Error('Capture Tool did not simulate drawing');

  await Scripting.sleep(250);
  if (tool.state?.interaction !== 'drawing' || tool.state.controlsOpacity !== 100)
    throw new Error('Capture Tool drawing did not keep controls translucent');
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
  await Scripting.sleep(500);

  const tool = devTool.clipboardHistoryTool;
  if (!tool) throw new Error('Clipboard History DevTool section not found');

  const previousEntryCount = tool.entryCount;
  if (tool.addRandomMessages(2).length !== 2)
    throw new Error('Clipboard History did not add random messages');
  if (tool.entryCount < previousEntryCount + 2)
    throw new Error('Clipboard History entry count did not increase');
  if (!tool.openPanel()) throw new Error('Clipboard History did not open the panel');

  await Scripting.sleep(100);
  if (!tool.isPanelOpen) throw new Error('Clipboard History panel state was not updated');

  Main.uiGroup
    .get_children()
    .find((actor) => actor.has_style_class_name?.('aurora-clipboard-panel'))
    ?.close?.();

  if (!tool.clearHistory()) throw new Error('Clipboard History did not clear the history');
  if (tool.entryCount !== 0) throw new Error('Clipboard History still has entries after clear');
}
