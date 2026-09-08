/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {
  EXTENSION_UUID,
  getAuroraModule,
  getAuroraSettings,
  waitForCondition,
  waitForExtension,
  waitForTiming,
} from '../../../support/testUtils.js';

const CALENDAR_REMINDERS_MODULE_KEY = 'module-calendar-reminders';
const WEATHER_MODULE_KEY = 'module-weather-clock';
const ALERTS_ENABLED_KEY = 'calendar-reminders-alerts-enabled';
const FORCE_REMINDERS_KEY = 'calendar-reminders-force-reminders';
const EDS_SCHEMA = 'org.gnome.evolution-data-server.calendar';

export var METRICS = {};

export function init() {
  Scripting.defineScriptEvent('calendarRemindersComplete', 'Calendar Reminders test completed');
}

function reminder(id, title, trigger, startOffset = 60) {
  const start = trigger + startOffset;
  return [
    'aurora-test-source',
    id,
    String(trigger),
    String(start),
    String(start + 1800),
    `UID:${id}\nSUMMARY:${title}`,
  ].join('\n');
}

function alertNotifications() {
  const source = Main.messageTray
    .getSources()
    .find((candidate) => candidate.title === 'Calendar Reminders');
  return (
    source?.notifications.filter((notification) => notification.title === 'Calendar reminder') || []
  );
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);

  const settings = getAuroraSettings();
  const dateMenu = Main.panel.statusArea.dateMenu;
  const originalClockDisplay = dateMenu._clockDisplay;
  settings.set_boolean(WEATHER_MODULE_KEY, false);
  settings.set_boolean(CALENDAR_REMINDERS_MODULE_KEY, false);
  await Scripting.waitLeisure();

  const schema = Gio.SettingsSchemaSource.get_default().lookup(EDS_SCHEMA, true);
  if (!schema) throw new Error(`${EDS_SCHEMA} is unavailable`);
  const evolutionSettings = new Gio.Settings({ settings_schema: schema });
  const originalDisplaySetting = evolutionSettings.get_boolean('notify-enable-display');
  const originalReminders = evolutionSettings.get_strv('reminders-past');

  try {
    settings.set_boolean(ALERTS_ENABLED_KEY, true);
    settings.set_boolean(FORCE_REMINDERS_KEY, false);
    evolutionSettings.set_strv('reminders-past', []);
    await Scripting.waitLeisure();

    if (originalClockDisplay.get_parent()?.has_style_class_name('aurora-clock-pill-box'))
      throw new Error('Calendar Reminders wrapper remained after disabling module');

    settings.set_boolean(CALENDAR_REMINDERS_MODULE_KEY, true);
    await Scripting.waitLeisure();

    if (evolutionSettings.get_boolean('notify-enable-display'))
      throw new Error('Calendar Reminders did not suppress Evolution display reminders');
    if (!originalClockDisplay.get_parent()?.has_style_class_name('aurora-clock-pill-box'))
      throw new Error('Calendar Reminders did not wrap the clock display after enabling module');

    const calendarReminders = getAuroraModule('calendar-reminders');
    const now = Math.floor(Date.now() / 1000);
    calendarReminders.setSourceEvents('aurora-test', [
      {
        id: 'aurora-test-no-link',
        title: 'Calendar event',
        startEpochSeconds: now,
        endEpochSeconds: now + 1800,
        sourceId: 'aurora-test',
        sourceName: 'Aurora Test',
        isAllDay: false,
      },
    ]);
    await Scripting.waitLeisure();
    if (alertNotifications().length !== 0)
      throw new Error('An event without a configured reminder triggered a notification');
    if (!calendarReminders.showAlert('aurora-test-no-link'))
      throw new Error('Calendar Reminders did not show a manual no-link reminder');

    const manualNotification = alertNotifications()[0];
    const manualActions = manualNotification?.actions.map((action) => action.label);
    if (manualActions?.join(',') !== 'Open Calendar,Snooze')
      throw new Error(`Unexpected no-link actions: ${manualActions?.join(',')}`);
    calendarReminders.clearSourceEvents('aurora-test');

    const first = reminder('alarm-1\trecurrence-1', 'First reminder', now, 1);
    const second = reminder('alarm-2', 'Second reminder', now);
    const stale = reminder('alarm-stale', 'Stale reminder', now - 3601);
    evolutionSettings.set_strv('reminders-past', [first, second, stale]);

    await waitForCondition({
      evaluate: () => alertNotifications().length === 2,
      signals: [[evolutionSettings, 'changed::reminders-past']],
      timeoutMs: 3000,
      description: 'Calendar Reminders to consume all fresh native reminders',
    });
    if (alertNotifications().some((notification) => notification.body.includes('Stale reminder')))
      throw new Error('Calendar Reminders displayed a stale native reminder');
    if (evolutionSettings.get_strv('reminders-past').length !== 0)
      throw new Error('Calendar Reminders did not clear consumed native reminders');
    const reminderActions = alertNotifications()[0]?.actions.map((action) => action.label);
    if (reminderActions?.join(',') !== 'Open Calendar,Snooze')
      throw new Error(`Unexpected reminder actions: ${reminderActions?.join(',')}`);

    await waitForTiming(1500, 'verify the negative event-start scheduling window');
    if (alertNotifications().length !== 2)
      throw new Error('Calendar Reminders displayed a second notification at the event start');

    evolutionSettings.set_strv('reminders-past', [first]);
    await Scripting.waitLeisure();
    if (alertNotifications().length !== 2)
      throw new Error('Calendar Reminders displayed a duplicate native reminder');

    const snoozedNotification = alertNotifications()[0];
    const snooze = snoozedNotification
      ? snoozedNotification.actions.find((action) => action.label === 'Snooze')
      : null;
    if (!snooze) throw new Error('Calendar Reminders Snooze action was not found');
    snooze.activate();
    if (alertNotifications().length !== 1)
      throw new Error('Snooze did not dismiss its active reminder');
    if (!calendarReminders._alerts || calendarReminders._alerts._snoozeTimers.size !== 1)
      throw new Error('Snooze did not create a managed timer');

    settings.set_boolean(ALERTS_ENABLED_KEY, false);
    await Scripting.waitLeisure();
    if (evolutionSettings.get_boolean('notify-enable-display') !== originalDisplaySetting)
      throw new Error('Disabling alerts did not restore Evolution display reminders');
    if (alertNotifications().length !== 0)
      throw new Error('Disabling alerts did not clear active reminders');
    if (!calendarReminders._alerts || calendarReminders._alerts._snoozeTimers.size !== 0)
      throw new Error('Disabling alerts did not cancel pending snoozes');

    settings.set_boolean(ALERTS_ENABLED_KEY, true);
    await Scripting.waitLeisure();
    if (evolutionSettings.get_boolean('notify-enable-display'))
      throw new Error('Re-enabling alerts did not resume the native reminder backend');

    await exerciseNativeReminderCancellation(calendarReminders, evolutionSettings);
    await exerciseStartReminders(settings, calendarReminders);

    settings.set_boolean(CALENDAR_REMINDERS_MODULE_KEY, false);
    settings.set_boolean(FORCE_REMINDERS_KEY, false);
    await Scripting.waitLeisure();
    if (evolutionSettings.get_boolean('notify-enable-display') !== originalDisplaySetting)
      throw new Error('Calendar Reminders did not restore Evolution display reminders');
    if (originalClockDisplay.get_parent()?.has_style_class_name('aurora-clock-pill-box'))
      throw new Error('Calendar Reminders wrapper was not restored after disable');
  } finally {
    settings.set_boolean(CALENDAR_REMINDERS_MODULE_KEY, false);
    settings.set_boolean(WEATHER_MODULE_KEY, false);
    evolutionSettings.set_strv('reminders-past', originalReminders);
    evolutionSettings.set_boolean('notify-enable-display', originalDisplaySetting);
    await Scripting.waitLeisure();
  }

  Scripting.scriptEvent('calendarRemindersComplete');
}

async function exerciseNativeReminderCancellation(calendarReminders, evolutionSettings) {
  for (const operation of ['remove', 'reschedule']) {
    const now = Math.floor(Date.now() / 1000);
    const event = {
      id: 'aurora-test-source\ncleanup-event\n',
      calendarUuid: 'aurora-test-source:cleanup-event',
      title: 'Native cleanup',
      sourceId: 'aurora-test-source',
      sourceName: 'Aurora Test',
      startEpochSeconds: now + 60,
      endEpochSeconds: now + 1800,
      isAllDay: false,
    };
    calendarReminders.setSourceEvents('aurora-test', [event]);
    evolutionSettings.set_strv('reminders-past', [
      [
        event.sourceId,
        `cleanup-${operation}`,
        String(now),
        String(event.startEpochSeconds),
        String(event.endEpochSeconds),
        'UID:cleanup-event\nSUMMARY:Native cleanup',
      ].join('\n'),
    ]);
    await waitForCondition({
      evaluate: () => alertNotifications().length === 1,
      signals: [[evolutionSettings, 'changed::reminders-past']],
      timeoutMs: 3000,
      description: 'native reminder before calendar event cancellation',
    });
    alertNotifications()[0]
      .actions.find((action) => action.label === 'Snooze')
      .activate();
    if (calendarReminders._alerts._snoozeTimers.size !== 1)
      throw new Error('Native reminder did not create a snooze');

    if (operation === 'remove') calendarReminders.clearSourceEvents('aurora-test');
    else
      calendarReminders.setSourceEvents('aurora-test', [
        { ...event, startEpochSeconds: event.startEpochSeconds + 60 },
      ]);
    if (calendarReminders._alerts._snoozeTimers.size !== 0)
      throw new Error(`Native snooze survived calendar event ${operation}`);
    calendarReminders.clearSourceEvents('aurora-test');
  }
}

async function exerciseStartReminders(settings, calendarReminders) {
  const now = Math.floor(Date.now() / 1000);
  const event = {
    id: 'forced-event',
    title: 'Forced start',
    calendarUuid: 'aurora-test-source:forced-event',
    sourceId: 'aurora-test',
    sourceName: 'Aurora Test',
    startEpochSeconds: now + 2,
    endEpochSeconds: now + 1800,
    isAllDay: false,
  };

  settings.set_boolean(FORCE_REMINDERS_KEY, true);
  await Scripting.waitLeisure();
  calendarReminders.showReminder({ ...event, id: 'configured-alarm' });
  calendarReminders.setSourceEvents('aurora-test', [
    event,
    {
      ...event,
      id: 'simultaneous',
      calendarUuid: 'aurora-test-source:simultaneous',
      title: 'Simultaneous start',
    },
    { ...event, id: 'all-day', calendarUuid: 'aurora-test-source:all-day', isAllDay: true },
    {
      ...event,
      id: 'stale',
      calendarUuid: 'aurora-test-source:stale',
      startEpochSeconds: now - 61,
    },
  ]);

  await waitForCondition({
    evaluate: () => alertNotifications().length === 3,
    signals: [[Main.messageTray, 'queue-changed']],
    timeoutMs: 5000,
    description: 'two simultaneous start reminders after an earlier configured reminder',
  });
  calendarReminders.setSourceEvents('aurora-test', [event]);
  await Scripting.waitLeisure();
  if (alertNotifications().length !== 2)
    throw new Error('Refreshing events duplicated a reminder or retained a removed event');

  calendarReminders.clearSourceEvents('aurora-test');
  settings.set_boolean(ALERTS_ENABLED_KEY, false);
  await Scripting.waitLeisure();
  if (calendarReminders.showReminder(event) || calendarReminders.showAlert())
    throw new Error('Disabled notifications accepted a reminder');
  settings.set_boolean(ALERTS_ENABLED_KEY, true);
  await Scripting.waitLeisure();

  const rescheduled = {
    ...event,
    id: 'rescheduled',
    startEpochSeconds: Math.floor(Date.now() / 1000) + 2,
  };
  calendarReminders.setSourceEvents('aurora-test', [rescheduled]);
  calendarReminders.setSourceEvents('aurora-test', [
    { ...rescheduled, startEpochSeconds: rescheduled.startEpochSeconds + 60 },
  ]);
  await waitForTiming(3500, 'negative window after the superseded start deadline');
  if (alertNotifications().length !== 0)
    throw new Error('A rescheduled event fired at its old start time');

  calendarReminders.setSourceEvents('aurora-test', [
    { ...rescheduled, startEpochSeconds: Math.floor(Date.now() / 1000) + 1 },
  ]);
  await waitForCondition({
    evaluate: () => alertNotifications().length === 1,
    signals: [[Main.messageTray, 'queue-changed']],
    timeoutMs: 4000,
    description: 'the rescheduled event to notify at its new start time',
  });
  calendarReminders.clearSourceEvents('aurora-test');
  if (alertNotifications().length !== 0)
    throw new Error('Clearing the event retained its start reminder');

  calendarReminders.setSourceEvents('aurora-test', [
    { ...event, id: 'cancelled', startEpochSeconds: Math.floor(Date.now() / 1000) + 1 },
  ]);
  settings.set_boolean(ALERTS_ENABLED_KEY, false);
  await waitForTiming(2500, 'negative window after the cancelled reminder deadline');
  if (alertNotifications().length !== 0)
    throw new Error('A pending reminder fired while notifications were disabled');
  calendarReminders.clearSourceEvents('aurora-test');
  settings.set_boolean(FORCE_REMINDERS_KEY, false);
}

let _complete = false;

export function script_calendarRemindersComplete() {
  _complete = true;
}

export function finish() {
  if (!_complete) throw new Error('Calendar Reminders integration test did not complete');
}
