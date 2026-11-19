import Gio from '@girs/gio-2.0';
import type { ExtensionContext } from '~/core/context.ts';
import type { Module } from '~/module.ts';
import { DEVTOOL_PATH, DEVTOOL_XML } from './protocol.ts';
import { MODULE_CATALOG } from '~/moduleCatalog.ts';
import { CalendarRemindersDevTool } from './calendarRemindersDevTool.ts';
import { CaptureToolsDevTool } from './captureToolsDevTool.ts';
import { ClipboardHistoryDevTool } from './clipboardHistoryDevTool.ts';
import { DockDevTool } from './dockDevTool.ts';
import { GeneralDevTool } from './generalDevTool.ts';
import { TrayIconsDevTool } from './trayIconsDevTool.ts';
import { WeatherClockDevTool } from './weatherClockDevTool.ts';

export class DevTool {
  private readonly _tools;
  private readonly _service: Gio.DBusExportedObject;

  constructor(
    context: ExtensionContext,
    getModule: (key: string) => Module | null,
    versionName: string,
  ) {
    this._tools = {
      general: new GeneralDevTool(
        versionName,
        () =>
          MODULE_CATALOG.filter((manifest) => context.settings.getBoolean(manifest.settingsKey))
            .length,
      ),
      capture: new CaptureToolsDevTool(getModule),
      dock: new DockDevTool(context.settings, getModule),
      clipboard: new ClipboardHistoryDevTool(getModule),
      tray: new TrayIconsDevTool(),
      weather: new WeatherClockDevTool(getModule),
      calendar: new CalendarRemindersDevTool(context.settings, getModule),
    };
    this._service = Gio.DBusExportedObject.wrapJSObject(DEVTOOL_XML, {
      Describe: () =>
        JSON.stringify(
          Object.values(this._tools).map((tool) => ({
            key: tool.key,
            title: tool.title,
            ...tool.describe(),
          })),
        ),
      RunAsync: async ([key, id]: [string, string], invocation: Gio.DBusMethodInvocation) => {
        try {
          const tool = Object.values(this._tools).find((tool) => tool.key === key);
          const selected = tool?.describe().actions.find((action) => action.id === id);
          if (!selected || selected.disabled) throw new Error('Action unavailable');
          const result = await selected.run();
          if (result === false || result === null) throw new Error('Action unavailable');
          invocation.return_value(null);
        } catch (error) {
          invocation.return_dbus_error(
            'org.gnome.Shell.Extensions.AuroraShell.ActionFailed',
            String(error),
          );
        }
      },
    });
  }

  enable(): void {
    this._service.export(Gio.DBus.session, DEVTOOL_PATH);
  }
  disable(): void {
    this._service.unexport();
    this._tools.capture.destroy();
    this._tools.tray.destroy();
    this._tools.weather.destroy();
    this._tools.calendar.destroy();
  }
}
