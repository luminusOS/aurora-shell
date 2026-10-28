declare module 'gi://Rsvg' {
  import type GdkPixbuf from '@girs/gdkpixbuf-2.0';

  namespace Rsvg {
    class Handle {
      static new_from_data(data: Uint8Array): Handle;
      set_stylesheet(css: Uint8Array): boolean;
      get_pixbuf(): GdkPixbuf.Pixbuf | null;
    }
  }

  export default Rsvg;
}
