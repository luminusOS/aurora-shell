import '@girs/gjs';

import Adw from '@girs/adw-1';
import Gdk from '@girs/gdk-4.0';
import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import Gtk from '@girs/gtk-4.0';

import { ExtensionPreferences, gettext as _ } from '@girs/gnome-shell/extensions/prefs';
import {
  getModuleMetadata,
  getSections,
  type ModuleMetadata,
  type ModuleOption,
} from '~/prefsMetadata.ts';

const OTHER_SECTION_ID = '__other__';
const LOGO_FILENAME = 'aurora-shell-logo.svg';
const WEBSITE_URL = 'https://github.com/luminusOS/aurora-shell';

export default class AuroraShellPreferences extends ExtensionPreferences {
  override fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
    const settings = this.getSettings();
    this._registerIconSearchPaths(window);

    const page = new Adw.PreferencesPage({
      title: _('General'),
      icon_name: 'dialog-information-symbolic',
    });

    const modules = getModuleMetadata();
    const sections = [...getSections(), { id: OTHER_SECTION_ID, title: _('Other') }];
    const knownIds = new Set(getSections().map((s) => s.id));

    page.add(this._buildLogoGroup());

    for (const section of sections) {
      const members = modules.filter((def) =>
        section.id === OTHER_SECTION_ID ? !knownIds.has(def.section) : def.section === section.id,
      );
      if (members.length === 0) continue;

      const group = new Adw.PreferencesGroup({ title: section.title });
      for (const def of members) {
        group.add(this._buildModuleRow(def, settings));
      }
      page.add(group);
    }

    window.add(page);

    return Promise.resolve();
  }

  private _buildLogoGroup(): Adw.PreferencesGroup {
    const group = new Adw.PreferencesGroup();
    const logoPath = GLib.build_filenamev([this.path, 'media', LOGO_FILENAME]);
    const logoFile = Gio.File.new_for_path(logoPath);

    const logo = Gtk.Picture.new_for_file(logoFile);
    logo.alternative_text = _('Aurora Shell logo');
    logo.can_shrink = true;
    logo.content_fit = Gtk.ContentFit.CONTAIN;
    logo.halign = Gtk.Align.CENTER;
    logo.valign = Gtk.Align.CENTER;
    logo.set_size_request(96, 96);

    const box = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      halign: Gtk.Align.CENTER,
      spacing: 10,
      margin_top: 18,
      margin_bottom: 10,
    });
    box.append(logo);
    box.append(this._buildWebsiteButton());

    group.add(box);
    return group;
  }

  private _buildWebsiteButton(): Gtk.LinkButton {
    const websiteUrl = this.metadata['url'] ?? WEBSITE_URL;
    const label = _('Access website');
    const content = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      spacing: 6,
      halign: Gtk.Align.CENTER,
      valign: Gtk.Align.CENTER,
    });

    content.append(
      new Gtk.Image({
        icon_name: 'insert-link-symbolic',
        pixel_size: 16,
      }),
    );
    content.append(new Gtk.Label({ label }));

    const button = Gtk.LinkButton.new(websiteUrl);
    button.set_child(content);
    button.tooltip_text = websiteUrl;
    button.halign = Gtk.Align.CENTER;
    button.valign = Gtk.Align.CENTER;

    return button;
  }

  private _registerIconSearchPaths(window: Gtk.Widget): void {
    const iconTheme = Gtk.IconTheme.get_for_display(window.get_display());

    for (const relativePath of ['icons', 'data/icons']) {
      const iconPath = GLib.build_filenamev([this.path, relativePath]);
      if (GLib.file_test(iconPath, GLib.FileTest.IS_DIR)) iconTheme.add_search_path(iconPath);
    }
  }

  private _buildModuleRow(def: ModuleMetadata, settings: Gio.Settings): Adw.PreferencesRow {
    if (def.options && def.options.length > 0) {
      return this._buildExpanderRow(def, settings);
    }

    const row = new Adw.SwitchRow({
      title: def.title,
      subtitle: def.subtitle,
    });
    settings.bind(def.settingsKey, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
  }

  private _buildExpanderRow(def: ModuleMetadata, settings: Gio.Settings): Adw.ExpanderRow {
    const expander = new Adw.ExpanderRow({
      title: def.title,
      subtitle: def.subtitle,
      show_enable_switch: true,
    });

    settings.bind(def.settingsKey, expander, 'enable-expansion', Gio.SettingsBindFlags.DEFAULT);

    for (const option of def.options!) {
      if (option.type === 'switch') {
        const row = new Adw.SwitchRow({
          title: option.title,
          subtitle: option.subtitle,
        });
        settings.bind(option.key!, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        expander.add_row(row);
      } else if (option.type === 'entry') {
        const row = new Adw.EntryRow({
          title: option.title,
        });
        settings.bind(option.key!, row, 'text', Gio.SettingsBindFlags.DEFAULT);
        expander.add_row(row);
      } else if (option.type === 'spin') {
        const row = new Adw.SpinRow({
          title: option.title,
          subtitle: option.subtitle,
          adjustment: new Gtk.Adjustment({
            lower: option.min ?? 0,
            upper: option.max ?? 100,
            step_increment: 1,
            page_increment: 10,
          }),
        });
        settings.bind(option.key!, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        expander.add_row(row);
      } else if (option.type === 'time') {
        const row = new Adw.ActionRow({
          title: option.title,
          subtitle: option.subtitle,
        });

        const timeBox = new Gtk.Box({
          orientation: Gtk.Orientation.HORIZONTAL,
          spacing: 6,
          valign: Gtk.Align.CENTER,
        });

        const hSpin = new Gtk.SpinButton({
          adjustment: new Gtk.Adjustment({
            lower: 0,
            upper: 23,
            step_increment: 1,
            page_increment: 1,
          }),
          orientation: Gtk.Orientation.VERTICAL,
          numeric: true,
          wrap: true,
          valign: Gtk.Align.CENTER,
        });

        const separator = new Gtk.Label({
          label: ':',
          valign: Gtk.Align.CENTER,
        });

        const mSpin = new Gtk.SpinButton({
          adjustment: new Gtk.Adjustment({
            lower: 0,
            upper: 59,
            step_increment: 1,
            page_increment: 10,
          }),
          orientation: Gtk.Orientation.VERTICAL,
          numeric: true,
          wrap: true,
          valign: Gtk.Align.CENTER,
        });

        settings.bind(option.hourKey!, hSpin, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind(option.minuteKey!, mSpin, 'value', Gio.SettingsBindFlags.DEFAULT);

        timeBox.append(hSpin);
        timeBox.append(separator);
        timeBox.append(mSpin);

        row.add_suffix(timeBox);
        expander.add_row(row);
      } else if (option.type === 'shortcut') {
        expander.add_row(
          this._buildShortcutRow(option.key!, option.title, option.subtitle, settings),
        );
      } else if (option.type === 'icon-select') {
        expander.add_row(this._buildIconSelectRow(option, settings));
      }
    }

    return expander;
  }

  private _buildIconSelectRow(option: ModuleOption, settings: Gio.Settings): Adw.ActionRow {
    const choices = option.choices ?? [];
    const row = new Adw.ActionRow({
      title: option.title,
      subtitle: option.subtitle,
    });

    const selectedIcon = new Gtk.Image({
      icon_name: 'image-missing-symbolic',
      pixel_size: 20,
      valign: Gtk.Align.CENTER,
    });
    const button = new Gtk.Button({
      child: selectedIcon,
      valign: Gtk.Align.CENTER,
      tooltip_text: option.title,
    });
    button.add_css_class('flat');

    const popover = new Gtk.Popover({
      autohide: true,
      has_arrow: true,
      position: Gtk.PositionType.BOTTOM,
    });
    popover.set_parent(button);

    const grid = new Gtk.Grid({
      column_spacing: 6,
      column_homogeneous: true,
      row_spacing: 6,
    });

    for (const [index, choice] of choices.entries()) {
      const icon = new Gtk.Image({
        icon_name: choice.iconName ?? 'image-missing-symbolic',
        pixel_size: 24,
        valign: Gtk.Align.CENTER,
        halign: Gtk.Align.CENTER,
      });

      const choiceButton = new Gtk.Button({
        child: icon,
        has_frame: false,
        tooltip_text: choice.title,
      });
      choiceButton.add_css_class('flat');
      choiceButton.set_size_request(44, 44);
      choiceButton.connect('clicked', () => {
        settings.set_string(option.key!, choice.value);
        popover.popdown();
      });

      grid.attach(choiceButton, index % 6, Math.floor(index / 6), 1, 1);
    }

    const popoverBox = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      margin_top: 6,
      margin_bottom: 6,
      margin_start: 6,
      margin_end: 6,
    });
    popoverBox.append(grid);
    popover.set_child(popoverBox);

    const syncSelection = () => {
      if (choices.length === 0) return;

      const selected =
        choices.find((choice) => choice.value === settings.get_string(option.key!)) ?? choices[0]!;
      selectedIcon.icon_name = selected.iconName ?? 'image-missing-symbolic';
      button.tooltip_text = selected.title;
    };

    button.connect('clicked', () => popover.popup());

    settings.connect(`changed::${option.key!}`, syncSelection);
    syncSelection();

    row.add_suffix(button);
    row.activatable_widget = button;
    return row;
  }

  private _buildShortcutRow(
    key: string,
    title: string,
    subtitle: string,
    settings: Gio.Settings,
  ): Adw.ActionRow {
    const row = new Adw.ActionRow({ title, subtitle });

    const label = new Gtk.ShortcutLabel({
      valign: Gtk.Align.CENTER,
      disabled_text: _('Disabled'),
    });
    const button = new Gtk.Button({
      child: label,
      valign: Gtk.Align.CENTER,
      has_frame: true,
    });

    const syncLabel = () => {
      label.accelerator = settings.get_strv(key)[0] ?? '';
    };
    syncLabel();

    const controller = new Gtk.EventControllerKey();
    button.add_controller(controller);

    let capturing = false;
    const stopCapturing = () => {
      capturing = false;
      button.remove_css_class('accent');
      syncLabel();
    };

    button.connect('clicked', () => {
      if (capturing) {
        stopCapturing();
        return;
      }
      capturing = true;
      button.add_css_class('accent');
      label.accelerator = '';
      label.disabled_text = _('Press a shortcut…');
    });

    controller.connect('key-pressed', (_c, keyval, _keycode, state) => {
      if (!capturing) return false;

      // Escape cancels; Backspace/Delete clears the binding.
      if (keyval === Gdk.KEY_Escape) {
        label.disabled_text = _('Disabled');
        stopCapturing();
        return true;
      }
      if (keyval === Gdk.KEY_BackSpace || keyval === Gdk.KEY_Delete) {
        settings.set_strv(key, []);
        label.disabled_text = _('Disabled');
        stopCapturing();
        return true;
      }

      const mask = state & Gtk.accelerator_get_default_mod_mask();
      if (mask === 0) return true; // require a modifier
      if (!Gtk.accelerator_valid(keyval, mask)) return true;

      const accel = Gtk.accelerator_name(keyval, mask);
      settings.set_strv(key, [accel]);
      label.disabled_text = _('Disabled');
      stopCapturing();
      return true;
    });

    settings.connect(`changed::${key}`, syncLabel);

    row.add_suffix(button);
    row.activatable_widget = button;
    return row;
  }
}
