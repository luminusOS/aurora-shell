import '@girs/gjs';

import Adw from "@girs/adw-1";
import Gio from "@girs/gio-2.0";

import { ExtensionPreferences } from '@girs/gnome-shell/extensions/prefs';

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

    // Theme Changer module
    const themeChangerRow = new Adw.SwitchRow({
      title: 'Theme Changer',
      subtitle: 'Monitors and synchronizes GNOME color scheme',
    });
    settings.bind(
      'module-theme-changer',
      themeChangerRow,
      'active',
      Gio.SettingsBindFlags.DEFAULT
    );

    // Dock module
    const dockRow = new Adw.SwitchRow({
      title: 'Dock',
      subtitle: 'Custom dock with auto-hide and intellihide features',
    });
    settings.bind(
      'module-dock',
      dockRow,
      'active',
      Gio.SettingsBindFlags.DEFAULT
    );

    group.add(themeChangerRow);
    group.add(dockRow);
    page.add(group);
    window.add(page);

    return Promise.resolve();
  }
}
