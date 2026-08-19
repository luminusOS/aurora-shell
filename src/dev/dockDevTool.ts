import '@girs/gjs';

import St from '@girs/st-18';
import Clutter from '@girs/clutter-18';

import type { SettingsManager } from '~/core/settings.ts';
import type { Module } from '~/module.ts';
import { Dock, type ManagedDockBinding } from '~/dock/dock.ts';
import { DOCK_POSITIONS, type DockPosition } from '~/dock/dockConfiguration.ts';
import { OverlapStatus } from '~/dock/intellihide.ts';
import {
  createDevToolActionButton,
  createDevToolActionRow,
  createDevToolModulePanel,
  createDevToolSummary,
} from '~/dev/devToolUi.ts';

const MIN_ICON_SIZE = 16;
const MAX_ICON_SIZE = 64;

const POSITION_ICONS: Record<DockPosition, string> = {
  bottom: 'go-bottom-symbolic',
  left: 'go-first-symbolic',
  right: 'go-last-symbolic',
};

function formatPosition(position: DockPosition): string {
  return position.charAt(0).toUpperCase() + position.slice(1);
}

export class DockDevTool {
  readonly key = 'dock';
  readonly title = 'Dock';
  readonly iconName = 'view-app-grid-symbolic';

  constructor(
    private readonly _settings: SettingsManager,
    private readonly _getModule: (key: string) => Module | null,
    private readonly _requestMenuRebuild: () => void,
  ) {}

  buildPanel(): St.Widget {
    const dock = this._getDock();
    const panel = createDevToolModulePanel();
    const iconSize = this._settings.getInt('dock-icon-size');
    const position = this._currentPosition();
    const summary = dock
      ? [
          `Bindings: ${dock.bindings.length}`,
          `Position: ${formatPosition(position)}`,
          `Icon size: ${iconSize}px`,
          `Always-show: ${dock.alwaysShow ? 'on' : 'off'}`,
          `Intellihide: ${dock.intellihideEnabled ? 'on' : 'off'}`,
        ].join(' · ')
      : 'Dock disabled';
    panel.add_child(createDevToolSummary(this.iconName, summary));

    if (dock) {
      for (const binding of dock.bindings) panel.add_child(this._buildMonitorPanel(binding));
    }

    const firstRow = createDevToolActionRow();
    firstRow.add_child(
      createDevToolActionButton('go-up-symbolic', 'Reveal All', () => this.revealAll(), !dock),
    );
    firstRow.add_child(
      createDevToolActionButton('go-down-symbolic', 'Hide All', () => this.hideAll(), !dock),
    );
    panel.add_child(firstRow);

    const secondRow = createDevToolActionRow();
    secondRow.add_child(
      createDevToolActionButton(
        'input-touchpad-symbolic',
        'Hot Area',
        () => this.triggerHotArea(),
        !dock,
      ),
    );
    secondRow.add_child(
      createDevToolActionButton(
        'view-pin-symbolic',
        `Always Show: ${dock?.alwaysShow ? 'On' : 'Off'}`,
        () => this.toggleAlwaysShow(),
        !dock,
      ),
    );
    panel.add_child(secondRow);

    const iconSizeRow = createDevToolActionRow();
    iconSizeRow.add_child(
      createDevToolActionButton(
        'zoom-out-symbolic',
        'Smaller Icons',
        () => this.decreaseIconSize(),
        !dock || iconSize <= MIN_ICON_SIZE,
      ),
    );
    iconSizeRow.add_child(
      createDevToolActionButton(
        'zoom-in-symbolic',
        'Larger Icons',
        () => this.increaseIconSize(),
        !dock || iconSize >= MAX_ICON_SIZE,
      ),
    );
    panel.add_child(iconSizeRow);

    const positionRow = createDevToolActionRow();
    for (const candidate of DOCK_POSITIONS) {
      positionRow.add_child(
        createDevToolActionButton(
          POSITION_ICONS[candidate],
          candidate === position
            ? `Position: ${formatPosition(candidate)}`
            : formatPosition(candidate),
          () => this.setPosition(candidate),
          !dock || candidate === position,
        ),
      );
    }
    panel.add_child(positionRow);

    return panel;
  }

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

  decreaseIconSize(): boolean {
    if (!this._getDock()) return false;

    const currentSize = this._settings.getInt('dock-icon-size');
    this._settings.setInt('dock-icon-size', Math.max(MIN_ICON_SIZE, currentSize - 1));
    this._requestMenuRebuild();
    return true;
  }

  increaseIconSize(): boolean {
    if (!this._getDock()) return false;

    const currentSize = this._settings.getInt('dock-icon-size');
    this._settings.setInt('dock-icon-size', Math.min(MAX_ICON_SIZE, currentSize + 1));
    this._requestMenuRebuild();
    return true;
  }

  setPosition(position: DockPosition): boolean {
    if (!this._getDock()) return false;
    if (!DOCK_POSITIONS.includes(position)) return false;
    if (position === this._currentPosition()) return false;

    this._settings.setString('dock-position', position);
    this._requestMenuRebuild();
    return true;
  }

  cyclePosition(): boolean {
    if (!this._getDock()) return false;

    const index = DOCK_POSITIONS.indexOf(this._currentPosition());
    const next = DOCK_POSITIONS[(index + 1) % DOCK_POSITIONS.length];
    if (!next) return false;

    return this.setPosition(next);
  }

  showMonitor(monitorIndex: number): boolean {
    const dock = this._getDock();
    if (!dock) return false;

    const changed = dock.showMonitor(monitorIndex);
    if (changed) this._requestMenuRebuild();
    return changed;
  }

  hideMonitor(monitorIndex: number): boolean {
    const dock = this._getDock();
    if (!dock) return false;

    const changed = dock.hideMonitor(monitorIndex);
    if (changed) this._requestMenuRebuild();
    return changed;
  }

  triggerMonitorHotArea(monitorIndex: number): boolean {
    const dock = this._getDock();
    if (!dock) return false;

    const changed = dock.revealMonitorFromHotArea(monitorIndex);
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

    const actions = createDevToolActionRow();
    actions.add_child(
      createDevToolActionButton('go-up-symbolic', 'Show', () =>
        this.showMonitor(binding.monitorIndex),
      ),
    );
    actions.add_child(
      createDevToolActionButton('go-down-symbolic', 'Hide', () =>
        this.hideMonitor(binding.monitorIndex),
      ),
    );
    actions.add_child(
      createDevToolActionButton(
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
      intellihide = binding.mode;
    } else if (binding.intellihide.status === OverlapStatus.CLEAR) {
      intellihide = 'clear';
    } else {
      intellihide = 'blocked';
    }
    const visible = binding.dash.visible ? 'visible' : 'hidden';
    const hot = binding.hotAreaActive ? ' · hot-area' : '';
    return `Monitor ${binding.monitorIndex + 1}: ${visible} · ${intellihide}${hot}`;
  }

  private _currentPosition(): DockPosition {
    const stored = this._settings.getString('dock-position') as DockPosition;
    return DOCK_POSITIONS.includes(stored) ? stored : 'bottom';
  }

  private _getDock(): Dock | null {
    const module = this._getModule('dock');
    return module instanceof Dock ? module : null;
  }
}
