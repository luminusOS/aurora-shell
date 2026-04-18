import '@girs/gjs';

import Adw from '@girs/adw-1';
import Gio from '@girs/gio-2.0';

import { ExtensionPreferences, gettext as _ } from '@girs/gnome-shell/extensions/prefs';
import { getModuleRegistry, type ModuleDefinition } from '~/registry.ts';

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

    for (const def of getModuleRegistry()) {
      group.add(this._buildModuleRow(def, settings));
    }

    page.add(group);
    window.add(page);

    return Promise.resolve();
  }

  private _buildModuleRow(def: ModuleDefinition, settings: Gio.Settings): Adw.PreferencesRow {
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

  private _buildExpanderRow(def: ModuleDefinition, settings: Gio.Settings): Adw.ExpanderRow {
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
        settings.bind(option.key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        expander.add_row(row);
      } else if (option.type === 'entry') {
        const row = new Adw.EntryRow({
          title: option.title,
        });
        settings.bind(option.key, row, 'text', Gio.SettingsBindFlags.DEFAULT);
        expander.add_row(row);
      }
    }

    return expander;
  }
}
