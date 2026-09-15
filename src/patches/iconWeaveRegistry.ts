export function createIconWeaveResolutionKey(
  wmClass: string,
  appId: string,
  title: string,
): string {
  return JSON.stringify([wmClass, appId, title]);
}

const MAX_RESOLVED_APPS = 256;

export class IconWeaveWindowRegistry {
  private _mappings = new Map<any, any>();
  private _resolvedApps = new Map<string, string | null>();

  get mappings(): ReadonlyMap<any, any> {
    return this._mappings;
  }

  hasResolved(key: string): boolean {
    return this._resolvedApps.has(key);
  }

  getResolvedApp(key: string): string | null | undefined {
    return this._resolvedApps.get(key);
  }

  setResolvedApp(key: string, desktopId: string | null): void {
    if (!this._resolvedApps.has(key) && this._resolvedApps.size >= MAX_RESOLVED_APPS) {
      const oldestKey = this._resolvedApps.keys().next().value;
      if (oldestKey !== undefined) this._resolvedApps.delete(oldestKey);
    }
    this._resolvedApps.set(key, desktopId);
  }

  removeResolution(key: string): void {
    this._resolvedApps.delete(key);
  }

  clearResolutions(): void {
    this._resolvedApps.clear();
  }

  map(window: any, app: any): void {
    this._mappings.set(window, app);
  }

  remove(window: any): void {
    this._mappings.delete(window);
  }

  clear(): void {
    this._mappings.clear();
    this._resolvedApps.clear();
  }
}
