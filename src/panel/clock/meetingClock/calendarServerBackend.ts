import '@girs/gjs';

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';

import { logger } from '~/core/logger.ts';
import { LifecycleScope } from '~/core/lifecycleScope.ts';

import { normalizeCalendarServerEvent, type MeetingEvent } from './meetingClockLogic.ts';

const LOG_PREFIX = 'MeetingClock';
const CALENDAR_SERVER_BUS_NAME = 'org.gnome.Shell.CalendarServer';
const CALENDAR_SERVER_OBJECT_PATH = '/org/gnome/Shell/CalendarServer';
const CALENDAR_SERVER_INTERFACE = 'org.gnome.Shell.CalendarServer';

type EventsChangedCallback = (events: MeetingEvent[]) => void;

export class CalendarServerBackend {
  private _proxy: Gio.DBusProxy | null = null;
  private _lifecycle: LifecycleScope | null = null;
  private _eventsById = new Map<string, MeetingEvent>();
  private _onEventsChanged: EventsChangedCallback;

  constructor(onEventsChanged: EventsChangedCallback) {
    this._onEventsChanged = onEventsChanged;
  }

  start(): void {
    if (this._proxy) return;
    try {
      this._proxy = Gio.DBusProxy.new_for_bus_sync(
        Gio.BusType.SESSION,
        Gio.DBusProxyFlags.NONE,
        null,
        CALENDAR_SERVER_BUS_NAME,
        CALENDAR_SERVER_OBJECT_PATH,
        CALENDAR_SERVER_INTERFACE,
        null,
      );
    } catch (e) {
      logger.warn(`Failed to connect to CalendarServer: ${e}`, { prefix: LOG_PREFIX });
      this._proxy = null;
      return;
    }

    this._lifecycle = new LifecycleScope();
    this._lifecycle.connect(this._proxy, 'g-signal', (_proxy, _senderName, signalName, params) => {
      if (signalName === 'EventsAddedOrUpdated') {
        if (!this._proxy) return;
        const [rawEvents = []] = params.deepUnpack() as [unknown[]?];
        this._onEventsAddedOrUpdated(rawEvents);
      } else if (signalName === 'EventsRemoved') {
        if (!this._proxy) return;
        const [rawIds = []] = params.deepUnpack() as [string[]?];
        this._onEventsRemoved(rawIds);
      }
    });
  }

  stop(): void {
    this._lifecycle?.dispose();
    this._lifecycle = null;
    this._proxy = null;
    this._eventsById.clear();
  }

  refresh(windowHours: number): void {
    if (!this._proxy) return;

    const sinceEpochSeconds = Math.floor(Date.now() / 1000) - 3600;
    const untilEpochSeconds = sinceEpochSeconds + Math.max(1, windowHours) * 3600;

    try {
      this._proxy.call_sync(
        'SetTimeRange',
        GLib.Variant.new('(xxb)', [sinceEpochSeconds, untilEpochSeconds, true]),
        Gio.DBusCallFlags.NONE,
        -1,
        null,
      );
    } catch (e) {
      logger.warn(`Failed to refresh CalendarServer events: ${e}`, { prefix: LOG_PREFIX });
    }
  }

  private _onEventsAddedOrUpdated(rawEvents: unknown[]): void {
    for (const rawEvent of rawEvents) {
      const event = normalizeCalendarServerEvent(rawEvent);
      if (!event) continue;
      this._eventsById.set(event.id, event);
    }

    this._emitEventsChanged();
  }

  private _onEventsRemoved(rawIds: string[]): void {
    for (const rawId of rawIds) this._eventsById.delete(String(rawId));

    this._emitEventsChanged();
  }

  private _emitEventsChanged(): void {
    if (!this._proxy) return;

    this._onEventsChanged(
      [...this._eventsById.values()].sort((a, b) => a.startEpochSeconds - b.startEpochSeconds),
    );
  }
}
