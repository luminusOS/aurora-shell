import Clutter from '@girs/clutter-18';
import St from '@girs/st-18';
import { gettext as _ } from '~/shared/i18n.ts';
import * as Main from '@girs/gnome-shell/ui/main';
import type { Slider } from '@girs/gnome-shell/ui/slider';
import { AnnotationCanvas } from '~/capture/annotationCanvas.ts';
import { AnnotationModel, type AnnotationTool, type Point } from '~/capture/annotationModel.ts';
import { CaptureOcrSession } from '~/capture/captureOcrSession.ts';
import { CaptureToolbarPositioner } from '~/capture/captureToolbarPositioner.ts';
import {
  CAPTURE_COLORS as COLORS,
  CAPTURE_WIDTH_MAX as LINE_WIDTH_MAX,
  CAPTURE_WIDTH_MIN as LINE_WIDTH_MIN,
  createCaptureToolbar,
} from '~/capture/captureToolbar.ts';
import { ScreenshotHooks } from '~/capture/screenshotHooks.ts';
import { getScreenshotUi, type ScreenshotUi } from '~/capture/screenshotUiAdapter.ts';
import type { ExtensionContext } from '~/core/context.ts';
import { LifecycleScope } from '~/core/lifecycleScope.ts';
import { logger } from '~/core/logger.ts';
import type { SettingsManager } from '~/core/settings.ts';
import { Module } from '~/module.ts';

const LOG_PREFIX = 'CaptureTools';
const COLOR_KEY = 'capture-tools-color';
const WIDTH_KEY = 'capture-tools-stroke-width';

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

export class CaptureTools extends Module {
  private _ui: ScreenshotUi | null = null;
  private _scope: LifecycleScope | null = null;
  private _settings: SettingsManager | null = null;
  private _model: AnnotationModel | null = null;
  private _canvas: InstanceType<typeof AnnotationCanvas> | null = null;
  private _toolbar: St.BoxLayout | null = null;
  private _toolbarPositioner: CaptureToolbarPositioner | null = null;
  private _ocr: CaptureOcrSession | null = null;
  private _widthSlider: Slider | null = null;
  private _toolButtons = new Map<AnnotationTool, St.Button>();
  private _colorButtons = new Map<string, St.Button>();
  private _textEntry: St.Entry | null = null;
  private _textPoint: Point | null = null;
  private _devInteraction: CaptureToolsDevInteraction = 'idle';
  private _portalMode = false;
  private _hooks: ScreenshotHooks | null = null;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this.disable();
    const ui = getScreenshotUi();

    const settings = this.context.settings;
    const model = new AnnotationModel();
    this._ui = ui;
    const scope = new LifecycleScope();
    this._scope = scope;
    this._settings = settings;
    this._model = model;
    const configuredColor = settings.getString(COLOR_KEY).toLowerCase();
    model.setColor(COLORS.find((color) => color === configuredColor) || COLORS[2]);
    model.setWidth(Math.min(LINE_WIDTH_MAX, settings.getInt(WIDTH_KEY)));

    const canvas = new AnnotationCanvas();
    this._canvas = canvas;
    canvas.configure(
      model,
      (point) => this._requestText(point),
      (drawing) => this._setInteractionState(drawing ? 'drawing' : 'idle'),
    );
    ui.insert_child_below(canvas, ui._primaryMonitorBin);

    const toolbar = this._buildToolbar(model, settings);
    ui._primaryMonitorBin.add_child(toolbar);

    const toolbarPositioner = new CaptureToolbarPositioner(ui, toolbar);
    const ocr = new CaptureOcrSession(ui, canvas, settings);
    this._toolbar = toolbar;
    this._toolbarPositioner = toolbarPositioner;
    this._ocr = ocr;

    this._connectLifecycle(scope, ui, canvas, toolbar, toolbarPositioner, ocr);
    this._hooks = new ScreenshotHooks(ui, {
      setPortalMode: (portalMode) => {
        this._portalMode = portalMode;
      },
      syncVisibility: () => this._syncVisibility(),
      commitText: () => this._commitText(true),
      getAnnotations: () => (this._portalMode ? [] : [...model.annotations]),
    });
    this._selectTool('select');
    this._selectColor(model.color);
    this._syncVisibility();
    logger.debug('Enabled; floating toolbar attached to the native screenshot UI', {
      prefix: LOG_PREFIX,
    });
    void ocr.probe();
  }

  override disable(): void {
    this._hooks?.destroy();
    this._hooks = null;

    this._scope?.dispose();
    this._scope = null;

    this._textEntry?.destroy();
    this._textEntry = null;
    this._textPoint = null;

    this._canvas?.cancelDrawing();
    this._resetControlsOpacity();

    this._toolbarPositioner?.destroy();
    this._toolbarPositioner = null;
    this._ocr?.destroy();
    this._ocr = null;
    this._toolbar?.destroy();
    this._canvas?.destroy();

    this._toolButtons.clear();
    this._colorButtons.clear();
    this._ui = null;
    this._settings = null;
    this._model = null;
    this._canvas = null;
    this._toolbar = null;
    this._widthSlider = null;
    this._devInteraction = 'idle';
    this._portalMode = false;
  }

  private _connectLifecycle(
    scope: LifecycleScope,
    ui: ScreenshotUi,
    canvas: InstanceType<typeof AnnotationCanvas>,
    toolbar: St.BoxLayout,
    toolbarPositioner: CaptureToolbarPositioner,
    ocr: CaptureOcrSession,
  ): void {
    scope.connect(ui, 'closed', () => this._resetSession());
    for (const button of [ui._shotButton, ui._castButton]) {
      scope.connect(button, 'notify::checked', () => this._syncVisibility());
    }
    scope.connect(ui._castButton, 'notify::checked', () => {
      if (ui._castButton.checked) ui._showPointerButton.checked = true;
    });

    for (const button of [ui._selectionButton, ui._screenButton, ui._windowButton]) {
      scope.connect(button, 'notify::checked', () => ocr.clear());
    }

    scope.connect(ui._selectionButton, 'notify::checked', () => {
      toolbarPositioner.sync(this._portalMode);
    });
    scope.connect(ui._areaSelector, 'drag-started', () => {
      ocr.clear();
      this._setInteractionState('selection');
    });
    scope.connect(ui._areaSelector, 'drag-ended', () => {
      this._setInteractionState('idle');
      toolbarPositioner.sync(this._portalMode);
    });

    for (const signal of ['notify::allocation', 'notify::mapped']) {
      scope.connect(toolbar, signal, () => toolbarPositioner.sync(this._portalMode));
    }

    const monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
      toolbarPositioner.handleMonitorsChanged();
      if (canvas.get_parent() === ui) {
        ui.set_child_below_sibling(canvas, ui._primaryMonitorBin);
      }
    });
    scope.onDispose(() => Main.layoutManager.disconnect(monitorsChangedId));

    const keyPressId = ui.connect(
      'key-press-event',
      (_actor: St.Widget, event: Clutter.Event): boolean => this._onKeyPress(event),
    );
    scope.onDispose(() => ui.disconnect(keyPressId));
  }

  private _buildToolbar(model: AnnotationModel, settings: SettingsManager): St.BoxLayout {
    const toolbar = createCaptureToolbar(model.width, {
      beginDrag: (handle, event) => {
        if (!this._toolbarPositioner) {
          return Clutter.EVENT_PROPAGATE;
        }

        return this._toolbarPositioner.beginDrag(handle, event);
      },
      moveDrag: (event) => {
        if (!this._toolbarPositioner) {
          return Clutter.EVENT_PROPAGATE;
        }

        return this._toolbarPositioner.moveDrag(event);
      },
      releaseDrag: (event) => {
        if (!this._toolbarPositioner) {
          return Clutter.EVENT_PROPAGATE;
        }

        return this._toolbarPositioner.releaseDrag(event);
      },
      selectTool: (tool) => this._selectTool(tool),
      selectColor: (color) => this._selectColor(color),
      setWidth: (width) => {
        model.setWidth(width);
        settings.setInt(WIDTH_KEY, model.width);
      },
      undo: () => this._undo(),
      clear: () => this._clearAnnotations(),
    });
    this._toolButtons = toolbar.toolButtons;
    this._colorButtons = toolbar.colorButtons;
    this._widthSlider = toolbar.widthSlider;
    return toolbar.actor;
  }

  private _selectTool(tool: AnnotationTool): void {
    if (!this._model || !this._canvas || !this._toolbar) return;

    this._commitText(true);
    this._model.setTool(tool);

    for (const [candidate, button] of this._toolButtons) {
      button.checked = candidate === tool;
    }

    this._canvas.setDrawingEnabled(this._usesCanvas(tool) && this._toolbar.visible);
  }

  private _usesCanvas(tool: AnnotationTool): boolean {
    return tool !== 'select';
  }

  private _selectColor(color: string): void {
    if (!this._model || !this._settings || !this._canvas) return;

    this._model.setColor(color);
    const selectedColor = this._model.color;
    this._settings.setString(COLOR_KEY, selectedColor);

    for (const [candidate, button] of this._colorButtons) {
      button.checked = candidate === selectedColor;
      button.style = `border-color: ${button.checked ? candidate : 'transparent'};`;
    }
    this._canvas.refresh();
  }

  private _requestText(point: Point): void {
    if (!this._ui) return;

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
    this._ui.insert_child_above(entry, this._canvas);
    this._textEntry = entry;
    entry.grab_key_focus();
  }

  private _commitText(save: boolean): void {
    const entry = this._textEntry;
    const point = this._textPoint;
    this._textEntry = null;
    this._textPoint = null;

    if (!entry) {
      return;
    }

    const text = entry.get_text();
    entry.destroy();

    if (save && point && this._model && this._canvas && this._model.addText(point, text)) {
      this._canvas.refresh();
    }
  }

  private _undo(): void {
    this._commitText(false);

    if (!this._model || !this._canvas || !this._model.undo()) return;

    this._canvas.refresh();
  }

  private _clearAnnotations(): void {
    this._commitText(false);

    if (!this._model || !this._canvas || !this._model.clear()) return;

    this._canvas.refresh();
  }

  private _onKeyPress(event: Clutter.Event): boolean {
    if (!this._model || !this._ocr) return Clutter.EVENT_PROPAGATE;

    const symbol = event.get_key_symbol();
    const control = Boolean(event.get_state() & Clutter.ModifierType.CONTROL_MASK);
    if (control && (symbol === Clutter.KEY_z || symbol === Clutter.KEY_Z)) {
      this._undo();
      return Clutter.EVENT_STOP;
    }

    if (control && (symbol === Clutter.KEY_e || symbol === Clutter.KEY_E)) {
      void this._ocr.run();
      return Clutter.EVENT_STOP;
    }

    if (symbol === Clutter.KEY_Escape && this._model.tool !== 'select') {
      this._selectTool('select');
      return Clutter.EVENT_STOP;
    }

    return Clutter.EVENT_PROPAGATE;
  }

  private _syncVisibility(): void {
    if (
      !this._ui ||
      !this._toolbar ||
      !this._canvas ||
      !this._model ||
      !this._ocr ||
      !this._toolbarPositioner
    ) {
      return;
    }

    const visible = !this._portalMode && this._ui._shotButton.checked;

    if (visible) {
      this._toolbar.show();
    } else {
      this._toolbar.hide();
    }

    if (!visible) {
      this._canvas.setDrawingEnabled(false);
      this._ocr.hidePanel();
    } else {
      this._canvas.setDrawingEnabled(this._usesCanvas(this._model.tool));
    }

    this._ocr.syncButton(this._portalMode);
    if (visible) this._toolbarPositioner.sync(this._portalMode);
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

  private _resetSession(): void {
    if (!this._toolbarPositioner || !this._ocr || !this._model || !this._canvas) return;

    this._commitText(false);
    this._toolbarPositioner.reset();
    this._ocr.clear();
    this._model.clear();
    this._canvas.refresh();
    this._portalMode = false;
    this._selectTool('select');
    this._resetControlsOpacity();
  }

  async openDevPreview(): Promise<boolean> {
    const ui = this._ui;
    if (!ui) {
      return false;
    }

    await ui.open();
    this._portalMode = false;
    this._syncVisibility();
    return true;
  }

  setDevTool(tool: AnnotationTool): boolean {
    if (!this._model) {
      return false;
    }

    this._selectTool(tool);
    return true;
  }

  setDevColor(color: string): boolean {
    if (!this._model || !COLORS.includes(color as (typeof COLORS)[number])) {
      return false;
    }

    this._selectColor(color);
    return true;
  }

  setDevWidth(width: number): boolean {
    if (!this._model || !this._settings || !Number.isFinite(width)) {
      return false;
    }

    const next = Math.max(LINE_WIDTH_MIN, Math.min(LINE_WIDTH_MAX, Math.round(width)));
    this._model.setWidth(next);
    this._settings.setInt(WIDTH_KEY, this._model.width);
    if (this._widthSlider) {
      this._widthSlider.value =
        (this._model.width - LINE_WIDTH_MIN) / (LINE_WIDTH_MAX - LINE_WIDTH_MIN);
    }

    return true;
  }

  simulateDevInteraction(interaction: CaptureToolsDevInteraction): boolean {
    if (!this._toolbar || !this._ui) {
      return false;
    }

    this._setInteractionState(interaction);
    return true;
  }

  setDevOcrAvailable(available: boolean | null): boolean {
    if (!this._ocr) {
      return false;
    }

    this._ocr.setAvailabilityOverride(available);
    this._ocr.syncButton(this._portalMode);
    return true;
  }

  injectDevOcrResult(text = 'Aurora simulated OCR result'): boolean {
    if (!this._ui || !this._ocr) {
      return false;
    }

    const selection = this._devSelectionGeometry(this._ui);
    this._ocr.injectResult(text, selection);
    return true;
  }

  copyDevOcrText(): boolean {
    if (!this._ocr) {
      return false;
    }

    return this._ocr.copy();
  }

  searchDevOcrText(): boolean {
    if (!this._ocr) {
      return false;
    }

    return this._ocr.search();
  }

  clearDevAnnotations(): boolean {
    if (!this._model) {
      return false;
    }

    this._clearAnnotations();
    return true;
  }

  resetDevState(): boolean {
    if (!this._model || !this._ocr) {
      return false;
    }

    this._ocr.setAvailabilityOverride(null);
    this._resetSession();
    this._ocr.syncButton(this._portalMode);
    return true;
  }

  get devState(): CaptureToolsDevState | null {
    if (!this._ui || !this._model || !this._toolbar || !this._ocr) {
      return null;
    }

    const [toolbarX, toolbarY] = this._toolbar.get_transformed_position();
    const toolbarGeometry = {
      x: Math.round(toolbarX),
      y: Math.round(toolbarY),
      width: Math.round(this._toolbar.width),
      height: Math.round(this._toolbar.height),
    };

    return {
      captureVisible: this._ui.visible,
      toolbarVisible: this._toolbar.visible,
      toolbarGeometry,
      tool: this._model.tool,
      color: this._model.color,
      width: this._model.width,
      annotationCount: this._model.annotations.length,
      controlsOpacity: this._toolbar.opacity,
      interaction: this._devInteraction,
      ocrAvailable: this._ocr.available,
      ocrAvailabilityOverridden: this._ocr.availabilityOverridden,
      ocrHasResult: this._ocr.hasResult,
      ocrPanelVisible: this._ocr.panelVisible,
      searchUri: this._ocr.searchUri,
    };
  }

  private _devSelectionGeometry(ui: ScreenshotUi): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    const [x, y, width, height] = ui._areaSelector.getGeometry();
    if (width > 0 && height > 0) {
      return { x, y, width, height };
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
