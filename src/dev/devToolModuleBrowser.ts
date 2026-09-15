import St from '@girs/st-18';
import Clutter from '@girs/clutter-18';
import Pango from '@girs/pango-1.0';

import type { SettingsManager } from '~/core/settings.ts';
import type { ModuleManifest } from '~/module.ts';
import { getSections, MODULE_CATALOG } from '~/moduleCatalog.ts';
import { gettext as _ } from '~/shared/i18n.ts';
import { createIcon } from '~/shared/icons.ts';

import { createDevToolGroup, createDevToolSwitch } from './devToolUi.ts';

type ModuleBrowserCallbacks = {
  openModule(key: string, returnFocusName: string): void;
};

const MODULE_ICONS: Record<string, string> = {
  'no-overview': 'view-app-grid-symbolic',
  'pip-on-top': 'view-pin-symbolic',
  'focus-launched-windows': 'focus-windows-symbolic',
  'capture-tools': 'camera-photo-symbolic',
  'theme-changer': 'preferences-desktop-appearance-symbolic',
  dock: 'view-app-grid-symbolic',
  'aurora-menu': 'aurora-shell-menu-symbolic',
  'power-menu-avatar': 'avatar-default-symbolic',
  'volume-mixer': 'audio-volume-high-symbolic',
  'low-battery-percentage': 'battery-level-20-symbolic',
  'lock-key-indicators': 'input-keyboard-symbolic',
  'xwayland-indicator': 'video-display-symbolic',
  privacy: 'changes-prevent-symbolic',
  'icon-weave': 'applications-graphics-symbolic',
  'app-search-tooltip': 'system-search-symbolic',
  'vela-vpn-quick-settings': 'network-vpn-symbolic',
  'auto-theme-switcher': 'weather-clear-night-symbolic',
  'bluetooth-menu': 'bluetooth-symbolic',
  'weather-clock': 'weather-clear-symbolic',
  'calendar-reminders': 'x-office-calendar-symbolic',
  'tray-icons': 'view-grid-symbolic',
  'clipboard-history': 'edit-paste-symbolic',
};

export function plainText(text: string): string {
  return text.replaceAll('&amp;', '&');
}

export class DevToolModuleBrowser {
  private _query = '';

  constructor(
    private readonly _settings: SettingsManager,
    private readonly _callbacks: ModuleBrowserCallbacks,
  ) {}

  resetQuery(): void {
    this._query = '';
  }

  buildSearch(viewport: St.Viewport): St.Widget {
    const box = new St.BoxLayout({ style_class: 'aurora-devtool-search-box' });
    const entry = new St.Entry({
      text: this._query,
      hint_text: _('Search modules'),
      can_focus: true,
      style_class: 'aurora-devtool-search',
      x_expand: true,
      name: 'aurora-devtool-focus-search',
    });
    entry.set_primary_icon(
      new St.Icon({
        icon_name: 'system-search-symbolic',
        icon_size: 15,
        style_class: 'aurora-devtool-search-icon',
      }),
    );
    entry.clutter_text.connect('text-changed', () => {
      this._query = entry.get_text();
      for (const child of viewport.get_children()) child.destroy();

      const page = this.buildRoot();
      page.x_expand = true;
      viewport.add_child(page);
    });
    box.add_child(entry);
    return box;
  }

  buildRoot(): St.Widget {
    const query = this._query.trim().toLocaleLowerCase();
    let matches = 0;
    const groups: St.Widget[] = [];
    const sections = getSections();
    const knownSections = new Set(sections.map((section) => section.id));
    for (const section of [...sections, { id: 'other', title: _('Other') }]) {
      const manifests = MODULE_CATALOG.filter((manifest) => {
        const belongs =
          section.id === 'other'
            ? !knownSections.has(manifest.section)
            : manifest.section === section.id;
        if (!belongs) return false;

        const haystack =
          `${plainText(manifest.title)} ${plainText(manifest.subtitle)}`.toLocaleLowerCase();
        return !query || haystack.includes(query);
      });
      if (manifests.length === 0) continue;

      matches += manifests.length;
      const group = createDevToolGroup(plainText(section.title));
      for (const manifest of manifests) group.list.add_child(this._buildModuleRow(manifest));
      groups.push(group.container);
    }
    if (query && matches === 0) return this._buildSearchStatusPage();

    const content = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      style_class: 'aurora-devtool-content',
    });
    content.add_child(
      new St.Label({ text: _('Modules'), style_class: 'aurora-devtool-page-title' }),
    );
    content.add_child(
      new St.Label({
        text: _('%d of %d modules · toggle a module or open its settings').format(
          matches,
          MODULE_CATALOG.length,
        ),
        style_class: 'aurora-devtool-page-subtitle',
      }),
    );
    for (const group of groups) content.add_child(group);
    return content;
  }

  private _buildSearchStatusPage(): St.Widget {
    const content = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      style_class: 'aurora-devtool-content',
    });
    const status = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      style_class: 'aurora-devtool-status-page',
      x_expand: true,
    });
    status.add_child(
      new St.Icon({
        icon_name: 'system-search-symbolic',
        icon_size: 72,
        style_class: 'aurora-devtool-status-icon',
        x_align: Clutter.ActorAlign.CENTER,
        opacity: 140,
      }),
    );
    status.add_child(
      new St.Label({
        text: _('No Results Found'),
        style_class: 'aurora-devtool-status-title',
      }),
    );
    const description = new St.Label({
      text: _('No modules match “%s”. Try a different search.').format(this._query.trim()),
      style_class: 'aurora-devtool-status-description',
      x_expand: true,
    });
    description.clutter_text.line_wrap = true;
    status.add_child(description);
    content.add_child(status);
    return content;
  }

  private _buildModuleRow(manifest: ModuleManifest): St.Widget {
    const enabled = this._settings.getBoolean(manifest.settingsKey);
    const row = new St.BoxLayout({
      style_class: 'aurora-devtool-row aurora-devtool-module-row',
      x_expand: true,
    });
    const openContent = new St.BoxLayout({
      style_class: 'aurora-devtool-navigation-content',
      x_expand: true,
    });
    openContent.add_child(
      createIcon(MODULE_ICONS[manifest.key] || 'application-x-addon-symbolic', {
        icon_size: 18,
        style_class: 'aurora-devtool-row-icon',
      }),
    );
    openContent.add_child(
      this._buildRowLabels(plainText(manifest.title), plainText(manifest.subtitle)),
    );
    openContent.add_child(
      new St.Icon({
        icon_name: 'go-next-symbolic',
        icon_size: 16,
        style_class: 'aurora-devtool-chevron',
        y_align: Clutter.ActorAlign.CENTER,
      }),
    );
    const focusName = `aurora-devtool-focus-module-${manifest.key}`;
    const open = new St.Button({
      child: openContent,
      style_class: 'button aurora-devtool-module-open',
      can_focus: true,
      x_expand: true,
      accessible_name: plainText(manifest.title),
      name: focusName,
    });
    open.connect('clicked', () => this._callbacks.openModule(manifest.key, focusName));
    row.add_child(open);
    row.add_child(
      createDevToolSwitch(
        enabled,
        (state) => this._settings.setBoolean(manifest.settingsKey, state),
        _('Enable %s').format(plainText(manifest.title)),
      ),
    );
    return row;
  }

  private _buildRowLabels(title: string, subtitle: string): St.Widget {
    const labels = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      style_class: 'aurora-devtool-row-labels',
      x_expand: true,
    });
    labels.add_child(new St.Label({ text: title, style_class: 'aurora-devtool-row-title' }));
    const subtitleLabel = new St.Label({
      text: subtitle,
      style_class: 'aurora-devtool-row-subtitle',
      x_expand: true,
    });
    subtitleLabel.clutter_text.line_wrap = true;
    subtitleLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    subtitleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    labels.add_child(subtitleLabel);
    return labels;
  }
}
