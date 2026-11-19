import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { gettext as _ } from '~/shared/i18n.ts';
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
  private _indicator: PanelMenu.Button | null = null;
  private _launchDeadline = 0;

  constructor(
    context: ExtensionContext,
    getModule: (key: string) => Module | null,
    versionName: string,
    private readonly _openPreferences: () => void,
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
      TakeLaunchRequest: () => {
        const requested = GLib.get_monotonic_time() < this._launchDeadline;
        this._launchDeadline = 0;
        return requested;
      },
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
    const title = _('Developer Tools');
    this._indicator = new PanelMenu.Button(1, title, true);
    this._indicator.can_focus = false;
    this._indicator.reactive = false;
    const launcher = new St.Button({
      can_focus: true,
      accessible_name: title,
      child: new St.Icon({
        icon_name: 'applications-engineering-symbolic',
        style_class: 'system-status-icon',
      }),
    });
    launcher.connect('clicked', () => {
      // Preferences may already be listening, or GNOME may still need to launch them.
      this._launchDeadline = GLib.get_monotonic_time() + 15 * GLib.USEC_PER_SEC;
      this._service.emit_signal('LaunchRequested', new GLib.Variant('()', []));
      this._openPreferences();
    });
    this._indicator.add_child(launcher);
    Main.panel.addToStatusArea('aurora-devtool', this._indicator, 2, 'left');
  }
  disable(): void {
    if (this._indicator) this._indicator.destroy();
    this._indicator = null;
    this._service.unexport();
    this._tools.capture.destroy();
    this._tools.tray.destroy();
    this._tools.weather.destroy();
    this._tools.calendar.destroy();
  }
}
