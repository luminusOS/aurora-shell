import Gio from '@girs/gio-2.0';
import St from '@girs/st-18';

let defaultLoader: IconThemeLoader | null = null;

export type CreateIconOptions = Omit<
  Partial<St.Icon.ConstructorProps>,
  'gicon' | 'icon_name' | 'iconName'
>;

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

function isIconPath(source: string): boolean {
  return (
    source.startsWith('/') ||
    source.startsWith('./') ||
    source.startsWith('../') ||
    source.startsWith('file://')
  );
}

function loadFileIcon(source: string): Gio.Icon {
  const file = source.startsWith('file://')
    ? Gio.File.new_for_uri(source)
    : Gio.File.new_for_path(source);
  return file.query_exists(null)
    ? new Gio.FileIcon({ file })
    : Gio.Icon.new_for_string('image-missing-symbolic');
}

/**
 * Resolves an icon by theme name or explicit file path.
 *
 * Prefer names such as `volume-mixer-symbolic`: they automatically search
 * Aurora's bundled hicolor icons and then the current system theme. Absolute
 * paths, explicit relative paths and file:// URIs remain available for assets
 * that cannot participate in an icon theme.
 */
export function loadIcon(nameOrPath: string): Gio.Icon {
  if (isIconPath(nameOrPath)) return loadFileIcon(nameOrPath);

  try {
    if (!defaultLoader) throw new Error('Icons not initialized');
    return defaultLoader.lookupIcon(nameOrPath);
  } catch (_e) {
    return Gio.Icon.new_for_string(nameOrPath);
  }
}

/**
 * Creates an St.Icon using Aurora's bundled hicolor theme with the system theme
 * as fallback. Additional St.Icon constructor properties can override the
 * default 16px size, but not the resolved icon itself.
 */
export function createIcon(nameOrPath: string, options: CreateIconOptions = {}): St.Icon {
  return new St.Icon({
    icon_size: 16,
    ...options,
    gicon: loadIcon(nameOrPath),
  });
}
