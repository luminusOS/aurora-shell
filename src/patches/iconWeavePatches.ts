import Shell from '@girs/shell-18';

type Patch = { prototype: any; name: string; original: any; wrapper: any };
export type NativeWindowAppResolver = (window: any) => any;

export class IconWeavePatches {
  private _patches: Patch[] = [];
  constructor(private _windowAppMap: ReadonlyMap<any, any>) {}

  install(): NativeWindowAppResolver {
    const map = this._windowAppMap;
    const tracker = Shell.WindowTracker.get_default();
    const originalGetWindowApp = Shell.WindowTracker.prototype.get_window_app;

    this._install(Shell.WindowTracker.prototype, 'get_window_app', function (original, win: any) {
      return map.get(win) ?? original.call(this, win);
    });

    this._install(Shell.App.prototype, 'get_windows', function (original) {
      const windows = original.call(this);
      const id = this.get_id();
      const filtered = windows.filter((win: any) => {
        const mapped = map.get(win);
        return !mapped || mapped.get_id() === id;
      });

      for (const [win, app] of map) {
        if (app.get_id() === id && !filtered.includes(win)) {
          filtered.push(win);
        }
      }

      return filtered;
    });

    this._install(Shell.App.prototype, 'get_state', function (original) {
      const state = original.call(this);
      if (state !== Shell.AppState.STOPPED) return state;

      const id = this.get_id();
      for (const app of map.values()) {
        if (app.get_id() === id) return Shell.AppState.RUNNING;
      }

      return state;
    });

    this._install(Shell.App.prototype, 'activate', function (original) {
      const id = this.get_id();
      const windows = [...map].filter(([, app]) => app.get_id() === id).map(([win]) => win);
      if (windows.length === 0) return original.call(this);

      const best = windows.reduce((latest, win) =>
        win.get_user_time() > latest.get_user_time() ? win : latest,
      );
      best.activate(global.get_current_time());
    });

    this._install(Shell.AppSystem.prototype, 'get_running', function (original) {
      const running = original.call(this);
      const ids = new Set(running.map((app: any) => app.get_id()));
      for (const app of map.values()) {
        if (ids.has(app.get_id())) continue;
        running.push(app);
        ids.add(app.get_id());
      }

      return running;
    });

    return (window) => originalGetWindowApp.call(tracker, window);
  }

  destroy(): void {
    for (const patch of [...this._patches].reverse()) {
      if (patch.prototype[patch.name] === patch.wrapper) {
        patch.prototype[patch.name] = patch.original;
      }
    }

    this._patches = [];
  }

  private _install(
    prototype: any,
    name: string,
    invoke: (this: any, original: any, ...args: any[]) => any,
  ): void {
    const original = prototype[name];
    const wrapper = function (this: any, ...args: any[]) {
      return invoke.call(this, original, ...args);
    };

    prototype[name] = wrapper;
    this._patches.push({ prototype, name, original, wrapper });
  }
}
