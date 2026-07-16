import type Clutter from '@girs/clutter-18';
import type Cogl from '@girs/cogl-18';
import type St from '@girs/st-18';
import * as Main from '@girs/gnome-shell/ui/main';

export type Geometry = [number, number, number, number];

export type TextureContent = Clutter.Content & { get_texture(): Cogl.Texture };

export type ScreenshotWindow = St.Button & {
  boundingBox: { x: number; y: number; width: number; height: number };
  bufferScale: number;
  child: St.Widget & { _bufferRect: { x: number; y: number; width: number; height: number } };
  checked: boolean;
  cursorPoint: { x: number; y: number };
  getCursorTexture(): TextureContent | null;
  windowContent: TextureContent | null;
};

type WindowSelector = St.Widget & { windows(): ScreenshotWindow[] };

export type ScreenshotUi = St.Widget & {
  _areaSelector: St.Widget & { getGeometry(): Geometry };
  _castButton: St.Button;
  _closeButton?: St.Button;
  _cursor: St.Widget & { content: TextureContent | null };
  _cursorScale: number;
  _getSelectedGeometry(rescale: boolean): Geometry;
  _panel: St.BoxLayout;
  _primaryMonitorBin: St.Widget;
  _saveScreenshot(): Promise<void>;
  _scale: number;
  _screenButton: St.Button;
  _selectionButton: St.Button;
  _showPointerButton: St.Button;
  _showPointerButtonContainer: St.BoxLayout;
  _shotButton: St.Button;
  _stageScreenshot: St.Widget & { get_content(): TextureContent | null };
  _stageScreenshotContainer: St.Widget;
  _windowButton: St.Button;
  _windowSelectors: WindowSelector[];
  close(instantly?: boolean): void;
  emit(signal: 'screenshot-taken', file: unknown): void;
  open(mode?: number, ...args: unknown[]): Promise<unknown>;
};

export function getScreenshotUi(): ScreenshotUi | null {
  const candidate: unknown = Main.screenshotUI;
  if (!isScreenshotUi(candidate)) return null;
  return candidate;
}

export function selectedWindow(ui: ScreenshotUi): ScreenshotWindow | null {
  return (
    ui._windowSelectors.flatMap((selector) => selector.windows()).find((item) => item.checked) ??
    null
  );
}

export function textureFromContent(content: Clutter.Content | null): Cogl.Texture | null {
  if (!content || typeof (content as { get_texture?: unknown }).get_texture !== 'function')
    return null;
  return (content as TextureContent).get_texture();
}

function isScreenshotUi(value: unknown): value is ScreenshotUi {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['_saveScreenshot'] === 'function' &&
    typeof candidate['open'] === 'function' &&
    typeof candidate['connect'] === 'function' &&
    candidate['_panel'] !== undefined &&
    candidate['_stageScreenshot'] !== undefined &&
    candidate['_areaSelector'] !== undefined &&
    candidate['_selectionButton'] !== undefined &&
    candidate['_showPointerButton'] !== undefined &&
    candidate['_showPointerButtonContainer'] !== undefined &&
    candidate['_screenButton'] !== undefined &&
    candidate['_windowButton'] !== undefined
  );
}
