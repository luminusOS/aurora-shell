import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';

import { logger } from '~/core/logger.ts';
import { parseRecentXbel, type RecentMenuItem } from '~/panel/auroraMenuState.ts';

const LOG_PREFIX = 'AuroraMenu';

// @ts-ignore — _promisify is a GJS extension not reflected in .d.ts
Gio._promisify(Gio.File.prototype, 'load_bytes_async');
// @ts-ignore
Gio._promisify(Gio.File.prototype, 'query_info_async');

export async function readRecentMenuItems(
  limit: number,
  cancellable: Gio.Cancellable | null = null,
): Promise<RecentMenuItem[]> {
  const file = Gio.File.new_for_path(
    GLib.build_filenamev([GLib.get_user_data_dir(), 'recently-used.xbel']),
  );
  try {
    await file.query_info_async(
      'standard::type',
      Gio.FileQueryInfoFlags.NONE,
      GLib.PRIORITY_DEFAULT,
      cancellable,
    );
    const [bytes] = await file.load_bytes_async(cancellable);
    const data = bytes.get_data();
    return data ? parseRecentXbel(new TextDecoder().decode(data), limit) : [];
  } catch (error) {
    if (error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
      throw error;
    }

    if (error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
      return [];
    }

    logger.warn(`Failed to read recent items: ${error}`, { prefix: LOG_PREFIX });
    return [];
  }
}
