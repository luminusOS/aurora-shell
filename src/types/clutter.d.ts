export {};

declare module '@girs/clutter-18/clutter-18' {
  namespace Clutter {
    // The generated typings predate this function, which the Mutter 51 typelib has. It aborts the
    // Shell for INHERIT and NONE, which have no name.
    function cursor_type_to_name(cursor: CursorType): string;
  }
}
