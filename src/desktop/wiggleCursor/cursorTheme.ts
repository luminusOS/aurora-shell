import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';

import { parseCursorMetadata, type CursorFrame } from './cursorMatching.ts';

// @ts-ignore - _promisify is a GJS extension not reflected in .d.ts
Gio._promisify(Gio.File.prototype, 'load_contents_async');
// @ts-ignore - _promisify is a GJS extension not reflected in .d.ts
Gio._promisify(Gio.File.prototype, 'enumerate_children_async');
// @ts-ignore - _promisify is a GJS extension not reflected in .d.ts
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async');

// The Shell's own fallback when the configured theme has no scalable cursor for a shape.
const SHELL_THEME_URI = 'resource:///org/gnome/shell/cursor-theme/';
const FALLBACK_THEME = 'Adwaita';
const DIRECTORY_BATCH = 64;

/** A static cursor shape of the theme: its name, its single frame and where its files are. */
export type ThemeCursor = {
  name: string;
  frame: CursorFrame;
  directory: Gio.File;
};

type ScalableDirectory = { directory: Gio.File; names: string[] };

async function listDirectory(directory: Gio.File): Promise<string[] | null> {
  try {
    const enumerator = await directory.enumerate_children_async(
      'standard::name',
      Gio.FileQueryInfoFlags.NONE,
      GLib.PRIORITY_DEFAULT,
      null,
    );
    const names: string[] = [];

    for (;;) {
      const infos = await enumerator.next_files_async(DIRECTORY_BATCH, GLib.PRIORITY_DEFAULT, null);
      if (infos.length === 0) break;
      for (const info of infos) names.push(info.get_name());
    }
    enumerator.close(null);

    return names;
  } catch {
    return null;
  }
}

// Same search order as the Shell: user data, system data, then the theme bundled in the Shell.
function scalableDirectories(theme: string): Gio.File[] {
  const relative = `icons/${theme}/cursors_scalable`;
  const dataRoots = [GLib.get_user_data_dir(), ...GLib.get_system_data_dirs()];

  return [
    ...dataRoots.map((root) => Gio.File.new_for_path(root).resolve_relative_path(relative)),
    Gio.File.new_for_uri(`${SHELL_THEME_URI}${relative}`),
  ];
}

async function findScalableDirectory(theme: string): Promise<ScalableDirectory | null> {
  if (theme.includes('/')) return null;

  for (const directory of scalableDirectories(theme)) {
    const names = await listDirectory(directory);
    if (names) return { directory, names };
  }

  return null;
}

async function readThemeCursor(directory: Gio.File, name: string): Promise<ThemeCursor | null> {
  const cursorDirectory = directory.get_child(name);

  try {
    const [metadata] = await cursorDirectory.get_child('metadata.json').load_contents_async(null);
    const frames = parseCursorMetadata(new TextDecoder().decode(metadata));
    // Animated cursors have several frames and are not matched, so the pointer is not enlarged for them.
    if (!frames || frames.length !== 1) return null;

    return { name, frame: frames[0]!, directory: cursorDirectory };
  } catch {
    return null;
  }
}

/**
 * The static cursors the Shell can draw from `theme`: those of the theme itself and, for the shapes
 * it lacks, those of the Shell's fallback theme.
 */
export async function readScalableCursors(theme: string): Promise<ThemeCursor[]> {
  const sources: ScalableDirectory[] = [];
  const themed = await findScalableDirectory(theme);
  if (themed) sources.push(themed);

  const fallback = await findScalableDirectory(FALLBACK_THEME);
  if (fallback && !sources.some((source) => source.directory.equal(fallback.directory)))
    sources.push(fallback);

  const seen = new Set<string>();
  const pending: Promise<ThemeCursor | null>[] = [];
  for (const { directory, names } of sources) {
    for (const name of names) {
      if (seen.has(name)) continue;

      seen.add(name);
      pending.push(readThemeCursor(directory, name));
    }
  }

  return (await Promise.all(pending)).filter((cursor): cursor is ThemeCursor => cursor !== null);
}

const svgReads = new WeakMap<ThemeCursor, Promise<Uint8Array>>();

/** The SVG of the cursor's frame. It is read once and then kept for as long as the cursor is. */
export function readCursorSvg(cursor: ThemeCursor): Promise<Uint8Array> {
  let read = svgReads.get(cursor);
  if (!read) {
    read = cursor.directory
      .get_child(cursor.frame.filename)
      .load_contents_async(null)
      .then(([svg]) => svg);
    svgReads.set(cursor, read);
  }

  return read;
}
