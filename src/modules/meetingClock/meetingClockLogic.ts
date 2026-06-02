export type MeetingEvent = {
  id: string;
  title: string;
  startEpochSeconds: number;
  endEpochSeconds: number;
  sourceId: string;
  sourceName: string;
  description: string;
  location: string;
  url: string;
  meetingUrl: string;
  isAllDay: boolean;
};

export type MeetingClockOptions = {
  alertsEnabled: boolean;
  alertMinutesBefore: number;
  alertEventsWithoutLink: boolean;
  excludeAllDayEvents: boolean;
  maxFutureSeconds?: number;
  ignoredEventIds?: ReadonlySet<string>;
  alertedEventIds?: ReadonlySet<string>;
  snoozedUntilByEventId?: ReadonlyMap<string, number>;
};

export type MeetingPanelPresentation = {
  label: string;
  event: MeetingEvent;
  isInProgress: boolean;
} | null;

const URL_REGEX = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
const VIDEO_HOST_REGEX =
  /(?:zoom\.us|meet\.google\.com|teams\.microsoft\.com|webex\.com|whereby\.com|jitsi|chime\.aws|around\.co)/i;
const GOOGLE_DELIMITER =
  '-::~:~::~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~::~:~::-';
const MAX_PANEL_TITLE_LENGTH = 24;

function _deepUnpack(value: unknown): unknown {
  if (
    value &&
    typeof value === 'object' &&
    'deepUnpack' in value &&
    typeof (value as { deepUnpack: () => unknown }).deepUnpack === 'function'
  ) {
    return _deepUnpack((value as { deepUnpack: () => unknown }).deepUnpack());
  }

  if (Array.isArray(value)) return value.map((item) => _deepUnpack(item));

  if (value && typeof value === 'object') {
    const unpacked: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) unpacked[key] = _deepUnpack(item);
    return unpacked;
  }

  return value;
}

function _readString(details: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = details[key];
    if (value !== null && value !== undefined) return String(value);
  }
  return '';
}

function _readBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }
  return false;
}

function _inferAllDayEvent(
  startEpochSeconds: number,
  endEpochSeconds: number,
  details: Record<string, unknown>,
): boolean {
  const explicitAllDay = [
    details['all_day'],
    details['all-day'],
    details['allDay'],
    details['allday'],
    details['is_all_day'],
    details['is-all-day'],
    details['isAllDay'],
    details['isallday'],
  ].some(_readBoolean);

  if (explicitAllDay) return true;
  if (!Number.isFinite(startEpochSeconds) || !Number.isFinite(endEpochSeconds)) return false;
  if (endEpochSeconds <= startEpochSeconds) return false;

  const durationSeconds = endEpochSeconds - startEpochSeconds;
  if (durationSeconds < 86400 || durationSeconds % 86400 !== 0) return false;

  const start = new Date(startEpochSeconds * 1000);
  const end = new Date(endEpochSeconds * 1000);
  return (
    start.getHours() === 0 &&
    start.getMinutes() === 0 &&
    start.getSeconds() === 0 &&
    end.getHours() === 0 &&
    end.getMinutes() === 0 &&
    end.getSeconds() === 0
  );
}

function _extractGoogleSection(description: string): string {
  if (!description) return '';

  const firstDelimiter = description.indexOf(GOOGLE_DELIMITER);
  if (firstDelimiter < 0) return '';

  const start = firstDelimiter + GOOGLE_DELIMITER.length;
  const lastDelimiter = description.indexOf(GOOGLE_DELIMITER, start);
  if (lastDelimiter < 0) return '';

  return description.slice(start, lastDelimiter);
}

function _cleanUrl(url: string): string {
  return url.replace(/[),.;!?]+$/, '');
}

function _extractPreferredUrl(text: string): string {
  const matches = text.match(URL_REGEX) ?? [];
  if (matches.length === 0) return '';

  const urls = matches.map(_cleanUrl);
  return urls.find((url) => VIDEO_HOST_REGEX.test(url.toLowerCase())) ?? urls[0] ?? '';
}

function _truncateTitle(title: string): string {
  if (title.length <= MAX_PANEL_TITLE_LENGTH) return title;
  return `${title.slice(0, MAX_PANEL_TITLE_LENGTH - 3)}...`;
}

export function normalizeCalendarServerEvent(rawEvent: unknown): MeetingEvent | null {
  const unpacked = _deepUnpack(rawEvent);
  if (!Array.isArray(unpacked) || unpacked.length < 4) return null;

  const [rawId, rawSummary, rawStart, rawEnd, rawDetails = {}] = unpacked;
  const startEpochSeconds = Number(rawStart);
  const endEpochSeconds = Number(rawEnd);
  if (!Number.isFinite(startEpochSeconds) || !Number.isFinite(endEpochSeconds)) return null;

  const id = String(rawId);
  const details =
    rawDetails && typeof rawDetails === 'object' ? (rawDetails as Record<string, unknown>) : {};
  const sourceId =
    _readString(details, [
      'source-uid',
      'source_uid',
      'source-id',
      'source_id',
      'calendar-uid',
      'calendar_uid',
      'calendar-id',
      'calendar_id',
    ]) ||
    id.split(/\s+/)[0] ||
    '';
  const sourceName =
    _readString(details, [
      'source-name',
      'source_name',
      'calendar-name',
      'calendar_name',
      'display-name',
      'display_name',
    ]) || 'Calendar';
  const description = _readString(details, ['description', 'comment']);
  const location = _readString(details, ['location']);
  const url = _readString(details, ['url', 'uri', 'meeting_url', 'conference_url']);

  const event: MeetingEvent = {
    id,
    title: rawSummary ? String(rawSummary) : 'Untitled event',
    startEpochSeconds,
    endEpochSeconds,
    sourceId,
    sourceName,
    description,
    location,
    url,
    meetingUrl: '',
    isAllDay: _inferAllDayEvent(startEpochSeconds, endEpochSeconds, details),
  };
  event.meetingUrl = extractMeetingUrl(event);
  return event;
}

export function extractMeetingUrl(event: Partial<MeetingEvent>): string {
  const candidates = [event.meetingUrl, event.url, event.location, event.description];

  for (const candidate of candidates) {
    const text = String(candidate ?? '');
    const directUrl = _extractPreferredUrl(text);
    if (directUrl) return directUrl;

    const googleSection = _extractGoogleSection(text);
    if (!googleSection) continue;

    const googleUrl = _extractPreferredUrl(googleSection);
    if (googleUrl) return googleUrl;
  }

  return '';
}

export function filterDisplayEvents(
  events: readonly MeetingEvent[],
  nowEpochSeconds: number,
  options: Pick<MeetingClockOptions, 'excludeAllDayEvents'>,
): MeetingEvent[] {
  return events
    .filter((event) => event.endEpochSeconds > nowEpochSeconds)
    .filter((event) => !(options.excludeAllDayEvents && event.isAllDay))
    .sort((a, b) => a.startEpochSeconds - b.startEpochSeconds);
}

export function derivePanelPresentation(
  events: readonly MeetingEvent[],
  nowEpochSeconds: number,
  options: Pick<MeetingClockOptions, 'excludeAllDayEvents' | 'maxFutureSeconds'>,
): MeetingPanelPresentation {
  const visibleEvents = filterDisplayEvents(events, nowEpochSeconds, options);
  const inProgress = visibleEvents.find(
    (event) =>
      event.startEpochSeconds <= nowEpochSeconds && event.endEpochSeconds > nowEpochSeconds,
  );
  if (inProgress) {
    return {
      label: `${_truncateTitle(inProgress.title)} · now`,
      event: inProgress,
      isInProgress: true,
    };
  }

  const maxFutureSeconds = options.maxFutureSeconds ?? Number.POSITIVE_INFINITY;
  const next = visibleEvents.find(
    (event) =>
      event.startEpochSeconds > nowEpochSeconds &&
      event.startEpochSeconds - nowEpochSeconds <= maxFutureSeconds,
  );
  if (!next) return null;

  return {
    label: `${_truncateTitle(next.title)} · ${formatRelativeTime(next.startEpochSeconds, nowEpochSeconds)}`,
    event: next,
    isInProgress: false,
  };
}

export function getDueAlertEvents(
  events: readonly MeetingEvent[],
  nowEpochSeconds: number,
  options: MeetingClockOptions,
): MeetingEvent[] {
  if (!options.alertsEnabled) return [];

  const ignored = options.ignoredEventIds ?? new Set<string>();
  const alerted = options.alertedEventIds ?? new Set<string>();
  const snoozed = options.snoozedUntilByEventId ?? new Map<string, number>();
  const leadSeconds = Math.max(0, options.alertMinutesBefore) * 60;

  return filterDisplayEvents(events, nowEpochSeconds, options)
    .filter((event) => Boolean(event.meetingUrl) || options.alertEventsWithoutLink)
    .filter((event) => !ignored.has(event.id))
    .filter((event) => !alerted.has(event.id))
    .filter((event) => (snoozed.get(event.id) ?? 0) <= nowEpochSeconds)
    .filter((event) => nowEpochSeconds >= event.startEpochSeconds - leadSeconds)
    .sort((a, b) => a.startEpochSeconds - b.startEpochSeconds);
}

export function formatRelativeTime(
  targetEpochSeconds: number,
  referenceEpochSeconds: number,
): string {
  const deltaSeconds = targetEpochSeconds - referenceEpochSeconds;
  const absSeconds = Math.abs(deltaSeconds);
  const isFuture = deltaSeconds >= 0;

  if (absSeconds < 3600) {
    const minutes = Math.max(1, Math.round(absSeconds / 60));
    return isFuture ? `${minutes}m` : `${minutes}m ago`;
  }

  if (absSeconds < 86400) {
    const hours = Math.max(1, Math.round(absSeconds / 3600));
    return isFuture ? `${hours}h` : `${hours}h ago`;
  }

  const days = Math.max(1, Math.round(absSeconds / 86400));
  return isFuture ? `${days}d` : `${days}d ago`;
}

export function formatEventTime(event: MeetingEvent): string {
  const start = new Date(event.startEpochSeconds * 1000);
  const end = new Date(event.endEpochSeconds * 1000);
  const options: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  return `${start.toLocaleTimeString([], options)} - ${end.toLocaleTimeString([], options)}`;
}
