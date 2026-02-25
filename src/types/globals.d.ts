import type Shell from '@girs/shell-17';

declare global {
  /**
   * Global instance of shell.
   * Provides access to stage, display, window manager, etc.
   *
   * @see https://gjs-docs.gnome.org/shell17~17/shell.global
   */
  const global: Shell.Global;
}
