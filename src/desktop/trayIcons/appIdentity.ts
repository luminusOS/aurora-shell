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
