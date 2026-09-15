export type IconWeaveCandidateMetadata = {
  desktopId: string;
  appName: string;
  shortId: string;
  normalizedDesktopId: string;
  normalizedAppName: string;
  normalizedShortId: string;
  abbreviation: string;
  steamGameId: string | null;
};

export type IconWeaveScoreInput = {
  candidate: IconWeaveCandidateMetadata;
  wmClass: string;
  appId: string;
  title: string;
};

export type IconWeaveRegistration = { windowId: number; appId: string };

export function registerIconWeaveWindow(
  registrations: ReadonlyMap<number, string>,
  registration: IconWeaveRegistration,
): Map<number, string> {
  const next = new Map(registrations);
  next.set(registration.windowId, registration.appId);
  return next;
}

export function unregisterIconWeaveWindow(
  registrations: ReadonlyMap<number, string>,
  windowId: number,
): Map<number, string> {
  const next = new Map(registrations);
  next.delete(windowId);
  return next;
}

const SHORT_ID_MIN_COVERAGE = 0.45;

export function createIconWeaveCandidateMetadata(
  desktopId: string,
  appName: string,
  executable: string,
): IconWeaveCandidateMetadata {
  const normalizedId = desktopId.toLowerCase().replace(/\.desktop$/, '');
  const normalizedName = appName.toLowerCase();
  const shortId = normalizedId.split('.').pop() || normalizedId;
  const words = normalizedName.split(/[^a-z0-9]/).filter((word) => word.length > 0);
  const steamMatch = executable.match(/steam:\/\/rungameid\/(\d+)/);

  return {
    desktopId: normalizedId,
    appName: normalizedName,
    shortId,
    normalizedDesktopId: normalize(normalizedId),
    normalizedAppName: normalize(normalizedName),
    normalizedShortId: normalize(shortId),
    abbreviation: words.map((word) => word[0]).join(''),
    steamGameId: steamMatch && steamMatch[1] ? steamMatch[1] : null,
  };
}

export function scoreIconWeaveCandidate(input: IconWeaveScoreInput): number {
  const candidate = input.candidate;
  if (isIconWeaveSteamGame(candidate, input.wmClass)) return 99;

  if (isSubprocessClass(wmClassLower(input.wmClass), candidate.desktopId, candidate.shortId)) {
    return 0;
  }

  let score = 0;

  const nWm = normalize(input.wmClass);

  if (input.wmClass) {
    const wm = wmClassLower(input.wmClass);
    if (candidate.desktopId === wm) score = Math.max(score, 93);
    if (candidate.desktopId.includes(wm) && wm.length >= 3) score = Math.max(score, 80);
    if (wm.includes(candidate.desktopId) && candidate.desktopId.length >= 3) {
      score = Math.max(score, 70);
    }
    if (isSpecificShortIdMatch(candidate.shortId, wm)) score = Math.max(score, 66);
    if (candidate.appName === wm) score = Math.max(score, 85);
    if (candidate.appName.includes(wm) && wm.length >= 3) score = Math.max(score, 60);
    if (wm.includes(candidate.appName) && candidate.appName.length >= 3) {
      score = Math.max(score, 55);
    }

    if (nWm === candidate.abbreviation && candidate.abbreviation.length >= 2) {
      score = Math.max(score, 88);
    }

    if (candidate.normalizedAppName.includes(nWm) && nWm.length >= 3) {
      score = Math.max(score, 62);
    }
    if (candidate.normalizedDesktopId.includes(nWm) && nWm.length >= 3) {
      score = Math.max(score, 61);
    }
  }

  if (input.appId) {
    const aId = input.appId.toLowerCase();
    const nAId = normalize(input.appId);
    if (candidate.desktopId.includes(aId) && aId.length >= 3) score = Math.max(score, 75);
    if (nAId === candidate.abbreviation && candidate.abbreviation.length >= 2) {
      score = Math.max(score, 88);
    }
  }

  const tNorm = normalize(input.title);

  if (tNorm && tNorm.length >= 3) {
    if (tNorm === candidate.normalizedDesktopId) score = Math.max(score, 98);
    if (tNorm === candidate.normalizedAppName) score = Math.max(score, 95);
    if (tNorm === candidate.normalizedShortId) score = Math.max(score, 94);
    if (candidate.normalizedAppName.includes(tNorm)) score = Math.max(score, 65);
    if (tNorm.includes(candidate.normalizedDesktopId)) score = Math.max(score, 68);
  }

  return score;
}

export function isIconWeaveSteamGame(
  candidate: IconWeaveCandidateMetadata,
  wmClass: string,
): boolean {
  if (!candidate.steamGameId) return false;

  const normalizedClass = normalize(wmClass);
  if (normalizedClass === `steamapp${candidate.steamGameId}`) return true;

  return normalizedClass === candidate.abbreviation && candidate.abbreviation.length >= 2;
}

export function normalize(str: string): string {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function wmClassLower(wmClass: string): string {
  return wmClass.toLowerCase();
}

function isSubprocessClass(wmClass: string, desktopId: string, shortId: string): boolean {
  return (
    wmClass.length > 0 &&
    (wmClass.startsWith(`${desktopId}_`) ||
      wmClass.startsWith(`${shortId}_`) ||
      wmClass.startsWith(`${desktopId}-`) ||
      wmClass.startsWith(`${shortId}-`))
  );
}

function isSpecificShortIdMatch(shortId: string, wmClass: string): boolean {
  const nShortId = normalize(shortId);
  const nWm = normalize(wmClass);

  if (nShortId.length < 3 || !nWm.includes(nShortId)) return false;
  if (nShortId === nWm) return true;

  const coverage = nShortId.length / nWm.length;
  if (coverage >= SHORT_ID_MIN_COVERAGE) return true;

  return nShortId.length >= 5 && (nWm.startsWith(nShortId) || nWm.endsWith(nShortId));
}
