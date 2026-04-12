// @ts-nocheck
import GObject from "@girs/gobject-2.0";
import type { Logger } from "./logger.ts";
import type { SettingsManager } from "./settings.ts";
import type { ShellEnvironment } from "./adapters/shell.ts";

/**
 * Global signal bus for Aurora Shell modules
 */
@GObject.registerClass({
  Signals: { "icons-woven": {} },
})
export class AuroraSignals extends GObject.Object {}

export interface ExtensionContext {
  readonly uuid: string;
  readonly path: string;
  readonly logger: Logger;
  readonly settings: SettingsManager;
  readonly shell: ShellEnvironment;
  readonly signals: AuroraSignals;
}

export class DefaultExtensionContext implements ExtensionContext {
  public readonly signals: AuroraSignals;

  constructor(
    public readonly uuid: string,
    public readonly path: string,
    public readonly logger: Logger,
    public readonly settings: SettingsManager,
    public readonly shell: ShellEnvironment
  ) {
    this.signals = new AuroraSignals();
  }
}