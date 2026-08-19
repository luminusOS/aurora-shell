import Clutter from '@girs/clutter-18';
import Shell from '@girs/shell-18';
import type St from '@girs/st-18';
import * as Main from '@girs/gnome-shell/ui/main';

import { isDashWindowRelevant } from './dashState.ts';
import type { DockPosition } from '~/dock/dockConfiguration.ts';

type DashApplicationOptions = {
  getContentActor: () => St.Widget | null;
  getMonitorIndex: () => number;
  getIsolateMonitor: () => boolean;
  getPosition: () => DockPosition;
};

const RUNNING_DOT_PLACEMENT = {
  bottom: { x: Clutter.ActorAlign.CENTER, y: Clutter.ActorAlign.END, resetOffset: false },
  left: { x: Clutter.ActorAlign.START, y: Clutter.ActorAlign.CENTER, resetOffset: true },
  right: { x: Clutter.ActorAlign.END, y: Clutter.ActorAlign.CENTER, resetOffset: true },
} satisfies Record<
  DockPosition,
  { x: Clutter.ActorAlign; y: Clutter.ActorAlign; resetOffset: boolean }
>;

export class DashApplicationController {
  constructor(private _options: DashApplicationOptions) {}

  getChildren(): any[] {
    const contentActor = this._options.getContentActor();
    if (!contentActor) {
      return [];
    }

    return contentActor.get_children();
  }

  isWindowRelevant(window: any): boolean {
    const workspace = global.workspace_manager.get_active_workspace();
    return isDashWindowRelevant(
      {
        monitor: window.get_monitor(),
        workspace: window.get_workspace() === workspace ? 0 : 1,
        sticky: window.is_on_all_workspaces(),
        skipTaskbar: false,
      },
      this._options.getMonitorIndex(),
      0,
      this._options.getIsolateMonitor(),
    );
  }

  updateRunningDots(): void {
    const placement = RUNNING_DOT_PLACEMENT[this._options.getPosition()];

    for (const child of this.getChildren()) {
      const icon = child.child?._delegate;
      if (!icon?.app) continue;

      const hasWindowHere = icon.app
        .get_windows()
        .some((window: any) => this.isWindowRelevant(window));
      if (icon._dot) {
        icon._dot.visible = hasWindowHere;
        icon._dot.x_align = placement.x;
        icon._dot.y_align = placement.y;
        if (placement.resetOffset) {
          icon._dot.translation_x = 0;
          icon._dot.translation_y = 0;
        }
      }
    }
  }

  installActivationOverrides(): void {
    for (const child of this.getChildren()) {
      const appIcon = child.child?._delegate;

      if (!appIcon?.app || appIcon._auroraActivatePatched) continue;

      appIcon._auroraActivatePatched = true;
      this._installActivationOverride(appIcon);
    }
  }

  private _installActivationOverride(appIcon: any): void {
    const originalActivate = appIcon.activate.bind(appIcon);
    const isRelevant = (window: any) => this.isWindowRelevant(window);
    const activateWindow = (window: any) => this._activateWindow(window);

    appIcon.activate = function (button: number) {
      const event = Clutter.get_current_event();
      const modifiers = event ? event.get_state() : 0;
      const opensNewWindow =
        button === Clutter.BUTTON_MIDDLE || (modifiers & Clutter.ModifierType.CONTROL_MASK) !== 0;

      if (opensNewWindow) {
        this._cycleState = null;
        originalActivate(button);
        return;
      }

      const windows = appIcon.app.get_windows().filter(isRelevant);
      if (windows.length === 0 && appIcon.app.get_state() === Shell.AppState.RUNNING) {
        this._cycleState = null;
        appIcon.app.open_new_window(-1);
        return;
      }

      if (windows.length <= 1) {
        this._cycleState = null;

        if (windows.length === 1) {
          const window = windows[0];
          if (window.minimized) {
            window.unminimize();
          }
          Main.activateWindow(window);
        } else {
          originalActivate(button);
        }

        return;
      }

      const focusedWindow = global.display.focus_window;
      const isFocused = windows.some((window: any) => window === focusedWindow);
      const appId = appIcon.app.get_id();

      if (!isFocused) {
        this._cycleState = null;
        activateWindow(windows[0]);
        return;
      }

      const cycle = this._cycleState;
      const continuesCycle = cycle?.appId === appId && cycle.windows[cycle.index] === focusedWindow;
      if (continuesCycle) {
        const nextIndex = (cycle.index + 1) % cycle.windows.length;
        const nextWindow = cycle.windows[nextIndex];

        if (windows.some((window: any) => window === nextWindow)) {
          cycle.index = nextIndex;
          activateWindow(nextWindow);
          return;
        }
      }

      this._cycleState = { appId, windows: [...windows], index: 1 };
      activateWindow(windows[1]);
    };
  }

  private _activateWindow(window: any): void {
    if (window.minimized) {
      window.unminimize();
    }

    Main.activateWindow(window);
  }
}
