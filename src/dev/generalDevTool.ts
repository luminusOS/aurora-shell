import '@girs/gjs';

import St from '@girs/st-18';

export class GeneralDevTool {
  readonly key = 'general';
  readonly title = 'General';
  readonly iconName = 'emblem-system-symbolic';

  constructor(private readonly _openPreferences: () => void) {}

  buildPanel(): St.Widget {
    const panel = new St.BoxLayout({
      vertical: true,
      style_class: 'aurora-devtool-module-panel',
    });

    const summary = new St.BoxLayout({
      style_class: 'aurora-devtool-summary',
    });
    summary.add_child(
      new St.Icon({
        icon_name: this.iconName,
        icon_size: 18,
        style_class: 'aurora-devtool-summary-icon',
      }),
    );
    summary.add_child(
      new St.Label({
        text: 'Extension tools',
        style_class: 'aurora-devtool-summary-label',
        x_expand: true,
      }),
    );
    panel.add_child(summary);

    const row = new St.BoxLayout({
      style_class: 'aurora-devtool-action-row',
    });
    row.add_child(
      this._createActionButton('emblem-system-symbolic', 'Open Settings', () =>
        this.openPreferences(),
      ),
    );
    panel.add_child(row);

    return panel;
  }

  destroy(): void {}

  openPreferences(): void {
    this._openPreferences();
  }

  private _createActionButton(iconName: string, label: string, onClick: () => void): St.Button {
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
      style_class: 'button aurora-devtool-action-button',
      can_focus: true,
      reactive: true,
      x_expand: true,
      accessible_name: label,
    });
    button.connect('clicked', onClick);
    return button;
  }
}
