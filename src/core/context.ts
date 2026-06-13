import GObject from '@girs/gobject-2.0';
import type { SettingsManager } from './settings.ts';

/**
 * Global signal bus for Aurora Shell modules
 */
@GObject.registerClass({
  Signals: {
    'icons-woven': {},
  },
})
export class AuroraSignals extends GObject.Object {}

export interface ExtensionContext {
  readonly uuid: string;
  readonly path: string;
  readonly settings: SettingsManager;
  readonly signals: AuroraSignals;
}

export class DefaultExtensionContext implements ExtensionContext {
  public readonly signals: AuroraSignals;

  constructor(
    public readonly uuid: string,
    public readonly path: string,
    public readonly settings: SettingsManager,
  ) {
    this.signals = new AuroraSignals();
  }
}
