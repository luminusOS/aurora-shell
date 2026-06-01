import '@girs/gjs';
import { gettext as _ } from 'gettext';

import Clutter from '@girs/clutter-18';
import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import St from '@girs/st-18';
import * as Main from '@girs/gnome-shell/ui/main';
import * as MessageTray from '@girs/gnome-shell/ui/messageTray';
import { PopupAnimation } from '@girs/gnome-shell/ui/boxpointer';

import type { ExtensionContext } from '~/core/context.ts';
import { logger } from '~/core/logger.ts';
import { Module } from '~/module.ts';
import type { ModuleDefinition } from '~/module.ts';

import { CalendarServerBackend } from './calendarServerBackend.ts';
import {
  derivePanelPresentation,
  filterDisplayEvents,
  formatEventTime,
  getDueAlertEvents,
  type MeetingEvent,
} from './meetingClockLogic.ts';

const LOG_PREFIX = 'MeetingClock';
const ALERTS_ENABLED_KEY = 'meeting-clock-alerts-enabled';
const ALERT_MINUTES_KEY = 'meeting-clock-alert-minutes-before';
const SNOOZE_MINUTES_KEY = 'meeting-clock-snooze-minutes';
const EXCLUDE_ALL_DAY_KEY = 'meeting-clock-exclude-all-day-events';
const REFRESH_WINDOW_HOURS = 24;
const REFRESH_INTERVAL_SECONDS = 180;
const LABEL_REFRESH_SECONDS = 30;
const CALENDAR_SERVER_SOURCE_KEY = 'calendar-server';
const PANEL_LOOKAHEAD_SECONDS = 60 * 60;

type DateMenuButton = {
  _clockDisplay: St.Label;
  menu: {
    open(animation?: PopupAnimation): void;
  };
};

export class MeetingClock extends Module {
  private _backend: CalendarServerBackend | null = null;
  private _eventsBySource = new Map<string, MeetingEvent[]>();
  private _events: MeetingEvent[] = [];
  private _dateMenu: DateMenuButton | null = null;
  private _originalClockDisplay: St.Label | null = null;
  private _topBox: St.BoxLayout | null = null;
  private _panelWidget: St.BoxLayout | null = null;
  private _panelLabel: St.Label | null = null;
  private _notificationSource: MessageTray.Source | null = null;
  private _activeNotification: MessageTray.Notification | null = null;
  private _uiAlive = false;
  private _enabled = false;
  private _settingsIds: number[] = [];
  private _refreshTimerId = 0;
  private _labelTimerId = 0;
  private _alertTimerId = 0;
  private _activeAlertEventId: string | null = null;
  private _alertedEventIds = new Set<string>();
  private _ignoredEventIds = new Set<string>();
  private _snoozedUntilByEventId = new Map<string, number>();

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this.disable();
    this._enabled = true;

    this._dateMenu = Main.panel.statusArea.dateMenu as unknown as DateMenuButton;
    this._installClockWidget();

    this._backend = new CalendarServerBackend((events) => {
      if (!this._enabled) return;
      this.setSourceEvents(CALENDAR_SERVER_SOURCE_KEY, events);
    });
    this._backend.start();
    this._refreshEvents();

    this._refreshTimerId = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      REFRESH_INTERVAL_SECONDS,
      () => {
        this._refreshEvents();
        return GLib.SOURCE_CONTINUE;
      },
    );
    this._labelTimerId = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      LABEL_REFRESH_SECONDS,
      () => {
        this._render();
        return GLib.SOURCE_CONTINUE;
      },
    );

    const settings = this.context.settings;
    this._settingsIds = [
      settings.connect(`changed::${ALERTS_ENABLED_KEY}`, () => this._scheduleAlerts()),
      settings.connect(`changed::${ALERT_MINUTES_KEY}`, () => this._scheduleAlerts()),
      settings.connect(`changed::${SNOOZE_MINUTES_KEY}`, () => this._scheduleAlerts()),
      settings.connect(`changed::${EXCLUDE_ALL_DAY_KEY}`, () => {
        this._render();
        this._scheduleAlerts();
      }),
    ];
  }

  override disable(): void {
    this._enabled = false;
    this._uiAlive = false;

    for (const id of this._settingsIds) this.context.settings.disconnect(id);
    this._settingsIds = [];

    this._clearTimer('_refreshTimerId');
    this._clearTimer('_labelTimerId');
    this._clearTimer('_alertTimerId');

    this._backend?.stop();
    this._backend = null;
    this._activeAlertEventId = null;
    this._destroyActiveNotification(MessageTray.NotificationDestroyedReason.SOURCE_CLOSED);
    this._notificationSource?.destroy(MessageTray.NotificationDestroyedReason.SOURCE_CLOSED);
    this._notificationSource = null;
    this._eventsBySource.clear();
    this._events = [];
    this._activeAlertEventId = null;
    this._alertedEventIds.clear();
    this._ignoredEventIds.clear();
    this._snoozedUntilByEventId.clear();

    this._panelWidget?.destroy();
    this._panelWidget = null;
    this._panelLabel = null;

    this._restoreClockWidget();
    this._dateMenu = null;
  }

  private _installClockWidget(): void {
    const dateMenu = this._dateMenu;
    if (!dateMenu) return;

    this._originalClockDisplay = dateMenu._clockDisplay;
    const clockParent = this._originalClockDisplay.get_parent();
    if (!clockParent) return;

    this._topBox = new St.BoxLayout({
      style_class: 'clock aurora-meeting-clock-box',
      y_align: Clutter.ActorAlign.CENTER,
      y_expand: true,
    });
    this._originalClockDisplay.remove_style_class_name('clock');

    this._panelWidget = new St.BoxLayout({
      style_class: 'aurora-meeting-clock-widget',
      y_align: Clutter.ActorAlign.CENTER,
      y_expand: true,
      visible: false,
      reactive: false,
    });
    const icon = new St.Icon({
      icon_name: 'x-office-calendar-symbolic',
      style_class: 'aurora-meeting-clock-icon',
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._panelLabel = new St.Label({
      style_class: 'clock-label aurora-meeting-clock-label',
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._panelWidget.add_child(this._panelLabel);
    this._panelWidget.add_child(icon);

    clockParent.replace_child(this._originalClockDisplay, this._topBox);
    this._topBox.add_child(this._originalClockDisplay);
    this._topBox.add_child(this._panelWidget);
    this._uiAlive = true;
  }

  private _restoreClockWidget(): void {
    if (!this._originalClockDisplay || !this._topBox) {
      this._originalClockDisplay = null;
      this._topBox = null;
      return;
    }

    const topBoxParent = this._topBox.get_parent();
    if (this._originalClockDisplay.get_parent() === this._topBox) {
      this._topBox.remove_child(this._originalClockDisplay);
    }
    this._originalClockDisplay.add_style_class_name('clock');
    topBoxParent?.replace_child(this._topBox, this._originalClockDisplay);
    this._topBox.destroy();
    this._topBox = null;
    this._originalClockDisplay = null;
  }

  private _refreshEvents(): void {
    this._backend?.refresh(REFRESH_WINDOW_HOURS);
  }

  setSourceEvents(sourceKey: string, events: readonly MeetingEvent[]): void {
    if (!this._enabled) return;

    const previousIds = new Set(this._eventsBySource.get(sourceKey)?.map((event) => event.id));
    const nextEvents = [...events];
    for (const event of nextEvents) previousIds.delete(event.id);
    this._eventsBySource.set(sourceKey, nextEvents);
    this._clearAlertState(previousIds);
    this._syncEvents();
  }

  clearSourceEvents(sourceKey: string): void {
    const removedIds = new Set(this._eventsBySource.get(sourceKey)?.map((event) => event.id));
    this._eventsBySource.delete(sourceKey);
    this._clearAlertState(removedIds);
    this._syncEvents();
  }

  getSourceEvents(sourceKey: string): MeetingEvent[] {
    return [...(this._eventsBySource.get(sourceKey) ?? [])];
  }

  showAlert(eventId: string | null = null): boolean {
    const event =
      (eventId ? this._events.find((candidate) => candidate.id === eventId) : null) ??
      this._events.find((candidate) => Boolean(candidate.meetingUrl));
    if (!event?.meetingUrl) return false;

    this._showAlert(event);
    return this._activeAlertEventId === event.id;
  }

  openMenu(): boolean {
    if (!this._enabled || !this._uiAlive || !this._dateMenu) return false;

    this._render();
    this._dateMenu.menu.open(PopupAnimation.FULL);
    return true;
  }

  get eventCount(): number {
    return this._events.length;
  }

  get activeAlertEventId(): string | null {
    return this._activeAlertEventId;
  }

  private _render(): void {
    if (!this._enabled || !this._uiAlive) return;

    const now = this._now();
    const excludeAllDayEvents = this.context.settings.getBoolean(EXCLUDE_ALL_DAY_KEY);
    const presentation = derivePanelPresentation(this._events, now, {
      excludeAllDayEvents,
      maxFutureSeconds: PANEL_LOOKAHEAD_SECONDS,
    });

    if (!presentation) {
      if (this._panelWidget) this._panelWidget.visible = false;
    } else {
      if (this._panelLabel) this._panelLabel.text = presentation.label;
      if (this._panelWidget) this._panelWidget.visible = true;
    }
  }

  private _scheduleAlerts(): void {
    if (!this._enabled || !this._uiAlive) return;

    this._clearTimer('_alertTimerId');
    if (this._activeAlertEventId) return;

    const now = this._now();
    const dueEvents = this._getDueEvents(now);
    if (dueEvents.length > 0) {
      this._showAlert(dueEvents[0]!);
      return;
    }

    const nextAlertAt = this._getNextAlertAt(now);
    if (!nextAlertAt) return;

    this._alertTimerId = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      Math.max(1, nextAlertAt - now),
      () => {
        this._alertTimerId = 0;
        this._scheduleAlerts();
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  private _getDueEvents(now: number): MeetingEvent[] {
    return getDueAlertEvents(this._events, now, {
      alertsEnabled: this.context.settings.getBoolean(ALERTS_ENABLED_KEY),
      alertMinutesBefore: this.context.settings.getInt(ALERT_MINUTES_KEY),
      excludeAllDayEvents: this.context.settings.getBoolean(EXCLUDE_ALL_DAY_KEY),
      ignoredEventIds: this._ignoredEventIds,
      alertedEventIds: this._alertedEventIds,
      snoozedUntilByEventId: this._snoozedUntilByEventId,
    });
  }

  private _getNextAlertAt(now: number): number | null {
    if (!this.context.settings.getBoolean(ALERTS_ENABLED_KEY)) return null;

    const leadSeconds = this.context.settings.getInt(ALERT_MINUTES_KEY) * 60;
    const excludeAllDayEvents = this.context.settings.getBoolean(EXCLUDE_ALL_DAY_KEY);
    const candidates = filterDisplayEvents(this._events, now, { excludeAllDayEvents })
      .filter((event) => event.meetingUrl)
      .filter((event) => !this._ignoredEventIds.has(event.id))
      .filter((event) => !this._alertedEventIds.has(event.id))
      .map((event) =>
        Math.max(
          event.startEpochSeconds - leadSeconds,
          this._snoozedUntilByEventId.get(event.id) ?? 0,
        ),
      )
      .filter((time) => time > now)
      .sort((a, b) => a - b);

    return candidates[0] ?? null;
  }

  private _showAlert(event: MeetingEvent): void {
    if (!this._enabled || !this._uiAlive) return;

    if (this._activeAlertEventId === event.id) return;

    this._activeAlertEventId = event.id;
    this._destroyActiveNotification(MessageTray.NotificationDestroyedReason.REPLACED);

    const source = this._ensureNotificationSource();
    const notification = new MessageTray.Notification({
      source,
      title: _('Meeting starting soon'),
      body: `${event.title}\n${formatEventTime(event)}`,
      iconName: 'x-office-calendar-symbolic',
      urgency: MessageTray.Urgency.HIGH,
      resident: true,
      isTransient: false,
    });
    notification.addAction(_('Join'), () => this._joinEvent(event));
    notification.addAction(_('Snooze'), () => this._snoozeEvent(event));
    notification.addAction(_('Dismiss'), () => this._dismissEvent(event));
    notification.addAction(_('Ignore'), () => this._ignoreEvent(event));
    notification.connect('destroy', () => {
      if (this._activeNotification === notification) this._activeNotification = null;
      if (this._activeAlertEventId !== event.id) return;

      this._alertedEventIds.add(event.id);
      this._activeAlertEventId = null;
      this._render();
      this._scheduleAlerts();
    });

    this._activeNotification = notification;
    source.addNotification(notification);
    this._render();
  }

  private _joinEvent(event: MeetingEvent): void {
    if (!event.meetingUrl) return;

    try {
      Gio.AppInfo.launch_default_for_uri(event.meetingUrl, null);
    } catch (e) {
      logger.warn(`Failed to open meeting URL: ${e}`, { prefix: LOG_PREFIX });
    }
    this._dismissEvent(event);
  }

  private _snoozeEvent(event: MeetingEvent): void {
    const snoozeSeconds = Math.max(1, this.context.settings.getInt(SNOOZE_MINUTES_KEY)) * 60;
    this._snoozedUntilByEventId.set(event.id, this._now() + snoozeSeconds);
    this._activeAlertEventId = null;
    this._destroyActiveNotification(MessageTray.NotificationDestroyedReason.DISMISSED);
    this._render();
    this._scheduleAlerts();
  }

  private _dismissEvent(event: MeetingEvent): void {
    this._alertedEventIds.add(event.id);
    this._activeAlertEventId = null;
    this._destroyActiveNotification(MessageTray.NotificationDestroyedReason.DISMISSED);
    this._render();
    this._scheduleAlerts();
  }

  private _ignoreEvent(event: MeetingEvent): void {
    this._ignoredEventIds.add(event.id);
    this._activeAlertEventId = null;
    this._destroyActiveNotification(MessageTray.NotificationDestroyedReason.DISMISSED);
    this._render();
    this._scheduleAlerts();
  }

  private _clearTimer(prop: '_refreshTimerId' | '_labelTimerId' | '_alertTimerId'): void {
    if (!this[prop]) return;
    GLib.source_remove(this[prop]);
    this[prop] = 0;
  }

  private _now(): number {
    return Math.floor(Date.now() / 1000);
  }

  private _syncEvents(): void {
    this._events = [...this._eventsBySource.values()]
      .flat()
      .sort((a, b) => a.startEpochSeconds - b.startEpochSeconds);
    this._render();
    this._scheduleAlerts();
  }

  private _ensureNotificationSource(): MessageTray.Source {
    if (this._notificationSource) return this._notificationSource;

    const source = new MessageTray.Source({
      title: _('Meeting Clock'),
      iconName: 'x-office-calendar-symbolic',
    });
    source.connect('destroy', () => {
      if (this._notificationSource === source) this._notificationSource = null;
    });
    Main.messageTray.add(source);
    this._notificationSource = source;
    return source;
  }

  private _destroyActiveNotification(reason: MessageTray.NotificationDestroyedReason): void {
    const notification = this._activeNotification;
    this._activeNotification = null;
    notification?.destroy(reason);
  }

  private _clearAlertState(eventIds: ReadonlySet<string | undefined>): void {
    for (const eventId of eventIds) {
      if (!eventId) continue;
      this._alertedEventIds.delete(eventId);
      this._ignoredEventIds.delete(eventId);
      this._snoozedUntilByEventId.delete(eventId);
      if (this._activeAlertEventId === eventId) this._activeAlertEventId = null;
    }
  }
}

export const definition: ModuleDefinition = {
  key: 'meeting-clock',
  settingsKey: 'module-meeting-clock',
  section: 'dock-panel',
  title: _('Meeting Clock'),
  subtitle: _('Shows upcoming calendar events next to the clock'),
  options: [
    {
      key: ALERTS_ENABLED_KEY,
      title: _('Meeting Alerts'),
      subtitle: _('Show a notification when a meeting is about to start'),
      type: 'switch',
    },
    {
      key: ALERT_MINUTES_KEY,
      title: _('Alert Lead Time (minutes)'),
      subtitle: _('Minutes before a meeting starts to show the alert'),
      type: 'spin',
      min: 0,
      max: 60,
    },
    {
      key: SNOOZE_MINUTES_KEY,
      title: _('Snooze Duration (minutes)'),
      subtitle: _('Minutes to wait before showing a snoozed alert again'),
      type: 'spin',
      min: 1,
      max: 60,
    },
    {
      key: EXCLUDE_ALL_DAY_KEY,
      title: _('Hide All-Day Events'),
      subtitle: _('Exclude all-day events from the clock and alerts'),
      type: 'switch',
    },
  ],
  factory: (ctx) => new MeetingClock(ctx),
};
