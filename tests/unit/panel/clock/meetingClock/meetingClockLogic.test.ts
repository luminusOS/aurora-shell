import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  derivePanelPresentation,
  extractMeetingUrl,
  getDueAlertEvents,
  getNextAlertEpoch,
  normalizeCalendarServerEvent,
  type MeetingEvent,
} from '~/panel/clock/meetingClock/meetingClockLogic.ts';

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

test('meetingClock — calculates the next alert across lead time and snooze state', () => {
  const now = 1_000;
  const first = event({
    id: 'first',
    startEpochSeconds: 1_900,
    endEpochSeconds: 2_200,
    meetingUrl: 'https://meet.example/first',
  });
  const second = event({
    id: 'second',
    startEpochSeconds: 2_500,
    endEpochSeconds: 2_800,
    meetingUrl: 'https://meet.example/second',
  });
  const next = getNextAlertEpoch([second, first], now, {
    alertsEnabled: true,
    alertMinutesBefore: 10,
    alertEventsWithoutLink: false,
    excludeAllDayEvents: false,
    snoozedUntilByEventId: new Map([['first', 1_450]]),
  });
  assert.equal(next, 1_450);
});

test('meetingClock — prefers video meeting URLs over generic links', () => {
  const url = extractMeetingUrl({
    description: 'Notes: https://example.com Agenda: https://zoom.us/j/12345',
  });

  assert.strictEqual(url, 'https://zoom.us/j/12345');
});

test('meetingClock — prefers a meeting URL from the description over an earlier generic URL', () => {
  const url = extractMeetingUrl({
    url: 'https://calendar.example.com/event/12345',
    description: 'Join: https://teams.microsoft.com/meet/247507021276381?p=ExamplePasscode',
  });

  assert.strictEqual(url, 'https://teams.microsoft.com/meet/247507021276381?p=ExamplePasscode');
});

test('meetingClock — restores wrapped Microsoft Teams meeting URLs', () => {
  const url = extractMeetingUrl({
    description: [
      'Microsoft Teams meeting',
      'Join: https://teams.microsoft.com/meet/247507021276381?',
      'p=ExamplePasscode',
      'Meeting ID: 247 507 021 276 381',
    ].join('\n'),
  });

  assert.strictEqual(url, 'https://teams.microsoft.com/meet/247507021276381?p=ExamplePasscode');
});

test('meetingClock — restores wrapped angle-bracket meeting URLs', () => {
  const url = extractMeetingUrl({
    description: [
      'System reference <https://teams.microsoft.com/l/meetup-join/',
      '19%3ameeting_example%40thread.v2/0?context=%7b%22Tid%22%3a%22tenant%22%7d>',
    ].join('\n'),
  });

  assert.strictEqual(
    url,
    'https://teams.microsoft.com/l/meetup-join/19%3ameeting_example%40thread.v2/0?context=%7b%22Tid%22%3a%22tenant%22%7d',
  );
});

test('meetingClock — restores wrapped Zoom meeting IDs and query parameters', () => {
  const url = extractMeetingUrl({
    description: [
      'Join: https://us06web.zoom.us/j/12345678',
      '901?',
      'pwd=',
      'ExampleSecret&',
      'omn=12345678901',
      'Meeting ID: 123 4567 890',
    ].join('\n'),
  });

  assert.strictEqual(
    url,
    'https://us06web.zoom.us/j/12345678901?pwd=ExampleSecret&omn=12345678901',
  );

  const urlWithoutQuery = extractMeetingUrl({
    description: ['Join: https://zoom.us/j/12345', '67890', 'Meeting ID: 123 4567 890'].join('\n'),
  });

  assert.strictEqual(urlWithoutQuery, 'https://zoom.us/j/1234567890');
});

test('meetingClock — restores wrapped Google Meet codes and query parameters', () => {
  const url = extractMeetingUrl({
    description: [
      'Join: https://meet.google.com/abc-',
      'defg-hij?',
      'authuser=0',
      'Meeting code: abc-defg-hij',
    ].join('\n'),
  });

  assert.strictEqual(url, 'https://meet.google.com/abc-defg-hij?authuser=0');
});

test('meetingClock — restores wrapped meeting URLs without provider-specific rules', () => {
  const url = extractMeetingUrl({
    description: [
      'Join: https://calls.example.org/rooms/session-',
      'alpha?',
      'token=ExampleSecret&',
      'mode=guest',
    ].join('\n'),
  });

  assert.strictEqual(
    url,
    'https://calls.example.org/rooms/session-alpha?token=ExampleSecret&mode=guest',
  );
});

test('meetingClock — matches video providers by hostname rather than hostname-like text', () => {
  const url = extractMeetingUrl({
    description: [
      'Misleading: https://zoom.us.example.org/j/12345',
      'Join: https://meet.google.com/abc-defg-hij',
    ].join('\n'),
  });

  assert.strictEqual(url, 'https://meet.google.com/abc-defg-hij');
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
