// @ts-nocheck
import '@girs/gjs';

import St from '@girs/st-17';

import type { QuickSlider } from '@girs/gnome-shell/ui/quickSettings';
import * as Main from '@girs/gnome-shell/ui/main';
import * as PopupMenu from '@girs/gnome-shell/ui/popupMenu';

import { Module } from '~/module.ts';
import { VolumeMixerPanel } from '~/modules/volumeMixer/mixerPanel.ts';

/**
 * Volume Mixer Module
 *
 * Adds a toggle button beside the output slider's device-list icon in Quick
 * Settings. Clicking it opens the slider menu with an additional section that
 * shows per-application volume sliders.
 */
export class VolumeMixer extends Module {
  private _panel: InstanceType<typeof VolumeMixerPanel> | null = null;
  private _toggleButton: St.Button | null = null;
  private _menuSection: InstanceType<typeof PopupMenu.PopupMenuSection> | null =
    null;
  private _outputSlider: QuickSlider | null = null;
  private _menuClosedId = 0;
  private _gridChildAddedId = 0;

  override enable(): void {
    const outputSlider = this._findOutputSlider();
    if (outputSlider) {
      this._attachToSlider(outputSlider);
      return;
    }

    const grid = Main.panel.statusArea.quickSettings?.menu?._grid;
    if (!grid) {
      console.error('Aurora Shell: VolumeMixer could not find quick settings grid');
      return;
    }

    this._gridChildAddedId = grid.connect('child-added', () => {
      if (this._outputSlider) return;
      const slider = this._findOutputSlider();
      if (slider) {
        grid.disconnect(this._gridChildAddedId);
        this._gridChildAddedId = 0;
        this._attachToSlider(slider);
      }
    });
  }

  override disable(): void {
    if (this._gridChildAddedId) {
      Main.panel.statusArea.quickSettings?.menu?._grid?.disconnect(this._gridChildAddedId);
      this._gridChildAddedId = 0;
    }

    if (this._menuClosedId && this._outputSlider) {
      this._outputSlider.menu.disconnect(this._menuClosedId);
      this._menuClosedId = 0;
    }

    if (this._toggleButton) {
      this._toggleButton.destroy();
      this._toggleButton = null;
    }

    if (this._menuSection) {
      this._menuSection.destroy();
      this._menuSection = null;
    }

    if (this._panel) {
      this._panel.destroy();
      this._panel = null;
    }

    this._outputSlider = null;
  }

  private _findOutputSlider(): QuickSlider | null {
    const quickSettings = Main.panel.statusArea.quickSettings;
    const grid = quickSettings.menu._grid;

    for (const child of grid.get_children()) {
      if (child.constructor.name === 'OutputStreamSlider') {
        return child as QuickSlider;
      }
    }

    return null;
  }

  /**
   * Attaches the volume mixer toggle button and panel to the output stream
   * slider's popup menu. Clicking the button opens a menu showing only
   * per-application volume sliders.
   */
  private _attachToSlider(slider: QuickSlider): void {
    this._outputSlider = slider;
    this._panel = new VolumeMixerPanel();
    this._menuSection = new PopupMenu.PopupMenuSection();
    this._menuSection.box.add_child(this._panel);
    this._menuSection.box.hide();

    slider.menu.addMenuItem(this._menuSection, 2);

    this._toggleButton = new St.Button({
      child: new St.Icon({ icon_name: 'open-menu-symbolic' }),
      style_class: 'icon-button flat',
      can_focus: true,
      x_expand: false,
      y_expand: true,
      accessible_name: _('Volume Mixer'),
    });

    slider.child.add_child(this._toggleButton);

    this._toggleButton.connect('clicked', () => {
      if (!this._panel || !this._menuSection) return;

      this._menuSection.box.show();
      slider._deviceSection?.box.hide();
      slider.menu._setSettingsVisibility?.(false);
      slider.menu.setHeader('audio-speakers-symbolic', _('Volume Mixer'));
      slider.menu.open(true);
    });

    this._menuClosedId = slider.menu.connect('menu-closed', () => {
      if (!this._menuSection) return;
      this._menuSection.box.hide();
      slider._deviceSection?.box.show();
      slider.menu._setSettingsVisibility?.(Main.sessionMode.allowSettings);
      slider.menu.setHeader('audio-headphones-symbolic', _('Sound Output'));
    });
  }
}
