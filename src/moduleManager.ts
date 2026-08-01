import type { ExtensionContext } from '~/core/context.ts';
import { LifecycleScope } from '~/core/lifecycleScope.ts';
import { activeDisplayRoles } from '~/device/runtime.ts';
import type { Module, ModuleDefinition } from '~/module.ts';
import { moduleSupportsRuntime } from '~/module.ts';

export type ModuleManagerLogger = {
  debug(message: string): void;
  error(message: string): void;
};

export class ModuleManager {
  private readonly _modules = new Map<string, Module>();
  private _lifecycle: LifecycleScope | null = null;

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
    if (this._lifecycle) return;

    const lifecycle = new LifecycleScope();
    this._lifecycle = lifecycle;

    for (const definition of this._definitions) {
      lifecycle.connect(this._context.settings, `changed::${definition.manifest.settingsKey}`, () =>
        this.reconcile(),
      );
    }
    lifecycle.onDispose(this._context.device.subscribeChanged(() => this.reconcile()));
    this.reconcile();
  }

  reconcile(): void {
    if (!this._lifecycle) return;

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
    const lifecycle = this._lifecycle;
    if (!lifecycle) return;

    this._lifecycle = null;
    lifecycle.dispose();

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
