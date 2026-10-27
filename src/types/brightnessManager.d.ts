import type GObject from '@girs/gobject-2.0';
import type Meta from '@girs/meta-18';

declare module '@girs/gnome-shell/ui/main' {
  export interface NativeBrightnessScale extends GObject.Object {
    readonly name: string;
    readonly monitor: Meta.LogicalMonitor;
    value: number;
  }

  export const brightnessManager: GObject.Object & {
    readonly scales: NativeBrightnessScale[];
    readonly globalScale: NativeBrightnessScale | null;
  };
}
