import '@girs/gjs';
import { gettext as _ } from '~/shared/i18n.ts';

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import * as Main from '@girs/gnome-shell/ui/main';
import * as MessageTray from '@girs/gnome-shell/ui/messageTray';

import { LifecycleScope, type ManagedSource } from '~/core/lifecycleScope.ts';
import { logger } from '~/core/logger.ts';
import { createManagedSource } from '~/core/mainLoop.ts';

import {
  formatEventTime,
  getStartReminderId,
  type CalendarEvent,
} from './calendarRemindersLogic.ts';

const LOG_PREFIX = 'CalendarReminders';

type CalendarReminderControllerOptions = {
  getSnoozeMinutes: () => number;
  onStateChanged: () => void;
};

type ActiveNotification = {
  event: CalendarEvent;
  notification: MessageTray.Notification;
  destroyId: number;
};

export class CalendarReminderController {
  private _lifecycle = new LifecycleScope();
  private _notificationSource: MessageTray.Source | null = null;
  private _notificationSourceDestroyId = 0;
  private _notifications = new Map<string, ActiveNotification>();
  private _snoozeTimers = new Map<string, { event: CalendarEvent; timer: ManagedSource }>();
  private _events: readonly CalendarEvent[] = [];

  constructor(private _options: CalendarReminderControllerOptions) {}

  get activeEventId(): string | null {
    return [...this._notifications.keys()].at(-1) || null;
  }

  setEvents(events: readonly CalendarEvent[]): void {
    this._events = events;
  }

  clearEventState(events: readonly CalendarEvent[]): void {
    const eventIds = new Set<string>();
    for (const { event: reminder } of [
      ...this._notifications.values(),
      ...this._snoozeTimers.values(),
    ]) {
      if (
        events.some(
          (event) =>
            reminder.id === event.id ||
            reminder.id === getStartReminderId(event) ||
            (event.calendarUuid &&
              reminder.calendarUuid === event.calendarUuid &&
              reminder.startEpochSeconds === event.startEpochSeconds),
        )
      ) {
        eventIds.add(reminder.id);
      }
    }

    for (const eventId of eventIds) {
      const snooze = this._snoozeTimers.get(eventId);
      if (snooze) snooze.timer.clear();
      this._snoozeTimers.delete(eventId);
      this._destroyNotification(eventId, MessageTray.NotificationDestroyedReason.SOURCE_CLOSED);
    }
  }

  show(eventId: string | null = null): boolean {
    let event: CalendarEvent | undefined;
    if (eventId) event = this._events.find((candidate) => candidate.id === eventId);
    else event = this._events[0];
    if (!event) return false;

    this.showEvent(event);
    return this._notifications.has(event.id);
  }

  showEvent(event: CalendarEvent): void {
    const active = this._notifications.get(event.id);
    if (active) {
      active.notification.acknowledged = false;
      return;
    }

    const notification = new MessageTray.Notification({
      source: this._ensureNotificationSource(),
      title: _('Calendar reminder'),
      body: `${event.title || _('Calendar event')}\n${formatEventTime(event)}`,
      iconName: 'org.gnome.Calendar',
      urgency: MessageTray.Urgency.HIGH,
      resident: true,
    });

    notification.connect('activated', () => {
      if (this._openCalendar(event)) this._dismiss(event.id);
    });
    notification.addAction(_('Open Calendar'), () => {
      if (this._openCalendar(event)) this._dismiss(event.id);
    });
    notification.addAction(_('Snooze'), () => this._snooze(event));

    const destroyId = notification.connect('destroy', () => {
      const activeNotification = this._notifications.get(event.id);
      if (!activeNotification || activeNotification.notification !== notification) return;
      this._notifications.delete(event.id);
      this._options.onStateChanged();
    });
    this._notifications.set(event.id, { event, notification, destroyId });
    this._ensureNotificationSource().addNotification(notification);
    this._options.onStateChanged();
  }

  clear(): void {
    for (const { timer } of this._snoozeTimers.values()) timer.clear();
    this._snoozeTimers.clear();
    for (const eventId of [...this._notifications.keys()]) {
      this._destroyNotification(eventId, MessageTray.NotificationDestroyedReason.SOURCE_CLOSED);
    }
  }

  destroy(): void {
    this.clear();
    this._lifecycle.dispose();
    this._destroyNotificationSource(MessageTray.NotificationDestroyedReason.SOURCE_CLOSED);
    this._events = [];
  }

  private _snooze(event: CalendarEvent): void {
    let snooze = this._snoozeTimers.get(event.id);
    if (!snooze) {
      snooze = { event, timer: createManagedSource(this._lifecycle) };
      this._snoozeTimers.set(event.id, snooze);
    }

    const { timer } = snooze;
    const seconds = Math.max(1, this._options.getSnoozeMinutes()) * 60;
    timer.replace(() =>
      GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
        timer.complete();
        this._snoozeTimers.delete(event.id);
        this.showEvent(event);
        return GLib.SOURCE_REMOVE;
      }),
    );
    this._dismiss(event.id);
  }

  private _dismiss(eventId: string): void {
    this._destroyNotification(eventId, MessageTray.NotificationDestroyedReason.DISMISSED);
  }

  private _dismissShellUi(): void {
    Main.overview.hide();
    Main.panel.closeCalendar();
  }

  private _openCalendar(event: CalendarEvent): boolean {
    this._dismissShellUi();
    if (!GLib.find_program_in_path('gnome-calendar')) {
      logger.warn('gnome-calendar is not installed', { prefix: LOG_PREFIX });
      return false;
    }

    const start = GLib.DateTime.new_from_unix_local(event.startEpochSeconds);
    const date = start.format('%x %H:%M') || '';
    let command = `gnome-calendar --date ${GLib.shell_quote(date)}`;
    if (event.calendarUuid) command += ` --uuid ${GLib.shell_quote(event.calendarUuid)}`;

    try {
      const app = Gio.AppInfo.create_from_commandline(
        command,
        'Calendar',
        Gio.AppInfoCreateFlags.SUPPORTS_STARTUP_NOTIFICATION,
      );
      const context = global.create_app_launch_context(global.get_current_time(), -1);
      return app.launch([], context);
    } catch (error) {
      logger.warn(`Failed to open Calendar: ${error}`, { prefix: LOG_PREFIX });
      return false;
    }
  }

  private _ensureNotificationSource(): MessageTray.Source {
    if (this._notificationSource) return this._notificationSource;

    const source = new MessageTray.Source({
      title: _('Calendar Reminders'),
      iconName: 'org.gnome.Calendar',
    });
    this._notificationSourceDestroyId = source.connect('destroy', () => {
      if (this._notificationSource === source) this._notificationSource = null;
      this._notificationSourceDestroyId = 0;
    });
    Main.messageTray.add(source);
    this._notificationSource = source;
    return source;
  }

  private _destroyNotification(
    eventId: string,
    reason: MessageTray.NotificationDestroyedReason,
  ): void {
    const active = this._notifications.get(eventId);
    if (!active) return;

    this._notifications.delete(eventId);
    active.notification.disconnect(active.destroyId);
    active.notification.destroy(reason);
    this._options.onStateChanged();
  }

  private _destroyNotificationSource(reason: MessageTray.NotificationDestroyedReason): void {
    const source = this._notificationSource;
    const destroyId = this._notificationSourceDestroyId;
    this._notificationSource = null;
    this._notificationSourceDestroyId = 0;

    if (source && destroyId) source.disconnect(destroyId);
    if (source) source.destroy(reason);
  }
}
