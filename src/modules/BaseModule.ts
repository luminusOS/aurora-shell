import type { ConsoleLike } from '@girs/gnome-shell/extensions/extension';

/**
 * Base interface for Aurora Shell modules
 */
export interface AuroraModule {
  /**
   * Enable the module
   */
  enable(): void;

  /**
   * Disable the module and clean up resources
   */
  disable(): void;
}

/**
 * Abstract base class for Aurora Shell modules
 * Provides common functionality like logging
 */
export abstract class BaseAuroraModule implements AuroraModule {
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
