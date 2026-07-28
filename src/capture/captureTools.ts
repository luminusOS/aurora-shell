import Clutter from '@girs/clutter-18';
import Gio from '@girs/gio-2.0';
import St from '@girs/st-18';
import { gettext as _ } from '~/shared/i18n.ts';
import * as Main from '@girs/gnome-shell/ui/main';
import { Slider } from '@girs/gnome-shell/ui/slider';
import { AnnotationCanvas } from '~/capture/annotationCanvas.ts';
import {
  AnnotationModel,
  type Annotation,
  type AnnotationTool,
  type Point,
} from '~/capture/annotationModel.ts';
import { OcrController, OcrUnavailableError } from '~/capture/ocrController.ts';
import { buildWebSearchUri, placeOcrActionBelow, type OcrWord } from '~/capture/ocrLogic.ts';
import { CaptureTooltip } from '~/capture/captureTooltip.ts';
import {
  captureScreenshot,
  exportAnnotatedScreenshot,
  type CapturedScreenshot,
} from '~/capture/screenshotCapture.ts';
import {
  getScreenshotUi,
  type Geometry,
  type ScreenshotUi,
} from '~/capture/screenshotUiAdapter.ts';
import {
  calculateToolbarTranslation,
  findMonitorForSelection,
} from '~/capture/toolbarPlacement.ts';
import type { ExtensionContext } from '~/core/context.ts';
import { LifecycleScope } from '~/core/lifecycleScope.ts';
import { logger } from '~/core/logger.ts';
import type { SettingsManager } from '~/core/settings.ts';
import { Module } from '~/module.ts';
import { createIcon } from '~/shared/icons.ts';

const LOG_PREFIX = 'CaptureTools';
const COLOR_KEY = 'capture-tools-color';
const WIDTH_KEY = 'capture-tools-stroke-width';
const OCR_ENABLED_KEY = 'capture-tools-ocr-enabled';
const WEB_SEARCH_ENGINE_KEY = 'capture-tools-web-search-engine';
const COLORS = [
  '#ffffff',
  '#000000',
  '#e01b24',
  '#ff8800',
  '#ffdd00',
  '#44cc44',
  '#4488ff',
  '#aa44ff',
] as const;
const LINE_WIDTH_MIN = 1;
const LINE_WIDTH_MAX = 16;

type ScreenshotOpen = (mode?: number, ...args: unknown[]) => Promise<unknown>;
type ScreenshotSave = () => Promise<void>;
type ToolDefinition = { tool: AnnotationTool; icon: string; label: string };
type ToolbarDrag = {
  pointerX: number;
  pointerY: number;
  toolbarX: number;
  toolbarY: number;
  baseX: number;
  baseY: number;
};

export type CaptureToolsDevInteraction = 'idle' | 'selection' | 'drawing';

export type CaptureToolsDevState = {
  captureVisible: boolean;
  toolbarVisible: boolean;
  toolbarGeometry: { x: number; y: number; width: number; height: number } | null;
  tool: AnnotationTool;
  color: string;
  width: number;
  annotationCount: number;
  controlsOpacity: number;
  interaction: CaptureToolsDevInteraction;
  ocrAvailable: boolean | null;
  ocrAvailabilityOverridden: boolean;
  ocrHasResult: boolean;
  ocrPanelVisible: boolean;
  searchUri: string | null;
};

const TOOLS: readonly ToolDefinition[] = [
  { tool: 'select', icon: 'selection-opaque-3-symbolic', label: _('Selection') },
  { tool: 'pointer', icon: 'pointer-primary-click-symbolic', label: _('Pointer') },
  { tool: 'freehand', icon: 'document-edit-symbolic', label: _('Freehand') },
  { tool: 'rectangle', icon: 'square-outline-thick-symbolic', label: _('Rectangle') },
  { tool: 'solid-rectangle', icon: 'square-filled-symbolic', label: _('Solid rectangle') },
  { tool: 'highlighter', icon: 'marker-symbolic', label: _('Highlighter') },
  { tool: 'arrow', icon: 'arrow1-top-right-symbolic', label: _('Arrow') },
  { tool: 'text', icon: 'text-insert2-symbolic', label: _('Text') },
  { tool: 'stamp', icon: 'one-circle-symbolic', label: _('Numbered marker') },
];

export class CaptureTools extends Module {
  private _ui: ScreenshotUi | null = null;
  private _scope: LifecycleScope | null = null;
  private _settings: SettingsManager | null = null;
  private _model: AnnotationModel | null = null;
  private _canvas: InstanceType<typeof AnnotationCanvas> | null = null;
  private _toolbar: St.BoxLayout | null = null;
  private _ocrLayer: St.Widget | null = null;
  private _ocrPanel: St.BoxLayout | null = null;
  private _ocrButton: St.Button | null = null;
  private _ocrTooltip: InstanceType<typeof CaptureTooltip> | null = null;
  private _ocrActionTooltips: InstanceType<typeof CaptureTooltip>[] = [];
  private _ocrController: OcrController | null = null;
  private _widthSlider: Slider | null = null;
  private _toolButtons = new Map<AnnotationTool, St.Button>();
  private _colorButtons = new Map<string, St.Button>();
  private _textEntry: St.Entry | null = null;
  private _textPoint: Point | null = null;
  private _toolbarDrag: ToolbarDrag | null = null;
  private _toolbarGrab: Clutter.Grab | null = null;
  private _toolbarDraggedByUser = false;
  private _ocrText = '';
  private _ocrBusy = false;
  private _devOcrAvailable: boolean | null = null;
  private _devInteraction: CaptureToolsDevInteraction = 'idle';
  private _portalMode = false;
  private _originalOpen: ScreenshotOpen | null = null;
  private _openWrapper: ScreenshotOpen | null = null;
  private _originalSaveScreenshot: ScreenshotSave | null = null;
  private _saveScreenshotWrapper: ScreenshotSave | null = null;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this.disable();
    const ui = getScreenshotUi();
    if (!ui) {
      logger.warn('[CaptureTools] GNOME screenshot UI contract is unavailable');
      return;
    }

    this._ui = ui;
    this._scope = new LifecycleScope();
    this._settings = this.context.settings;
    this._model = new AnnotationModel();
    const configuredColor = this._settings.getString(COLOR_KEY).toLowerCase();
    this._model.setColor(COLORS.find((color) => color === configuredColor) ?? COLORS[2]);
    this._model.setWidth(Math.min(LINE_WIDTH_MAX, this._settings.getInt(WIDTH_KEY)));
    this._ocrController = new OcrController(this._settings);

    this._canvas = new AnnotationCanvas();
    this._canvas.configure(
      this._model,
      (point) => this._requestText(point),
      (drawing) => this._setInteractionState(drawing ? 'drawing' : 'idle'),
    );
    ui.insert_child_below(this._canvas, ui._primaryMonitorBin);
    this._toolbar = this._buildToolbar();
    ui._primaryMonitorBin.add_child(this._toolbar);
    this._ocrButton = this._buildOcrButton();
    ui._showPointerButtonContainer.insert_child_below(this._ocrButton, ui._showPointerButton);
    this._ocrTooltip = new CaptureTooltip();
    this._ocrTooltip.configure(this._ocrButton, _('Extract text'));
    ui.add_child(this._ocrTooltip);
    this._ocrPanel = this._buildOcrPanel();
    this._ocrLayer = new St.Widget({ reactive: false, x_expand: true, y_expand: true });
    this._ocrLayer.add_constraint(
      new Clutter.BindConstraint({ source: global.stage, coordinate: Clutter.BindCoordinate.ALL }),
    );
    this._ocrLayer.add_child(this._ocrPanel);
    ui.add_child(this._ocrLayer);

    this._scope.onDispose(() => this._canvas?.destroy());
    this._scope.onDispose(() => this._toolbar?.destroy());
    this._scope.onDispose(() => this._ocrButton?.destroy());
    this._scope.onDispose(() => this._ocrTooltip?.destroy());
    this._scope.onDispose(() => this._ocrLayer?.destroy());
    this._scope.onDispose(() => {
      for (const tooltip of this._ocrActionTooltips) tooltip.destroy();
    });
    this._connectLifecycle(ui);
    this._patchOpen(ui);
    this._patchSaveScreenshot(ui);
    this._selectTool('select');
    this._selectColor(this._model.color);
    this._syncVisibility();
    logger.debug('Enabled; floating toolbar attached to the native screenshot UI', {
      prefix: LOG_PREFIX,
    });
    void this._probeOcr();
  }

  override disable(): void {
    const ui = this._ui;
    if (ui && this._openWrapper && this._originalOpen && ui.open === this._openWrapper) {
      ui.open = this._originalOpen;
    } else if (ui && this._openWrapper && ui.open !== this._openWrapper) {
      logger.warn('[CaptureTools] Screenshot open hook changed externally; leaving it untouched');
    }
    if (
      ui &&
      this._saveScreenshotWrapper &&
      this._originalSaveScreenshot &&
      ui._saveScreenshot === this._saveScreenshotWrapper
    ) {
      ui._saveScreenshot = this._originalSaveScreenshot;
    } else if (
      ui &&
      this._saveScreenshotWrapper &&
      ui._saveScreenshot !== this._saveScreenshotWrapper
    ) {
      logger.warn('[CaptureTools] Screenshot save hook changed externally; leaving it untouched');
    }

    this._commitText(false);
    this._canvas?.cancelDrawing();
    this._resetControlsOpacity();
    this._endToolbarDrag();
    this._ocrController?.destroy();
    this._scope?.dispose();
    this._toolButtons.clear();
    this._colorButtons.clear();
    this._ui = null;
    this._scope = null;
    this._settings = null;
    this._model = null;
    this._canvas = null;
    this._toolbar = null;
    this._ocrLayer = null;
    this._ocrPanel = null;
    this._ocrButton = null;
    this._ocrTooltip = null;
    this._ocrActionTooltips = [];
    this._ocrController = null;
    this._widthSlider = null;
    this._ocrText = '';
    this._ocrBusy = false;
    this._devOcrAvailable = null;
    this._devInteraction = 'idle';
    this._portalMode = false;
    this._toolbarDrag = null;
    this._toolbarGrab = null;
    this._toolbarDraggedByUser = false;
    this._originalOpen = null;
    this._openWrapper = null;
    this._originalSaveScreenshot = null;
    this._saveScreenshotWrapper = null;
  }

  private _connectLifecycle(ui: ScreenshotUi): void {
    const scope = this._scope!;
    scope.connect(ui, 'closed', () => this._resetSession());
    for (const button of [ui._shotButton, ui._castButton])
      scope.connect(button, 'notify::checked', () => this._syncVisibility());
    for (const button of [ui._selectionButton, ui._screenButton, ui._windowButton])
      scope.connect(button, 'notify::checked', () => this._clearOcr());
    scope.connect(ui._selectionButton, 'notify::checked', () => this._syncToolbarPlacement());
    scope.connect(ui._areaSelector, 'drag-started', () => {
      this._clearOcr();
      this._setInteractionState('selection');
    });
    scope.connect(ui._areaSelector, 'drag-ended', () => {
      this._setInteractionState('idle');
      this._syncToolbarPlacement();
    });
    if (this._toolbar) {
      for (const signal of ['notify::allocation', 'notify::mapped'])
        scope.connect(this._toolbar, signal, () => this._syncToolbarPlacement());
    }

    const monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
      this._endToolbarDrag();
      if (this._toolbar) {
        this._toolbar.translation_x = 0;
        this._toolbar.translation_y = 0;
      }
      if (this._canvas?.get_parent() === ui)
        ui.set_child_below_sibling(this._canvas, ui._primaryMonitorBin);
    });
    scope.onDispose(() => Main.layoutManager.disconnect(monitorsChangedId));

    const keyPressId = ui.connect(
      'key-press-event',
      (_actor: St.Widget, event: Clutter.Event): boolean => this._onKeyPress(event),
    );
    scope.onDispose(() => ui.disconnect(keyPressId));
    const settingsId = this._settings!.connect(`changed::${OCR_ENABLED_KEY}`, () =>
      this._syncOcrButton(),
    );
    scope.onDispose(() => this._settings?.disconnect(settingsId));
  }

  private _patchOpen(ui: ScreenshotUi): void {
    const original = ui.open;
    this._originalOpen = original;
    const wrapper: ScreenshotOpen = async (mode = 0, ...args: unknown[]) => {
      this._portalMode = mode === 2;
      const result = await original.call(ui, mode, ...args);
      this._syncVisibility();
      logger.debug(
        `Native screenshot UI opened; toolbar visible=${!this._portalMode} (mode=${mode})`,
        {
          prefix: LOG_PREFIX,
        },
      );
      return result;
    };
    this._openWrapper = wrapper;
    ui.open = wrapper;
  }

  private _patchSaveScreenshot(ui: ScreenshotUi): void {
    const original = ui._saveScreenshot;
    this._originalSaveScreenshot = original;
    const wrapper = async (): Promise<void> => {
      this._commitText(true);
      const model = this._model;
      if (this._portalMode || !model?.hasAnnotations) return original.call(ui);

      const annotations = [...model.annotations];
      try {
        const capture = await captureScreenshot(ui);
        // Return now so the caller closes the UI with the default animation;
        // the annotated export finishes in the background.
        void this._exportAnnotatedScreenshot(ui, capture, annotations);
      } catch (error) {
        logger.warn(`[CaptureTools] Annotated screenshot export failed: ${String(error)}`);
        Main.notify(_('Screenshot failed'), _('Could not export the annotated screenshot'));
      }
    };
    this._saveScreenshotWrapper = wrapper;
    ui._saveScreenshot = wrapper;
  }

  private async _exportAnnotatedScreenshot(
    ui: ScreenshotUi,
    capture: CapturedScreenshot,
    annotations: readonly Annotation[],
  ): Promise<void> {
    try {
      const file = await exportAnnotatedScreenshot(
        capture.pixbuf,
        annotations,
        { origin: capture.origin, scale: capture.scale },
        { copy: true, save: true },
      );
      if (file) ui.emit('screenshot-taken', file);
      logger.debug(`Saved screenshot with ${annotations.length} annotation(s)`, {
        prefix: LOG_PREFIX,
      });
    } catch (error) {
      logger.warn(`[CaptureTools] Annotated screenshot export failed: ${String(error)}`);
      Main.notify(_('Screenshot failed'), _('Could not export the annotated screenshot'));
    }
  }

  private _buildToolbar(): St.BoxLayout {
    const toolbar = new St.BoxLayout({
      style_class: 'screenshot-ui-panel capture-tools-toolbar',
      reactive: true,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.START,
      y_expand: true,
    });

    const dragHandle = this._iconButton('list-drag-handle-symbolic', _('Move toolbar'));
    dragHandle.add_style_class_name('capture-tools-drag-handle');
    dragHandle.connect('button-press-event', (_actor: St.Button, event: Clutter.Event) =>
      this._beginToolbarDrag(dragHandle, event),
    );
    dragHandle.connect('motion-event', (_actor: St.Button, event: Clutter.Event) =>
      this._moveToolbar(event),
    );
    dragHandle.connect('button-release-event', (_actor: St.Button, event: Clutter.Event) =>
      this._releaseToolbar(event),
    );
    toolbar.add_child(dragHandle);

    for (const [index, definition] of TOOLS.entries()) {
      const button = this._iconButton(definition.icon, definition.label, true);
      button.add_style_class_name(`capture-tools-tool-${definition.tool}`);
      button.connect('clicked', () => this._selectTool(definition.tool));
      toolbar.add_child(button);
      this._toolButtons.set(definition.tool, button);
      if (index === 1) toolbar.add_child(this._separator());
    }

    toolbar.add_child(this._separator());
    for (const color of COLORS) {
      const swatch = new St.Widget({
        style_class: 'capture-tools-swatch',
        style: `background-color: ${color};`,
      });
      const button = new St.Button({
        style_class: 'capture-tools-ring-button',
        accessible_name: `${_('Annotation color')}: ${color}`,
        child: swatch,
        toggle_mode: true,
        can_focus: true,
      });
      button.connect('clicked', () => this._selectColor(color));
      toolbar.add_child(button);
      this._colorButtons.set(color, button);
    }

    toolbar.add_child(this._separator());
    const initialWidth = Math.max(
      LINE_WIDTH_MIN,
      Math.min(LINE_WIDTH_MAX, this._model?.width ?? 4),
    );
    const slider = new Slider((initialWidth - LINE_WIDTH_MIN) / (LINE_WIDTH_MAX - LINE_WIDTH_MIN));
    slider.add_style_class_name('capture-tools-width-slider');
    slider.accessible_name = _('Annotation width');
    slider.y_align = Clutter.ActorAlign.CENTER;
    slider.connect('notify::value', () => {
      const model = this._model;
      if (!model || !this._settings) return;
      const next = LINE_WIDTH_MIN + slider.value * (LINE_WIDTH_MAX - LINE_WIDTH_MIN);
      model.setWidth(next);
      this._settings.setInt(WIDTH_KEY, model.width);
    });
    this._widthSlider = slider;
    toolbar.add_child(slider);

    toolbar.add_child(this._separator());
    const undo = this._iconButton('edit-undo-symbolic', _('Undo'));
    undo.connect('clicked', () => this._undo());
    toolbar.add_child(undo);
    const clear = this._iconButton('user-trash-symbolic', _('Clear annotations'));
    clear.connect('clicked', () => this._clearAnnotations());
    toolbar.add_child(clear);
    return toolbar;
  }

  private _buildOcrButton(): St.Button {
    const button = new St.Button({
      style_class: 'screenshot-ui-show-pointer-button capture-tools-native-ocr-button',
      icon_name: 'scanner-symbolic',
      accessible_name: _('Extract text'),
      toggle_mode: false,
      can_focus: true,
    });
    button.connect('clicked', () => void this._runOcr());
    return button;
  }

  private _buildOcrPanel(): St.BoxLayout {
    const panel = new St.BoxLayout({
      style_class: 'screenshot-ui-panel capture-tools-ocr-panel',
      reactive: true,
      visible: false,
    });
    const copy = this._iconButton('edit-copy-symbolic', _('Copy text'));
    copy.add_style_class_name('capture-tools-ocr-copy-button');
    copy.connect('clicked', () => this._copyOcrText());
    panel.add_child(copy);
    this._attachOcrActionTooltip(copy, _('Copy text'));

    const search = this._iconButton('system-search-symbolic', _('Search the web'));
    search.add_style_class_name('capture-tools-ocr-search-button');
    search.connect('clicked', () => void this._searchOcrText());
    panel.add_child(search);
    this._attachOcrActionTooltip(search, _('Search the web'));
    return panel;
  }

  private _attachOcrActionTooltip(anchor: St.Button, text: string): void {
    const tooltip = new CaptureTooltip();
    tooltip.configure(anchor, text);
    this._ui?.add_child(tooltip);
    this._ocrActionTooltips.push(tooltip);
  }

  private _iconButton(icon: string, label: string, toggle = false): St.Button {
    return new St.Button({
      style_class: 'screenshot-ui-type-button capture-tools-button',
      child: createIcon(icon),
      accessible_name: label,
      toggle_mode: toggle,
      can_focus: true,
    });
  }

  private _separator(): St.Widget {
    return new St.Widget({ style_class: 'capture-tools-separator', y_expand: true });
  }

  private _selectTool(tool: AnnotationTool): void {
    this._commitText(true);
    this._model?.setTool(tool);
    for (const [candidate, button] of this._toolButtons) button.checked = candidate === tool;
    this._canvas?.setDrawingEnabled(this._usesCanvas(tool) && this._toolbar?.visible === true);
  }

  private _usesCanvas(tool: AnnotationTool): boolean {
    return tool !== 'select';
  }

  private _beginToolbarDrag(handle: St.Button, event: Clutter.Event): boolean {
    const toolbar = this._toolbar;
    if (!toolbar || event.get_button() !== Clutter.BUTTON_PRIMARY) return Clutter.EVENT_PROPAGATE;
    const [pointerX, pointerY] = event.get_coords();
    const [toolbarX, toolbarY] = toolbar.get_transformed_position();
    this._toolbarDrag = {
      pointerX,
      pointerY,
      toolbarX,
      toolbarY,
      baseX: toolbarX - toolbar.translation_x,
      baseY: toolbarY - toolbar.translation_y,
    };
    this._toolbarGrab?.dismiss();
    this._toolbarGrab = global.stage.grab(handle);
    global.stage.get_grab_actor()?.set_cursor_type(Clutter.CursorType.GRABBING);
    return Clutter.EVENT_STOP;
  }

  private _moveToolbar(event: Clutter.Event): boolean {
    const toolbar = this._toolbar;
    const drag = this._toolbarDrag;
    const monitor = Main.layoutManager.primaryMonitor;
    if (!toolbar || !drag || !monitor) return Clutter.EVENT_PROPAGATE;
    const [pointerX, pointerY] = event.get_coords();
    const extents = toolbar.get_transformed_extents();
    const desiredX = drag.toolbarX + pointerX - drag.pointerX;
    const desiredY = drag.toolbarY + pointerY - drag.pointerY;
    const x = Math.max(
      monitor.x,
      Math.min(desiredX, monitor.x + monitor.width - extents.get_width()),
    );
    const y = Math.max(
      monitor.y,
      Math.min(desiredY, monitor.y + monitor.height - extents.get_height()),
    );
    toolbar.translation_x = Math.round(x - drag.baseX);
    toolbar.translation_y = Math.round(y - drag.baseY);
    return Clutter.EVENT_STOP;
  }

  private _releaseToolbar(event: Clutter.Event): boolean {
    if (!this._toolbarDrag || event.get_button() !== Clutter.BUTTON_PRIMARY)
      return Clutter.EVENT_PROPAGATE;
    this._toolbarDraggedByUser = true;
    this._endToolbarDrag();
    return Clutter.EVENT_STOP;
  }

  private _endToolbarDrag(): void {
    this._toolbarDrag = null;
    if (this._toolbarGrab)
      global.stage.get_grab_actor()?.set_cursor_type(Clutter.CursorType.INHERIT);
    this._toolbarGrab?.dismiss();
    this._toolbarGrab = null;
  }

  private _selectColor(color: string): void {
    const model = this._model;
    model?.setColor(color);
    const selectedColor = model?.color ?? color.toLowerCase();
    this._settings?.setString(COLOR_KEY, selectedColor);
    for (const [candidate, button] of this._colorButtons) {
      button.checked = candidate === selectedColor;
      button.style = `border-color: ${button.checked ? candidate : 'transparent'};`;
    }
    this._canvas?.refresh();
  }

  private _requestText(point: Point): void {
    const ui = this._ui;
    if (!ui) return;
    this._commitText(true);
    this._textPoint = point;
    const entry = new St.Entry({
      style_class: 'capture-tools-text-entry',
      hint_text: _('Type annotation text'),
      can_focus: true,
      reactive: true,
    });
    entry.set_position(Math.round(point.x), Math.round(point.y));
    entry.set_size(240, 38);
    entry.clutter_text.connect('activate', () => this._commitText(true));
    entry.clutter_text.connect('key-press-event', (_actor: Clutter.Text, event: Clutter.Event) => {
      if (event.get_key_symbol() !== Clutter.KEY_Escape) return Clutter.EVENT_PROPAGATE;
      this._commitText(false);
      return Clutter.EVENT_STOP;
    });
    entry.clutter_text.connect('key-focus-out', () => this._commitText(true));
    ui.insert_child_above(entry, this._canvas);
    this._textEntry = entry;
    entry.grab_key_focus();
  }

  private _commitText(save: boolean): void {
    const entry = this._textEntry;
    const point = this._textPoint;
    this._textEntry = null;
    this._textPoint = null;
    if (!entry) return;
    const text = entry.get_text();
    entry.destroy();
    if (save && point && this._model?.addText(point, text)) this._canvas?.refresh();
  }

  private async _runOcr(): Promise<void> {
    const ui = this._ui;
    const controller = this._ocrController;
    if (!ui || !controller || this._ocrBusy) return;
    this._ocrBusy = true;
    this._ocrText = '';
    this._canvas?.setOcrWords([]);
    this._hideOcrPanel();
    try {
      const capture = await captureScreenshot(ui, false);
      const result = await controller.recognize(capture.pixbuf, capture.scale, capture.origin);
      if (!result.text) {
        this._clearOcr();
        Main.notify(_('OCR'), _('No text found in the screenshot'));
        return;
      }
      this._ocrText = result.text;
      this._canvas?.setOcrWords(result.words);
      this._showOcrCopyAction({
        x: capture.origin.x,
        y: capture.origin.y,
        width: capture.pixbuf.get_width() / capture.scale,
        height: capture.pixbuf.get_height() / capture.scale,
      });
    } catch (error) {
      this._canvas?.setOcrWords([]);
      if (error instanceof OcrUnavailableError)
        Main.notify(_('OCR unavailable'), _('Tesseract OCR and language data are not installed'));
      else {
        logger.warn(`[CaptureTools] OCR failed: ${String(error)}`);
        Main.notify(_('OCR failed'), _('Text recognition failed'));
      }
      this._hideOcrPanel();
    } finally {
      this._ocrBusy = false;
    }
  }

  private _copyOcrText(): void {
    if (!this._ocrText) return;
    const clipboard = St.Clipboard.get_default();
    clipboard.set_text(St.ClipboardType.CLIPBOARD, this._ocrText);
    clipboard.set_text(St.ClipboardType.PRIMARY, this._ocrText);
    this._hideOcrPanel();
    Main.notify(_('OCR'), _('Recognized text copied'));
  }

  private async _searchOcrText(): Promise<void> {
    if (!this._ocrText) return;
    const uri = buildWebSearchUri(this._ocrText, this._settings?.getString(WEB_SEARCH_ENGINE_KEY));
    const launchContext = global.create_app_launch_context(global.get_current_time(), -1);
    this._hideOcrPanel();
    try {
      await new Promise<void>((resolve, reject) => {
        Gio.app_info_launch_default_for_uri_async(uri, launchContext, null, (_source, result) => {
          try {
            Gio.app_info_launch_default_for_uri_finish(result);
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });
      this._ui?.close(true);
    } catch (error) {
      logger.warn(`[CaptureTools] Could not open OCR web search: ${String(error)}`);
      Main.notifyError(_('OCR'), _('Could not open the web search'));
    }
  }

  private _showOcrCopyAction(selection: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): void {
    const panel = this._ocrPanel;
    if (!panel) return;
    const [, naturalWidth] = panel.get_preferred_width(-1);
    const [, naturalHeight] = panel.get_preferred_height(naturalWidth);
    const position = placeOcrActionBelow(
      selection,
      { width: naturalWidth, height: naturalHeight },
      { width: global.stage.width, height: global.stage.height },
    );
    panel.set_position(position.x, position.y);
    panel.show();
  }

  private _clearOcr(): void {
    this._ocrController?.cancel();
    this._ocrText = '';
    this._canvas?.setOcrWords([]);
    this._hideOcrPanel();
  }

  private _hideOcrPanel(): void {
    this._ocrPanel?.hide();
    for (const tooltip of this._ocrActionTooltips) tooltip.close();
  }

  private _undo(): void {
    this._commitText(false);
    if (this._model?.undo()) this._canvas?.refresh();
  }

  private _clearAnnotations(): void {
    this._commitText(false);
    if (this._model?.clear()) this._canvas?.refresh();
  }

  private _onKeyPress(event: Clutter.Event): boolean {
    const symbol = event.get_key_symbol();
    const control = Boolean(event.get_state() & Clutter.ModifierType.CONTROL_MASK);
    if (control && (symbol === Clutter.KEY_z || symbol === Clutter.KEY_Z)) {
      this._undo();
      return Clutter.EVENT_STOP;
    }
    if (control && (symbol === Clutter.KEY_e || symbol === Clutter.KEY_E)) {
      void this._runOcr();
      return Clutter.EVENT_STOP;
    }
    if (symbol === Clutter.KEY_Escape && this._model?.tool !== 'select') {
      this._selectTool('select');
      return Clutter.EVENT_STOP;
    }
    return Clutter.EVENT_PROPAGATE;
  }

  private _syncVisibility(): void {
    const visible = !this._portalMode && this._ui?._shotButton.checked === true;
    if (visible) this._toolbar?.show();
    else this._toolbar?.hide();
    if (!visible) {
      this._canvas?.setDrawingEnabled(false);
      this._hideOcrPanel();
      this._ocrTooltip?.close();
    } else {
      this._canvas?.setDrawingEnabled(this._model ? this._usesCanvas(this._model.tool) : false);
    }
    this._syncOcrButton();
    if (visible) this._syncToolbarPlacement();
  }

  private _syncToolbarPlacement(): void {
    const toolbar = this._toolbar;
    const ui = this._ui;
    if (!toolbar || !ui || !toolbar.visible || !toolbar.mapped) return;
    // A position picked manually through the drag handle wins for the session.
    if (this._toolbarDraggedByUser) return;

    let selection: Geometry | null = null;
    if (!this._portalMode && ui._shotButton.checked && ui._selectionButton.checked) {
      try {
        const [x, y, width, height] = ui._areaSelector.getGeometry();
        if (width > 0 && height > 0) selection = [x, y, width, height];
      } catch {
        // The selector may not have geometry before its first allocation.
      }
    }

    if (!selection) {
      toolbar.translation_x = 0;
      toolbar.translation_y = 0;
      return;
    }

    const [x, y, width, height] = selection;
    const selectionRectangle = { x, y, width, height };
    const monitor = findMonitorForSelection(
      selectionRectangle,
      Main.layoutManager.monitors ?? [],
      Main.layoutManager.primaryIndex,
    );
    if (!monitor) {
      toolbar.translation_x = 0;
      toolbar.translation_y = 0;
      return;
    }

    const [stageX, stageY] = toolbar.get_transformed_position();
    const translation = calculateToolbarTranslation({
      monitor,
      selection: selectionRectangle,
      toolbar: {
        width: toolbar.width,
        height: toolbar.height,
        stageX,
        stageY,
        translationX: toolbar.translation_x,
        translationY: toolbar.translation_y,
      },
      margin: 12,
    });
    if (!translation) return;

    toolbar.translation_x = translation.x;
    toolbar.translation_y = translation.y;
  }

  private _setControlsOpacity(opacity: number): void {
    for (const actor of [this._toolbar, this._ui?._panel, this._ui?._closeButton]) {
      actor?.ease({
        opacity,
        duration: 200,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      });
    }
  }

  private _setInteractionState(interaction: CaptureToolsDevInteraction): void {
    this._devInteraction = interaction;
    this._setControlsOpacity(interaction === 'idle' ? 255 : 100);
  }

  private _resetControlsOpacity(): void {
    for (const actor of [this._toolbar, this._ui?._panel, this._ui?._closeButton]) {
      if (!actor) continue;
      actor.remove_all_transitions();
      actor.opacity = 255;
    }
    this._devInteraction = 'idle';
  }

  private _syncOcrButton(): void {
    if (!this._ocrButton) return;
    const available = this._devOcrAvailable ?? this._ocrController?.available;
    const enabled =
      this._devOcrAvailable !== null || (this._settings?.getBoolean(OCR_ENABLED_KEY) ?? false);
    this._ocrButton.visible =
      enabled && available === true && !this._portalMode && this._ui?._shotButton.checked === true;
    if (!this._ocrButton.visible) this._ocrTooltip?.close();
  }

  private _resetSession(): void {
    this._commitText(false);
    this._endToolbarDrag();
    this._clearOcr();
    this._model?.clear();
    this._canvas?.refresh();
    this._portalMode = false;
    this._selectTool('select');
    this._resetControlsOpacity();
    this._toolbarDraggedByUser = false;
    if (this._toolbar) {
      this._toolbar.translation_x = 0;
      this._toolbar.translation_y = 0;
    }
  }

  private async _probeOcr(): Promise<void> {
    try {
      await this._ocrController?.probe();
    } catch (error) {
      logger.warn(`[CaptureTools] Tesseract probe failed: ${String(error)}`);
    } finally {
      this._syncOcrButton();
    }
  }

  async openDevPreview(): Promise<boolean> {
    const ui = this._ui;
    if (!ui) return false;
    await ui.open();
    this._portalMode = false;
    this._syncVisibility();
    return true;
  }

  setDevTool(tool: AnnotationTool): boolean {
    if (!this._model) return false;
    this._selectTool(tool);
    return true;
  }

  setDevColor(color: string): boolean {
    if (!this._model || !COLORS.includes(color as (typeof COLORS)[number])) return false;
    this._selectColor(color);
    return true;
  }

  setDevWidth(width: number): boolean {
    const model = this._model;
    if (!model || !Number.isFinite(width)) return false;
    const next = Math.max(LINE_WIDTH_MIN, Math.min(LINE_WIDTH_MAX, Math.round(width)));
    model.setWidth(next);
    this._settings?.setInt(WIDTH_KEY, model.width);
    if (this._widthSlider)
      this._widthSlider.value = (model.width - LINE_WIDTH_MIN) / (LINE_WIDTH_MAX - LINE_WIDTH_MIN);
    return true;
  }

  simulateDevInteraction(interaction: CaptureToolsDevInteraction): boolean {
    if (!this._toolbar || !this._ui) return false;
    this._setInteractionState(interaction);
    return true;
  }

  setDevOcrAvailable(available: boolean | null): boolean {
    if (!this._ocrButton) return false;
    this._devOcrAvailable = available;
    this._syncOcrButton();
    return true;
  }

  injectDevOcrResult(text = 'Aurora simulated OCR result'): boolean {
    const ui = this._ui;
    if (!ui || !this._canvas || !this._ocrPanel) return false;

    const selection = this._devSelectionGeometry();
    const words: OcrWord[] = text
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 6)
      .map((word, index) => ({
        text: word,
        confidence: 96,
        lineKey: 'devtool:1',
        bounds: {
          x: selection.x + 18 + index * 72,
          y: selection.y + 20,
          width: Math.max(36, Math.min(68, word.length * 9)),
          height: 24,
        },
      }));
    this._ocrText = text;
    this._canvas.setOcrWords(words);
    this._showOcrCopyAction(selection);
    return true;
  }

  copyDevOcrText(): boolean {
    if (!this._ocrText) return false;
    this._copyOcrText();
    return true;
  }

  searchDevOcrText(): boolean {
    if (!this._ocrText) return false;
    void this._searchOcrText();
    return true;
  }

  clearDevAnnotations(): boolean {
    if (!this._model) return false;
    this._clearAnnotations();
    return true;
  }

  resetDevState(): boolean {
    if (!this._model) return false;
    this._devOcrAvailable = null;
    this._resetSession();
    this._syncOcrButton();
    return true;
  }

  get devState(): CaptureToolsDevState | null {
    const model = this._model;
    if (!model) return null;
    const toolbar = this._toolbar;
    let toolbarGeometry: CaptureToolsDevState['toolbarGeometry'] = null;
    if (toolbar) {
      const [x, y] = toolbar.get_transformed_position();
      toolbarGeometry = {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(toolbar.width),
        height: Math.round(toolbar.height),
      };
    }
    const searchUri = this._ocrText
      ? buildWebSearchUri(this._ocrText, this._settings?.getString(WEB_SEARCH_ENGINE_KEY))
      : null;
    return {
      captureVisible: this._ui?.visible ?? false,
      toolbarVisible: toolbar?.visible ?? false,
      toolbarGeometry,
      tool: model.tool,
      color: model.color,
      width: model.width,
      annotationCount: model.annotations.length,
      controlsOpacity: toolbar?.opacity ?? 255,
      interaction: this._devInteraction,
      ocrAvailable: this._devOcrAvailable ?? this._ocrController?.available ?? null,
      ocrAvailabilityOverridden: this._devOcrAvailable !== null,
      ocrHasResult: this._ocrText.length > 0,
      ocrPanelVisible: this._ocrPanel?.visible ?? false,
      searchUri,
    };
  }

  private _devSelectionGeometry(): { x: number; y: number; width: number; height: number } {
    try {
      const [x, y, width, height] = this._ui?._areaSelector.getGeometry() ?? [0, 0, 0, 0];
      if (width > 0 && height > 0) return { x, y, width, height };
    } catch {
      // The selector may not have geometry before its first allocation.
    }
    const monitor = Main.layoutManager.primaryMonitor;
    return monitor
      ? {
          x: monitor.x + Math.round(monitor.width * 0.2),
          y: monitor.y + Math.round(monitor.height * 0.2),
          width: Math.round(monitor.width * 0.6),
          height: Math.round(monitor.height * 0.45),
        }
      : { x: 160, y: 120, width: 640, height: 360 };
  }
}
