import '@girs/gjs';

import Adw from "@girs/adw-1";
import Gio from "@girs/gio-2.0";

import { ExtensionPreferences, gettext as _ } from '@girs/gnome-shell/extensions/prefs';
import { getModuleRegistry } from '~/registry.ts';

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
      const row = new Adw.SwitchRow({
        title: def.title,
        subtitle: def.subtitle,
      });
      settings.bind(def.settingsKey, row, 'active', Gio.SettingsBindFlags.DEFAULT);
      group.add(row);
    }

    page.add(group);
    window.add(page);

    return Promise.resolve();
  }
}
