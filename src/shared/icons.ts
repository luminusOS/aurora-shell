import Gio from '@girs/gio-2.0';
import { Extension } from '@girs/gnome-shell/extensions/extension';
import St from '@girs/st-17';

let defaultLoader: IconThemeLoader | null = null;

export class IconThemeLoader {
  readonly #theme = St.IconTheme.new();

  constructor(iconDirectory: Gio.File | null) {
    if (!iconDirectory) {
      // @ts-expect-error: Extension.lookupByURL is not properly typed in @girs/gnome-shell
      const ext = Extension.lookupByURL(import.meta.url);

      if (ext) {
        // @ts-expect-error: Gio.File type mismatch between packages
        iconDirectory = ext.dir.get_child('icons') as Gio.File;
      }
    }

    const iconPath = iconDirectory?.get_path();

    if (iconPath == null) {
      throw new Error('Failed to get path of icon directory');
    }

    this.#theme.append_search_path(iconPath);
  }

  lookupIcon(name: string): Gio.Icon {
    const icon = this.#theme.lookup_icon(
      name,
      16,
      St.IconLookupFlags.FORCE_SVG,
    );

    if (!icon) {
      throw new Error(`Icon ${name} not found`);
    }

    const iconFilename = icon.get_filename();
    if (!iconFilename) {
      throw new Error(`Icon ${name} had no file`);
    }

    return new Gio.FileIcon({ file: Gio.File.new_for_path(iconFilename) });
  }
}

/**
 * Loads a Gio.Icon from either a bundled extension icon name or a file path.
 *
 * - Icon name (e.g. 'volume-mixer-symbolic'): searches the extension's
 * icons directory in order, falling back to a system themed icon with
 * that name if none is found.
 *
 * - File path (starts with '/'): loads the icon directly from disk.
 */
export function loadIcon(nameOrPath: string): Gio.Icon {
  if (nameOrPath.startsWith('/')) {
    const file = Gio.File.new_for_path(nameOrPath);
    if (file.query_exists(null)) {
      return new Gio.FileIcon({ file });
    }
    return Gio.Icon.new_for_string('image-missing-symbolic');
  }

  try {
    defaultLoader ??= new IconThemeLoader(null);
    return defaultLoader.lookupIcon(nameOrPath);
  } catch (e) {
    return Gio.Icon.new_for_string(nameOrPath);
  }
}