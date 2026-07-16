import '@girs/gjs';
import { gettext as _ } from '~/shared/i18n.ts';

import St from '@girs/st-18';
import Gio from '@girs/gio-2.0';

import type { QuickSlider } from '@girs/gnome-shell/ui/quickSettings';
import type { QuickSettings } from '@girs/gnome-shell/ui/panel';
import { PopupAnimation } from '@girs/gnome-shell/ui/boxpointer';
import * as Main from '@girs/gnome-shell/ui/main';
import * as PopupMenu from '@girs/gnome-shell/ui/popupMenu';
import type { ExtensionContext } from '~/core/context.ts';
import { LifecycleScope } from '~/core/lifecycleScope.ts';
import { logger } from '~/core/logger.ts';
import { Module } from '~/module.ts';
import { attachToQuickSettings } from '~/shared/quickSettings.ts';
import { VolumeMixerPanel } from '~/panel/volumeMixer/mixerPanel.ts';
import { createIcon } from '~/shared/icons.ts';

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
  private _lifecycle: LifecycleScope | null = null;
  private _quickSettings: QuickSettings | null = null;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this.disable();
    this._lifecycle = new LifecycleScope();
    this._quickSettings = Main.panel.statusArea.quickSettings;

    const detachQuickSettings = attachToQuickSettings(
      () => this._findOutputSlider(),
      (slider) => this._attachToSlider(slider),
    );
    if (!detachQuickSettings) {
      logger.error('Could not find quick settings grid', { prefix: LOG_PREFIX });
    } else {
      this._lifecycle.onDispose(detachQuickSettings);
    }
  }

  override disable(): void {
    this._lifecycle?.dispose();
    this._lifecycle = null;

    this._toggleButton?.destroy();
    this._toggleButton = null;
    this._panel?.destroy();
    this._panel = null;
    this._menuSection?.destroy();
    this._menuSection = null;
    this._settingsSection?.destroy();
    this._settingsSection = null;
  }

  private _findOutputSlider(): QuickSlider | null {
    const grid = this._quickSettings?.menu?._grid;
    if (!grid) return null;

    for (const child of grid.get_children()) {
      if (child.constructor.name === 'OutputStreamSlider') {
        return child as QuickSlider;
      }
    }

    return null;
  }

  private _attachToSlider(slider: QuickSlider): void {
    const lifecycle = this._lifecycle;
    if (!lifecycle) return;

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
      child: createIcon('volume-mixer-symbolic'),
      style_class: 'icon-button flat',
      can_focus: true,
      x_expand: false,
      y_expand: true,
      accessible_name: _('Volume Mixer'),
    });

    slider.child.add_child(this._toggleButton);

    const toggleButton = this._toggleButton;
    const toggleClickedId = toggleButton.connect('clicked', () => {
      if (!this._panel || !this._menuSection || !this._settingsSection) return;

      this._menuSection.box.show();
      this._settingsSection.box.show();
      (slider as any)._deviceSection?.box.hide();
      slider.menu._setSettingsVisibility?.(false);
      slider.menu.setHeader('audio-speakers-symbolic', _('Volume Mixer'));
      slider.menu.open(PopupAnimation.FULL);
    });
    lifecycle.onDispose(() => toggleButton.disconnect(toggleClickedId));

    const menuClosedId = slider.menu.connect('menu-closed', () => {
      if (!this._menuSection || !this._settingsSection) return undefined;
      this._menuSection.box.hide();
      this._settingsSection.box.hide();
      (slider as any)._deviceSection?.box.show();
      slider.menu._setSettingsVisibility?.(Main.sessionMode.allowSettings);
      slider.menu.setHeader('audio-headphones-symbolic', _('Sound Output'));
      return undefined;
    });
    lifecycle.onDispose(() => slider.menu.disconnect(menuClosedId));
  }
}
