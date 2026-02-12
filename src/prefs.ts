import '@girs/gjs';

import Adw from "@girs/adw-1";
import Gio from "@girs/gio-2.0";

import { ExtensionPreferences } from '@girs/gnome-shell/extensions/prefs';
import { MODULE_REGISTRY } from './registry.ts';

export default class AuroraShellPreferences extends ExtensionPreferences {
  override fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
    const settings = this.getSettings();

    const page = new Adw.PreferencesPage({
      title: 'General',
      icon_name: 'dialog-information-symbolic',
    });

    const group = new Adw.PreferencesGroup({
      title: 'Modules',
      description: 'Enable or disable extension modules',
    });

    for (const def of MODULE_REGISTRY) {
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
