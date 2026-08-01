import * as Main from '@girs/gnome-shell/ui/main';

import { gettext as _ } from '~/shared/i18n.ts';
import type { Annotation } from '~/capture/annotationModel.ts';
import { captureScreenshot, exportAnnotatedScreenshot } from '~/capture/screenshotCapture.ts';
import type { ScreenshotUi } from '~/capture/screenshotUiAdapter.ts';
import { logger } from '~/core/logger.ts';

type ScreenshotOpen = (mode?: number, ...args: unknown[]) => Promise<unknown>;
type ScreenshotSave = () => Promise<void>;

export type ScreenshotHookCallbacks = {
  setPortalMode(portalMode: boolean): void;
  syncVisibility(): void;
  commitText(): void;
  getAnnotations(): readonly Annotation[];
};

export class ScreenshotHooks {
  private _originalOpen: ScreenshotOpen;
  private _openWrapper: ScreenshotOpen;
  private _originalSave: ScreenshotSave;
  private _saveWrapper: ScreenshotSave;

  constructor(
    private _ui: ScreenshotUi,
    private _callbacks: ScreenshotHookCallbacks,
  ) {
    this._originalOpen = _ui.open;
    this._originalSave = _ui._saveScreenshot;
    this._openWrapper = this._createOpenWrapper();
    this._saveWrapper = this._createSaveWrapper();

    _ui.open = this._openWrapper;
    _ui._saveScreenshot = this._saveWrapper;
  }

  destroy(): void {
    if (this._ui.open === this._openWrapper) {
      this._ui.open = this._originalOpen;
    } else {
      logger.warn('[CaptureTools] Screenshot open hook changed externally; leaving it untouched');
    }

    if (this._ui._saveScreenshot === this._saveWrapper) {
      this._ui._saveScreenshot = this._originalSave;
    } else {
      logger.warn('[CaptureTools] Screenshot save hook changed externally; leaving it untouched');
    }
  }

  private _createOpenWrapper(): ScreenshotOpen {
    return async (mode = 0, ...args: unknown[]) => {
      const portalMode = mode === 2;
      this._callbacks.setPortalMode(portalMode);

      const result = await this._originalOpen.call(this._ui, mode, ...args);

      this._callbacks.syncVisibility();
      logger.debug(`Native screenshot UI opened; toolbar visible=${!portalMode} (mode=${mode})`, {
        prefix: 'CaptureTools',
      });

      return result;
    };
  }

  private _createSaveWrapper(): ScreenshotSave {
    return async () => {
      this._callbacks.commitText();

      const annotations = this._callbacks.getAnnotations();
      if (annotations.length === 0) {
        return this._originalSave.call(this._ui);
      }

      try {
        const capture = await captureScreenshot(this._ui);

        void this._export(capture.pixbuf, capture.origin, capture.scale, annotations);
      } catch (error) {
        this._reportExportFailure(error);
      }
    };
  }

  private async _export(
    pixbuf: Parameters<typeof exportAnnotatedScreenshot>[0],
    origin: { x: number; y: number },
    scale: number,
    annotations: readonly Annotation[],
  ): Promise<void> {
    try {
      const file = await exportAnnotatedScreenshot(
        pixbuf,
        annotations,
        { origin, scale },
        { copy: true, save: true },
      );

      if (file) {
        this._ui.emit('screenshot-taken', file);
      }

      logger.debug(`Saved screenshot with ${annotations.length} annotation(s)`, {
        prefix: 'CaptureTools',
      });
    } catch (error) {
      this._reportExportFailure(error);
    }
  }

  private _reportExportFailure(error: unknown): void {
    logger.warn(`[CaptureTools] Annotated screenshot export failed: ${String(error)}`);
    Main.notify(_('Screenshot failed'), _('Could not export the annotated screenshot'));
  }
}
