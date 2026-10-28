import type GdkPixbuf from '@girs/gdkpixbuf-2.0';
import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import type Rsvg from 'gi://Rsvg';

import { logger } from '~/core/logger.ts';
import {
  MATCH_THRESHOLD,
  matchesHotspot,
  meanPixelDifference,
  parseCursorMetadata,
  type CursorFrame,
  type PixelView,
} from './cursorMatching.ts';

// @ts-ignore - _promisify is a GJS extension not reflected in .d.ts
Gio._promisify(Gio.File.prototype, 'load_contents_async');
// @ts-ignore - _promisify is a GJS extension not reflected in .d.ts
Gio._promisify(Gio.File.prototype, 'enumerate_children_async');
// @ts-ignore - _promisify is a GJS extension not reflected in .d.ts
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async');

type RsvgModule = typeof Rsvg;

// The Shell's own fallback when the configured theme has no scalable cursor for a shape.
const SHELL_THEME_URI = 'resource:///org/gnome/shell/cursor-theme/';
const FALLBACK_THEME = 'Adwaita';
// A 3x monitor draws a 96 px cursor, so 5x is 480 px. Anything larger is not worth the memory.
const MAX_VECTOR_SIDE = 640;
const DIRECTORY_BATCH = 64;

export type CursorPlacement = {
  /** Hotspot in the pixels of the cursor texture, as the tracker reports it. */
  hotspot: [number, number];
  monitorScale: number;
};

type CatalogEntry = {
  name: string;
  frame: CursorFrame;
  directory: Gio.File;
  svg: Uint8Array | null;
};

let rsvgModule: Promise<RsvgModule | null> | null = null;

// The typelib ships with librsvg but not in every distribution's default install.
function loadRsvg(): Promise<RsvgModule | null> {
  if (!rsvgModule) {
    rsvgModule = import('gi://Rsvg').then(
      (module) => module.default,
      (error) => {
        logger.warn(
          'Rsvg is unavailable, so Wiggle Cursor cannot enlarge the pointer',
          { prefix: 'WiggleCursor' },
          error,
        );
        return null;
      },
    );
  }

  return rsvgModule;
}

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

type ScalableDirectory = { directory: Gio.File; names: string[] };

async function findScalableDirectory(theme: string): Promise<ScalableDirectory | null> {
  if (theme.includes('/')) return null;

  for (const directory of scalableDirectories(theme)) {
    const names = await listDirectory(directory);
    if (names) return { directory, names };
  }

  return null;
}

async function readCatalogEntry(directory: Gio.File, name: string): Promise<CatalogEntry | null> {
  const cursorDirectory = directory.get_child(name);

  try {
    const [metadata] = await cursorDirectory.get_child('metadata.json').load_contents_async(null);
    const frames = parseCursorMetadata(new TextDecoder().decode(metadata));
    // Animated cursors would need every frame tested, and nobody looks for a spinner.
    if (!frames || frames.length !== 1) return null;

    return { name, frame: frames[0]!, directory: cursorDirectory, svg: null };
  } catch {
    return null;
  }
}

async function readCatalog(theme: string): Promise<CatalogEntry[]> {
  const sources: ScalableDirectory[] = [];
  const themed = await findScalableDirectory(theme);
  if (themed) sources.push(themed);

  const fallback = await findScalableDirectory(FALLBACK_THEME);
  if (fallback && !sources.some((source) => source.directory.equal(fallback.directory)))
    sources.push(fallback);

  const seen = new Set<string>();
  const pending: Promise<CatalogEntry | null>[] = [];
  for (const { directory, names } of sources) {
    for (const name of names) {
      if (seen.has(name)) continue;

      seen.add(name);
      pending.push(readCatalogEntry(directory, name));
    }
  }

  return (await Promise.all(pending)).filter((entry): entry is CatalogEntry => entry !== null);
}

function renderSvg(
  rsvg: RsvgModule,
  svg: Uint8Array,
  width: number,
  height: number,
): GdkPixbuf.Pixbuf | null {
  const handle = rsvg.Handle.new_from_data(svg);
  handle.set_stylesheet(
    new TextEncoder().encode(`svg { width: ${width}px; height: ${height}px; }`),
  );

  return handle.get_pixbuf();
}

function pixelView(pixbuf: GdkPixbuf.Pixbuf): PixelView {
  return {
    pixels: pixbuf.get_pixels(),
    width: pixbuf.get_width(),
    height: pixbuf.get_height(),
    rowstride: pixbuf.get_rowstride(),
    channels: pixbuf.get_n_channels(),
  };
}

/**
 * Redraws the current cursor from the vector image of the cursor theme at the enlarged size.
 *
 * The tracker only exposes the pixels the Shell rasterised, not which cursor they show. The theme
 * is searched for the cursor whose SVG, drawn at the size of those pixels, reproduces them. A
 * cursor that no theme file reproduces, such as the one an application sets itself, yields null.
 */
export class VectorCursorSource {
  private _catalog: { theme: string; entries: Promise<CatalogEntry[]> } | null = null;

  constructor(private readonly _interfaceSettings: Gio.Settings) {}

  async draw(
    native: GdkPixbuf.Pixbuf,
    placement: CursorPlacement,
    magnification: number,
    isCurrent: () => boolean,
  ): Promise<GdkPixbuf.Pixbuf | null> {
    const width = native.get_width();
    const height = native.get_height();
    if (Math.max(width, height) * magnification > MAX_VECTOR_SIDE) return null;

    const rsvg = await loadRsvg();
    if (!rsvg) return null;

    try {
      const cursorSize = this._interfaceSettings.get_int('cursor-size');
      const entries = await this._entriesFor(this._interfaceSettings.get_string('cursor-theme'));
      const nativeView = pixelView(native);

      for (const entry of entries) {
        if (!isCurrent()) return null;
        if (!matchesHotspot(entry.frame, cursorSize, placement.monitorScale, placement.hotspot))
          continue;

        const svg = await this._readSvg(entry);
        const sameSize = renderSvg(rsvg, svg, width, height);
        if (!sameSize || meanPixelDifference(nativeView, pixelView(sameSize)) > MATCH_THRESHOLD)
          continue;

        if (!isCurrent()) return null;

        return renderSvg(rsvg, svg, width * magnification, height * magnification);
      }
    } catch (error) {
      logger.warn('Could not draw the scalable cursor', { prefix: 'WiggleCursor' }, error);
    }

    return null;
  }

  private _entriesFor(theme: string): Promise<CatalogEntry[]> {
    if (!this._catalog || this._catalog.theme !== theme) {
      this._catalog = { theme, entries: readCatalog(theme) };
    }

    return this._catalog.entries;
  }

  private async _readSvg(entry: CatalogEntry): Promise<Uint8Array> {
    if (!entry.svg) {
      const [contents] = await entry.directory
        .get_child(entry.frame.filename)
        .load_contents_async(null);
      entry.svg = contents;
    }

    return entry.svg;
  }
}
