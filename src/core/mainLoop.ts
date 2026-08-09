import GLib from '@girs/glib-2.0';

import type { LifecycleScope, ManagedSource } from '~/core/lifecycleScope.ts';

export interface ManagedTimeoutBatch {
  replace(delays: readonly number[], callback: () => void): void;
  clear(): void;
}

class ManagedTimeoutBatchImpl implements ManagedTimeoutBatch {
  private _sourceIds: Set<number> | null = new Set();

  replace(delays: readonly number[], callback: () => void): void {
    this.clear();
    if (!this._sourceIds) return;

    for (const delay of delays) {
      const sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
        if (!this._sourceIds) return GLib.SOURCE_REMOVE;

        this._sourceIds.delete(sourceId);
        callback();
        return GLib.SOURCE_REMOVE;
      });
      this._sourceIds.add(sourceId);
    }
  }

  clear(): void {
    if (!this._sourceIds) return;

    for (const sourceId of this._sourceIds) {
      removeSource(sourceId);
    }
    this._sourceIds.clear();
  }

  dispose(): void {
    if (!this._sourceIds) return;

    this.clear();
    this._sourceIds = null;
  }
}

export function removeSource(sourceId: number): 0 {
  if (sourceId !== 0) GLib.source_remove(sourceId);
  return 0;
}

/**
 * Registers one replaceable GLib source with an owner's LifecycleScope.
 *
 * ManagedSource.replace() removes the previous source before creating another one,
 * and LifecycleScope.dispose() removes every source still active on disable/destroy.
 */
export function createManagedSource(scope: LifecycleScope): ManagedSource {
  return scope.manageSource(removeSource);
}

export function createManagedTimeoutBatch(scope: LifecycleScope): ManagedTimeoutBatch {
  const batch = new ManagedTimeoutBatchImpl();
  scope.onDispose(() => batch.dispose());
  return batch;
}
