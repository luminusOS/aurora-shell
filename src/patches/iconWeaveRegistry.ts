export class IconWeaveWindowRegistry {
  private _mappings = new Map<any, any>();
  private _processed = new Set<string>();

  get mappings(): ReadonlyMap<any, any> {
    return this._mappings;
  }

  hasProcessed(identity: string): boolean {
    return this._processed.has(identity);
  }

  markProcessed(identity: string): void {
    this._processed.add(identity);
  }

  map(window: any, app: any): void {
    this._mappings.set(window, app);
  }

  findMappedApp(wmClass: string, appId: string): any | null {
    for (const [window, app] of this._mappings) {
      const sameWmClass = Boolean(wmClass && window.get_wm_class() === wmClass);
      const sameAppId = Boolean(appId && window.get_gtk_application_id() === appId);

      if (sameWmClass || sameAppId) return app;
    }

    return null;
  }

  remove(window: any, wmClass: string, appId: string): void {
    this._mappings.delete(window);

    const identity = wmClass || appId;
    if (!identity) return;

    const stillMapped = [...this._mappings.keys()].some(
      (mappedWindow) =>
        (wmClass && mappedWindow.get_wm_class() === wmClass) ||
        (appId && mappedWindow.get_gtk_application_id() === appId),
    );

    if (!stillMapped) {
      this._processed.delete(identity);
    }
  }

  clear(): void {
    this._processed.clear();
    this._mappings.clear();
  }
}
