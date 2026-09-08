import type { CalendarEvent } from './calendarRemindersLogic.ts';

function readIcsText(ics: string, name: string): string {
  const match = ics.match(new RegExp(`^${name}(?:;[^:]*)?:(.*)$`, 'm'));
  const text = match && match[1] ? match[1] : '';
  return text
    .replace(/\\n/gi, ' ')
    .replace(/\\([,;\\])/g, '$1')
    .trim();
}

export type EvolutionReminderEvent = CalendarEvent & { triggerEpochSeconds: number };

export function parseEvolutionReminderEntry(entry: string): EvolutionReminderEvent | null {
  const parts = entry.split('\n');
  if (parts.length < 6) return null;

  const sourceId = parts[0] ? parts[0].trim() : '';
  const alarmId = parts[1] ? parts[1].trim() : '';
  if (!sourceId || !alarmId || !parts[2] || !parts[3]) return null;

  const trigger = Number(parts[2]);
  const start = Number(parts[3]);
  const end = Number(parts[4]);
  if (!Number.isFinite(trigger) || !Number.isFinite(start)) return null;

  const ics = parts
    .slice(5)
    .join('\n')
    .replace(/\r?\n[ \t]/g, '');
  const uid = readIcsText(ics, 'UID');
  if (!uid) return null;

  const event: EvolutionReminderEvent = {
    id: `${sourceId}\n${alarmId}\n${trigger}`,
    triggerEpochSeconds: trigger,
    calendarUuid: `${sourceId}:${uid}`,
    title: readIcsText(ics, 'SUMMARY'),
    startEpochSeconds: start,
    endEpochSeconds: parts[4] && Number.isFinite(end) ? end : start,
    sourceId,
    sourceName: 'Calendar',
    isAllDay: false,
  };
  return event;
}
