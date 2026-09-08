import '@girs/gjs';

import GLib from '@girs/glib-2.0';
import type St from '@girs/st-18';

import { LifecycleScope, type ManagedSource } from '~/core/lifecycleScope.ts';
import { createManagedSource } from '~/core/mainLoop.ts';
import type { SettingsManager } from '~/core/settings.ts';
import {
  createDevToolActionButton,
  createDevToolActionRow,
  createDevToolModulePanel,
  createDevToolSummary,
} from '~/dev/devToolUi.ts';
import type { Module } from '~/module.ts';
import { CalendarReminders } from '~/panel/clock/calendarReminders/calendarReminders.ts';
import type { CalendarEvent } from '~/panel/clock/calendarReminders/calendarRemindersLogic.ts';

const DEVTOOL_SOURCE_KEY = 'aurora-devtool';

export class CalendarRemindersDevTool {
  readonly key = 'calendar-reminders';
  readonly title = 'Calendar Reminders';
  readonly iconName = 'x-office-calendar-symbolic';

  private _events: CalendarEvent[] = [];
  private _withReminder = true;
  private _lifecycle = new LifecycleScope();
  private _reminderTimers = new Set<ManagedSource>();

  constructor(
    private readonly _settings: SettingsManager,
    private readonly _getModule: (key: string) => Module | null,
    private readonly _requestMenuRebuild: () => void,
  ) {
    this._lifecycle.connect(_settings, 'changed::calendar-reminders-alerts-enabled', () => {
      if (!_settings.getBoolean('calendar-reminders-alerts-enabled')) this._clearReminderTimers();
    });
    this._lifecycle.connect(_settings, 'changed::module-calendar-reminders', () => {
      if (!_settings.getBoolean('module-calendar-reminders')) this.clearEvents();
    });
  }

  buildPanel(): St.Widget {
    const calendarReminders = this._getCalendarReminders();
    const panel = createDevToolModulePanel();
    panel.add_child(
      createDevToolSummary(
        this.iconName,
        calendarReminders
          ? `${this._events.length} fake events, ${calendarReminders.eventCount} available`
          : 'Calendar Reminders disabled',
      ),
    );

    const firstRow = createDevToolActionRow();
    firstRow.add_child(
      createDevToolActionButton(
        'appointment-new-symbolic',
        'Add Soon',
        () => this.addSoonEvent(),
        !calendarReminders,
      ),
    );
    firstRow.add_child(
      createDevToolActionButton(
        'media-playback-start-symbolic',
        'Add Now',
        () => this.addCurrentEvent(),
        !calendarReminders,
      ),
    );
    panel.add_child(firstRow);

    const secondRow = createDevToolActionRow();
    secondRow.add_child(
      createDevToolActionButton(
        'alarm-symbolic',
        'With Reminder',
        () => this.setWithReminder(!this._withReminder),
        !calendarReminders,
        this._withReminder,
      ),
    );
    secondRow.add_child(
      createDevToolActionButton(
        'dialog-warning-symbolic',
        'Trigger Alert',
        () => this.triggerAlert(),
        !calendarReminders,
      ),
    );
    panel.add_child(secondRow);

    const thirdRow = createDevToolActionRow();
    thirdRow.add_child(
      createDevToolActionButton(
        'document-open-symbolic',
        'Open Calendar',
        () => this.openCalendar(),
        !calendarReminders,
      ),
    );
    thirdRow.add_child(
      createDevToolActionButton(
        'user-trash-symbolic',
        'Clear Fake',
        () => this.clearEvents(),
        !calendarReminders || this._events.length === 0,
      ),
    );
    panel.add_child(thirdRow);

    return panel;
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
    this._requestMenuRebuild();
  }

  triggerAlert(): boolean {
    const calendarReminders = this._getCalendarReminders();
    const event = this._events[0];
    if (!calendarReminders || !event) return false;

    const triggered = calendarReminders.showAlert(event.id);
    this._requestMenuRebuild();
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
    this._requestMenuRebuild();
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
    this._requestMenuRebuild();
    return id;
  }

  private _clearReminderTimers(): void {
    for (const timer of this._reminderTimers) timer.clear();
    this._reminderTimers.clear();
  }
}
