import type { ParamSpec, GType, TypeFlags } from '@girs/gobject-2.0';

// Augment the subpath module where registerClass is actually declared.
// Adds the decorator-factory overload: @GObject.registerClass({ Signals: {...} })
declare module '@girs/gobject-2.0/gobject-2.0' {
  export namespace GObject {
    export function registerClass<
      T extends new (...args: any[]) => any,
      Props extends { [key: string]: ParamSpec },
      Interfaces extends { $gtype: GType }[],
      Sigs extends {
        [key: string]: {
          param_types?: readonly GType[];
          [key: string]: any;
        };
      },
    >(options: {
      GTypeName?: string;
      GTypeFlags?: TypeFlags;
      Properties?: Props;
      Signals?: Sigs;
      Implements?: Interfaces;
      CssName?: string;
      Template?: string;
      Children?: string[];
      InternalChildren?: string[];
    }): (target: T) => T;
  }
}
