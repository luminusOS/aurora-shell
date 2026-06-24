export const TRASH_URI = 'trash://';
export const NAUTILUS_APP_ID = 'org.gnome.Nautilus.desktop';

export type TrashLaunchResult = 'nautilus';

export interface TrashLaunchStrategy {
  launchNautilus(): boolean;
}

export interface TrashAvailabilityStrategy {
  getNautilusExecutable(): string | null;
}

export function canLaunchTrash(strategy: TrashAvailabilityStrategy): boolean {
  return strategy.getNautilusExecutable() !== null;
}

/** Opens the trash explicitly through Nautilus. */
export function launchTrash(strategy: TrashLaunchStrategy): TrashLaunchResult {
  if (strategy.launchNautilus()) return 'nautilus';
  throw new Error('Nautilus refused the trash URI');
}
