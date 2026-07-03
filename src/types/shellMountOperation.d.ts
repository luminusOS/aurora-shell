/* eslint-disable @typescript-eslint/consistent-type-imports */

declare module '@girs/gnome-shell/ui/shellMountOperation' {
  export class ShellMountOperation {
    mountOp: import('@girs/gio-2.0').default.MountOperation;

    constructor(
      source: import('@girs/gio-2.0').default.Volume | import('@girs/gio-2.0').default.Mount,
      params?: { existingDialog?: unknown },
    );
    close(): void;
    borrowDialog?(): unknown;
  }
}
