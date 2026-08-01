import '@girs/gjs';
import GLib from '@girs/glib-2.0';

import type { ExtensionContext } from '~/core/context.ts';
import { LifecycleScope, type ManagedSource } from '~/core/lifecycleScope.ts';
import { createManagedSource } from '~/core/mainLoop.ts';
import { Module } from '~/module.ts';

import { CalendarServerBackend } from './calendarServerBackend.ts';
import { MeetingAlertController } from './meetingAlertController.ts';
import { MeetingClockPill } from './meetingClockPill.ts';
import { derivePanelPresentation, type MeetingEvent } from './meetingClockLogic.ts';

const ALERTS_ENABLED_KEY = 'meeting-clock-alerts-enabled';
const ALERT_MINUTES_KEY = 'meeting-clock-alert-minutes-before';
const SNOOZE_MINUTES_KEY = 'meeting-clock-snooze-minutes';
const ALERT_EVENTS_WITHOUT_LINK_KEY = 'meeting-clock-alert-events-without-link';
const PANEL_REVEAL_INTERVAL_MINUTES_KEY = 'meeting-clock-panel-reveal-interval-minutes';
const PANEL_LOOKAHEAD_MINUTES_KEY = 'meeting-clock-panel-lookahead-minutes';
const EXCLUDE_ALL_DAY_KEY = 'meeting-clock-exclude-all-day-events';
const REFRESH_WINDOW_HOURS = 24;
const REFRESH_INTERVAL_SECONDS = 180;
const LABEL_REFRESH_SECONDS = 30;
const CALENDAR_SERVER_SOURCE_KEY = 'calendar-server';

export class MeetingClock extends Module {
  private _backend: CalendarServerBackend | null = null;
  private _eventsBySource = new Map<string, MeetingEvent[]>();
  private _events: MeetingEvent[] = [];
  private _pill: MeetingClockPill | null = null;
  private _alerts: MeetingAlertController | null = null;
  private _lifecycle: LifecycleScope | null = null;
  private _panelRevealTimer: ManagedSource | null = null;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this.disable();
    const lifecycle = new LifecycleScope();
    const refreshTimer = createManagedSource(lifecycle);
    const labelTimer = createManagedSource(lifecycle);
    const panelRevealTimer = createManagedSource(lifecycle);
    const pill = new MeetingClockPill(lifecycle);
    const alerts = new MeetingAlertController({
      getPreferences: () => this._getAlertPreferences(),
      onStateChanged: () => this._render(),
      now: () => this._now(),
    });
    this._lifecycle = lifecycle;
    this._panelRevealTimer = panelRevealTimer;
    this._pill = pill;
    this._alerts = alerts;

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
        return GLib.SOURCE_CONTINUE;
      }),
    );
    this._schedulePanelRevealTimer();

    const settings = this.context.settings;
    lifecycle.connect(settings, `changed::${ALERTS_ENABLED_KEY}`, () => alerts.schedule());
    lifecycle.connect(settings, `changed::${ALERT_MINUTES_KEY}`, () => alerts.schedule());
    lifecycle.connect(settings, `changed::${SNOOZE_MINUTES_KEY}`, () => alerts.schedule());
    lifecycle.connect(settings, `changed::${ALERT_EVENTS_WITHOUT_LINK_KEY}`, () =>
      alerts.schedule(),
    );
    lifecycle.connect(settings, `changed::${PANEL_REVEAL_INTERVAL_MINUTES_KEY}`, () =>
      this._schedulePanelRevealTimer(),
    );
    lifecycle.connect(settings, `changed::${PANEL_LOOKAHEAD_MINUTES_KEY}`, () => this._render());
    lifecycle.connect(settings, `changed::${EXCLUDE_ALL_DAY_KEY}`, () => {
      this._render();
      alerts.schedule();
    });
  }

  override disable(): void {
    this._lifecycle?.dispose();
    this._lifecycle = null;
    this._panelRevealTimer = null;

    this._backend?.stop();
    this._backend = null;

    this._alerts?.destroy();
    this._alerts = null;

    this._eventsBySource.clear();
    this._events = [];

    this._pill?.destroy();
    this._pill = null;
  }

  setSourceEvents(sourceKey: string, events: readonly MeetingEvent[]): void {
    if (!this._lifecycle || !this._alerts) return;

    const previousIds = new Set(this._eventsBySource.get(sourceKey)?.map((event) => event.id));
    const nextEvents = [...events];

    for (const event of nextEvents) {
      previousIds.delete(event.id);
    }

    this._eventsBySource.set(sourceKey, nextEvents);
    this._alerts.clearEventState(previousIds);
    this._syncEvents();
  }

  clearSourceEvents(sourceKey: string): void {
    const removedIds = new Set(this._eventsBySource.get(sourceKey)?.map((event) => event.id));
    this._eventsBySource.delete(sourceKey);
    if (this._alerts) this._alerts.clearEventState(removedIds);

    this._syncEvents();
  }

  getSourceEvents(sourceKey: string): MeetingEvent[] {
    return [...(this._eventsBySource.get(sourceKey) ?? [])];
  }

  showAlert(eventId: string | null = null): boolean {
    if (!this._alerts) return false;

    return this._alerts.show(eventId);
  }

  openMenu(): boolean {
    if (!this._lifecycle || !this._pill) {
      return false;
    }

    this._render();
    return this._pill.openMenu();
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

  private _getAlertPreferences() {
    return {
      alertsEnabled: this.context.settings.getBoolean(ALERTS_ENABLED_KEY),
      alertMinutesBefore: this.context.settings.getInt(ALERT_MINUTES_KEY),
      alertEventsWithoutLink: this.context.settings.getBoolean(ALERT_EVENTS_WITHOUT_LINK_KEY),
      excludeAllDayEvents: this.context.settings.getBoolean(EXCLUDE_ALL_DAY_KEY),
      snoozeMinutes: this.context.settings.getInt(SNOOZE_MINUTES_KEY),
    };
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
  }
}
