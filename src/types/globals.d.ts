import type Shell from '@girs/shell-18';
import '@girs/gnome-shell/extensions/global';

declare global {
  /**
   * Global instance of shell.
   * Provides access to stage, display, window manager, etc.
   *
   * @see https://gjs-docs.gnome.org/shell17~17/shell.global
   */
  const global: Shell.Global;
}

// GJS ESM modules expose import.meta.url (the file:// URI of the current module)
interface ImportMeta {
  url: string;
}

declare global {
  // TextDecoder and TextEncoder are available in GJS (SpiderMonkey) but absent from ESNext lib
  class TextDecoder {
    constructor(encoding?: string);
    decode(input?: ArrayBuffer | ArrayBufferView): string;
  }

  class TextEncoder {
    constructor();
    encode(input?: string): Uint8Array;
  }
}
