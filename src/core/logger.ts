import GLib from '@girs/glib-2.0';
import { Extension } from '@girs/gnome-shell/extensions/extension';

type LogOptions = {
  prefix?: string;
};

function write(
  level: GLib.LogLevelFlags,
  msg: string,
  options: LogOptions = {},
  args: unknown[] = [],
): void {
  const prefix = options.prefix ? `[${options.prefix}] ` : '';
  const suffix = args.length ? ` ${args.map(String).join(' ')}` : '';
  const extension = Extension.lookupByURL(import.meta.url)!;
  GLib.log_structured(extension.metadata.name, level, {
    SYSLOG_IDENTIFIER: extension.uuid,
    MESSAGE: `${prefix}${msg}${suffix}`,
  });
}

export const logger = {
  log: (msg: string, options: LogOptions = {}, ...args: unknown[]) =>
    write(GLib.LogLevelFlags.LEVEL_MESSAGE, msg, options, args),
  debug: (msg: string, options: LogOptions = {}, ...args: unknown[]) =>
    write(GLib.LogLevelFlags.LEVEL_DEBUG, msg, options, args),
  warn: (msg: string, options: LogOptions = {}, ...args: unknown[]) =>
    write(GLib.LogLevelFlags.LEVEL_WARNING, msg, options, args),
  error: (msg: string, options: LogOptions = {}, ...args: unknown[]) =>
    write(GLib.LogLevelFlags.LEVEL_CRITICAL, msg, options, args),
};
