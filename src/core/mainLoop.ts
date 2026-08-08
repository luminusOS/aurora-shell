import GLib from '@girs/glib-2.0';

import type { LifecycleScope, ManagedSource } from '~/core/lifecycleScope.ts';

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
