import Clutter from '@girs/clutter-18';
import Cogl from '@girs/cogl-18';
import type GdkPixbuf from '@girs/gdkpixbuf-2.0';
import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import GObject from '@girs/gobject-2.0';
import Mtk from '@girs/mtk-18';
import Shell from '@girs/shell-18';
import St from '@girs/st-18';
import { gettext as _ } from '~/shared/i18n.ts';
import { OutputAnnotationCanvas } from '~/capture/annotationCanvas.ts';
import type { Annotation, Point } from '~/capture/annotationModel.ts';
import {
  selectedWindow,
  textureFromContent,
  type Geometry,
  type ScreenshotUi,
} from '~/capture/screenshotUiAdapter.ts';

type CursorCapture = {
  texture: Cogl.Texture | null;
  x: number;
  y: number;
  scale: number;
};

type CaptureTarget = {
  texture: Cogl.Texture;
  geometry: Geometry | null;
  logicalOrigin: Point;
  scale: number;
  cursor: CursorCapture;
};

const CaptureOffscreenEffect = GObject.registerClass(
  class CaptureOffscreenEffect extends Clutter.OffscreenEffect {},
);

export type CapturedScreenshot = {
  pixbuf: GdkPixbuf.Pixbuf;
  origin: Point;
  scale: number;
};

export type ScreenshotExportOptions = {
  copy: boolean;
  save: boolean;
};

export async function captureScreenshot(
  ui: ScreenshotUi,
  playSound = true,
): Promise<CapturedScreenshot> {
  const target = getCaptureTarget(ui);
  if (!target) throw new Error('No screenshot target is selected');

  if (playSound)
    global.display
      .get_sound_player()
      .play_from_theme('screen-capture', _('Screenshot taken'), null);
  return {
    pixbuf: await compositeTarget(target),
    origin: target.logicalOrigin,
    scale: target.scale,
  };
}

export async function exportAnnotatedScreenshot(
  base: GdkPixbuf.Pixbuf,
  annotations: readonly Annotation[],
  transform: { origin: Point; scale: number },
  options: ScreenshotExportOptions,
): Promise<Gio.File | null> {
  const annotated =
    annotations.length === 0
      ? base
      : await compositeAnnotations(base, annotations, transform.origin, transform.scale);
  const [, encoded] = annotated.save_to_bufferv('png', [], []);
  const bytes = new GLib.Bytes(encoded);

  if (options.copy)
    St.Clipboard.get_default().set_content(St.ClipboardType.CLIPBOARD, 'image/png', bytes);
  return options.save ? saveScreenshot(bytes) : null;
}

export function imageContentFromPixbuf(pixbuf: GdkPixbuf.Pixbuf): St.ImageContent {
  const rgba = pixbuf.get_n_channels() === 4 ? pixbuf : pixbuf.add_alpha(false, 0, 0, 0);
  if (!rgba) throw new Error('Failed to prepare screenshot pixels');
  const width = rgba.get_width();
  const height = rgba.get_height();
  const content = St.ImageContent.new_with_preferred_size(width, height) as St.ImageContent;
  const coglContext = global.stage.context.get_backend().get_cogl_context();
  if (
    !content.set_bytes(
      coglContext,
      rgba.read_pixel_bytes(),
      Cogl.PixelFormat.RGBA_8888,
      width,
      height,
      rgba.get_rowstride(),
    )
  )
    throw new Error('Failed to create screenshot image content');
  return content;
}

function getCaptureTarget(ui: ScreenshotUi): CaptureTarget | null {
  if (ui._selectionButton.checked || ui._screenButton.checked) {
    const content = ui._stageScreenshot.get_content();
    if (!content) return null;
    const texture = textureFromContent(content);
    if (!texture) return null;
    const logicalGeometry = ui._getSelectedGeometry(false);
    const geometry = ui._getSelectedGeometry(true);
    const cursorTexture = textureFromContent(ui._cursor.content);
    return {
      texture,
      geometry,
      logicalOrigin: { x: logicalGeometry[0], y: logicalGeometry[1] },
      scale: ui._scale,
      cursor: {
        texture: ui._cursor.visible ? cursorTexture : null,
        x: ui._cursor.x * ui._scale,
        y: ui._cursor.y * ui._scale,
        scale: ui._cursorScale,
      },
    };
  }

  if (ui._windowButton.checked) {
    const window = selectedWindow(ui);
    if (!window?.windowContent) return null;
    const texture = textureFromContent(window.windowContent);
    if (!texture) return null;
    const bufferRect = window.child._bufferRect;
    const cursorTexture = textureFromContent(window.getCursorTexture());
    return {
      texture,
      geometry: null,
      logicalOrigin: { x: bufferRect.x, y: bufferRect.y },
      scale: window.bufferScale,
      cursor: {
        texture: ui._cursor.visible ? cursorTexture : null,
        x: window.cursorPoint.x * window.bufferScale,
        y: window.cursorPoint.y * window.bufferScale,
        scale: ui._cursorScale,
      },
    };
  }

  return null;
}

async function compositeTarget(target: CaptureTarget): Promise<GdkPixbuf.Pixbuf> {
  const stream = Gio.MemoryOutputStream.new_resizable();
  const geometry = target.geometry || [0, 0, -1, -1];
  const [x, y, width, height] = geometry;
  try {
    return await new Promise<GdkPixbuf.Pixbuf>((resolve, reject) => {
      Shell.Screenshot.composite_to_stream(
        target.texture,
        x,
        y,
        width,
        height,
        target.scale,
        target.cursor.texture,
        target.cursor.x,
        target.cursor.y,
        target.cursor.scale,
        stream,
        (_source, result) => {
          try {
            const pixbuf = Shell.Screenshot.composite_to_stream_finish(result);
            if (!pixbuf) throw new Error('Screenshot composition returned no image');
            resolve(pixbuf);
          } catch (error) {
            reject(error);
          }
        },
      );
    });
  } finally {
    stream.close(null);
  }
}

async function compositeAnnotations(
  base: GdkPixbuf.Pixbuf,
  annotations: readonly Annotation[],
  logicalOrigin: Point,
  scale: number,
): Promise<GdkPixbuf.Pixbuf> {
  const rgba = base.get_n_channels() === 4 ? base : base.add_alpha(false, 0, 0, 0);
  if (!rgba) throw new Error('Failed to prepare screenshot pixels');
  const width = rgba.get_width();
  const height = rgba.get_height();
  const imageContent = imageContentFromPixbuf(rgba);

  const logicalWidth = width / scale;
  const logicalHeight = height / scale;
  const container = new Clutter.Actor({
    layout_manager: new Clutter.BinLayout(),
    reactive: false,
    width: logicalWidth,
    height: logicalHeight,
    x: logicalOrigin.x,
    y: logicalOrigin.y,
  });
  const baseActor = new Clutter.Actor({
    content: imageContent,
    width: logicalWidth,
    height: logicalHeight,
  });
  const overlay = new OutputAnnotationCanvas();
  overlay.configure(annotations, {
    originX: logicalOrigin.x,
    originY: logicalOrigin.y,
    scale: 1,
  });
  overlay.set_size(logicalWidth, logicalHeight);
  const effect = new CaptureOffscreenEffect();
  container.add_effect(effect);
  container.add_child(baseActor);
  container.add_child(overlay);
  global.stage.add_child(container);
  let texture: Cogl.Texture | null;
  try {
    global.stage.paint_to_content(
      new Mtk.Rectangle({
        x: Math.floor(logicalOrigin.x),
        y: Math.floor(logicalOrigin.y),
        width: Math.ceil(logicalWidth),
        height: Math.ceil(logicalHeight),
      }),
      scale,
      null,
      Clutter.PaintFlag.NONE,
    );
    texture = effect.get_texture();
    if (!texture) throw new Error('Failed to render the annotated screenshot texture');
  } finally {
    // Destroy synchronously so the container never reaches a presented frame;
    // the grabbed Cogl texture stays alive through its own reference.
    container.destroy();
  }
  return compositeTarget({
    texture,
    geometry: null,
    logicalOrigin: { x: 0, y: 0 },
    scale: 1,
    cursor: { texture: null, x: 0, y: 0, scale: 1 },
  });
}

function saveScreenshot(bytes: GLib.Bytes): Gio.File | null {
  const lockdown = new Gio.Settings({ schema_id: 'org.gnome.desktop.lockdown' });
  if (lockdown.get_boolean('disable-save-to-disk')) return null;

  const pictures =
    GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES) || GLib.get_home_dir();
  const directory = Gio.File.new_for_path(GLib.build_filenamev([pictures, _('Screenshots')]));
  try {
    directory.make_directory_with_parents(null);
  } catch (error) {
    if (!(error instanceof GLib.Error) || !error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
      throw error;
  }

  const timestamp = GLib.DateTime.new_now_local().format('%Y-%m-%d %H-%M-%S');
  const baseName = _('Screenshot From %s').replace('%s', timestamp || '');
  for (let suffix = 0; ; suffix++) {
    const suffixText = suffix === 0 ? '' : `-${suffix}`;
    const file = directory.get_child(`${baseName}${suffixText}.png`);
    try {
      const stream = file.create(Gio.FileCreateFlags.NONE, null);
      stream.write_bytes(bytes, null);
      stream.close(null);
      addRecentFile(file);
      return file;
    } catch (error) {
      if (!(error instanceof GLib.Error) || !error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
        throw error;
    }
  }
}

function addRecentFile(file: Gio.File): void {
  const recentPath = GLib.build_filenamev([GLib.get_user_data_dir(), 'recently-used.xbel']);
  const bookmarks = new GLib.BookmarkFile();
  try {
    bookmarks.load_from_file(recentPath);
  } catch (error) {
    if (
      !(error instanceof GLib.Error) ||
      !error.matches(GLib.BookmarkFileError, GLib.BookmarkFileError.FILE_NOT_FOUND)
    )
      return;
  }
  try {
    bookmarks.add_application(file.get_uri(), GLib.get_prgname(), 'gio open %u');
    bookmarks.to_file(recentPath);
  } catch {
    // Saving the recent-files entry must not fail the screenshot itself.
  }
}
