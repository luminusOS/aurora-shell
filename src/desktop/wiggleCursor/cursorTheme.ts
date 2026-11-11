import Clutter from '@girs/clutter-18';
import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';

import { parseCursorMetadata, type CursorFrame } from './cursorMatching.ts';

// @ts-ignore - _promisify is a GJS extension not reflected in .d.ts
Gio._promisify(Gio.File.prototype, 'load_contents_async');

const SHELL_THEME_URI = 'resource:///org/gnome/shell/cursor-theme/';
const FALLBACK_THEME = 'Adwaita';

export type ThemeCursor = {
  frame: CursorFrame;
  directory: Gio.File;
};

// Where StCursor looks for a cursor, in its order: user data, system data, the theme bundled in the
// Shell, and finally the Adwaita bundled there when the theme has no such cursor.
function cursorDirectories(theme: string, name: string): Gio.File[] {
  const relative = (themeName: string): string => `icons/${themeName}/cursors_scalable/${name}`;
  const dataRoots = [GLib.get_user_data_dir(), ...GLib.get_system_data_dirs()];

  return [
    ...dataRoots.map((root) => Gio.File.new_for_path(root).resolve_relative_path(relative(theme))),
    Gio.File.new_for_uri(`${SHELL_THEME_URI}${relative(theme)}`),
    Gio.File.new_for_uri(`${SHELL_THEME_URI}${relative(FALLBACK_THEME)}`),
  ];
}

async function readThemeCursor(
  theme: string,
  cursorType: Clutter.CursorType,
): Promise<ThemeCursor | null> {
  for (const directory of cursorDirectories(theme, Clutter.cursor_type_to_name(cursorType))) {
    try {
      const [metadata] = await directory.get_child('metadata.json').load_contents_async(null);
      const frames = parseCursorMetadata(new TextDecoder().decode(metadata));
      if (!frames) continue;

      // Animated cursors have several frames and are left alone.
      return frames.length === 1 ? { frame: frames[0]!, directory } : null;
    } catch {
      // This directory has no such cursor, so the next one is tried.
    }
  }

  return null;
}

/** The static cursors the Shell draws from `theme`, found the way it finds them. */
export async function readScalableCursors(theme: string): Promise<ThemeCursor[]> {
  if (theme.includes('/')) return [];

  const cursorTypes = Object.values(Clutter.CursorType).filter(
    (value): value is Clutter.CursorType =>
      typeof value === 'number' &&
      value !== Clutter.CursorType.INHERIT &&
      value !== Clutter.CursorType.NONE,
  );
  const cursors = await Promise.all(cursorTypes.map((type) => readThemeCursor(theme, type)));

  return cursors.filter((cursor): cursor is ThemeCursor => cursor !== null);
}

const svgReads = new WeakMap<ThemeCursor, Promise<Uint8Array>>();

/** The SVG of the cursor's frame. A failed read is forgotten so the next search retries it. */
export function readCursorSvg(cursor: ThemeCursor): Promise<Uint8Array> {
  let read = svgReads.get(cursor);
  if (!read) {
    read = cursor.directory
      .get_child(cursor.frame.filename)
      .load_contents_async(null)
      .then(([svg]) => svg);
    svgReads.set(cursor, read);
    read.catch(() => svgReads.delete(cursor));
  }

  return read;
}
