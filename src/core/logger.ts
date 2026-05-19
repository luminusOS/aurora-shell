import GLib from '@girs/glib-2.0';

export type LogOptions = {
  prefix?: string;
};

export interface Logger {
  log(msg: string, options: LogOptions, ...args: any[]): void;
  log(msg: string, ...args: any[]): void;
  debug(msg: string, options: LogOptions, ...args: any[]): void;
  debug(msg: string, ...args: any[]): void;
  info(msg: string, options: LogOptions, ...args: any[]): void;
  info(msg: string, ...args: any[]): void;
  warn(msg: string, options: LogOptions, ...args: any[]): void;
  warn(msg: string, ...args: any[]): void;
  error(msg: string, options: LogOptions, ...args: any[]): void;
  error(msg: string, ...args: any[]): void;
}

export class ConsoleLogger implements Logger {
  private _prefix: string;
  private _uuid: string;

  constructor(prefix = 'Aurora Shell', uuid = 'aurora-shell@luminusos.github.io') {
    this._prefix = prefix;
    this._uuid = uuid;
  }

  private _splitArgs(args: any[]): { options: LogOptions; args: any[] } {
    const [first, ...rest] = args;
    if (this._isLogOptions(first)) return { options: first, args: rest };
    return { options: {}, args };
  }

  private _isLogOptions(value: unknown): value is LogOptions {
    return (
      typeof value === 'object' &&
      value !== null &&
      'prefix' in value &&
      (value as LogOptions).prefix !== undefined
    );
  }

  private _fmt(msg: string, args: any[], options: LogOptions): string {
    const suffix = args.length ? ` ${args.map((a) => String(a)).join(' ')}` : '';
    const body = `${msg}${suffix}`;
    return options.prefix ? `[${options.prefix}] ${body}` : body;
  }

  private _emit(level: GLib.LogLevelFlags, msg: string): void {
    GLib.log_structured(this._prefix, level, {
      SYSLOG_IDENTIFIER: this._uuid,
      MESSAGE: msg,
    });
  }

  log(msg: string, ...args: any[]): void {
    const { options, args: rest } = this._splitArgs(args);
    this._emit(GLib.LogLevelFlags.LEVEL_MESSAGE, this._fmt(msg, rest, options));
  }

  debug(msg: string, ...args: any[]): void {
    const { options, args: rest } = this._splitArgs(args);
    this._emit(GLib.LogLevelFlags.LEVEL_DEBUG, this._fmt(msg, rest, options));
  }

  info(msg: string, ...args: any[]): void {
    const { options, args: rest } = this._splitArgs(args);
    this._emit(GLib.LogLevelFlags.LEVEL_MESSAGE, this._fmt(msg, rest, options));
  }

  warn(msg: string, ...args: any[]): void {
    const { options, args: rest } = this._splitArgs(args);
    this._emit(GLib.LogLevelFlags.LEVEL_WARNING, this._fmt(msg, rest, options));
  }

  error(msg: string, ...args: any[]): void {
    const { options, args: rest } = this._splitArgs(args);
    this._emit(GLib.LogLevelFlags.LEVEL_CRITICAL, this._fmt(msg, rest, options));
  }
}

let _activeLogger: Logger = new ConsoleLogger();

export const logger: Logger = {
  log: (...args) => _activeLogger.log(...args),
  debug: (...args) => _activeLogger.debug(...args),
  info: (...args) => _activeLogger.info(...args),
  warn: (...args) => _activeLogger.warn(...args),
  error: (...args) => _activeLogger.error(...args),
};

export function setGlobalLogger(l: Logger): void {
  _activeLogger = l;
}
