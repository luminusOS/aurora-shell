import '@girs/gjs';
import GLib from '@girs/glib-2.0';

import type { ExtensionContext } from '~/core/context.ts';
import { LifecycleScope, type ManagedSource } from '~/core/lifecycleScope.ts';
import { createManagedSource } from '~/core/mainLoop.ts';
import { Module } from '~/module.ts';
import { openClockMenu } from '~/shared/clockPill.ts';

import { CalendarServerBackend } from './calendarServerBackend.ts';
import { EvolutionReminderBackend } from './evolutionReminderBackend.ts';
import { CalendarReminderController } from './calendarReminderController.ts';
import { CalendarRemindersPill } from './calendarRemindersPill.ts';
import {
  derivePanelPresentation,
  getStartReminderEvents,
  getStartReminderId,
  type CalendarEvent,
} from './calendarRemindersLogic.ts';

const ALERTS_ENABLED_KEY = 'calendar-reminders-alerts-enabled';
const FORCE_REMINDERS_KEY = 'calendar-reminders-force-reminders';
const SNOOZE_MINUTES_KEY = 'calendar-reminders-snooze-minutes';
const PANEL_REVEAL_INTERVAL_MINUTES_KEY = 'calendar-reminders-panel-reveal-interval-minutes';
const PANEL_LOOKAHEAD_MINUTES_KEY = 'calendar-reminders-panel-lookahead-minutes';
const EXCLUDE_ALL_DAY_KEY = 'calendar-reminders-exclude-all-day-events';
const REFRESH_WINDOW_HOURS = 24;
const REFRESH_INTERVAL_SECONDS = 180;
const LABEL_REFRESH_SECONDS = 30;
const CALENDAR_SERVER_SOURCE_KEY = 'calendar-server';

export class CalendarReminders extends Module {
  private _backend: CalendarServerBackend | null = null;
  private _reminderBackend: EvolutionReminderBackend | null = null;
  private _eventsBySource = new Map<string, CalendarEvent[]>();
  private _events: CalendarEvent[] = [];
  private _pill: CalendarRemindersPill | null = null;
  private _alerts: CalendarReminderController | null = null;
  private _lifecycle: LifecycleScope | null = null;
  private _panelRevealTimer: ManagedSource | null = null;
  private _startReminderTimer: ManagedSource | null = null;
  private _notifiedStarts = new Map<string, number>();

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this.disable();
    const lifecycle = new LifecycleScope();
    const refreshTimer = createManagedSource(lifecycle);
    const labelTimer = createManagedSource(lifecycle);
    const panelRevealTimer = createManagedSource(lifecycle);
    const pill = new CalendarRemindersPill(lifecycle);
    const alerts = new CalendarReminderController({
      getSnoozeMinutes: () => this.context.settings.getInt(SNOOZE_MINUTES_KEY),
      onStateChanged: () => this._render(),
    });
    this._lifecycle = lifecycle;
    this._panelRevealTimer = panelRevealTimer;
    this._startReminderTimer = createManagedSource(lifecycle);
    this._pill = pill;
    this._alerts = alerts;

    const reminderBackend = new EvolutionReminderBackend(
      (event) => {
        if (this._reminderBackend === reminderBackend) this.showReminder(event);
      },
      () => this._now(),
    );
    this._reminderBackend = reminderBackend;
    this._syncReminderBackend();

    const backend = new CalendarServerBackend((events) => {
      if (this._backend !== backend) return;
      this.setSourceEvents(CALENDAR_SERVER_SOURCE_KEY, events);
    });
    this._backend = backend;
    backend.start();
    backend.refresh(REFRESH_WINDOW_HOURS);

    refreshTimer.replace(() =>
      GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_INTERVAL_SECONDS, () => {
        backend.refresh(REFRESH_WINDOW_HOURS);
        return GLib.SOURCE_CONTINUE;
      }),
    );
    labelTimer.replace(() =>
      GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, LABEL_REFRESH_SECONDS, () => {
        this._render();
        this._syncStartReminders();
        return GLib.SOURCE_CONTINUE;
      }),
    );
    this._schedulePanelRevealTimer();

    const settings = this.context.settings;
    lifecycle.connect(settings, `changed::${ALERTS_ENABLED_KEY}`, () =>
      this._syncReminderBackend(),
    );
    lifecycle.connect(settings, `changed::${FORCE_REMINDERS_KEY}`, () =>
      this._syncStartReminders(),
    );
    lifecycle.connect(settings, `changed::${PANEL_REVEAL_INTERVAL_MINUTES_KEY}`, () =>
      this._schedulePanelRevealTimer(),
    );
    lifecycle.connect(settings, `changed::${PANEL_LOOKAHEAD_MINUTES_KEY}`, () => this._render());
    lifecycle.connect(settings, `changed::${EXCLUDE_ALL_DAY_KEY}`, () => {
      this._render();
    });
  }

  override disable(): void {
    this._lifecycle?.dispose();
    this._lifecycle = null;
    this._panelRevealTimer = null;
    this._startReminderTimer = null;
    this._notifiedStarts.clear();

    this._backend?.stop();
    this._backend = null;

    this._reminderBackend?.stop();
    this._reminderBackend = null;

    this._alerts?.destroy();
    this._alerts = null;

    this._eventsBySource.clear();
    this._events = [];

    this._pill?.destroy();
    this._pill = null;
  }

  setSourceEvents(sourceKey: string, events: readonly CalendarEvent[]): void {
    if (!this._lifecycle || !this._alerts) return;

    const nextEvents = [...events];
    const nextStarts = new Map(nextEvents.map((event) => [event.id, event.startEpochSeconds]));
    const removedEvents = this.getSourceEvents(sourceKey).filter(
      (event) => nextStarts.get(event.id) !== event.startEpochSeconds,
    );

    this._eventsBySource.set(sourceKey, nextEvents);
    this._alerts.clearEventState(removedEvents);
    this._syncEvents();
  }

  clearSourceEvents(sourceKey: string): void {
    const removedEvents = this.getSourceEvents(sourceKey);
    this._eventsBySource.delete(sourceKey);
    if (this._alerts) this._alerts.clearEventState(removedEvents);

    this._syncEvents();
  }

  getSourceEvents(sourceKey: string): CalendarEvent[] {
    const events = this._eventsBySource.get(sourceKey);
    if (!events) return [];

    return [...events];
  }

  showAlert(eventId: string | null = null): boolean {
    if (!this._alerts || !this.context.settings.getBoolean(ALERTS_ENABLED_KEY)) return false;

    return this._alerts.show(eventId);
  }

  showReminder(event: CalendarEvent): boolean {
    if (!this._alerts || !this.context.settings.getBoolean(ALERTS_ENABLED_KEY)) return false;

    this._alerts.showEvent(event);
    return true;
  }

  openMenu(): boolean {
    if (!this._lifecycle || !this._pill) {
      return false;
    }

    this._render();
    return openClockMenu();
  }

  get eventCount(): number {
    return this._events.length;
  }

  get activeAlertEventId(): string | null {
    if (!this._alerts) return null;

    return this._alerts.activeEventId;
  }

  private _render(): void {
    if (!this._lifecycle || !this._pill) return;

    const now = this._now();
    const excludeAllDayEvents = this.context.settings.getBoolean(EXCLUDE_ALL_DAY_KEY);
    const presentation = derivePanelPresentation(this._events, now, {
      excludeAllDayEvents,
      maxFutureSeconds: this._getPanelLookaheadSeconds(),
    });

    if (!presentation) {
      this._pill.setPresentation(null);
      return;
    }

    this._pill.setPresentation(presentation.event.id, presentation.label);
  }

  private _schedulePanelRevealTimer(): void {
    const pill = this._pill;
    const panelRevealTimer = this._panelRevealTimer;
    if (!this._lifecycle || !pill || !panelRevealTimer) return;

    const intervalSeconds =
      Math.max(1, this.context.settings.getInt(PANEL_REVEAL_INTERVAL_MINUTES_KEY)) * 60;

    panelRevealTimer.replace(() =>
      GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, intervalSeconds, () => {
        pill.reveal();
        return GLib.SOURCE_CONTINUE;
      }),
    );
  }

  private _getPanelLookaheadSeconds(): number {
    return Math.max(0, this.context.settings.getInt(PANEL_LOOKAHEAD_MINUTES_KEY)) * 60;
  }

  private _syncReminderBackend(): void {
    this._syncStartReminders();
    if (this.context.settings.getBoolean(ALERTS_ENABLED_KEY)) {
      this._reminderBackend?.start();
      return;
    }

    this._reminderBackend?.stop();
    this._alerts?.clear();
  }

  private _now(): number {
    return Math.floor(Date.now() / 1000);
  }

  private _syncEvents(): void {
    this._events = [...this._eventsBySource.values()]
      .flat()
      .sort((a, b) => a.startEpochSeconds - b.startEpochSeconds);
    this._render();
    if (this._alerts) this._alerts.setEvents(this._events);
    this._syncStartReminders();
  }

  private _syncStartReminders(): void {
    if (!this._startReminderTimer) return;

    this._startReminderTimer.clear();
    if (
      !this.context.settings.getBoolean(ALERTS_ENABLED_KEY) ||
      !this.context.settings.getBoolean(FORCE_REMINDERS_KEY)
    ) {
      return;
    }

    const now = this._now();
    for (const [id, end] of this._notifiedStarts) {
      if (end <= now) this._notifiedStarts.delete(id);
    }

    for (const event of getStartReminderEvents(this._events, now)) {
      const id = getStartReminderId(event);
      if (this._notifiedStarts.has(id)) continue;

      if (event.startEpochSeconds <= now) {
        this._notifiedStarts.set(id, event.endEpochSeconds);
        this.showReminder({ ...event, id });
        continue;
      }

      this._startReminderTimer.replace(() =>
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, event.startEpochSeconds - now, () => {
          if (!this._startReminderTimer) return GLib.SOURCE_REMOVE;

          this._startReminderTimer.complete();
          this._syncStartReminders();
          return GLib.SOURCE_REMOVE;
        }),
      );
      break;
    }
  }
}
