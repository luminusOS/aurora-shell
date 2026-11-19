import GLib from 'gi://GLib';

import { LifecycleScope, type ManagedSource } from '~/core/lifecycleScope.ts';
import { createManagedSource } from '~/core/mainLoop.ts';
import type { SettingsManager } from '~/core/settings.ts';
import { action, type RuntimeAction } from './protocol.ts';
import type { Module } from '~/module.ts';
import { CalendarReminders } from '~/panel/clock/calendarReminders/calendarReminders.ts';
import type { CalendarEvent } from '~/panel/clock/calendarReminders/calendarRemindersLogic.ts';
import { gettext as _ } from '~/shared/i18n.ts';

const DEVTOOL_SOURCE_KEY = 'aurora-devtool';

export class CalendarRemindersDevTool {
  readonly key = 'calendar-reminders';
  readonly title = 'Calendar Reminders';

  private _events: CalendarEvent[] = [];
  private _withReminder = true;
  private _lifecycle = new LifecycleScope();
  private _reminderTimers = new Set<ManagedSource>();

  constructor(
    private readonly _settings: SettingsManager,
    private readonly _getModule: (key: string) => Module | null,
  ) {
    this._lifecycle.connect(_settings, 'changed::calendar-reminders-alerts-enabled', () => {
      if (!_settings.getBoolean('calendar-reminders-alerts-enabled')) this._clearReminderTimers();
    });
    this._lifecycle.connect(_settings, 'changed::module-calendar-reminders', () => {
      if (!_settings.getBoolean('module-calendar-reminders')) this.clearEvents();
    });
  }

  describe() {
    const calendarReminders = this._getCalendarReminders();
    const actions: RuntimeAction[] = [];
    const details: string[] = [];
    details.push(
      calendarReminders
        ? `${this._events.length} fake events, ${calendarReminders.eventCount} available`
        : 'Calendar Reminders disabled',
    );

    if (this._events.length) {
      for (const event of this._events) {
        const time = new Date(event.startEpochSeconds * 1000).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
        details.push(
          event.title + ': ' + `${time} · ${this._withReminder ? _('reminder') : _('no reminder')}`,
        );
      }
    }

    actions.push(action('addSoonEvent', 'Add Soon', () => this.addSoonEvent(), !calendarReminders));
    actions.push(
      action('addCurrentEvent', 'Add Now', () => this.addCurrentEvent(), !calendarReminders),
    );

    actions.push(
      action(
        'calendar-with-reminder',
        'With Reminder',
        () => this.setWithReminder(!this._withReminder),
        !calendarReminders,
        this._withReminder,
      ),
    );
    actions.push(
      action(
        'triggerAlert',
        'Trigger Alert',
        () => this.triggerAlert(),
        !calendarReminders || this._events.length === 0,
      ),
    );

    actions.push(
      action('openCalendar', 'Open Calendar', () => this.openCalendar(), !calendarReminders),
    );
    actions.push(
      action(
        'clearEvents',
        'Clear Fake',
        () => this.clearEvents(),
        !calendarReminders || this._events.length === 0,
      ),
    );

    return { details, actions };
  }

  destroy(): void {
    this.clearEvents();
    this._lifecycle.dispose();
  }

  addSoonEvent(): string | null {
    return this._addEvent('Dev event in 1 minute', 1);
  }

  addCurrentEvent(): string | null {
    return this._addEvent('Dev event now', 0);
  }

  setWithReminder(enabled: boolean): void {
    this._withReminder = enabled;
  }

  triggerAlert(): boolean {
    const calendarReminders = this._getCalendarReminders();
    const event = this._events[0];
    if (!calendarReminders || !event) return false;

    const triggered = calendarReminders.showAlert(event.id);
    return triggered;
  }

  openCalendar(): boolean {
    const calendarReminders = this._getCalendarReminders();
    if (!calendarReminders) return false;

    return calendarReminders.openMenu();
  }

  clearEvents(): void {
    this._clearReminderTimers();
    this._events = [];
    this._getCalendarReminders()?.clearSourceEvents(DEVTOOL_SOURCE_KEY);
  }

  get devEventCount(): number {
    return this._events.length;
  }

  get activeAlertEventId(): string | null {
    const calendarReminders = this._getCalendarReminders();
    if (!calendarReminders) return null;

    return calendarReminders.activeAlertEventId;
  }

  private _getCalendarReminders(): CalendarReminders | null {
    const module = this._getModule('calendar-reminders');
    return module instanceof CalendarReminders ? module : null;
  }

  private _addEvent(title: string, startsInMinutes: number): string | null {
    const calendarReminders = this._getCalendarReminders();
    if (!calendarReminders) return null;

    const now = Math.floor(Date.now() / 1000);
    const startEpochSeconds = now + Math.round(startsInMinutes * 60);
    const id = `aurora-dev-event-${GLib.uuid_string_random()}`;
    const event: CalendarEvent = {
      id,
      title,
      startEpochSeconds,
      endEpochSeconds: startEpochSeconds + 30 * 60,
      sourceId: DEVTOOL_SOURCE_KEY,
      sourceName: 'Aurora DevTool',
      isAllDay: false,
    };

    this._events = [...this._events, event];
    calendarReminders.setSourceEvents(DEVTOOL_SOURCE_KEY, this._events);
    if (this._withReminder && this._settings.getBoolean('calendar-reminders-alerts-enabled')) {
      if (startsInMinutes === 0) {
        calendarReminders.showReminder(event);
      } else {
        const timer = createManagedSource(this._lifecycle);
        this._reminderTimers.add(timer);
        timer.replace(() =>
          GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, startsInMinutes * 60, () => {
            timer.complete();
            this._reminderTimers.delete(timer);
            const activeModule = this._getCalendarReminders();
            if (
              activeModule &&
              activeModule.getSourceEvents(DEVTOOL_SOURCE_KEY).some((item) => item.id === event.id)
            ) {
              activeModule.showReminder(event);
            }
            return GLib.SOURCE_REMOVE;
          }),
        );
      }
    }
    return id;
  }

  private _clearReminderTimers(): void {
    for (const timer of this._reminderTimers) timer.clear();
    this._reminderTimers.clear();
  }
}
