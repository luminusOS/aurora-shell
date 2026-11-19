import type Adw from '@girs/adw-1';
import Gio from '@girs/gio-2.0';
import GeneralPreferences from './preferences/generalPreferences.ts';
import { createDeveloperPage } from './dev/preferencesPage.ts';
import { DEVTOOL_INTERFACE, DEVTOOL_PATH } from './dev/protocol.ts';

export default class DevelopmentPreferences extends GeneralPreferences {
  override async fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
    await super.fillPreferencesWindow(window);
    const page = createDeveloperPage(window);
    window.add(page);
    const cancellable = new Gio.Cancellable();
    async function selectRequestedPage() {
      try {
        const reply = await Gio.DBus.session.call(
          'org.gnome.Shell',
          DEVTOOL_PATH,
          DEVTOOL_INTERFACE,
          'TakeLaunchRequest',
          null,
          null,
          Gio.DBusCallFlags.NO_AUTO_START,
          2000,
          cancellable,
        );
        if (!cancellable.is_cancelled() && reply.get_child_value(0).get_boolean()) {
          window.visible_page = page;
          if (window.visible) window.present();
        }
      } catch {
        // A development package can open preferences without an active DevTool service.
      }
    }
    const subscription = Gio.DBus.session.signal_subscribe(
      'org.gnome.Shell',
      DEVTOOL_INTERFACE,
      'LaunchRequested',
      DEVTOOL_PATH,
      null,
      Gio.DBusSignalFlags.NONE,
      () => void selectRequestedPage(),
    );
    window.connect('close-request', () => {
      cancellable.cancel();
      Gio.DBus.session.signal_unsubscribe(subscription);
      return false;
    });
    await selectRequestedPage();
  }
}
