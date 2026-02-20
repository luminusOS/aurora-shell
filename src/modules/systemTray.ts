import Clutter from '@girs/clutter-17';
import GLib from '@girs/glib-2.0';
import Shell from '@girs/shell-17';
import St from '@girs/st-17';

import * as Main from '@girs/gnome-shell/ui/main';
import { Button as PanelButton } from '@girs/gnome-shell/ui/panelMenu';

import { Module } from '../module.ts';

const PANEL_ICON_SIZE = 16;

/**
 * SystemTray Module
 *
 * Displays legacy X11 tray icons in the GNOME Shell top panel using a single
 * panel container with a box layout for all icons.
 */
export class SystemTray extends Module {
  private _tray: InstanceType<typeof Shell.TrayManager> | null = null;
  private _container: InstanceType<typeof PanelButton> | null = null;
  private _box: InstanceType<typeof St.BoxLayout> | null = null;
  private _icons = new Map<any, InstanceType<typeof St.Button>>();
  private _startupCompleteId: number | null = null;

  override enable(): void {
    this._container = new PanelButton(0.5, 'AuroraSystemTray', true);
    this._box = new St.BoxLayout({ style_class: 'panel-status-indicators-box' });
    this._container.add_child(this._box);

    this._tray = new Shell.TrayManager();
    this._tray.connect('tray-icon-added', (_o: any, icon: any) => this._onTrayIconAdded(icon));
    this._tray.connect('tray-icon-removed', (_o: any, icon: any) => this._onTrayIconRemoved(icon));
    this._tray.manage_screen(Main.panel);

    if (Main.layoutManager._startingUp) {
      this._startupCompleteId = Main.layoutManager.connect('startup-complete', () => {
        Main.panel.addToStatusArea('AuroraSystemTray', this._container!);
        Main.layoutManager.disconnect(this._startupCompleteId!);
        this._startupCompleteId = null;
      });
    } else {
      Main.panel.addToStatusArea('AuroraSystemTray', this._container);
    }
  }

  override disable(): void {
    if (this._startupCompleteId !== null) {
      Main.layoutManager.disconnect(this._startupCompleteId);
      this._startupCompleteId = null;
    }

    this._icons.forEach((button) => button.destroy());
    this._icons.clear();

    this._tray = null;

    this._container?.destroy();
    this._container = null;
    this._box = null;
  }

  private _onTrayIconAdded(icon: any): void {
    const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
    const iconSize = PANEL_ICON_SIZE * scaleFactor;

    icon.set({
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
      reactive: true,
    });

    const button = new St.Button({
      child: icon,
      button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO | St.ButtonMask.THREE,
      style_class: 'panel-button',
    });

    // Delay sizing to allow the icon to initialize its X11 embedding
    icon.opacity = 0;
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
      if (!icon.get_parent()) return GLib.SOURCE_REMOVE;
      icon.set_size(iconSize, iconSize);
      icon.ease({
        opacity: 255,
        duration: 300,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      });
      return GLib.SOURCE_REMOVE;
    });

    button.connect('button-release-event', (_actor: any, event: any) => icon.click(event));

    this._icons.set(icon, button);
    this._box?.insert_child_at_index(button, 0);
  }

  private _onTrayIconRemoved(icon: any): void {
    const button = this._icons.get(icon);
    button?.destroy();
    this._icons.delete(icon);
  }
}
