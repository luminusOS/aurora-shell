import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { Module } from '~/module.ts';
import { LifecycleScope } from '~/core/lifecycleScope.ts';

const PANEL = 'aurora-translucent-panel';
const DOCK = 'aurora-translucent-docks';
const BLUR = 'aurora-panel-backdrop-blur';

export class ShellBackgroundEffects extends Module {
  private _scope: LifecycleScope | null = null;

  override enable(): void {
    const scope = new LifecycleScope();
    this._scope = scope;
    const settings = this.context.settings.getRawSettings();
    const accessibility = St.Settings.get();
    const theme = St.ThemeContext.get_for_stage(global.stage);
    const sync = () => {
      const panel =
        !accessibility.high_contrast && settings.get_boolean('shell-background-effects-panel');
      const dock =
        !accessibility.high_contrast && settings.get_boolean('shell-background-effects-dock');
      if (panel) Main.panel.add_style_class_name(PANEL);
      else Main.panel.remove_style_class_name(PANEL);
      if (dock) Main.uiGroup.add_style_class_name(DOCK);
      else Main.uiGroup.remove_style_class_name(DOCK);

      if (panel && settings.get_boolean('shell-background-effects-blur')) {
        const radius = 12 * theme.scale_factor;
        const effect = Main.panel.get_effect(BLUR);
        if (effect instanceof Shell.BlurEffect) effect.radius = radius;
        else
          Main.panel.add_effect_with_name(
            BLUR,
            new Shell.BlurEffect({ mode: Shell.BlurMode.BACKGROUND, radius, brightness: 1 }),
          );
      } else if (Main.panel.get_effect(BLUR)) Main.panel.remove_effect_by_name(BLUR);
    };
    scope.connect(settings, 'changed::shell-background-effects-panel', sync);
    scope.connect(settings, 'changed::shell-background-effects-dock', sync);
    scope.connect(settings, 'changed::shell-background-effects-blur', sync);
    scope.connect(accessibility, 'notify::high-contrast', sync);
    scope.connect(theme, 'notify::scale-factor', sync);
    sync();
  }

  override disable(): void {
    this._scope?.dispose();
    this._scope = null;
    Main.panel.remove_style_class_name(PANEL);
    Main.uiGroup.remove_style_class_name(DOCK);
    if (Main.panel.get_effect(BLUR)) Main.panel.remove_effect_by_name(BLUR);
  }
}
