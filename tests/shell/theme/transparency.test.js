import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {
  EXTENSION_UUID,
  getAuroraModule,
  getAuroraSettings,
  waitForExtension,
  waitForModuleState,
} from '../support/testUtils.js';

export async function run() {
  await waitForExtension(EXTENSION_UUID);
  const settings = getAuroraSettings();
  const accessibility = new Gio.Settings({ schema_id: 'org.gnome.desktop.a11y.interface' });
  const key = 'module-shell-background-effects';
  settings.set_boolean(key, true);
  await waitForModuleState(settings, key, 'shell-background-effects', true);
  await Scripting.waitLeisure();
  const dock = getAuroraModule('dock');
  Main.overview.hide();
  await Scripting.waitLeisure();
  const background = dock.bindings[0].dash._background;
  for (const widget of [Main.panel, background]) {
    const alpha = widget.get_theme_node().get_background_color().alpha;
    if (!(alpha > 0 && alpha < 255))
      throw new Error(`Expected translucent ${widget}, got ${alpha}`);
  }
  const blur = () => Main.panel.get_effect('aurora-panel-backdrop-blur');
  if (blur()) throw new Error('Transparency alone installed a blur effect');
  settings.set_boolean('shell-background-effects-blur', true);
  await Scripting.waitLeisure();
  if (!(blur() instanceof Shell.BlurEffect)) throw new Error('Missing native panel blur');
  accessibility.set_boolean('high-contrast', true);
  await Scripting.waitLeisure();
  if (blur() || Main.uiGroup.has_style_class_name('aurora-translucent-docks'))
    throw new Error('High contrast retained effects');
  accessibility.reset('high-contrast');
  await Scripting.waitLeisure();
  if (!blur()) throw new Error('Blur setting lost after leaving high contrast');
  settings.set_boolean(key, false);
  await waitForModuleState(settings, key, 'shell-background-effects', false);
  if (blur() || Main.panel.has_style_class_name('aurora-translucent-panel'))
    throw new Error('Effect survived module teardown');
}
