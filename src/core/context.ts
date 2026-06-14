import GObject from '@girs/gobject-2.0';
import type { SettingsManager } from './settings.ts';
import type { DeviceService } from '~/device/device.ts';

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
  readonly device: DeviceService;
}

export class DefaultExtensionContext implements ExtensionContext {
  public readonly signals: AuroraSignals;

  constructor(
    public readonly uuid: string,
    public readonly path: string,
    public readonly settings: SettingsManager,
    public readonly device: DeviceService,
  ) {
    this.signals = new AuroraSignals();
  }
}
