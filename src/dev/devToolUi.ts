import St from '@girs/st-18';

export function createDevToolModulePanel(): St.BoxLayout {
  return new St.BoxLayout({
    vertical: true,
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

export function createDevToolActionButton(
  iconName: string,
  label: string,
  onClick: () => void,
  disabled = false,
  active = false,
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
      : 'button aurora-devtool-action-button',
    can_focus: !disabled,
    reactive: !disabled,
    x_expand: true,
    accessible_name: label,
  });
  if (disabled) button.opacity = 120;
  button.connect('clicked', onClick);
  return button;
}
