export const TRASH_URI = 'trash://';
export const NAUTILUS_APP_ID = 'org.gnome.Nautilus.desktop';

export type TrashLaunchResult = 'nautilus';

export function canLaunchTrash(getNautilusExecutable: () => string | null | undefined): boolean {
  return Boolean(getNautilusExecutable());
}

export function launchTrash(launchNautilus: () => boolean): TrashLaunchResult {
  if (launchNautilus()) return 'nautilus';
  throw new Error('Nautilus refused the trash URI');
}
