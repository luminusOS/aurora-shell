import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { waitForCondition } from '../../support/testUtils.js';

export async function exerciseTrayIcons(devTool, tray) {
  const tool = devTool.trayIconsTool;
  if (!tool) throw new Error('Tray Icons DevTool section not found');

  const firstId = tool.addRandomFakeIcon();
  const secondId = tool.addRandomFakeIcon();
  if (!firstId || !secondId) throw new Error('Tray Icons returned no fake item id');
  if (!tool.fakeItemIds.includes(firstId) || !tool.fakeItemIds.includes(secondId))
    throw new Error('Tray Icons did not track fake items after add');

  tool.toggleAttentionOnAll();
  if (!tray._state?.attentionIds?.has(firstId) || !tray._state?.attentionIds?.has(secondId))
    throw new Error('Tray Icons did not toggle fake item alerts on');

  tool.toggleAttentionOnAll();
  if (tray._state?.attentionIds?.has(firstId) || tray._state?.attentionIds?.has(secondId))
    throw new Error('Tray Icons did not toggle fake item alerts off');

  const removeMenuItem = tray._items
    ?.get(firstId)
    ?.trayItem?.menuItems?.find((item) => item.label === 'Remove Icon');
  if (!removeMenuItem) throw new Error(`Fake tray item "${firstId}" has no Remove Icon action`);

  removeMenuItem.action();
  await Scripting.waitLeisure();
  if (tool.fakeItemIds.includes(firstId))
    throw new Error(`Tray Icons still tracks "${firstId}" after menu removal`);

  tool.removeAllFakeIcons();
  await Scripting.waitLeisure();
  if (tool.fakeItemIds.length !== 0) throw new Error('Tray Icons still tracks fake items');
}

export async function exerciseWeatherClock(settings, devTool) {
  settings.set_boolean('module-weather-clock', true);
  await Scripting.waitLeisure();

  const tool = devTool.weatherClockTool;
  if (!tool) throw new Error('Weather Clock DevTool section not found');
  if (!tool.showSunny()) throw new Error('Weather Clock did not set a sunny snapshot');
  await Scripting.waitLeisure();
  if (!tool.isVisible) throw new Error('Weather Clock did not make the widget visible');
  if (!tool.showOffline()) throw new Error('Weather Clock did not set an offline snapshot');
  tool.clearWeather();

  settings.set_boolean('module-weather-clock', false);
  await Scripting.waitLeisure();
}

export async function exerciseCalendarReminders(settings, devTool) {
  settings.set_boolean('calendar-reminders-alerts-enabled', true);
  settings.set_boolean('calendar-reminders-force-reminders', false);
  settings.set_boolean('module-calendar-reminders', true);
  await Scripting.waitLeisure();

  const tool = devTool.calendarRemindersTool;
  if (!tool) throw new Error('Calendar Reminders DevTool section not found');
  let source = null;
  let bannerRequested = false;
  let bannerSignalId = 0;
  const sourceAddedId = Main.messageTray.connect('source-added', (_tray, addedSource) => {
    if (addedSource.title !== 'Calendar Reminders') return;

    source = addedSource;
    bannerSignalId = source.connect('notification-request-banner', () => {
      bannerRequested = true;
    });
  });
  try {
    const nowId = tool.addCurrentEvent();
    if (!nowId || !source || source.notifications.length !== 1 || !bannerRequested)
      throw new Error('Add Now did not publish a notification and request its banner');
    const actions = source.notifications[0].actions.map((action) => action.label);
    if (actions.join(',') !== 'Open Calendar,Snooze')
      throw new Error(`Unexpected Calendar Reminders actions: ${actions.join(',')}`);
  } finally {
    Main.messageTray.disconnect(sourceAddedId);
    if (source && bannerSignalId) source.disconnect(bannerSignalId);
  }

  const notificationCount = () =>
    Main.messageTray
      .getSources()
      .filter((candidate) => candidate.title === 'Calendar Reminders')
      .reduce((count, candidate) => count + candidate.notifications.length, 0);
  try {
    tool.clearEvents();
    if (notificationCount() !== 0) throw new Error('Clear Fake retained an immediate reminder');

    tool.setWithReminder(false);
    tool.addCurrentEvent();
    if (notificationCount() !== 0)
      throw new Error('An event without a reminder notified while forced reminders were off');
    settings.set_boolean('calendar-reminders-force-reminders', true);
    await Scripting.waitLeisure();
    if (notificationCount() !== 1)
      throw new Error('Forced reminders did not notify the event without an alarm');
    tool.clearEvents();
    settings.set_boolean('calendar-reminders-force-reminders', false);
    await Scripting.waitLeisure();

    tool.setWithReminder(true);
    tool.addSoonEvent();
    tool.clearEvents();
    const soonId = tool.addSoonEvent();
    // The one-minute reminder outlives PerfHelper's idle timeout.
    await Scripting.disableHelperAutoExit();
    await waitForCondition({
      evaluate: () => tool.activeAlertEventId === soonId,
      signals: [[Main.messageTray, 'queue-changed']],
      timeoutMs: 65000,
      description: 'Add Soon to deliver its configured reminder after one minute',
    });
    if (notificationCount() !== 1)
      throw new Error('A cleared Add Soon reminder fired or the scheduled reminder is missing');
    if (!tool.triggerAlert()) throw new Error('Calendar Reminders manual alert failed');
  } finally {
    tool.clearEvents();
  }
  if (!tool.openCalendar()) throw new Error('Calendar Reminders did not open the calendar menu');

  await Scripting.waitLeisure();
  if (tool.devEventCount !== 0) throw new Error('Calendar Reminders still tracks fake events');

  settings.set_boolean('module-calendar-reminders', false);
  await Scripting.waitLeisure();
}
