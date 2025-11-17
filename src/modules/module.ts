import type { ConsoleLike } from '@girs/gnome-shell/extensions/extension';

/**
 * Abstract base class for Aurora Shell modules
 * Provides common functionality like logging
 */
export abstract class Module {
  protected _console: ConsoleLike;

  constructor(console: ConsoleLike) {
    this._console = console;
  }

  abstract enable(): void;
  abstract disable(): void;

  protected log(message: string, ...args: any[]): void {
    this._console.log(message, ...args);
  }

  protected error(message: string, ...args: any[]): void {
    this._console.error(message, ...args);
  }

  protected warn(message: string, ...args: any[]): void {
    this._console.warn(message, ...args);
  }
}
