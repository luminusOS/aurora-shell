import '@girs/gjs';

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';

import { logger } from '~/core/logger.ts';
import { LifecycleScope } from '~/core/lifecycleScope.ts';

import {
  normalizeCalendarServerEvent,
  removeCalendarEventsByPrefix,
  type CalendarEvent,
} from './calendarRemindersLogic.ts';

const LOG_PREFIX = 'CalendarReminders';
const CALENDAR_SERVER_BUS_NAME = 'org.gnome.Shell.CalendarServer';
const CALENDAR_SERVER_OBJECT_PATH = '/org/gnome/Shell/CalendarServer';
const CALENDAR_SERVER_INTERFACE = 'org.gnome.Shell.CalendarServer';
const DBUS_TIMEOUT_MS = 10_000;

type EventsChangedCallback = (events: CalendarEvent[]) => void;

export class CalendarServerBackend {
  private _proxy: Gio.DBusProxy | null = null;
  private _lifecycle: LifecycleScope | null = null;
  private _cancellable: Gio.Cancellable | null = null;
  private _requestCancellable: Gio.Cancellable | null = null;
  private _refreshWindowHours: number | null = null;
  private _eventsById = new Map<string, CalendarEvent>();
  private _onEventsChanged: EventsChangedCallback;

  constructor(onEventsChanged: EventsChangedCallback) {
    this._onEventsChanged = onEventsChanged;
  }

  start(): void {
    if (this._lifecycle) return;

    const lifecycle = new LifecycleScope();
    const cancellable = new Gio.Cancellable();
    const proxy = new Gio.DBusProxy({
      g_connection: Gio.DBus.session,
      g_interface_name: CALENDAR_SERVER_INTERFACE,
      g_name: CALENDAR_SERVER_BUS_NAME,
      g_object_path: CALENDAR_SERVER_OBJECT_PATH,
    });
    lifecycle.onDispose(() => cancellable.cancel());
    this._lifecycle = lifecycle;
    this._cancellable = cancellable;

    void this._initializeProxy(proxy, lifecycle, cancellable);
  }

  private async _initializeProxy(
    proxy: Gio.DBusProxy,
    lifecycle: LifecycleScope,
    cancellable: Gio.Cancellable,
  ): Promise<void> {
    let loaded = false;

    try {
      await proxy.init_async(GLib.PRIORITY_DEFAULT, cancellable);
      loaded = true;
    } catch (e) {
      if (this._lifecycle !== lifecycle) return;

      const timedOut = e instanceof GLib.Error && e.matches(Gio.DBusError, Gio.DBusError.TIMED_OUT);
      if (!timedOut) {
        logger.warn(`Failed to connect to CalendarServer: ${e}`, { prefix: LOG_PREFIX });
        this.stop();
        return;
      }
    }

    if (this._lifecycle !== lifecycle) return;

    this._proxy = proxy;
    lifecycle.connect(proxy, 'g-signal', (_proxy, _senderName, signalName, params) => {
      if (this._lifecycle !== lifecycle) return;

      if (signalName === 'EventsAddedOrUpdated') {
        const [rawEvents = []] = params.deepUnpack() as [unknown[]?];
        this._onEventsAddedOrUpdated(rawEvents);
      } else if (signalName === 'EventsRemoved') {
        const [rawIds = []] = params.deepUnpack() as [string[]?];
        this._onEventsRemoved(rawIds);
      } else if (signalName === 'ClientDisappeared') {
        const [sourceUid = ''] = params.deepUnpack() as [string?];
        this._removeMatching(sourceUid + '\n');
      }
    });
    lifecycle.connect(proxy, 'notify::g-name-owner', () => {
      if (this._lifecycle !== lifecycle) return;

      if (proxy.g_name_owner) this._handleServiceAppeared(lifecycle);
      else this._handleServiceVanished();
    });

    if (loaded) this._handleServiceAppeared(lifecycle);
  }

  stop(): void {
    if (this._requestCancellable) this._requestCancellable.cancel();
    this._requestCancellable = null;
    this._lifecycle?.dispose();
    this._lifecycle = null;
    this._cancellable = null;
    this._proxy = null;
    this._refreshWindowHours = null;
    this._eventsById.clear();
  }

  refresh(windowHours: number): void {
    if (!this._lifecycle) return;

    this._refreshWindowHours = windowHours;
    if (!this._proxy) return;

    this._requestTimeRange(windowHours, this._lifecycle);
  }

  private async _requestTimeRange(windowHours: number, lifecycle: LifecycleScope): Promise<void> {
    if (!this._proxy || !this._cancellable) return;

    const proxy = this._proxy;
    if (this._requestCancellable) this._requestCancellable.cancel();
    const requestCancellable = new Gio.Cancellable();
    this._requestCancellable = requestCancellable;
    const sinceEpochSeconds = Math.floor(Date.now() / 1000) - 3600;
    const untilEpochSeconds = sinceEpochSeconds + Math.max(1, windowHours) * 3600;

    try {
      await proxy.call(
        'SetTimeRange',
        GLib.Variant.new('(xxb)', [sinceEpochSeconds, untilEpochSeconds, true]),
        Gio.DBusCallFlags.NONE,
        DBUS_TIMEOUT_MS,
        requestCancellable,
      );
    } catch (e) {
      if (this._lifecycle !== lifecycle || requestCancellable.is_cancelled()) return;

      logger.warn(`Failed to refresh CalendarServer events: ${e}`, { prefix: LOG_PREFIX });
    } finally {
      if (this._requestCancellable === requestCancellable) this._requestCancellable = null;
    }
  }

  private _handleServiceAppeared(lifecycle: LifecycleScope): void {
    this._eventsById.clear();
    this._emitEventsChanged();

    if (this._refreshWindowHours !== null)
      this._requestTimeRange(this._refreshWindowHours, lifecycle);
  }

  private _handleServiceVanished(): void {
    this._eventsById.clear();
    this._emitEventsChanged();
  }

  private _onEventsAddedOrUpdated(rawEvents: unknown[]): void {
    const clearedRecurringEvents = new Set<string>();
    for (const rawEvent of rawEvents) {
      const event = normalizeCalendarServerEvent(rawEvent);
      if (!event) continue;
      if (!event.id.endsWith('\n')) {
        const parentId = event.id.slice(0, event.id.lastIndexOf('\n') + 1);
        if (!clearedRecurringEvents.has(parentId)) {
          clearedRecurringEvents.add(parentId);
          this._removeMatching(parentId, false);
        }
      }
      this._eventsById.set(event.id, event);
    }

    this._emitEventsChanged();
  }

  private _onEventsRemoved(rawIds: string[]): void {
    for (const rawId of rawIds) this._removeMatching(String(rawId), false);

    this._emitEventsChanged();
  }

  private _removeMatching(prefix: string, emit = true): void {
    const changed = removeCalendarEventsByPrefix(this._eventsById, prefix);
    if (changed && emit) this._emitEventsChanged();
  }

  private _emitEventsChanged(): void {
    if (!this._proxy) return;

    this._onEventsChanged(
      [...this._eventsById.values()].sort((a, b) => a.startEpochSeconds - b.startEpochSeconds),
    );
  }
}
