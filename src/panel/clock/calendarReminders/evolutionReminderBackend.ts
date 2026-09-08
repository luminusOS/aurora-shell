import '@girs/gjs';

import Gio from '@girs/gio-2.0';

import { logger } from '~/core/logger.ts';

import type { CalendarEvent } from './calendarRemindersLogic.ts';
import { parseEvolutionReminderEntry } from './evolutionReminderParser.ts';

const LOG_PREFIX = 'CalendarReminders';
const EDS_SCHEMA_ID = 'org.gnome.evolution-data-server.calendar';
const REMINDERS_KEY = 'reminders-past';
const DISPLAY_KEY = 'notify-enable-display';
const STALE_SECONDS = 60 * 60;

export class EvolutionReminderBackend {
  private _settings: Gio.Settings | null = null;
  private _changedId = 0;
  private _previousDisplay = true;
  private _seen = new Map<string, number>();

  constructor(
    private _onReminder: (event: CalendarEvent) => void,
    private _now: () => number,
  ) {}

  start(): boolean {
    if (this._settings) return true;

    const schema = Gio.SettingsSchemaSource.get_default()?.lookup(EDS_SCHEMA_ID, true);
    if (!schema || !schema.has_key(REMINDERS_KEY) || !schema.has_key(DISPLAY_KEY)) {
      logger.warn(`${EDS_SCHEMA_ID} is unavailable; native reminders are disabled`, {
        prefix: LOG_PREFIX,
      });
      return false;
    }

    const settings = new Gio.Settings({ settings_schema: schema });
    this._previousDisplay = settings.get_boolean(DISPLAY_KEY);
    if (
      this._previousDisplay &&
      (!settings.is_writable(DISPLAY_KEY) ||
        !settings.set_boolean(DISPLAY_KEY, false) ||
        settings.get_boolean(DISPLAY_KEY))
    ) {
      logger.warn('Evolution display reminders could not be disabled', { prefix: LOG_PREFIX });
      return false;
    }

    this._settings = settings;
    this._seen.clear();
    this._changedId = settings.connect(`changed::${REMINDERS_KEY}`, () => this._consume());
    this._consume();
    return true;
  }

  stop(): void {
    const settings = this._settings;
    this._settings = null;
    if (!settings) return;

    if (this._changedId) settings.disconnect(this._changedId);
    this._changedId = 0;
    settings.set_boolean(DISPLAY_KEY, this._previousDisplay);
    this._seen.clear();
  }

  private _consume(): void {
    const settings = this._settings;
    if (!settings) return;

    const entries = settings.get_strv(REMINDERS_KEY);
    if (entries.length === 0) return;

    const now = this._now();
    for (const entry of entries) {
      const event = parseEvolutionReminderEntry(entry);
      if (!event || this._seen.has(event.id)) continue;

      this._seen.set(event.id, event.triggerEpochSeconds);
      if (now - event.triggerEpochSeconds > STALE_SECONDS) continue;
      this._onReminder(event);
    }

    for (const [eventId, trigger] of this._seen) {
      if (now - trigger > STALE_SECONDS) this._seen.delete(eventId);
    }

    settings.set_strv(REMINDERS_KEY, []);
  }
}
