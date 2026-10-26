import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import System from 'system';

const { buildBrightnessCalibrationRow } = await import(globalThis.ARGV[0]);
Adw.init();
const window = new Adw.PreferencesWindow({
  title: 'Brightness preferences test',
  default_width: 640,
  default_height: 720,
});
const page = new Adw.PreferencesPage();
const group = new Adw.PreferencesGroup();
const settings = new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.aurora-shell' });
group.add(
  buildBrightnessCalibrationRow('Monitor calibration', 'Configure raw DDC limits', settings),
);
page.add(group);
window.add(page);

function findWidget(root, predicate) {
  if (predicate(root)) return root;
  for (let child = root.get_first_child(); child; child = child.get_next_sibling()) {
    const found = findWidget(child, predicate);
    if (found) return found;
  }
  return null;
}

function waitForUi(evaluate, description) {
  return new Promise((resolve, reject) => {
    let tick = 0;
    const watchdog = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 8000, () => {
      window.remove_tick_callback(tick);
      const titles = [];
      findWidget(window, (widget) => {
        if (widget instanceof Adw.PreferencesRow || widget instanceof Adw.PreferencesGroup)
          titles.push(`${widget.title}: ${widget.subtitle || widget.description || ''}`);
        return false;
      });
      reject(new Error(`Timeout: ${description}; visible: ${titles.join(' | ')}`));
      return GLib.SOURCE_REMOVE;
    });
    tick = window.add_tick_callback(() => {
      try {
        const result = evaluate();
        if (result) {
          GLib.source_remove(watchdog);
          resolve(result);
          return GLib.SOURCE_REMOVE;
        }
      } catch (error) {
        GLib.source_remove(watchdog);
        reject(error);
        return GLib.SOURCE_REMOVE;
      }
      return GLib.SOURCE_CONTINUE;
    });
  });
}

async function run() {
  window.present();
  const configure = await waitForUi(
    () =>
      findWidget(window, (widget) => widget instanceof Gtk.Button && widget.label === 'Configure…'),
    'preferences configure action',
  );
  configure.emit('clicked');
  const target = await waitForUi(
    () =>
      findWidget(
        window,
        (widget) => widget instanceof Adw.PreferencesGroup && widget.title === 'TEST-27',
      ),
    'live monitor list',
  );
  const minimum = findWidget(
    target,
    (widget) => widget instanceof Adw.EntryRow && widget.title === 'Minimum raw value',
  );
  const maximum = findWidget(
    target,
    (widget) => widget instanceof Adw.EntryRow && widget.title === 'Maximum raw value',
  );
  if (findWidget(target, (widget) => widget instanceof Adw.SwitchRow))
    throw new Error('Calibration still asks for a verification switch');
  const apply = findWidget(
    target,
    (widget) => widget instanceof Gtk.Button && widget.label === 'Apply limits',
  );
  minimum.text = '5';
  maximum.text = '4';
  if (apply.sensitive) throw new Error('An inverted preference range could be applied');
  maximum.text = '35';
  if (!apply.sensitive) throw new Error('Valid preference limits could not be applied');

  // Saving another display makes the Shell report a change, which refreshes the whole list.
  const otherGroup = () =>
    findWidget(
      window,
      (widget) => widget instanceof Adw.PreferencesGroup && widget.title === 'HOTPLUG-24',
    );
  findWidget(
    otherGroup(),
    (widget) => widget instanceof Gtk.Button && widget.label === 'Pause control',
  ).emit('clicked');
  await waitForUi(
    () =>
      findWidget(
        otherGroup(),
        (widget) => widget instanceof Adw.ActionRow && widget.title === 'Control paused',
      ),
    'the Shell to report the other display as paused',
  );
  const refreshedTarget = findWidget(
    window,
    (widget) => widget instanceof Adw.PreferencesGroup && widget.title === 'TEST-27',
  );
  if (refreshedTarget !== target || minimum.text !== '5' || maximum.text !== '35')
    throw new Error('A refresh replaced the limits being typed');

  const screenshotPath = GLib.getenv('AURORA_CALIBRATION_SCREENSHOT');
  if (screenshotPath) {
    await waitForUi(() => apply.get_mapped(), 'calibration fields to map');
    const paintable = new Gtk.WidgetPaintable({ widget: window });
    const snapshot = new Gtk.Snapshot();
    paintable.snapshot(snapshot, window.get_width(), window.get_height());
    const node = snapshot.to_node();
    if (!node) throw new Error('GTK did not produce a render node');
    window.get_renderer().render_texture(node, null).save_to_png(screenshotPath);
  }
  apply.emit('clicked');
  await waitForUi(
    () =>
      findWidget(
        window,
        (widget) => widget instanceof Adw.ActionRow && widget.title === 'Manual limits active',
      ),
    'configuration to reach the Shell',
  );
  window.close();
  // GJS console output goes to stderr; print() is the stdout contract checked by the Shell test.
  globalThis.print('GTK_CALIBRATION_PASS');
}

let exitCode = 0;
try {
  await run();
} catch (error) {
  console.error(`${error}\n${error.stack}`);
  exitCode = 1;
} finally {
  window.close();
}
System.exit(exitCode);
