import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseEvolutionReminderEntry } from '~/panel/clock/calendarReminders/evolutionReminderParser.ts';

function reminder(ics: string, alarm = 'alarm-1\trecurrence-1'): string {
  return ['source-1', alarm, '1700000000', '1700000060', '1700003660', ics].join('\n');
}

test('evolutionReminderParser: parses identity, escaped text and folded titles', () => {
  const event = parseEvolutionReminderEntry(
    reminder(
      ['BEGIN:VEVENT', 'UID:event-1', 'SUMMARY:Planning\\,', '  weekly', 'END:VEVENT'].join('\r\n'),
    ),
  );

  assert.ok(event);
  assert.equal(event.id, 'source-1\nalarm-1\trecurrence-1\n1700000000');
  assert.equal(event.calendarUuid, 'source-1:event-1');
  assert.equal(event.title, 'Planning, weekly');
  assert.equal(event.triggerEpochSeconds, 1700000000);
  assert.equal(event.startEpochSeconds, 1700000060);
  assert.equal(event.endEpochSeconds, 1700003660);
});

test('evolutionReminderParser: rejects malformed reminders', () => {
  assert.equal(parseEvolutionReminderEntry('broken'), null);
  assert.equal(parseEvolutionReminderEntry(reminder('SUMMARY:Missing UID')), null);
  assert.equal(
    parseEvolutionReminderEntry(
      ['source-1', 'alarm-1', 'bad-trigger', '12', '13', 'UID:x'].join('\n'),
    ),
    null,
  );
});

test('evolutionReminderParser: distinguishes repeated alarms by trigger', () => {
  const first = parseEvolutionReminderEntry(reminder('UID:event-4'));
  const second = parseEvolutionReminderEntry(
    [
      'source-1',
      'alarm-1\trecurrence-1',
      '1700000030',
      '1700000060',
      '1700003660',
      'UID:event-4',
    ].join('\n'),
  );

  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first.id, second.id);
});
