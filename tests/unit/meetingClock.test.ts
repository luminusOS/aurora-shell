import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  derivePanelPresentation,
  extractMeetingUrl,
  getDueAlertEvents,
  normalizeCalendarServerEvent,
  type MeetingEvent,
} from '../../src/modules/meetingClock/meetingClockLogic.ts';

const NOW = 1_700_000_000;

function event(overrides: Partial<MeetingEvent> = {}): MeetingEvent {
  return {
    id: 'event-1',
    title: 'Planning',
    startEpochSeconds: NOW + 300,
    endEpochSeconds: NOW + 1800,
    sourceId: 'calendar-1',
    sourceName: 'Calendar',
    description: '',
    location: '',
    url: '',
    meetingUrl: '',
    isAllDay: false,
    ...overrides,
  };
}

test('meetingClock — normalizes CalendarServer events and detects meeting URL', () => {
  const normalized = normalizeCalendarServerEvent([
    'calendar-1 event-1',
    'Daily Sync',
    NOW + 60,
    NOW + 1800,
    {
      'source-uid': 'calendar-1',
      'source-name': 'Work',
      location: 'https://meet.google.com/abc-defg-hij',
    },
  ]);

  assert.ok(normalized);
  assert.strictEqual(normalized.title, 'Daily Sync');
  assert.strictEqual(normalized.sourceId, 'calendar-1');
  assert.strictEqual(normalized.sourceName, 'Work');
  assert.strictEqual(normalized.meetingUrl, 'https://meet.google.com/abc-defg-hij');
});

test('meetingClock — prefers video meeting URLs over generic links', () => {
  const url = extractMeetingUrl({
    description: 'Notes: https://example.com Agenda: https://zoom.us/j/12345',
  });

  assert.strictEqual(url, 'https://zoom.us/j/12345');
});

test('meetingClock — excludes all-day events from panel presentation when configured', () => {
  const presentation = derivePanelPresentation(
    [
      event({
        title: 'Conference',
        startEpochSeconds: NOW - 60,
        endEpochSeconds: NOW + 86400,
        isAllDay: true,
      }),
    ],
    NOW,
    { excludeAllDayEvents: true },
  );

  assert.strictEqual(presentation, null);
});

test('meetingClock — panel presentation uses in-progress event before future event', () => {
  const presentation = derivePanelPresentation(
    [
      event({ id: 'future', title: 'Later', startEpochSeconds: NOW + 3600 }),
      event({ id: 'now', title: 'Current', startEpochSeconds: NOW - 60 }),
    ],
    NOW,
    { excludeAllDayEvents: false },
  );

  assert.ok(presentation);
  assert.strictEqual(presentation.event.id, 'now');
  assert.strictEqual(presentation.label, 'Current · now');
});

test('meetingClock — panel presentation hides future events beyond configured lookahead', () => {
  const presentation = derivePanelPresentation(
    [event({ id: 'later', title: 'Much Later', startEpochSeconds: NOW + 7200 })],
    NOW,
    { excludeAllDayEvents: false, maxFutureSeconds: 3600 },
  );

  assert.strictEqual(presentation, null);
});

test('meetingClock — panel presentation uses compact time without parentheses', () => {
  const presentation = derivePanelPresentation(
    [event({ id: 'soon', title: 'Soon', startEpochSeconds: NOW + 900 })],
    NOW,
    { excludeAllDayEvents: false, maxFutureSeconds: 3600 },
  );

  assert.ok(presentation);
  assert.strictEqual(presentation.label, 'Soon · 15m');
});

test('meetingClock — due alerts require meeting URLs and respect ignored/alerted/snoozed state', () => {
  const due = event({ id: 'due', meetingUrl: 'https://meet.google.com/abc-defg-hij' });
  const noLink = event({ id: 'no-link' });
  const ignored = event({ id: 'ignored', meetingUrl: 'https://zoom.us/j/1' });
  const alerted = event({ id: 'alerted', meetingUrl: 'https://zoom.us/j/2' });
  const snoozed = event({ id: 'snoozed', meetingUrl: 'https://zoom.us/j/3' });

  const dueEvents = getDueAlertEvents([due, noLink, ignored, alerted, snoozed], NOW, {
    alertsEnabled: true,
    alertMinutesBefore: 5,
    alertEventsWithoutLink: false,
    excludeAllDayEvents: false,
    ignoredEventIds: new Set(['ignored']),
    alertedEventIds: new Set(['alerted']),
    snoozedUntilByEventId: new Map([['snoozed', NOW + 60]]),
  });

  assert.deepStrictEqual(
    dueEvents.map((candidate) => candidate.id),
    ['due'],
  );
});

test('meetingClock — due alerts can include events without meeting URLs when enabled', () => {
  const noLink = event({ id: 'no-link' });

  const dueEvents = getDueAlertEvents([noLink], NOW, {
    alertsEnabled: true,
    alertMinutesBefore: 5,
    alertEventsWithoutLink: true,
    excludeAllDayEvents: false,
  });

  assert.deepStrictEqual(
    dueEvents.map((candidate) => candidate.id),
    ['no-link'],
  );
});
