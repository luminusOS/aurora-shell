import type { SettingsManager } from '~/core/settings.ts';
import type { Module } from '~/module.ts';
import { Dock, type ManagedDockBinding } from '~/dock/dock.ts';
import { DOCK_POSITIONS, type DockPosition } from '~/dock/dockConfiguration.ts';
import { OverlapStatus } from '~/dock/intellihide.ts';
import { action, type RuntimeAction } from './protocol.ts';

const MIN_ICON_SIZE = 16;
const MAX_ICON_SIZE = 64;

function formatPosition(position: DockPosition): string {
  return position.charAt(0).toUpperCase() + position.slice(1);
}

export class DockDevTool {
  readonly key = 'dock';
  readonly title = 'Dock';

  constructor(
    private readonly _settings: SettingsManager,
    private readonly _getModule: (key: string) => Module | null,
  ) {}

  describe() {
    const dock = this._getDock();
    const actions: RuntimeAction[] = [];
    const details: string[] = [];
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
    details.push(summary);

    if (dock) {
      for (const binding of dock.bindings) {
        details.push(this._monitorStatus(binding));
        actions.push(...this._monitorActions(binding));
      }
    }

    actions.push(action('revealAll', 'Reveal All', () => this.revealAll(), !dock));
    actions.push(action('hideAll', 'Hide All', () => this.hideAll(), !dock));

    actions.push(action('triggerHotArea', 'Hot Area', () => this.triggerHotArea(), !dock));
    actions.push(
      action(
        'dock-always-show',
        `Always Show: ${dock?.alwaysShow ? 'On' : 'Off'}`,
        () => this.toggleAlwaysShow(),
        !dock,
      ),
    );

    actions.push(
      action(
        'decreaseIconSize',
        'Smaller Icons',
        () => this.decreaseIconSize(),
        !dock || iconSize <= MIN_ICON_SIZE,
      ),
    );
    actions.push(
      action(
        'increaseIconSize',
        'Larger Icons',
        () => this.increaseIconSize(),
        !dock || iconSize >= MAX_ICON_SIZE,
      ),
    );

    for (const candidate of DOCK_POSITIONS) {
      actions.push(
        action(
          `position-${candidate}`,
          candidate === position
            ? `Position: ${formatPosition(candidate)}`
            : formatPosition(candidate),
          () => this.setPosition(candidate),
          !dock || candidate === position,
        ),
      );
    }

    return { details, actions };
  }

  revealAll(): boolean {
    const dock = this._getDock();
    if (!dock) return false;
    dock.showAll();
    return true;
  }

  hideAll(): boolean {
    const dock = this._getDock();
    if (!dock) return false;
    dock.hideAll();
    return true;
  }

  triggerHotArea(): boolean {
    const dock = this._getDock();
    if (!dock) return false;
    dock.revealFromHotArea();
    return true;
  }

  toggleAlwaysShow(): boolean {
    const dock = this._getDock();
    if (!dock) return false;
    dock.toggleAlwaysShow();
    return true;
  }

  decreaseIconSize(): boolean {
    if (!this._getDock()) return false;

    const currentSize = this._settings.getInt('dock-icon-size');
    this._settings.setInt('dock-icon-size', Math.max(MIN_ICON_SIZE, currentSize - 1));
    return true;
  }

  increaseIconSize(): boolean {
    if (!this._getDock()) return false;

    const currentSize = this._settings.getInt('dock-icon-size');
    this._settings.setInt('dock-icon-size', Math.min(MAX_ICON_SIZE, currentSize + 1));
    return true;
  }

  setPosition(position: DockPosition): boolean {
    if (!this._getDock()) return false;
    if (!DOCK_POSITIONS.includes(position)) return false;
    if (position === this._currentPosition()) return false;

    this._settings.setString('dock-position', position);
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

    return dock.showMonitor(monitorIndex);
  }

  hideMonitor(monitorIndex: number): boolean {
    const dock = this._getDock();
    if (!dock) return false;

    return dock.hideMonitor(monitorIndex);
  }

  triggerMonitorHotArea(monitorIndex: number): boolean {
    const dock = this._getDock();
    if (!dock) return false;

    return dock.revealMonitorFromHotArea(monitorIndex);
  }

  private _monitorActions(binding: ManagedDockBinding) {
    const actions: RuntimeAction[] = [];
    actions.push(
      action(
        `dock-monitor-${binding.monitorIndex}-show`,
        `Monitor ${binding.monitorIndex + 1}: Show`,
        () => this.showMonitor(binding.monitorIndex),
        false,
      ),
    );
    actions.push(
      action(
        `dock-monitor-${binding.monitorIndex}-hide`,
        `Monitor ${binding.monitorIndex + 1}: Hide`,
        () => this.hideMonitor(binding.monitorIndex),
        false,
      ),
    );
    actions.push(
      action(
        `dock-monitor-${binding.monitorIndex}-hot-area`,
        `Monitor ${binding.monitorIndex + 1}: Hot Area`,
        () => this.triggerMonitorHotArea(binding.monitorIndex),
        !binding.hotArea,
      ),
    );
    return actions;
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
