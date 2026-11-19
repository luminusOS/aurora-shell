import type Clutter from 'gi://Clutter';
import type Cogl from 'gi://Cogl';
import type St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

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

export function getScreenshotUi(): ScreenshotUi {
  return Main.screenshotUI as ScreenshotUi;
}

export function selectedWindow(ui: ScreenshotUi): ScreenshotWindow | undefined {
  return ui._windowSelectors.flatMap((selector) => selector.windows()).find((item) => item.checked);
}

export function textureFromContent(content: Clutter.Content | null): Cogl.Texture | null {
  if (!content) return null;

  return (content as TextureContent).get_texture();
}
