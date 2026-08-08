import GioUnix from '@girs/giounix-2.0';
import GLib from '@girs/glib-2.0';
import Meta from '@girs/meta-18';
import Shell from '@girs/shell-18';

import { LifecycleScope } from '~/core/lifecycleScope.ts';
import { logger } from '~/core/logger.ts';
import { createManagedSource } from '~/core/mainLoop.ts';

import { normalize, scoreIconWeaveCandidate } from './iconWeaveScoring.ts';
import type { NativeWindowAppResolver } from './iconWeavePatches.ts';
import type { IconWeaveWindowRegistry } from './iconWeaveRegistry.ts';

const WINDOW_INSPECT_DELAY_MS = 500;
const MIN_MATCH_SCORE = 50;
const LOG_PREFIX = 'IconWeave';

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

type IconWeaveInspectorOptions = {
  registry: IconWeaveWindowRegistry;
  resolveNativeWindowApp: NativeWindowAppResolver;
  onMappingChanged: () => void;
};

export class IconWeaveInspector {
  private _lifecycle = new LifecycleScope();
  private _windowScopes = new Map<any, LifecycleScope>();
  private _titleScopes = new Map<any, LifecycleScope>();

  constructor(private _options: IconWeaveInspectorOptions) {}

  start(): void {
    this._lifecycle.connect(global.display, 'window-created', (_display: any, window: any) => {
      this._schedule(window);
    });
  }

  destroy(): void {
    this._lifecycle.dispose();

    for (const scope of this._titleScopes.values()) {
      scope.dispose();
    }
    this._titleScopes.clear();

    for (const scope of this._windowScopes.values()) {
      scope.dispose();
    }
    this._windowScopes.clear();
  }

  private _schedule(window: any): void {
    if (!ALLOWED_WINDOW_TYPES.includes(window.get_window_type())) return;

    const scope = new LifecycleScope();
    this._windowScopes.set(window, scope);
    scope.connect(window, 'unmanaged', () => this._removeWindow(window));

    this._matchWindow(window);

    const actor = window.get_compositor_private();
    if (actor) {
      this._inspectAfterFirstFrame(window, actor, scope);
      return;
    }

    const idle = createManagedSource(scope);
    idle.replace(() =>
      GLib.timeout_add(GLib.PRIORITY_HIGH, 0, () => {
        idle.complete();

        const compositorActor = window.get_compositor_private();
        if (compositorActor) {
          this._inspectAfterFirstFrame(window, compositorActor, scope);
        } else {
          this._inspectAfterDelay(window, scope);
        }

        return GLib.SOURCE_REMOVE;
      }),
    );
  }

  private _removeWindow(window: any): void {
    const wmClass: string = window.get_wm_class() || '';
    const appId: string = window.get_gtk_application_id() || '';
    this._options.registry.remove(window, wmClass, appId);

    this._titleScopes.get(window)?.dispose();
    this._titleScopes.delete(window);

    const scope = this._windowScopes.get(window);
    this._windowScopes.delete(window);
    scope?.dispose();
  }

  private _inspectAfterFirstFrame(window: any, actor: any, scope: LifecycleScope): void {
    const timeout = createManagedSource(scope);
    let inspected = false;

    scope.connect(actor, 'first-frame', () => {
      if (inspected) return;

      inspected = true;
      timeout.clear();
      this._matchWindow(window);
    });
    scope.connect(actor, 'destroy', () => {
      inspected = true;
      timeout.clear();
    });

    timeout.replace(() =>
      GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, WINDOW_INSPECT_DELAY_MS, () => {
        timeout.complete();

        if (!inspected) {
          inspected = true;
          this._matchWindow(window);
        }

        return GLib.SOURCE_REMOVE;
      }),
    );
  }

  private _inspectAfterDelay(window: any, scope: LifecycleScope): void {
    const timeout = createManagedSource(scope);
    timeout.replace(() =>
      GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, WINDOW_INSPECT_DELAY_MS, () => {
        timeout.complete();
        this._matchWindow(window);
        return GLib.SOURCE_REMOVE;
      }),
    );
  }

  private _matchWindow(window: any): void {
    const wmClass: string = window.get_wm_class() || '';
    const appId: string = window.get_gtk_application_id() || '';

    if (!wmClass && !appId) {
      this._waitForTitle(window);
      return;
    }

    const currentApp = this._options.resolveNativeWindowApp(window);
    if (this._isValidApp(currentApp) && !this._isGenericSteamApp(currentApp)) return;
    if (wmClass.toLowerCase() === appId.toLowerCase()) return;

    const tracker = Shell.WindowTracker.get_default();
    const identity = wmClass || appId;

    if (this._options.registry.hasProcessed(identity)) {
      const mappedApp = this._options.registry.findMappedApp(wmClass, appId);
      if (mappedApp) {
        this._applyMapping(window, mappedApp, tracker, false);
      }

      return;
    }

    const title: string = window.get_title() || '';
    logger.log(`untracked window: title="${title}" wm_class="${wmClass}" app_id="${appId}"`, {
      prefix: LOG_PREFIX,
    });

    const appSystem = Shell.AppSystem.get_default();
    const deterministic = this._deterministicMatch(appSystem, wmClass, appId, title);
    if (deterministic) {
      logger.log(`deterministic match found: ${deterministic.get_id()} — applying`, {
        prefix: LOG_PREFIX,
      });
      this._applyMapping(window, deterministic, tracker);
      this._options.registry.markProcessed(identity);
      return;
    }

    if (!title) {
      this._waitForTitle(window);
      return;
    }

    const candidate = this._heuristicMatch(appSystem, wmClass, appId, title);
    if (candidate) {
      logger.log(`heuristic match found: ${candidate.get_id()} — applying`, {
        prefix: LOG_PREFIX,
      });
      this._applyMapping(window, candidate, tracker);
    } else {
      logger.log(`no candidate found for wm_class="${wmClass}"`, { prefix: LOG_PREFIX });
    }

    this._options.registry.markProcessed(identity);
  }

  private _applyMapping(window: any, app: any, tracker: any, notifyApp = true): void {
    this._options.registry.map(window, app);
    this._options.onMappingChanged();
    tracker.emit('tracked-windows-changed');
    if (notifyApp) {
      app.emit('windows-changed');
    }
  }

  private _waitForTitle(window: any): void {
    if (this._titleScopes.has(window)) return;

    const titleScope = new LifecycleScope();
    this._titleScopes.set(window, titleScope);
    titleScope.connect(window, 'notify::title', () => {
      this._titleScopes.delete(window);
      titleScope.dispose();
      this._matchWindow(window);
    });
    titleScope.connect(window, 'unmanaged', () => {
      this._titleScopes.delete(window);
      titleScope.dispose();
    });
  }

  private _isValidApp(app: any): boolean {
    if (!app) return false;

    const id: string = app.get_id() || '';
    return id.length > 0 && !id.startsWith('window:');
  }

  private _isGenericSteamApp(app: any): boolean {
    if (!app) return false;

    const id: string = app.get_id() || '';
    const lowerId = id.toLowerCase();
    return lowerId === 'steam.desktop' || lowerId === 'com.valvesoftware.steam.desktop';
  }

  private _deterministicMatch(appSystem: any, wmClass: string, appId: string, title: string): any {
    if (this._isBlacklisted(wmClass)) return null;

    const identities = [title, appId, wmClass].filter(Boolean);
    const candidates = identities.flatMap((identity) => [
      `${identity}.desktop`,
      `${identity.toLowerCase()}.desktop`,
    ]);

    for (const id of candidates) {
      const app = appSystem.lookup_app(id);
      if (app) return app;
    }

    return null;
  }

  private _heuristicMatch(appSystem: any, wmClass: string, appId: string, title: string): any {
    if (this._isBlacklisted(wmClass)) return null;

    let bestApp: any = null;
    let bestScore = 0;

    for (const appInfo of appSystem.get_installed()) {
      const id = appInfo.get_id();
      if (!id) continue;

      const app = appSystem.lookup_app(id);
      if (!app) continue;

      const score = this._scoreCandidate(app, wmClass, appId, title);
      if (score <= bestScore) continue;

      bestScore = score;
      bestApp = app;
    }

    if (bestScore < MIN_MATCH_SCORE) return null;

    logger.log(`heuristic match score=${bestScore}: ${bestApp.get_id()}`, {
      prefix: LOG_PREFIX,
    });
    return bestApp;
  }

  private _isBlacklisted(wmClass: string): boolean {
    const normalizedClass = wmClass.toLowerCase();
    return BLACKLISTED_PREFIXES.some((prefix) => normalizedClass.startsWith(prefix));
  }

  private _scoreCandidate(app: any, wmClass: string, appId: string, title: string): number {
    const desktopId = (app.get_id() || '').toLowerCase().replace(/\.desktop$/, '');
    const appName = String(app.get_name() || '').toLowerCase();

    if (this._isSteamGame(app, wmClass)) return 99;

    return scoreIconWeaveCandidate({ desktopId, appName, wmClass, appId, title });
  }

  private _isSteamGame(app: any, wmClass: string): boolean {
    const info = GioUnix.DesktopAppInfo.new(app.get_id());
    const executable: string = info?.get_string('Exec') || '';
    const steamMatch = executable.match(/steam:\/\/rungameid\/(\d+)/);
    if (!steamMatch) return false;

    const gameId = steamMatch[1];
    const normalizedClass = normalize(wmClass);
    if (normalizedClass === `steamapp${gameId}`) return true;

    const appName = String(app.get_name() || '').toLowerCase();
    const words = appName.split(/[^a-z0-9]/).filter((word: string) => word.length > 0);
    const abbreviation = words.map((word: string) => word[0]).join('');
    return normalizedClass === abbreviation && abbreviation.length >= 2;
  }
}
