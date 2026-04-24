import '@girs/gjs';

import Adw from '@girs/adw-1';
import Gio from '@girs/gio-2.0';
import Gtk from '@girs/gtk-4.0';

import { ExtensionPreferences, gettext as _ } from '@girs/gnome-shell/extensions/prefs';
import { getModuleMetadata, type ModuleMetadata } from '~/prefsMetadata.ts';

export default class AuroraShellPreferences extends ExtensionPreferences {
  // @ts-ignore: Conflicting Adw version types from gnome-shell
  override fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
    const settings = this.getSettings();

    const page = new Adw.PreferencesPage({
      title: _('General'),
      icon_name: 'dialog-information-symbolic',
    });

    const group = new Adw.PreferencesGroup({
      title: _('Modules'),
      description: _('Enable or disable extension modules'),
    });

    for (const def of getModuleMetadata()) {
      group.add(this._buildModuleRow(def, settings));
    }

    page.add(group);
    window.add(page);

    return Promise.resolve();
  }

  private _buildModuleRow(def: ModuleMetadata, settings: Gio.Settings): Adw.PreferencesRow {
    if (def.options && def.options.length > 0) {
      return this._buildExpanderRow(def, settings);
    }

    const row = new Adw.SwitchRow({
      title: def.title,
      subtitle: def.subtitle,
    });
    settings.bind(def.settingsKey, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
  }

  private _buildExpanderRow(def: ModuleMetadata, settings: Gio.Settings): Adw.ExpanderRow {
    // @ts-ignore: Adw.ExpanderRow constructor accepts title/subtitle/show_enable_switch
    const expander = new Adw.ExpanderRow({
      title: def.title,
      subtitle: def.subtitle,
      show_enable_switch: true,
    });

    settings.bind(def.settingsKey, expander, 'enable-expansion', Gio.SettingsBindFlags.DEFAULT);

    for (const option of def.options!) {
      if (option.type === 'switch') {
        const row = new Adw.SwitchRow({
          title: option.title,
          subtitle: option.subtitle,
        });
        settings.bind(option.key!, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        expander.add_row(row);
      } else if (option.type === 'entry') {
        const row = new Adw.EntryRow({
          title: option.title,
        });
        settings.bind(option.key!, row, 'text', Gio.SettingsBindFlags.DEFAULT);
        expander.add_row(row);
      } else if (option.type === 'spin') {
        const row = new Adw.SpinRow({
          title: option.title,
          subtitle: option.subtitle,
          adjustment: new Gtk.Adjustment({
            lower: option.min ?? 0,
            upper: option.max ?? 100,
            step_increment: 1,
            page_increment: 10,
          }),
        });
        settings.bind(option.key!, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        expander.add_row(row);
      } else if (option.type === 'time') {
        const row = new Adw.ActionRow({
          title: option.title,
          subtitle: option.subtitle,
        });

        const timeBox = new Gtk.Box({
          orientation: Gtk.Orientation.HORIZONTAL,
          spacing: 6,
          valign: Gtk.Align.CENTER,
        });

        const hSpin = new Gtk.SpinButton({
          adjustment: new Gtk.Adjustment({
            lower: 0,
            upper: 23,
            step_increment: 1,
            page_increment: 1,
          }),
          orientation: Gtk.Orientation.VERTICAL,
          numeric: true,
          wrap: true,
          valign: Gtk.Align.CENTER,
        });

        const separator = new Gtk.Label({
          label: ':',
          valign: Gtk.Align.CENTER,
        });

        const mSpin = new Gtk.SpinButton({
          adjustment: new Gtk.Adjustment({
            lower: 0,
            upper: 59,
            step_increment: 1,
            page_increment: 10,
          }),
          orientation: Gtk.Orientation.VERTICAL,
          numeric: true,
          wrap: true,
          valign: Gtk.Align.CENTER,
        });

        settings.bind(option.hourKey!, hSpin, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind(option.minuteKey!, mSpin, 'value', Gio.SettingsBindFlags.DEFAULT);

        timeBox.append(hSpin);
        timeBox.append(separator);
        timeBox.append(mSpin);

        row.add_suffix(timeBox);
        expander.add_row(row);
      }
    }

    return expander;
  }
}
