export type IconWeaveScoreInput = {
  desktopId: string;
  appName: string;
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

export function scoreIconWeaveCandidate(input: IconWeaveScoreInput): number {
  const desktopId = input.desktopId.toLowerCase().replace(/\.desktop$/, '');
  const appName = input.appName.toLowerCase();
  const shortId = desktopId.split('.').pop() ?? desktopId;

  if (isSubprocessClass(wmClassLower(input.wmClass), desktopId, shortId)) return 0;

  let score = 0;

  const words = appName.split(/[^a-z0-9]/).filter((w) => w.length > 0);
  const abbreviation = words.map((w) => w[0]).join('');

  const nWm = normalize(input.wmClass);
  const nAppName = normalize(appName);
  const nDesktopId = normalize(desktopId);
  const nShortId = normalize(shortId);

  if (input.wmClass) {
    const wm = wmClassLower(input.wmClass);
    if (desktopId === wm) score = Math.max(score, 93);
    if (desktopId.includes(wm) && wm.length >= 3) score = Math.max(score, 80);
    if (wm.includes(desktopId) && desktopId.length >= 3) score = Math.max(score, 70);
    if (isSpecificShortIdMatch(shortId, wm)) score = Math.max(score, 66);
    if (appName === wm) score = Math.max(score, 85);
    if (appName.includes(wm) && wm.length >= 3) score = Math.max(score, 60);
    if (wm.includes(appName) && appName.length >= 3) score = Math.max(score, 55);

    if (nWm === abbreviation && abbreviation.length >= 2) {
      score = Math.max(score, 88);
    }

    if (nAppName.includes(nWm) && nWm.length >= 3) score = Math.max(score, 62);
    if (nDesktopId.includes(nWm) && nWm.length >= 3) score = Math.max(score, 61);
  }

  if (input.appId) {
    const aId = input.appId.toLowerCase();
    const nAId = normalize(input.appId);
    if (desktopId.includes(aId) && aId.length >= 3) score = Math.max(score, 75);
    if (nAId === abbreviation && abbreviation.length >= 2) score = Math.max(score, 88);
  }

  const tNorm = normalize(input.title);

  if (tNorm && tNorm.length >= 3) {
    if (tNorm === nDesktopId) score = Math.max(score, 98);
    if (tNorm === nAppName) score = Math.max(score, 95);
    if (tNorm === nShortId) score = Math.max(score, 94);
    if (nAppName.includes(tNorm)) score = Math.max(score, 65);
    if (tNorm.includes(nDesktopId)) score = Math.max(score, 68);
  }

  return score;
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
