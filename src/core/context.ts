import GObject from 'gi://GObject';
import type { SettingsManager } from './settings.ts';
import type { DeviceService } from '~/device/device.ts';

/**
 * Global signal bus for Aurora Shell modules
 */
export const AuroraSignals = GObject.registerClass(
  {
    Signals: {
      'icons-woven': {},
    },
  },
  class AuroraSignals extends GObject.Object {
    declare emit: GObject.SignalMethods<
      this,
      GObject.Object['$signals'] & { 'icons-woven': () => void }
    >['emit'];
  },
);

export type AuroraSignals = InstanceType<typeof AuroraSignals>;

export interface ExtensionContext {
  readonly uuid: string;
  readonly path: string;
  readonly settings: SettingsManager;
  readonly signals: AuroraSignals;
  readonly device: DeviceService;
}

export class DefaultExtensionContext implements ExtensionContext {
  public readonly signals = new AuroraSignals();

  constructor(
    public readonly uuid: string,
    public readonly path: string,
    public readonly settings: SettingsManager,
    public readonly device: DeviceService,
  ) {}
}
