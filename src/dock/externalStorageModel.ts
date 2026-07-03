export type ExternalStorageKind = 'volume' | 'mount';

export interface ExternalStorageCandidate {
  id: string;
  name: string;
  kind: ExternalStorageKind;
  sortKey: string | null;
  volumeClass: string | null;
  hasDrive: boolean;
  isNative: boolean;
  isShadowed: boolean;
  canMount: boolean;
  hasMount: boolean;
}

export interface ExternalStorageEntry {
  id: string;
  name: string;
  kind: ExternalStorageKind;
}

function isNetworkClass(volumeClass: string | null): boolean {
  return volumeClass?.includes('network') ?? false;
}

function isInterestingLocalStorage(candidate: ExternalStorageCandidate): boolean {
  if (!candidate.id || !candidate.name) return false;
  if (candidate.isShadowed) return false;
  if (isNetworkClass(candidate.volumeClass)) return false;
  if (!candidate.isNative && !candidate.hasDrive) return false;

  if (candidate.kind === 'volume') {
    return candidate.hasDrive && (candidate.hasMount || candidate.canMount);
  }

  return candidate.isNative;
}

export function selectExternalStorageEntries(
  candidates: readonly ExternalStorageCandidate[],
): ExternalStorageEntry[] {
  const entries = new Map<string, ExternalStorageEntry & { sortKey: string }>();

  for (const candidate of candidates) {
    if (!isInterestingLocalStorage(candidate)) continue;

    if (!entries.has(candidate.id)) {
      entries.set(candidate.id, {
        id: candidate.id,
        name: candidate.name,
        kind: candidate.kind,
        sortKey: candidate.sortKey ?? candidate.name.toLocaleLowerCase(),
      });
    }
  }

  return [...entries.values()]
    .sort((a, b) => {
      const sortCompare = a.sortKey.localeCompare(b.sortKey);
      if (sortCompare !== 0) return sortCompare;
      return a.name.localeCompare(b.name);
    })
    .map(({ sortKey: _sortKey, ...entry }) => entry);
}
