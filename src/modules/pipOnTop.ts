import Meta from '@girs/meta-17';

import { Module } from '../module.ts';

const PIP_TITLES = [
  'Picture-in-Picture',
  'Picture in picture',
  'Picture-in-picture',
];

/**
 * PipOnTop Module
 * 
 * Automatically keeps Picture-in-Picture (PiP) windows above other windows.
 * It detects PiP windows based on their title and ensures they are always on top.
 * This enhances the user experience by preventing PiP windows from being accidentally hidden behind other windows.
 */
export class PipOnTop extends Module {
  private _lastWorkspace: any = null;
  private _windowAddedId = 0;
  private _windowRemovedId = 0;

  override enable(): void {
    // @ts-ignore
    global.window_manager.connectObject(
      'switch-workspace', () => this._onSwitchWorkspace(),
      this
    );
    this._onSwitchWorkspace();
  }

  override disable(): void {
    // @ts-ignore
    global.window_manager.disconnectObject(this);
    this._disconnectWorkspace();

    for (const actor of global.get_window_actors()) {
      const window = actor.meta_window as any;
      if (!window) continue;
      this._cleanupWindow(window);
    }
  }

  private _onSwitchWorkspace(): void {
    this._disconnectWorkspace();

    const workspace = global.workspace_manager.get_active_workspace();
    this._lastWorkspace = workspace;

    this._windowAddedId = workspace.connect(
      'window-added', (_ws: any, window: any) => this._onWindowAdded(window)
    );
    this._windowRemovedId = workspace.connect(
      'window-removed', (_ws: any, window: any) => this._onWindowRemoved(window)
    );

    const windows = global.display.get_tab_list(Meta.TabList.NORMAL, workspace);
    if (windows) {
      for (const window of windows) {
        this._onWindowAdded(window);
      }
    }
  }

  private _disconnectWorkspace(): void {
    if (this._windowAddedId) {
      this._lastWorkspace.disconnect(this._windowAddedId);
      this._windowAddedId = 0;
    }
    if (this._windowRemovedId) {
      this._lastWorkspace.disconnect(this._windowRemovedId);
      this._windowRemovedId = 0;
    }
    this._lastWorkspace = null;
  }

  private _onWindowAdded(window: any): void {
    if (!window._notifyPipTitleId) {
      window._notifyPipTitleId = window.connect(
        'notify::title', () => this._checkTitle(window)
      );
    }
    this._checkTitle(window);
  }

  private _onWindowRemoved(window: any): void {
    if (window._notifyPipTitleId) {
      window.disconnect(window._notifyPipTitleId);
      window._notifyPipTitleId = null;
    }
  }

  private _checkTitle(window: any): void {
    if (!window.title) return;

    const isPip = PIP_TITLES.some(t => window.title === t)
      || window.title.endsWith(' - PiP');

    if (isPip) {
      window._isPipManaged = true;
      if (!window.above) window.make_above();
    } else if (window._isPipManaged) {
      window._isPipManaged = null;
      if (window.above) window.unmake_above();
    }
  }

  private _cleanupWindow(window: any): void {
    if (window._notifyPipTitleId) {
      window.disconnect(window._notifyPipTitleId);
      window._notifyPipTitleId = null;
    }
    if (window._isPipManaged) {
      if (window.above) window.unmake_above();
      window._isPipManaged = null;
    }
  }
}
