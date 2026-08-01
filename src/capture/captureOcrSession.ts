import Clutter from '@girs/clutter-18';
import Gio from '@girs/gio-2.0';
import St from '@girs/st-18';
import { gettext as _ } from '~/shared/i18n.ts';
import * as Main from '@girs/gnome-shell/ui/main';

import type { AnnotationCanvas } from './annotationCanvas.ts';
import { CaptureTooltip } from './captureTooltip.ts';
import { iconButton } from './captureToolbar.ts';
import { OcrController, OcrUnavailableError } from './ocrController.ts';
import { buildWebSearchUri, placeOcrActionBelow, type OcrWord } from './ocrLogic.ts';
import { captureScreenshot } from './screenshotCapture.ts';
import type { ScreenshotUi } from './screenshotUiAdapter.ts';
import { LifecycleScope } from '~/core/lifecycleScope.ts';
import { logger } from '~/core/logger.ts';
import type { SettingsManager } from '~/core/settings.ts';

const OCR_ENABLED_KEY = 'capture-tools-ocr-enabled';
const WEB_SEARCH_ENGINE_KEY = 'capture-tools-web-search-engine';

type SelectionGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export class CaptureOcrSession {
  private _scope = new LifecycleScope();
  private _controller: OcrController | null;
  private _layer: St.Widget;
  private _panel: St.BoxLayout;
  private _button: St.Button;
  private _buttonTooltip: InstanceType<typeof CaptureTooltip>;
  private _actionTooltips: InstanceType<typeof CaptureTooltip>[] = [];
  private _text = '';
  private _busy = false;
  private _availabilityOverride: boolean | null = null;

  constructor(
    private _ui: ScreenshotUi,
    private _canvas: InstanceType<typeof AnnotationCanvas>,
    private _settings: SettingsManager,
  ) {
    this._controller = new OcrController(_settings);
    this._button = this._createButton();
    this._panel = this._createPanel();
    this._layer = this._createLayer(this._panel);
    this._buttonTooltip = new CaptureTooltip();
    this._buttonTooltip.configure(this._button, _('Extract text'));

    _ui._showPointerButtonContainer.insert_child_below(this._button, _ui._showPointerButton);
    _ui.add_child(this._buttonTooltip);
    _ui.add_child(this._layer);

    this._scope.connect(_settings, `changed::${OCR_ENABLED_KEY}`, () => this.syncButton(false));
  }

  get available(): boolean | null {
    if (this._availabilityOverride !== null) {
      return this._availabilityOverride;
    }

    if (!this._controller) return null;

    return this._controller.available;
  }

  get availabilityOverridden(): boolean {
    return this._availabilityOverride !== null;
  }

  get hasResult(): boolean {
    return this._text.length > 0;
  }

  get panelVisible(): boolean {
    return this._panel.visible;
  }

  get searchUri(): string | null {
    if (!this._text) return null;

    return buildWebSearchUri(this._text, this._settings.getString(WEB_SEARCH_ENGINE_KEY));
  }

  async run(): Promise<void> {
    const controller = this._controller;
    if (!controller || this._busy) return;

    this._busy = true;
    this._text = '';
    this._canvas.setOcrWords([]);
    this.hidePanel();

    try {
      const capture = await captureScreenshot(this._ui, false);
      if (this._controller !== controller) return;

      const result = await controller.recognize(capture.pixbuf, capture.scale, capture.origin);
      if (this._controller !== controller) return;

      if (!result.text) {
        this.clear();
        Main.notify(_('OCR'), _('No text found in the screenshot'));
        return;
      }

      this._text = result.text;
      this._canvas.setOcrWords(result.words);
      this._showAction({
        x: capture.origin.x,
        y: capture.origin.y,
        width: capture.pixbuf.get_width() / capture.scale,
        height: capture.pixbuf.get_height() / capture.scale,
      });
    } catch (error) {
      if (this._controller !== controller) return;

      this._canvas.setOcrWords([]);
      if (error instanceof OcrUnavailableError) {
        Main.notify(_('OCR unavailable'), _('Tesseract OCR and language data are not installed'));
      } else {
        logger.warn(`[CaptureTools] OCR failed: ${String(error)}`);
        Main.notify(_('OCR failed'), _('Text recognition failed'));
      }

      this.hidePanel();
    } finally {
      if (this._controller === controller) {
        this._busy = false;
      }
    }
  }

  async probe(): Promise<void> {
    const controller = this._controller;
    if (!controller) return;

    try {
      await controller.probe();
    } catch (error) {
      if (this._controller === controller) {
        logger.warn(`[CaptureTools] Tesseract probe failed: ${String(error)}`);
      }
    } finally {
      if (this._controller === controller) {
        this.syncButton(false);
      }
    }
  }

  syncButton(portalMode: boolean): void {
    const enabled =
      this._availabilityOverride !== null || this._settings.getBoolean(OCR_ENABLED_KEY);
    this._button.visible =
      enabled && this.available === true && !portalMode && this._ui._shotButton.checked === true;

    if (!this._button.visible) {
      this._buttonTooltip.close();
    }
  }

  setAvailabilityOverride(available: boolean | null): void {
    this._availabilityOverride = available;
  }

  injectResult(text: string, selection: SelectionGeometry): void {
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

    this._text = text;
    this._canvas.setOcrWords(words);
    this._showAction(selection);
  }

  copy(): boolean {
    if (!this._text) return false;

    const clipboard = St.Clipboard.get_default();
    clipboard.set_text(St.ClipboardType.CLIPBOARD, this._text);
    clipboard.set_text(St.ClipboardType.PRIMARY, this._text);
    this.hidePanel();
    Main.notify(_('OCR'), _('Recognized text copied'));
    return true;
  }

  search(): boolean {
    const uri = this.searchUri;
    if (!uri) return false;

    void this._launchSearch(uri);
    return true;
  }

  clear(): void {
    this._controller?.cancel();
    this._text = '';
    this._canvas.setOcrWords([]);
    this.hidePanel();
  }

  hidePanel(): void {
    this._panel.hide();

    for (const tooltip of this._actionTooltips) {
      tooltip.close();
    }
  }

  destroy(): void {
    this._controller?.destroy();
    this._controller = null;
    this._scope.dispose();

    for (const tooltip of this._actionTooltips) {
      tooltip.destroy();
    }
    this._actionTooltips = [];

    this._layer.destroy();
    this._buttonTooltip.destroy();
    this._button.destroy();
    this._text = '';
    this._busy = false;
    this._availabilityOverride = null;
  }

  private _createButton(): St.Button {
    const button = new St.Button({
      style_class: 'screenshot-ui-show-pointer-button capture-tools-native-ocr-button',
      icon_name: 'scanner-symbolic',
      accessible_name: _('Extract text'),
      toggle_mode: false,
      can_focus: true,
    });
    button.connect('clicked', () => void this.run());
    return button;
  }

  private _createPanel(): St.BoxLayout {
    const panel = new St.BoxLayout({
      style_class: 'screenshot-ui-panel capture-tools-ocr-panel',
      reactive: true,
      visible: false,
    });

    const copy = iconButton('edit-copy-symbolic', _('Copy text'));
    copy.add_style_class_name('capture-tools-ocr-copy-button');
    copy.connect('clicked', () => this.copy());
    panel.add_child(copy);
    this._addActionTooltip(copy, _('Copy text'));

    const search = iconButton('system-search-symbolic', _('Search the web'));
    search.add_style_class_name('capture-tools-ocr-search-button');
    search.connect('clicked', () => this.search());
    panel.add_child(search);
    this._addActionTooltip(search, _('Search the web'));

    return panel;
  }

  private _createLayer(panel: St.BoxLayout): St.Widget {
    const layer = new St.Widget({ reactive: false, x_expand: true, y_expand: true });
    layer.add_constraint(
      new Clutter.BindConstraint({
        source: global.stage,
        coordinate: Clutter.BindCoordinate.ALL,
      }),
    );
    layer.add_child(panel);
    return layer;
  }

  private _addActionTooltip(anchor: St.Button, text: string): void {
    const tooltip = new CaptureTooltip();
    tooltip.configure(anchor, text);
    this._ui.add_child(tooltip);
    this._actionTooltips.push(tooltip);
  }

  private _showAction(selection: SelectionGeometry): void {
    const [, naturalWidth] = this._panel.get_preferred_width(-1);
    const [, naturalHeight] = this._panel.get_preferred_height(naturalWidth);
    const position = placeOcrActionBelow(
      selection,
      { width: naturalWidth, height: naturalHeight },
      { width: global.stage.width, height: global.stage.height },
    );

    this._panel.set_position(position.x, position.y);
    this._panel.show();
  }

  private async _launchSearch(uri: string): Promise<void> {
    const launchContext = global.create_app_launch_context(global.get_current_time(), -1);
    this.hidePanel();

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
      this._ui.close(true);
    } catch (error) {
      logger.warn(`[CaptureTools] Could not open OCR web search: ${String(error)}`);
      Main.notifyError(_('OCR'), _('Could not open the web search'));
    }
  }
}
