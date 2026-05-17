import Gio from '@girs/gio-2.0';
import St from '@girs/st-18';

let defaultLoader: IconThemeLoader | null = null;

export function initIcons(extensionPath: string): void {
  const iconDir = Gio.File.new_for_path(extensionPath).get_child('icons') as Gio.File;
  defaultLoader = new IconThemeLoader(iconDir);
}

export function cleanupIcons(): void {
  defaultLoader = null;
}

export class IconThemeLoader {
  readonly #theme = St.IconTheme.new();

  constructor(iconDirectory: Gio.File) {
    const iconPath = iconDirectory.get_path();

    if (iconPath == null) {
      throw new Error('Failed to get path of icon directory');
    }

    this.#theme.append_search_path(iconPath);
  }

  lookupIcon(name: string): Gio.Icon {
    const icon = this.#theme.lookup_icon(name, 16, St.IconLookupFlags.FORCE_SVG);

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
    if (!defaultLoader) throw new Error('Icons not initialized');
    return defaultLoader.lookupIcon(nameOrPath);
  } catch (_e) {
    return Gio.Icon.new_for_string(nameOrPath);
  }
}
