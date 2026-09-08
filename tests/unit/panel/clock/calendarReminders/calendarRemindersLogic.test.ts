import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  derivePanelPresentation,
  getStartReminderEvents,
  getStartReminderId,
  normalizeCalendarServerEvent,
  type CalendarEvent,
} from '~/panel/clock/calendarReminders/calendarRemindersLogic.ts';

const NOW = 1_700_000_000;

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'event-1',
    title: 'Planning',
    startEpochSeconds: NOW + 300,
    endEpochSeconds: NOW + 1800,
    sourceId: 'calendar-1',
    sourceName: 'Calendar',
    isAllDay: false,
    ...overrides,
  };
}

test('calendarReminders: normalizes CalendarServer identity and times', () => {
  const normalized = normalizeCalendarServerEvent([
    'calendar-1\nevent-1\nrecurrence-1',
    'Daily Sync',
    NOW + 60,
    NOW + 1800,
    {
      'source-uid': 'calendar-1',
      'source-name': 'Work',
    },
  ]);

  assert.ok(normalized);
  assert.strictEqual(normalized.title, 'Daily Sync');
  assert.strictEqual(normalized.sourceId, 'calendar-1');
  assert.strictEqual(normalized.sourceName, 'Work');
  assert.strictEqual(normalized.calendarUuid, 'calendar-1:event-1');
  assert.strictEqual(normalized.startEpochSeconds, NOW + 60);
});

test('calendarReminders: start reminders exclude stale, ended and all-day events', () => {
  const events = [
    event({ id: 'future', startEpochSeconds: NOW + 60 }),
    event({ id: 'stale', startEpochSeconds: NOW - 61 }),
    event({ id: 'boundary', startEpochSeconds: NOW - 60 }),
    event({ id: 'now', startEpochSeconds: NOW }),
    event({ id: 'simultaneous', startEpochSeconds: NOW }),
    event({ id: 'ended', startEpochSeconds: NOW - 30, endEpochSeconds: NOW }),
    event({ id: 'all-day', startEpochSeconds: NOW, isAllDay: true }),
  ];

  assert.deepEqual(
    getStartReminderEvents(events, NOW).map((item) => item.id),
    ['boundary', 'now', 'simultaneous', 'future'],
  );
  assert.equal(events[0].id, 'future');
});

test('calendarReminders: start reminder identity tracks occurrences and rescheduling', () => {
  const first = event();
  assert.equal(getStartReminderId(first), getStartReminderId({ ...first, title: 'Renamed' }));
  assert.notEqual(
    getStartReminderId(first),
    getStartReminderId({ ...first, startEpochSeconds: first.startEpochSeconds + 60 }),
  );
  assert.notEqual(getStartReminderId(first), getStartReminderId({ ...first, id: 'another' }));
});

test('calendarReminders: excludes all-day events from panel presentation when configured', () => {
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

test('calendarReminders: panel presentation uses in-progress event before future event', () => {
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

test('calendarReminders: panel presentation hides future events beyond configured lookahead', () => {
  const presentation = derivePanelPresentation(
    [event({ id: 'later', title: 'Much Later', startEpochSeconds: NOW + 7200 })],
    NOW,
    { excludeAllDayEvents: false, maxFutureSeconds: 3600 },
  );

  assert.strictEqual(presentation, null);
});

test('calendarReminders: panel presentation uses compact time without parentheses', () => {
  const presentation = derivePanelPresentation(
    [event({ id: 'soon', title: 'Soon', startEpochSeconds: NOW + 900 })],
    NOW,
    { excludeAllDayEvents: false, maxFutureSeconds: 3600 },
  );

  assert.ok(presentation);
  assert.strictEqual(presentation.label, 'Soon · 15m');
});
