import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

export async function exerciseTrayIcons(devTool, tray) {
  const tool = devTool.trayIconsTool;
  if (!tool) throw new Error('Tray Icons DevTool section not found');

  const firstId = tool.addRandomFakeIcon();
  const secondId = tool.addRandomFakeIcon();
  if (!firstId || !secondId) throw new Error('Tray Icons returned no fake item id');
  if (!tool.fakeItemIds.includes(firstId) || !tool.fakeItemIds.includes(secondId))
    throw new Error('Tray Icons did not track fake items after add');

  tool.toggleAttentionOnAll();
  await Scripting.sleep(100);
  if (!tray._state?.attentionIds?.has(firstId) || !tray._state?.attentionIds?.has(secondId))
    throw new Error('Tray Icons did not toggle fake item alerts on');

  tool.toggleAttentionOnAll();
  await Scripting.sleep(100);
  if (tray._state?.attentionIds?.has(firstId) || tray._state?.attentionIds?.has(secondId))
    throw new Error('Tray Icons did not toggle fake item alerts off');

  const removeMenuItem = tray._items
    ?.get(firstId)
    ?.trayItem?.menuItems?.find((item) => item.label === 'Remove Icon');
  if (!removeMenuItem) throw new Error(`Fake tray item "${firstId}" has no Remove Icon action`);

  removeMenuItem.action();
  await Scripting.sleep(500);
  if (tool.fakeItemIds.includes(firstId))
    throw new Error(`Tray Icons still tracks "${firstId}" after menu removal`);

  tool.removeAllFakeIcons();
  await Scripting.sleep(500);
  if (tool.fakeItemIds.length !== 0) throw new Error('Tray Icons still tracks fake items');
}

export async function exerciseWeatherClock(settings, devTool) {
  settings.set_boolean('module-weather-clock', true);
  await Scripting.waitLeisure();
  await Scripting.sleep(500);

  const tool = devTool.weatherClockTool;
  if (!tool) throw new Error('Weather Clock DevTool section not found');
  if (!tool.showSunny()) throw new Error('Weather Clock did not set a sunny snapshot');
  await Scripting.sleep(300);
  if (!tool.isVisible) throw new Error('Weather Clock did not make the widget visible');
  if (!tool.showOffline()) throw new Error('Weather Clock did not set an offline snapshot');
  tool.clearWeather();

  settings.set_boolean('module-weather-clock', false);
  await Scripting.waitLeisure();
  await Scripting.sleep(300);
}

export async function exerciseMeetingClock(settings, devTool) {
  settings.set_boolean('module-meeting-clock', true);
  await Scripting.waitLeisure();
  await Scripting.sleep(500);

  const tool = devTool.meetingClockTool;
  if (!tool) throw new Error('Meeting Clock DevTool section not found');
  if (!tool.addSoonMeeting() || !tool.addNoLinkMeeting())
    throw new Error('Meeting Clock did not create fake meetings');
  if (tool.devMeetingCount < 2) throw new Error('Meeting Clock did not track fake meetings');
  if (!tool.triggerAlert()) throw new Error('Meeting Clock did not trigger a linked alert');
  if (!tool.activeAlertEventId) throw new Error('Meeting Clock alert state was not updated');
  if (!tool.openCalendar()) throw new Error('Meeting Clock did not open the calendar menu');

  tool.clearMeetings();
  await Scripting.sleep(300);
  if (tool.devMeetingCount !== 0) throw new Error('Meeting Clock still tracks fake meetings');

  settings.set_boolean('module-meeting-clock', false);
  await Scripting.waitLeisure();
  await Scripting.sleep(300);
}
