import '@girs/gjs';

import St from '@girs/st-18';
import Clutter from '@girs/clutter-18';

import type { Module } from '~/module.ts';
import { Dock, type ManagedDockBinding } from '~/dock/dock.ts';
import { OverlapStatus } from '~/dock/intellihide.ts';

export class DockDevTool {
  readonly key = 'dock';
  readonly title = 'Dock';
  readonly iconName = 'view-app-grid-symbolic';

  constructor(
    private readonly _getModule: (key: string) => Module | null,
    private readonly _requestMenuRebuild: () => void,
  ) {}

  buildPanel(): St.Widget {
    const dock = this._getDock();
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
        text: dock
          ? `Bindings: ${dock.bindings.length} · Always-show: ${dock.alwaysShow ? 'on' : 'off'}`
          : 'Dock disabled',
        style_class: 'aurora-devtool-summary-label',
        x_expand: true,
      }),
    );
    panel.add_child(summary);

    if (dock) {
      for (const binding of dock.bindings) panel.add_child(this._buildMonitorPanel(binding));
    }

    const firstRow = new St.BoxLayout({
      style_class: 'aurora-devtool-action-row',
    });
    firstRow.add_child(
      this._createActionButton('go-up-symbolic', 'Reveal All', () => this.revealAll(), !dock),
    );
    firstRow.add_child(
      this._createActionButton('go-down-symbolic', 'Hide All', () => this.hideAll(), !dock),
    );
    panel.add_child(firstRow);

    const secondRow = new St.BoxLayout({
      style_class: 'aurora-devtool-action-row',
    });
    secondRow.add_child(
      this._createActionButton(
        'input-touchpad-symbolic',
        'Hot Area',
        () => this.triggerHotArea(),
        !dock,
      ),
    );
    secondRow.add_child(
      this._createActionButton(
        'view-pin-symbolic',
        `Always Show: ${dock?.alwaysShow ? 'On' : 'Off'}`,
        () => this.toggleAlwaysShow(),
        !dock,
      ),
    );
    panel.add_child(secondRow);

    return panel;
  }

  destroy(): void {}

  revealAll(): boolean {
    const dock = this._getDock();
    if (!dock) return false;
    dock.showAll();
    this._requestMenuRebuild();
    return true;
  }

  hideAll(): boolean {
    const dock = this._getDock();
    if (!dock) return false;
    dock.hideAll();
    this._requestMenuRebuild();
    return true;
  }

  triggerHotArea(): boolean {
    const dock = this._getDock();
    if (!dock) return false;
    dock.revealFromHotArea();
    this._requestMenuRebuild();
    return true;
  }

  toggleAlwaysShow(): boolean {
    const dock = this._getDock();
    if (!dock) return false;
    dock.toggleAlwaysShow();
    this._requestMenuRebuild();
    return true;
  }

  showMonitor(monitorIndex: number): boolean {
    const changed = this._getDock()?.showMonitor(monitorIndex) ?? false;
    if (changed) this._requestMenuRebuild();
    return changed;
  }

  hideMonitor(monitorIndex: number): boolean {
    const changed = this._getDock()?.hideMonitor(monitorIndex) ?? false;
    if (changed) this._requestMenuRebuild();
    return changed;
  }

  triggerMonitorHotArea(monitorIndex: number): boolean {
    const changed = this._getDock()?.revealMonitorFromHotArea(monitorIndex) ?? false;
    if (changed) this._requestMenuRebuild();
    return changed;
  }

  private _buildMonitorPanel(binding: ManagedDockBinding): St.Widget {
    const panel = new St.BoxLayout({
      vertical: true,
      style_class: 'aurora-devtool-module-panel',
    });

    panel.add_child(
      new St.Label({
        text: this._monitorStatus(binding),
        style_class: 'aurora-devtool-summary-label',
        y_align: Clutter.ActorAlign.CENTER,
      }),
    );

    const actions = new St.BoxLayout({
      style_class: 'aurora-devtool-action-row',
    });
    actions.add_child(
      this._createActionButton('go-up-symbolic', 'Show', () =>
        this.showMonitor(binding.monitorIndex),
      ),
    );
    actions.add_child(
      this._createActionButton('go-down-symbolic', 'Hide', () =>
        this.hideMonitor(binding.monitorIndex),
      ),
    );
    actions.add_child(
      this._createActionButton(
        'input-touchpad-symbolic',
        'Hot Area',
        () => this.triggerMonitorHotArea(binding.monitorIndex),
        !binding.hotArea,
      ),
    );
    panel.add_child(actions);
    return panel;
  }

  private _monitorStatus(binding: ManagedDockBinding): string {
    let intellihide: string;
    if (!binding.intellihide) {
      intellihide = 'always-show';
    } else if (binding.intellihide.status === OverlapStatus.CLEAR) {
      intellihide = 'clear';
    } else {
      intellihide = 'blocked';
    }
    const visible = binding.dash.visible ? 'visible' : 'hidden';
    const hot = binding.hotAreaActive ? ' · hot-area' : '';
    return `Monitor ${binding.monitorIndex + 1}: ${visible} · ${intellihide}${hot}`;
  }

  private _getDock(): Dock | null {
    const module = this._getModule('dock');
    return module instanceof Dock ? module : null;
  }

  private _createActionButton(
    iconName: string,
    label: string,
    onClick: () => void,
    disabled = false,
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
      style_class: 'button aurora-devtool-action-button',
      can_focus: !disabled,
      reactive: !disabled,
      x_expand: true,
      accessible_name: label,
    });
    if (disabled) button.opacity = 120;
    button.connect('clicked', onClick);
    return button;
  }
}
