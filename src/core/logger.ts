import GLib from '@girs/glib-2.0';

export interface Logger {
  log(msg: string, ...args: any[]): void;
  debug(msg: string, ...args: any[]): void;
  info(msg: string, ...args: any[]): void;
  warn(msg: string, ...args: any[]): void;
  error(msg: string, ...args: any[]): void;
}

export class ConsoleLogger implements Logger {
  private _prefix: string;
  private _uuid: string;

  constructor(prefix = 'Aurora Shell', uuid = 'aurora-shell@luminusos.github.io') {
    this._prefix = prefix;
    this._uuid = uuid;
  }

  private _fmt(msg: string, args: any[]): string {
    const suffix = args.length ? ` ${args.map((a) => String(a)).join(' ')}` : '';
    return `${msg}${suffix}`;
  }

  private _emit(level: GLib.LogLevelFlags, msg: string): void {
    GLib.log_structured(this._prefix, level, {
      SYSLOG_IDENTIFIER: this._uuid,
      MESSAGE: msg,
    });
  }

  log(msg: string, ...args: any[]): void {
    this._emit(GLib.LogLevelFlags.LEVEL_MESSAGE, this._fmt(msg, args));
  }

  debug(msg: string, ...args: any[]): void {
    this._emit(GLib.LogLevelFlags.LEVEL_DEBUG, this._fmt(msg, args));
  }

  info(msg: string, ...args: any[]): void {
    this._emit(GLib.LogLevelFlags.LEVEL_MESSAGE, this._fmt(msg, args));
  }

  warn(msg: string, ...args: any[]): void {
    this._emit(GLib.LogLevelFlags.LEVEL_WARNING, this._fmt(msg, args));
  }

  error(msg: string, ...args: any[]): void {
    this._emit(GLib.LogLevelFlags.LEVEL_CRITICAL, this._fmt(msg, args));
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
