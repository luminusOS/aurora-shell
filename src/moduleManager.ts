import type { ExtensionContext } from '~/core/context.ts';
import { activeDisplayRoles } from '~/device/runtime.ts';
import type { Module, ModuleDefinition } from '~/module.ts';
import { moduleSupportsRuntime } from '~/module.ts';

export type ModuleManagerLogger = {
  debug(message: string): void;
  error(message: string): void;
};

export class ModuleManager {
  private readonly _modules = new Map<string, Module>();
  private readonly _settingSignalIds: number[] = [];
  private _unsubscribeDevice: (() => void) | null = null;
  private _started = false;

  constructor(
    private readonly _definitions: readonly ModuleDefinition[],
    private readonly _context: ExtensionContext,
    private readonly _logger: ModuleManagerLogger,
  ) {}

  getModule(key: string): Module | null {
    return this._modules.get(key) ?? null;
  }

  get modules(): ReadonlyMap<string, Module> {
    return this._modules;
  }

  start(): void {
    if (this._started) return;
    this._started = true;
    for (const definition of this._definitions) {
      const id = this._context.settings.connect(`changed::${definition.manifest.settingsKey}`, () =>
        this.reconcile(),
      );
      this._settingSignalIds.push(id);
    }
    this._unsubscribeDevice = this._context.device.subscribeChanged(() => this.reconcile());
    this.reconcile();
  }

  reconcile(): void {
    if (!this._started) return;
    const snapshot = this._context.device.current;
    const roles = activeDisplayRoles(snapshot);

    for (const definition of this._definitions) {
      const { manifest } = definition;
      const shouldRun =
        this._context.settings.getBoolean(manifest.settingsKey) &&
        moduleSupportsRuntime(manifest, roles, snapshot.capabilities);
      const existing = this._modules.get(manifest.key);

      if (shouldRun && !existing) this._enable(definition);
      else if (!shouldRun && existing) this._disable(manifest.key, existing);
    }
  }

  stop(): void {
    if (!this._started) return;
    this._started = false;
    this._unsubscribeDevice?.();
    this._unsubscribeDevice = null;
    for (const id of this._settingSignalIds) this._context.settings.disconnect(id);
    this._settingSignalIds.length = 0;

    for (const [key, module] of [...this._modules].reverse()) this._disable(key, module);
  }

  private _enable(definition: ModuleDefinition): void {
    const { manifest } = definition;
    this._logger.debug(`Enabling module ${manifest.key}`);
    let module: Module | null = null;
    try {
      module = definition.factory(this._context);
      module.enable();
      this._modules.set(manifest.key, module);
    } catch (error) {
      if (module) {
        try {
          module.disable();
        } catch {
          // The original enable failure is the useful error to report.
        }
      }
      this._logger.error(`Failed to enable module ${manifest.key}: ${String(error)}`);
    }
  }

  private _disable(key: string, module: Module): void {
    this._logger.debug(`Disabling module ${key}`);
    this._modules.delete(key);
    try {
      module.disable();
    } catch (error) {
      this._logger.error(`Failed to disable module ${key}: ${String(error)}`);
    }
  }
}
