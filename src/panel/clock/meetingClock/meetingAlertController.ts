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
  getDueAlertEvents,
  getNextAlertEpoch,
  type MeetingClockOptions,
  type MeetingEvent,
} from './meetingClockLogic.ts';

const LOG_PREFIX = 'MeetingClock';

type MeetingAlertPreferences = MeetingClockOptions & {
  snoozeMinutes: number;
};

type MeetingAlertControllerOptions = {
  getPreferences: () => MeetingAlertPreferences;
  onStateChanged: () => void;
  now: () => number;
};

export class MeetingAlertController {
  private _lifecycle = new LifecycleScope();
  private _timer: ManagedSource = createManagedSource(this._lifecycle);
  private _notificationSource: MessageTray.Source | null = null;
  private _notificationSourceDestroyId = 0;
  private _activeNotification: MessageTray.Notification | null = null;
  private _activeNotificationDestroyId = 0;
  private _activeEventId: string | null = null;
  private _events: readonly MeetingEvent[] = [];
  private _alertedEventIds = new Set<string>();
  private _ignoredEventIds = new Set<string>();
  private _snoozedUntilByEventId = new Map<string, number>();

  constructor(private _options: MeetingAlertControllerOptions) {}

  get activeEventId(): string | null {
    return this._activeEventId;
  }

  setEvents(events: readonly MeetingEvent[]): void {
    this._events = events;
    this.schedule();
  }

  clearEventState(eventIds: ReadonlySet<string | undefined>): void {
    for (const eventId of eventIds) {
      if (!eventId) continue;

      this._alertedEventIds.delete(eventId);
      this._ignoredEventIds.delete(eventId);
      this._snoozedUntilByEventId.delete(eventId);

      if (this._activeEventId === eventId) {
        this._activeEventId = null;
      }
    }
  }

  show(eventId: string | null = null): boolean {
    const preferences = this._options.getPreferences();
    let event = eventId ? this._events.find((candidate) => candidate.id === eventId) : undefined;
    if (!event) {
      event = this._events.find(
        (candidate) => Boolean(candidate.meetingUrl) || preferences.alertEventsWithoutLink,
      );
    }

    if (!event) return false;
    if (!event.meetingUrl && !preferences.alertEventsWithoutLink) return false;

    this._showNotification(event);
    return this._activeEventId === event.id;
  }

  schedule(): void {
    this._timer.clear();

    if (this._activeEventId) return;

    const now = this._options.now();
    const preferences = this._options.getPreferences();
    const alertOptions = this._alertOptions(preferences);
    const dueEvents = getDueAlertEvents(this._events, now, alertOptions);

    if (dueEvents.length > 0) {
      this._showNotification(dueEvents[0]!);
      return;
    }

    const nextAlertAt = getNextAlertEpoch(this._events, now, alertOptions);
    if (!nextAlertAt) return;

    this._timer.replace(() =>
      GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, Math.max(1, nextAlertAt - now), () => {
        this._timer.complete();
        this.schedule();
        return GLib.SOURCE_REMOVE;
      }),
    );
  }

  destroy(): void {
    this._lifecycle.dispose();
    this._destroyActiveNotification(MessageTray.NotificationDestroyedReason.SOURCE_CLOSED);
    this._destroyNotificationSource(MessageTray.NotificationDestroyedReason.SOURCE_CLOSED);

    this._events = [];
    this._activeEventId = null;
    this._alertedEventIds.clear();
    this._ignoredEventIds.clear();
    this._snoozedUntilByEventId.clear();
  }

  private _alertOptions(preferences: MeetingAlertPreferences): MeetingClockOptions {
    return {
      alertsEnabled: preferences.alertsEnabled,
      alertMinutesBefore: preferences.alertMinutesBefore,
      alertEventsWithoutLink: preferences.alertEventsWithoutLink,
      excludeAllDayEvents: preferences.excludeAllDayEvents,
      ignoredEventIds: this._ignoredEventIds,
      alertedEventIds: this._alertedEventIds,
      snoozedUntilByEventId: this._snoozedUntilByEventId,
    };
  }

  private _showNotification(event: MeetingEvent): void {
    if (this._activeEventId === event.id) {
      if (this._activeNotification) this._activeNotification.acknowledged = false;
      return;
    }

    this._activeEventId = event.id;
    this._destroyActiveNotification(MessageTray.NotificationDestroyedReason.REPLACED);

    const notification = new MessageTray.Notification({
      source: this._ensureNotificationSource(),
      title: _('Meeting starting soon'),
      body: `${event.title}\n${formatEventTime(event)}`,
      iconName: 'x-office-calendar-symbolic',
      urgency: MessageTray.Urgency.HIGH,
      resident: true,
      isTransient: false,
    });

    if (event.meetingUrl) {
      notification.addAction(_('Join'), () => this._join(event));
    }

    notification.addAction(_('Snooze'), () => this._snooze(event));
    notification.addAction(_('Dismiss'), () => this._dismiss(event));

    if (event.meetingUrl) {
      notification.addAction(_('Ignore'), () => this._ignore(event));
    }

    this._activeNotificationDestroyId = notification.connect('destroy', () => {
      if (this._activeNotification === notification) {
        this._activeNotification = null;
        this._activeNotificationDestroyId = 0;
      }

      if (this._activeEventId !== event.id) return;

      this._alertedEventIds.add(event.id);
      this._activeEventId = null;
      this._stateChanged();
    });

    this._activeNotification = notification;
    this._ensureNotificationSource().addNotification(notification);
    this._options.onStateChanged();
  }

  private _join(event: MeetingEvent): void {
    if (!event.meetingUrl) return;

    try {
      Gio.AppInfo.launch_default_for_uri(event.meetingUrl, null);
    } catch (error) {
      logger.warn(`Failed to open meeting URL: ${error}`, { prefix: LOG_PREFIX });
    }

    this._dismiss(event);
  }

  private _snooze(event: MeetingEvent): void {
    const snoozeSeconds = Math.max(1, this._options.getPreferences().snoozeMinutes) * 60;
    this._snoozedUntilByEventId.set(event.id, this._options.now() + snoozeSeconds);
    this._activeEventId = null;
    this._destroyActiveNotification(MessageTray.NotificationDestroyedReason.DISMISSED);
    this._stateChanged();
  }

  private _dismiss(event: MeetingEvent): void {
    this._alertedEventIds.add(event.id);
    this._activeEventId = null;
    this._destroyActiveNotification(MessageTray.NotificationDestroyedReason.DISMISSED);
    this._stateChanged();
  }

  private _ignore(event: MeetingEvent): void {
    this._ignoredEventIds.add(event.id);
    this._activeEventId = null;
    this._destroyActiveNotification(MessageTray.NotificationDestroyedReason.DISMISSED);
    this._stateChanged();
  }

  private _stateChanged(): void {
    this._options.onStateChanged();
    this.schedule();
  }

  private _ensureNotificationSource(): MessageTray.Source {
    if (this._notificationSource) return this._notificationSource;

    const source = new MessageTray.Source({
      title: _('Meeting Clock'),
      iconName: 'x-office-calendar-symbolic',
    });
    this._notificationSourceDestroyId = source.connect('destroy', () => {
      if (this._notificationSource === source) {
        this._notificationSource = null;
      }

      this._notificationSourceDestroyId = 0;
    });

    Main.messageTray.add(source);
    this._notificationSource = source;
    return source;
  }

  private _destroyActiveNotification(reason: MessageTray.NotificationDestroyedReason): void {
    const notification = this._activeNotification;
    this._activeNotification = null;

    if (notification && this._activeNotificationDestroyId) {
      notification.disconnect(this._activeNotificationDestroyId);
    }

    this._activeNotificationDestroyId = 0;
    notification?.destroy(reason);
  }

  private _destroyNotificationSource(reason: MessageTray.NotificationDestroyedReason): void {
    const source = this._notificationSource;
    const destroyId = this._notificationSourceDestroyId;
    this._notificationSource = null;
    this._notificationSourceDestroyId = 0;

    if (source && destroyId) {
      source.disconnect(destroyId);
    }

    source?.destroy(reason);
  }
}
