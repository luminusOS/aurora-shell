// @ts-nocheck
import GLib from '@girs/glib-2.0';
import Gio from '@girs/gio-2.0';
import Shell from '@girs/shell-17';
import Meta from '@girs/meta-17';
import type { ExtensionContext } from '~/core/context.ts';
import { Module } from '../module.ts';

const WINDOW_INSPECT_DELAY_MS = 1000;
const MIN_MATCH_SCORE = 50;

const BLACKLISTED_PREFIXES = [
  'org.gnome',
  'gnome-shell',
  'xdg',
  'org.mozilla',
  'teams-for-linux',
  'google-chrome',
];

const ALLOWED_WINDOW_TYPES = [
  Meta.WindowType.NORMAL,
  Meta.WindowType.DIALOG,
  Meta.WindowType.MODAL_DIALOG,
];

type TimeoutId = number;

/**
 * Automatically matches untracked application windows with their corresponding
 * .desktop files using an in-memory approach.
 */
export class IconWeave extends Module {
  private _displayConnectionId = 0;
  private _processed = new Set<string>();
  private _pendingConnections = new Map<any, number>();
  private _timeoutSources = new Set<TimeoutId>();

  // Maps a window to an app
  private _windowAppMap = new Map<any, any>();

  private _originalGetWindowApp: any = null;
  private _originalAppGetWindows: any = null;
  private _originalAppGetState: any = null;
  private _originalGetRunning: any = null;
  private _originalActivate: any = null;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    // Monkey-patch Shell.WindowTracker.get_window_app
    const trackerProto = Shell.WindowTracker.prototype;
    this._originalGetWindowApp = trackerProto.get_window_app;

    trackerProto.get_window_app = function (win: any) {
      if (self._windowAppMap.has(win)) {
        return self._windowAppMap.get(win);
      }
      return self._originalGetWindowApp.call(this, win);
    };

    // Monkey-patch Shell.App.prototype.get_windows
    const appProto = Shell.App.prototype;
    this._originalAppGetWindows = appProto.get_windows;
    appProto.get_windows = function () {
      const windows = self._originalAppGetWindows.call(this);
      // Remove windows that have been re-mapped to a different app so that the
      // original window-backed app (window:XXXX) becomes empty and is dropped
      // from the dock, preventing a duplicate icon.
      const filtered = windows.filter((win: any) => {
        const mappedApp = self._windowAppMap.get(win);
        return !mappedApp || mappedApp === this;
      });
      for (const [win, app] of self._windowAppMap.entries()) {
        if (app === this && !filtered.includes(win)) {
          filtered.push(win);
        }
      }
      return filtered;
    };

    // Monkey-patch Shell.App.prototype.get_state
    this._originalAppGetState = appProto.get_state;
    appProto.get_state = function () {
      const state = self._originalAppGetState.call(this);
      if (state === Shell.AppState.STOPPED) {
        for (const app of self._windowAppMap.values()) {
          if (app === this) return Shell.AppState.RUNNING;
        }
      }
      return state;
    };

    // Monkey-patch Shell.App.prototype.activate so that clicking a dock icon
    // for a mapped window focuses it instead of launching a new instance.
    // activate() is a C-level method; it calls get_windows() at the C level,
    // bypassing our JS prototype patch — so we must intercept activate() itself.
    this._originalActivate = appProto.activate;
    appProto.activate = function () {
      const mappedWindows: any[] = [];
      for (const [win, app] of self._windowAppMap.entries()) {
        if (app === this) mappedWindows.push(win);
      }
      if (mappedWindows.length > 0) {
        let best = mappedWindows[0];
        for (const w of mappedWindows) {
          if (w.get_user_time() > best.get_user_time()) best = w;
        }
        best.activate(global.get_current_time());
        return;
      }
      return self._originalActivate.call(this);
    };

    // Monkey-patch Shell.AppSystem.prototype.get_running
    const systemProto = Shell.AppSystem.prototype;
    this._originalGetRunning = systemProto.get_running;
    systemProto.get_running = function () {
      const running = self._originalGetRunning.call(this);
      for (const app of self._windowAppMap.values()) {
        if (!running.includes(app)) {
          running.push(app);
        }
      }
      return running;
    };

    this._displayConnectionId = global.display.connect(
      'window-created',
      (_display: any, win: any) => this._scheduleInspection(win),
    );
  }

  override disable(): void {
    if (this._displayConnectionId) {
      global.display.disconnect(this._displayConnectionId);
      this._displayConnectionId = 0;
    }

    if (this._originalGetWindowApp) {
      Shell.WindowTracker.prototype.get_window_app = this._originalGetWindowApp;
      this._originalGetWindowApp = null;
    }

    if (this._originalAppGetWindows) {
      Shell.App.prototype.get_windows = this._originalAppGetWindows;
      this._originalAppGetWindows = null;
    }

    if (this._originalAppGetState) {
      Shell.App.prototype.get_state = this._originalAppGetState;
      this._originalAppGetState = null;
    }

    if (this._originalActivate) {
      Shell.App.prototype.activate = this._originalActivate;
      this._originalActivate = null;
    }

    if (this._originalGetRunning) {
      Shell.AppSystem.prototype.get_running = this._originalGetRunning;
      this._originalGetRunning = null;
    }

    for (const id of this._timeoutSources) GLib.source_remove(id);
    this._timeoutSources.clear();

    for (const [win, id] of this._pendingConnections) {
      try {
        win.disconnect(id);
      } catch (_e) {
        // window may already be gone
      }
    }
    this._pendingConnections.clear();
    this._processed.clear();
    this._windowAppMap.clear();
  }

  private _scheduleInspection(win: any): void {
    if (!ALLOWED_WINDOW_TYPES.includes(win.get_window_type())) return;

    // Remove window from map when it is destroyed
    const destroyId = win.connect('unmanaged', () => {
      win.disconnect(destroyId);
      this._windowAppMap.delete(win);
    });

    const id: TimeoutId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT_IDLE,
      WINDOW_INSPECT_DELAY_MS,
      () => {
        this._timeoutSources.delete(id);
        this._inspectWindow(win);
        return GLib.SOURCE_REMOVE;
      },
    );
    this._timeoutSources.add(id);
  }

  private _inspectWindow(win: any): void {
    try {
      const title: string = win.get_title() ?? '';

      if (!title) {
        if (!this._pendingConnections.has(win)) {
          const id = win.connect('notify::title', () => {
            win.disconnect(id);
            this._pendingConnections.delete(win);
            this._inspectWindow(win);
          });
          this._pendingConnections.set(win, id);
        }
        return;
      }

      const tracker = Shell.WindowTracker.get_default();
      // Temporarily use original method to check if GNOME already knows it
      const currentApp = this._originalGetWindowApp.call(tracker, win);
      if (this._isValidApp(currentApp) && !this._isGenericSteamApp(currentApp)) return;

      const wmClass: string = win.get_wm_class() ?? '';
      const appId: string = win.get_gtk_application_id() ?? '';

      if (!wmClass && !appId) return;

      if (wmClass.toLowerCase() === appId.toLowerCase()) return;

      const dedupeKey = wmClass || appId;
      if (this._processed.has(dedupeKey)) {
        // We already processed this class, but this is a new window.
        // Try to find if we have a mapped app for another window with same class
        for (const [mappedWin, app] of this._windowAppMap.entries()) {
          if (mappedWin.get_wm_class() === wmClass || mappedWin.get_gtk_application_id() === appId) {
            this._windowAppMap.set(win, app);
            // Notify shell that app might have changed
            tracker.emit('tracked-windows-changed');
            return;
          }
        }
        return;
      }

      this.context.logger.log(`[IconWeave] untracked window: title="${title}" wm_class="${wmClass}" app_id="${appId}"`);

      const candidate = this._findBestCandidate(wmClass, appId, title);
      if (candidate) {
        this.context.logger.log(`[IconWeave] match found: ${candidate.get_id()} — applying memory fix`);
        this._windowAppMap.set(win, candidate);
        // Force the window tracker to update its state
        tracker.emit('tracked-windows-changed');
        // Notify the app too
        candidate.emit('windows-changed');
        candidate.notify('state');
      } else {
        this.context.logger.log(`[IconWeave] no candidate found for wm_class="${wmClass}"`);
      }

      this._processed.add(dedupeKey);
    } catch (e) {
      this.context.logger.log(`[IconWeave] _inspectWindow error: ${e}`);
    }
  }

  private _isValidApp(app: any): boolean {
    if (!app) return false;
    const id: string = app.get_id() ?? '';
    return id.length > 0 && !id.startsWith('window:');
  }

  private _isGenericSteamApp(app: any): boolean {
    if (!app) return false;
    const id: string = app.get_id() ?? '';
    const lowerId = id.toLowerCase();
    return lowerId === 'steam.desktop' || lowerId === 'com.valvesoftware.steam.desktop';
  }

  private _findBestCandidate(wmClass: string, appId: string, title: string): any {
    for (const prefix of BLACKLISTED_PREFIXES) {
      if (wmClass.toLowerCase().startsWith(prefix)) return null;
    }

    const appSystem = Shell.AppSystem.get_default();

    const deterministic = this._deterministicMatch(appSystem, wmClass, appId, title);
    if (deterministic) return deterministic;

    return this._heuristicMatch(appSystem, wmClass, appId, title);
  }

  private _deterministicMatch(appSystem: any, wmClass: string, appId: string, title: string): any {
    const candidates: string[] = [];

    if (title) {
      candidates.push(`${title}.desktop`, `${title.toLowerCase()}.desktop`);
    }
    if (appId) {
      candidates.push(`${appId}.desktop`, `${appId.toLowerCase()}.desktop`);
    }
    if (wmClass) {
      candidates.push(`${wmClass}.desktop`, `${wmClass.toLowerCase()}.desktop`);
    }

    for (const id of candidates) {
      const app = appSystem.lookup_app(id);
      if (app) return app;
    }

    return null;
  }

  private _heuristicMatch(appSystem: any, wmClass: string, appId: string, title: string): any {
    let bestApp: any = null;
    let bestScore = 0;

    for (const app of appSystem.get_installed()) {
      const info = Gio.DesktopAppInfo.new(app.get_id());
      if (!info) continue;

      const score = this._scoreCandidate(app, wmClass, appId, title);
      if (score > bestScore) {
        bestScore = score;
        bestApp = app;
      }
    }

    if (bestScore >= MIN_MATCH_SCORE) {
      this.context.logger.log(`[IconWeave] heuristic match score=${bestScore}: ${bestApp.get_id()}`);
      return bestApp;
    }

    return null;
  }

  private _isSteamGame(app: any, wmClass: string): boolean {
    const info = Gio.DesktopAppInfo.new(app.get_id());
    const exec: string = info?.get_string('Exec') ?? '';
    const steamMatch = exec.match(/steam:\/\/rungameid\/(\d+)/);
    if (!steamMatch) return false;

    const gameId = steamMatch[1];
    const nWm = this._normalize(wmClass);

    if (nWm === `steamapp${gameId}`) return true;

    // Check if wmClass matches the app name abbreviation (e.g. "cs2" for "Counter-Strike 2")
    const appName = (app.get_name() ?? '').toLowerCase();
    const words = appName.split(/[^a-z0-9]/).filter(w => w.length > 0);
    const abbreviation = words.map(w => w[0]).join('');
    if (nWm === abbreviation && abbreviation.length >= 2) return true;

    return false;
  }

  private _scoreCandidate(app: any, wmClass: string, appId: string, title: string): number {
    const desktopId = (app.get_id() ?? '').toLowerCase().replace(/\.desktop$/, '');
    const appName = (app.get_name() ?? '').toLowerCase();
    const shortId = desktopId.split('.').pop() ?? desktopId;

    // Prevent subprocess IDs (e.g. steam_app_1234) matching a parent (steam.desktop)
    if (wmClass && (
      wmClass.startsWith(`${desktopId}_`) || wmClass.startsWith(`${shortId}_`) ||
      wmClass.startsWith(`${desktopId}-`) || wmClass.startsWith(`${shortId}-`)
    )) return 0;

    if (this._isSteamGame(app, wmClass)) return 99;

    let score = 0;

    const words = appName.split(/[^a-z0-9]/).filter(w => w.length > 0);
    const abbreviation = words.map(w => w[0]).join('');

    const nWm = this._normalize(wmClass);
    const nAppName = this._normalize(appName);
    const nDesktopId = this._normalize(desktopId);
    const nShortId = this._normalize(shortId);

    if (wmClass) {
      const wm = wmClass.toLowerCase();
      if (desktopId === wm) score = Math.max(score, 93);
      if (desktopId.includes(wm) && wm.length >= 3) score = Math.max(score, 80);
      if (wm.includes(desktopId) && desktopId.length >= 3) score = Math.max(score, 70);
      if (shortId && wm.includes(shortId) && shortId.length >= 3) score = Math.max(score, 66);
      if (appName === wm) score = Math.max(score, 85);
      if (appName.includes(wm) && wm.length >= 3) score = Math.max(score, 60);
      if (wm.includes(appName) && appName.length >= 3) score = Math.max(score, 55);

      if (nWm === abbreviation && abbreviation.length >= 2) {
        score = Math.max(score, 88);
      }

      // Check normalized includes
      if (nAppName.includes(nWm) && nWm.length >= 3) score = Math.max(score, 62);
      if (nDesktopId.includes(nWm) && nWm.length >= 3) score = Math.max(score, 61);
    }

    if (appId) {
      const aId = appId.toLowerCase();
      const nAId = this._normalize(appId);
      if (desktopId.includes(aId) && aId.length >= 3) score = Math.max(score, 75);
      if (nAId === abbreviation && abbreviation.length >= 2) score = Math.max(score, 88);
    }

    const tNorm = this._normalize(title);

    if (tNorm && tNorm.length >= 3) {
      if (tNorm === nDesktopId) score = Math.max(score, 98);
      if (tNorm === nAppName) score = Math.max(score, 95);
      if (tNorm === nShortId) score = Math.max(score, 94);
      if (nAppName.includes(tNorm)) score = Math.max(score, 65);
      if (tNorm.includes(nDesktopId)) score = Math.max(score, 68);
    }

    return score;
  }

  private _normalize(str: string): string {
    return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }
}
