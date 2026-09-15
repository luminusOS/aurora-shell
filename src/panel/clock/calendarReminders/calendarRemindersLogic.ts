export type CalendarEvent = {
  id: string;
  calendarUuid?: string;
  title: string;
  startEpochSeconds: number;
  endEpochSeconds: number;
  sourceId: string;
  sourceName: string;
  isAllDay: boolean;
};

export type CalendarDisplayOptions = {
  excludeAllDayEvents: boolean;
  maxFutureSeconds?: number;
};

export type CalendarPanelPresentation = {
  label: string;
  event: CalendarEvent;
  isInProgress: boolean;
} | null;

export function removeCalendarEventsByPrefix(
  eventsById: Map<string, CalendarEvent>,
  prefix: string,
): boolean {
  let changed = false;
  for (const id of eventsById.keys()) {
    if (id.startsWith(prefix)) changed = eventsById.delete(id) || changed;
  }
  return changed;
}

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

function _truncateTitle(title: string): string {
  if (title.length <= MAX_PANEL_TITLE_LENGTH) return title;
  return `${title.slice(0, MAX_PANEL_TITLE_LENGTH - 3)}...`;
}

export function normalizeCalendarServerEvent(rawEvent: unknown): CalendarEvent | null {
  const unpacked = _deepUnpack(rawEvent);
  if (!Array.isArray(unpacked) || unpacked.length < 4) return null;

  const [rawId, rawSummary, rawStart, rawEnd, rawDetails = {}] = unpacked;
  const startEpochSeconds = Number(rawStart);
  const endEpochSeconds = Number(rawEnd);
  if (!Number.isFinite(startEpochSeconds) || !Number.isFinite(endEpochSeconds)) return null;

  const id = String(rawId);
  const idParts = id.split('\n');
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
    idParts[0] ||
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

  const event: CalendarEvent = {
    id,
    title: rawSummary ? String(rawSummary) : 'Untitled event',
    startEpochSeconds,
    endEpochSeconds,
    sourceId,
    sourceName,
    isAllDay: _inferAllDayEvent(startEpochSeconds, endEpochSeconds, details),
  };
  if (idParts[1]) event.calendarUuid = `${sourceId}:${idParts[1]}`;
  return event;
}

export function getStartReminderId(event: CalendarEvent): string {
  return `start:${JSON.stringify([event.id, event.startEpochSeconds])}`;
}

export function getStartReminderEvents(
  events: readonly CalendarEvent[],
  nowEpochSeconds: number,
): CalendarEvent[] {
  return events
    .filter((event) => !event.isAllDay && event.endEpochSeconds > nowEpochSeconds)
    .filter((event) => event.startEpochSeconds >= nowEpochSeconds - 60)
    .sort((a, b) => a.startEpochSeconds - b.startEpochSeconds);
}

export function filterDisplayEvents(
  events: readonly CalendarEvent[],
  nowEpochSeconds: number,
  options: Pick<CalendarDisplayOptions, 'excludeAllDayEvents'>,
): CalendarEvent[] {
  return events
    .filter((event) => event.endEpochSeconds > nowEpochSeconds)
    .filter((event) => !(options.excludeAllDayEvents && event.isAllDay))
    .sort((a, b) => a.startEpochSeconds - b.startEpochSeconds);
}

export function derivePanelPresentation(
  events: readonly CalendarEvent[],
  nowEpochSeconds: number,
  options: Pick<CalendarDisplayOptions, 'excludeAllDayEvents' | 'maxFutureSeconds'>,
): CalendarPanelPresentation {
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

  const { maxFutureSeconds = Number.POSITIVE_INFINITY } = options;
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

export function formatEventTime(event: CalendarEvent): string {
  const start = new Date(event.startEpochSeconds * 1000);
  const end = new Date(event.endEpochSeconds * 1000);
  const options: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  return `${start.toLocaleTimeString([], options)} - ${end.toLocaleTimeString([], options)}`;
}
