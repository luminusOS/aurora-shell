import St from '@girs/st-18';
import Clutter from '@girs/clutter-18';
import Pango from '@girs/pango-1.0';
import * as PopupMenu from '@girs/gnome-shell/ui/popupMenu';

import { gettext as _ } from '~/shared/i18n.ts';
import { createIcon } from '~/shared/icons.ts';

export type DevToolButtonVariant = 'suggested' | 'destructive' | 'flat';

export type DevToolGroup = {
  container: St.BoxLayout;
  list: St.BoxLayout;
};

export function createDevToolModulePanel(): St.BoxLayout {
  return new St.BoxLayout({
    orientation: Clutter.Orientation.VERTICAL,
    style_class: 'aurora-devtool-module-panel',
  });
}

export function createDevToolSummary(iconName: string, text: string): St.BoxLayout {
  const summary = new St.BoxLayout({
    style_class: 'aurora-devtool-summary',
  });
  summary.add_child(
    new St.Icon({
      icon_name: iconName,
      icon_size: 18,
      style_class: 'aurora-devtool-summary-icon',
    }),
  );
  summary.add_child(
    new St.Label({
      text,
      style_class: 'aurora-devtool-summary-label',
      x_expand: true,
    }),
  );
  return summary;
}

export function createDevToolActionRow(): St.BoxLayout {
  return new St.BoxLayout({
    style_class: 'aurora-devtool-action-row',
  });
}

export function createDevToolGroup(title?: string, description?: string): DevToolGroup {
  const container = new St.BoxLayout({
    orientation: Clutter.Orientation.VERTICAL,
    style_class: 'aurora-devtool-group',
    x_expand: true,
  });
  if (title) {
    container.add_child(
      new St.Label({
        text: title,
        style_class: 'aurora-devtool-group-title',
      }),
    );
  }
  if (description) {
    const descriptionLabel = new St.Label({
      text: description,
      style_class: 'aurora-devtool-group-description',
      x_expand: true,
    });
    descriptionLabel.clutter_text.line_wrap = true;
    container.add_child(descriptionLabel);
  }

  const list = new St.BoxLayout({
    orientation: Clutter.Orientation.VERTICAL,
    style_class: 'aurora-devtool-group-list',
    x_expand: true,
  });
  container.add_child(list);
  return { container, list };
}

export function createDevToolRow(
  title: string,
  subtitle = '',
  suffix?: St.Widget,
  iconName?: string,
  activatable = false,
): St.BoxLayout {
  const row = new St.BoxLayout({
    style_class: activatable ? 'aurora-devtool-row activatable' : 'aurora-devtool-row',
    x_expand: true,
    reactive: activatable,
    track_hover: activatable,
  });
  if (iconName)
    row.add_child(
      new St.Icon({
        icon_name: iconName,
        icon_size: 18,
        style_class: 'aurora-devtool-row-icon',
      }),
    );

  const labels = new St.BoxLayout({
    orientation: Clutter.Orientation.VERTICAL,
    style_class: 'aurora-devtool-row-labels',
    x_expand: true,
  });
  labels.add_child(new St.Label({ text: title, style_class: 'aurora-devtool-row-title' }));
  if (subtitle) {
    const subtitleLabel = new St.Label({
      text: subtitle,
      style_class: 'aurora-devtool-row-subtitle',
      x_expand: true,
    });
    subtitleLabel.clutter_text.line_wrap = true;
    subtitleLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    subtitleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    labels.add_child(subtitleLabel);
  }
  row.add_child(labels);
  if (suffix) row.add_child(suffix);
  return row;
}

export function createDevToolSwitch(
  active: boolean,
  onToggle: (active: boolean) => void,
  accessibleName: string,
  focusId = accessibleName,
): St.Button {
  const control = new PopupMenu.Switch(active);
  control.reactive = false;
  const button = new St.Button({
    child: control,
    style_class: 'button aurora-devtool-switch-button',
    can_focus: true,
    toggle_mode: true,
    checked: active,
    name: `aurora-devtool-focus-${focusId}`,
    accessible_name: `${accessibleName}: ${active ? _('On') : _('Off')}`,
  });
  button.connect('clicked', () => control.toggle());
  control.connect('notify::state', () => {
    button.checked = control.state;
    button.accessible_name = `${accessibleName}: ${control.state ? _('On') : _('Off')}`;
    onToggle(control.state);
  });
  return button;
}

export function createDevToolButton(
  label: string,
  onClick: () => void,
  iconName?: string,
  accessibleName = label,
  active = false,
  variant?: DevToolButtonVariant,
  focusId = accessibleName,
  toggleMode = false,
): St.Button {
  const content = new St.BoxLayout({ style_class: 'aurora-devtool-button-content' });
  if (iconName) content.add_child(createIcon(iconName, { icon_size: 16 }));
  content.add_child(new St.Label({ text: label }));
  const button = new St.Button({
    child: content,
    style_class: variant
      ? `button aurora-devtool-button ${variant}`
      : 'button aurora-devtool-button',
    can_focus: true,
    accessible_name: accessibleName,
    name: `aurora-devtool-focus-${focusId}`,
    toggle_mode: toggleMode,
    checked: active,
  });
  button.connect('clicked', onClick);
  return button;
}

export function createDevToolActionButton(
  iconName: string,
  label: string,
  onClick: () => void,
  disabled = false,
  active = false,
  variant?: DevToolButtonVariant,
  focusId = label,
  toggleMode = false,
): St.Button {
  const content = new St.BoxLayout({
    style_class: 'aurora-devtool-action-content',
  });
  content.add_child(
    new St.Icon({
      icon_name: iconName,
      icon_size: 16,
    }),
  );
  content.add_child(new St.Label({ text: label }));

  const button = new St.Button({
    child: content,
    style_class: active
      ? 'button aurora-devtool-action-button active'
      : variant
        ? `button aurora-devtool-action-button ${variant}`
        : 'button aurora-devtool-action-button',
    can_focus: !disabled,
    reactive: !disabled,
    x_expand: true,
    accessible_name: label,
    name: `aurora-devtool-focus-${focusId}`,
    toggle_mode: toggleMode,
    checked: active,
  });
  if (disabled) button.opacity = 115;
  button.connect('clicked', onClick);
  return button;
}
