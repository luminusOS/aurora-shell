import Gio from '@girs/gio-2.0';
import { Extension } from '@girs/gnome-shell/extensions/extension';

const ICON_CONTEXTS = [
  'apps',
  'categories',
  'devices',
  'emblems',
  'mimetypes',
  'places',
  'status',
];

/**
 * Loads a Gio.Icon from either a bundled extension icon name or a file path.
 *
 * - Icon name (e.g. 'volume-mixer-symbolic'): searches the extension's
 *   icons/hicolor/scalable/<context>/ directories in order, falling back to
 *   a system themed icon with that name if none is found.
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

  // @ts-ignore: Extension.lookupByURL is not properly typed in @girs/gnome-shell
  const ext = Extension.lookupByURL(import.meta.url);
  if (ext) {
    for (const ctx of ICON_CONTEXTS) {
      const file = ext.dir.get_child(
        `icons/hicolor/scalable/${ctx}/${nameOrPath}.svg`,
      );
      if (file.query_exists(null)) {
        // @ts-ignore: Gio.FileIcon is not properly typed in @girs/gio-2.0
        return new Gio.FileIcon({ file });
      }
    }
  }

  return Gio.Icon.new_for_string(nameOrPath);
}
