import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

Gtk.init();
const loop = new GLib.MainLoop(null, false);
const window = new Gtk.Window({
  default_width: 320,
  default_height: 240,
  title: 'Aurora Wayland Popup Test',
});
const anchor = new Gtk.Button({ label: 'Popup anchor' });
const popup = new Gtk.Popover({ child: new Gtk.Label({ label: 'Application popup' }) });
popup.set_parent(anchor);
window.set_child(anchor);
window.connect('close-request', () => loop.quit());
window.present();
GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
  popup.popup();
  return GLib.SOURCE_REMOVE;
});

loop.run();
