import GLib from '@girs/glib-2.0';
import { Extension } from '@girs/gnome-shell/extensions/extension';

type LogOptions = {
  prefix?: string;
};

let _cachedExtension: { metadata: { name: string }; uuid: string } | null = null;

function getExtension(): { metadata: { name: string }; uuid: string } {
  if (!_cachedExtension) {
    _cachedExtension = Extension.lookupByURL(import.meta.url)!;
  }
  return _cachedExtension;
}

function write(
  level: GLib.LogLevelFlags,
  msg: string,
  options: LogOptions = {},
  args: unknown[] = [],
): void {
  const prefix = options.prefix ? `[${options.prefix}] ` : '';
  const suffix = args.length ? ` ${args.map(String).join(' ')}` : '';
  const extension = getExtension();
  GLib.log_structured(extension.metadata.name, level, {
    SYSLOG_IDENTIFIER: extension.uuid,
    MESSAGE: `${prefix}${msg}${suffix}`,
  });
}

export const logger = {
  log: (msg: string, options: LogOptions = {}, ...args: unknown[]) =>
    write(GLib.LogLevelFlags.LEVEL_MESSAGE, msg, options, args),
  debug: (_msg: string, _options?: LogOptions, ..._args: unknown[]) => {},
  warn: (msg: string, options: LogOptions = {}, ...args: unknown[]) =>
    write(GLib.LogLevelFlags.LEVEL_WARNING, msg, options, args),
  error: (msg: string, options: LogOptions = {}, ...args: unknown[]) =>
    write(GLib.LogLevelFlags.LEVEL_CRITICAL, msg, options, args),
};

export function enableDebugLogging(): void {
  logger.debug = (msg: string, options: LogOptions = {}, ...args: unknown[]) =>
    write(GLib.LogLevelFlags.LEVEL_DEBUG, msg, options, args);
}
