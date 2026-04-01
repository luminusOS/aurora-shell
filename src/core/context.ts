import type { Logger } from "./logger.ts";
import type { SettingsManager } from "./settings.ts";
import type { ShellEnvironment } from "./adapters/shell.ts";

export interface ExtensionContext {
  readonly uuid: string;
  readonly path: string;
  readonly logger: Logger;
  readonly settings: SettingsManager;
  readonly shell: ShellEnvironment;
}

export class DefaultExtensionContext implements ExtensionContext {
  constructor(
    public readonly uuid: string,
    public readonly path: string,
    public readonly logger: Logger,
    public readonly settings: SettingsManager,
    public readonly shell: ShellEnvironment
  ) {}
}