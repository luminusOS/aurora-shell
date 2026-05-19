import '@girs/gjs';
import { gettext as _ } from 'gettext';

import St from '@girs/st-18';
import Gio from '@girs/gio-2.0';

import type { QuickSlider } from '@girs/gnome-shell/ui/quickSettings';
import type { QuickSettings } from '@girs/gnome-shell/ui/panel';
import { PopupAnimation } from '@girs/gnome-shell/ui/boxpointer';
import * as Main from '@girs/gnome-shell/ui/main';
import * as PopupMenu from '@girs/gnome-shell/ui/popupMenu';
import type { ExtensionContext } from '~/core/context.ts';
import { logger } from '~/core/logger.ts';
import { Module } from '~/module.ts';
import type { ModuleDefinition } from '~/module.ts';
import { VolumeMixerPanel } from '~/modules/volumeMixer/mixerPanel.ts';
import { loadIcon } from '~/shared/icons.ts';

const LOG_PREFIX = 'VolumeMixer';

/**
 * Volume Mixer Module
 *
 * Adds a toggle button beside the output slider's device-list icon in Quick
 * Settings. Clicking it opens the slider menu with the following layout:
 *
 *   [header]           "Volume Mixer"
 *   [_menuSection]     per-application sliders   ← before separator
 *   [separator]        ─────────────────────────
 *   [_settingsSection] "Sound Settings" link      ← after separator
 *
 * OutputStreamSlider already calls setHeader() in its own _init(), so by the
 * time _attachToSlider() runs the menu already contains:
 *   header(0) · separator(1) · deviceSection(2) · …
 * We insert _menuSection at 1 (shifting separator to 2) and _settingsSection
 * at 3 (between separator and deviceSection).
 */
export class VolumeMixer extends Module {
  private _panel: InstanceType<typeof VolumeMixerPanel> | null = null;
  private _toggleButton: St.Button | null = null;
  private _menuSection: InstanceType<typeof PopupMenu.PopupMenuSection> | null = null;
  private _settingsSection: InstanceType<typeof PopupMenu.PopupMenuSection> | null = null;
  private _outputSlider: QuickSlider | null = null;
  private _menuClosedId = 0;
  private _toggleClickedId = 0;
  private _gridChildAddedId = 0;
  private _quickSettings: QuickSettings | null = null;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this._quickSettings = Main.panel.statusArea.quickSettings;

    const outputSlider = this._findOutputSlider();
    if (outputSlider) {
      this._attachToSlider(outputSlider);
      return;
    }

    const grid = Main.panel.statusArea.quickSettings?.menu?._grid;
    if (!grid) {
      logger.error('Could not find quick settings grid', { prefix: LOG_PREFIX });
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

    if (this._toggleClickedId && this._toggleButton) {
      this._toggleButton.disconnect(this._toggleClickedId);
      this._toggleClickedId = 0;
    }

    if (this._toggleButton) {
      this._toggleButton.destroy();
      this._toggleButton = null;
    }

    if (this._panel) {
      this._panel.destroy();
      this._panel = null;
    }

    if (this._menuSection) {
      this._menuSection.destroy();
      this._menuSection = null;
    }

    if (this._settingsSection) {
      this._settingsSection.destroy();
      this._settingsSection = null;
    }

    this._outputSlider = null;
  }

  private _findOutputSlider(): QuickSlider | null {
    const grid = this._quickSettings?.menu?._grid;

    if (!grid) {
      logger.error('Could not find quick settings grid', { prefix: LOG_PREFIX });
      return null;
    }

    for (const child of grid.get_children()) {
      if (child.constructor.name === 'OutputStreamSlider') {
        return child as QuickSlider;
      }
    }

    return null;
  }

  private _attachToSlider(slider: QuickSlider): void {
    this._outputSlider = slider;
    this._panel = new (VolumeMixerPanel as unknown as new (
      ctx: ExtensionContext,
    ) => VolumeMixerPanel)(this.context);
    this._menuSection = new PopupMenu.PopupMenuSection();

    this._menuSection.box.add_child(this._panel);
    slider.menu.addMenuItem(this._menuSection, 1);
    this._menuSection.box.hide();

    this._settingsSection = new PopupMenu.PopupMenuSection();
    const settingsItem = new PopupMenu.PopupMenuItem(_('Sound Settings'));
    settingsItem.connect('activate', () => {
      try {
        Gio.Subprocess.new(['gnome-control-center', 'sound'], Gio.SubprocessFlags.NONE);
      } catch (e) {
        logger.error(`Failed to open sound settings: ${e}`, { prefix: LOG_PREFIX });
      }
      this._quickSettings?.menu.close(PopupAnimation.FULL);
    });
    this._settingsSection.addMenuItem(settingsItem);
    slider.menu.addMenuItem(this._settingsSection, 3);
    this._settingsSection.box.hide();

    this._toggleButton = new St.Button({
      child: new St.Icon({ gicon: loadIcon('volume-mixer-symbolic') }),
      style_class: 'icon-button flat',
      can_focus: true,
      x_expand: false,
      y_expand: true,
      accessible_name: _('Volume Mixer'),
    });

    slider.child.add_child(this._toggleButton);

    this._toggleClickedId = this._toggleButton.connect('clicked', () => {
      if (!this._panel || !this._menuSection || !this._settingsSection) return;

      this._menuSection.box.show();
      this._settingsSection.box.show();
      (slider as any)._deviceSection?.box.hide();
      slider.menu._setSettingsVisibility?.(false);
      slider.menu.setHeader('audio-speakers-symbolic', _('Volume Mixer'));
      slider.menu.open(PopupAnimation.FULL);
    });

    this._menuClosedId = slider.menu.connect('menu-closed', () => {
      if (!this._menuSection || !this._settingsSection) return undefined;
      this._menuSection.box.hide();
      this._settingsSection.box.hide();
      (slider as any)._deviceSection?.box.show();
      slider.menu._setSettingsVisibility?.(Main.sessionMode.allowSettings);
      slider.menu.setHeader('audio-headphones-symbolic', _('Sound Output'));
      return undefined;
    });
  }
}

export const definition: ModuleDefinition = {
  key: 'volume-mixer',
  settingsKey: 'module-volume-mixer',
  title: _('Volume Mixer'),
  subtitle: _('Per-application volume control in Quick Settings'),
  factory: (ctx) => new VolumeMixer(ctx),
};
