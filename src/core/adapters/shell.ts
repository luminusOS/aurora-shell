import * as Main from '@girs/gnome-shell/ui/main';

/**
 * Interface representing the GNOME Shell environment.
 * Abstracting this allows us to test modules without a real GNOME Shell instance.
 */
export interface ShellEnvironment {
  readonly isStartingUp: boolean;
  hasOverview: boolean;
  hideOverview(): void;
  onStartupComplete(callback: () => void): number;
  disconnect(id: number): void;
}

export class GnomeShellAdapter implements ShellEnvironment {
  get isStartingUp(): boolean {
    // @ts-ignore
    return Main.layoutManager._startingUp;
  }

  get hasOverview(): boolean {
    return Main.sessionMode.hasOverview;
  }

  set hasOverview(value: boolean) {
    Main.sessionMode.hasOverview = value;
  }

  hideOverview(): void {
    Main.overview.hide();
  }

  onStartupComplete(callback: () => void): number {
    // @ts-ignore
    return Main.layoutManager.connect('startup-complete', callback);
  }

  disconnect(id: number): void {
    Main.layoutManager.disconnect(id);
  }
}