import type { ExtensionContext } from '~/core/context.ts';
import { Module } from '~/module.ts';

import { IconWeaveInspector } from './iconWeaveInspector.ts';
import { IconWeavePatches } from './iconWeavePatches.ts';
import { IconWeaveWindowRegistry } from './iconWeaveRegistry.ts';

export class IconWeave extends Module {
  private _registry: IconWeaveWindowRegistry | null = null;
  private _patches: IconWeavePatches | null = null;
  private _inspector: IconWeaveInspector | null = null;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this.disable();

    this._registry = new IconWeaveWindowRegistry();
    this._patches = new IconWeavePatches(this._registry.mappings);

    const resolveNativeWindowApp = this._patches.install();
    this._inspector = new IconWeaveInspector({
      registry: this._registry,
      resolveNativeWindowApp,
      onMappingChanged: () => this.context.signals.emit('icons-woven'),
    });
    this._inspector.start();
  }

  override disable(): void {
    this._inspector?.destroy();
    this._inspector = null;

    this._patches?.destroy();
    this._patches = null;

    this._registry?.clear();
    this._registry = null;
  }
}
