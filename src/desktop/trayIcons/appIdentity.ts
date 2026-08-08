/**
 * Normalizes desktop application identifiers for matching Shell apps, SNI
 * entries and background-app records. Both suffixed and unsuffixed forms are
 * retained because GNOME APIs do not consistently use the `.desktop` suffix.
 */
export function appIdCandidates(appIds: readonly string[]): Set<string> {
  const candidates = new Set<string>();

  for (const appId of appIds) {
    let candidate = appId.toLowerCase();
    while (candidate) {
      candidates.add(candidate);
      if (!candidate.endsWith('.desktop')) break;
      candidate = candidate.slice(0, -'.desktop'.length);
    }
  }

  return candidates;
}

const GENERIC_COMPONENTS = new Set([
  'app',
  'application',
  'desktop',
  'indicator',
  'status',
  'statusicon',
  'status_icon',
  'tray',
]);

export type SniIdentity = { desktopEntry: string; sniId: string };

export function sniIdentityMatchesAppId(identity: SniIdentity, appId: string): boolean {
  const appIds = appIdCandidates([appId]);
  const appComponents = new Set(
    [...appIds]
      .map((candidate) => candidate.split('.').at(-1) || candidate)
      .filter(isSpecificAppComponent),
  );
  const desktopEntry = identity.desktopEntry.toLowerCase();
  const unsuffixed = desktopEntry.replace(/\.desktop$/, '');
  if (
    [...appIds].some(
      (id) => desktopEntry === id || desktopEntry === `${id}.desktop` || unsuffixed === id,
    )
  )
    return true;
  const sniId = identity.sniId.toLowerCase();
  if (!sniId) return false;
  if (appIds.has(sniId)) return true;
  const component = sniId.split('.').at(-1) || sniId;
  return isSpecificAppComponent(component) && appComponents.has(component);
}

function isSpecificAppComponent(component: string): boolean {
  return component.length >= 4 && !GENERIC_COMPONENTS.has(component);
}
