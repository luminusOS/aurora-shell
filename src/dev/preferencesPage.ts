import Adw from '@girs/adw-1';
import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import Gtk from '@girs/gtk-4.0';
import { gettext as _ } from '~/shared/i18n.ts';
import { DEVTOOL_PATH, DEVTOOL_INTERFACE, type ToolInfo } from './protocol.ts';

Gio._promisify(Gio.DBusConnection.prototype, 'call');

export function createDeveloperPage(window: Adw.PreferencesWindow): Adw.PreferencesPage {
  const page = new Adw.PreferencesPage({
    name: 'devtools',
    title: _('Developer Tools'),
    icon_name: 'applications-engineering-symbolic',
  });
  const group = new Adw.PreferencesGroup({ title: _('Live development controls') });
  page.add(group);
  const refresh = new Gtk.Button({
    icon_name: 'view-refresh-symbolic',
    tooltip_text: _('Refresh'),
  });
  group.header_suffix = refresh;
  const expanded = new Set<string>();
  const rows: Adw.ExpanderRow[] = [];
  let pending: Gio.Cancellable | null = null;

  async function update(parameters: GLib.Variant | null = null) {
    if (pending) return;
    const request = new Gio.Cancellable();
    pending = request;
    group.sensitive = false;
    const call = (method: string, args: GLib.Variant | null) =>
      Gio.DBus.session.call(
        'org.gnome.Shell',
        DEVTOOL_PATH,
        DEVTOOL_INTERFACE,
        method,
        args,
        null,
        Gio.DBusCallFlags.NO_AUTO_START,
        5000,
        request,
      );
    try {
      if (parameters) {
        try {
          await call('Run', parameters);
        } catch (error) {
          if (!request.is_cancelled()) window.add_toast(new Adw.Toast({ title: String(error) }));
        }
      }
      const reply = await call('Describe', null);
      if (request.is_cancelled()) return;
      const [json] = reply.deepUnpack() as [string];
      const tools = JSON.parse(json) as ToolInfo[];
      for (const row of rows.splice(0)) group.remove(row);
      group.description = '';
      for (const tool of tools) {
        const row = new Adw.ExpanderRow({
          title: tool.title,
          subtitle: tool.details.join('\n'),
          use_markup: false,
        });
        for (const action of tool.actions) {
          const item = new Adw.ActionRow({
            title: action.label,
            use_markup: false,
            activatable: true,
            sensitive: !action.disabled,
          });
          item.add_suffix(
            new Gtk.Image({
              icon_name: action.active ? 'object-select-symbolic' : 'media-playback-start-symbolic',
            }),
          );
          item.connect(
            'activated',
            () => void update(new GLib.Variant('(ss)', [tool.key, action.id])),
          );
          row.add_row(item);
        }
        group.add(row);
        rows.push(row);
        row.expanded = expanded.has(tool.key);
        row.connect('notify::expanded', () => {
          if (row.expanded) expanded.add(tool.key);
          else expanded.delete(tool.key);
        });
      }
    } catch {
      if (!request.is_cancelled()) {
        for (const row of rows.splice(0)) group.remove(row);
        group.description = _(
          'Start the development session with AURORA_DEVTOOLS=1, then refresh.',
        );
      }
    } finally {
      if (pending === request) {
        pending = null;
        group.sensitive = true;
      }
    }
  }
  refresh.connect('clicked', () => void update());
  page.connect('map', () => void update());
  page.connect('unmap', () => {
    if (pending) pending.cancel();
    pending = null;
  });
  return page;
}
