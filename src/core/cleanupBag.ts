export type Cleanup = () => void;

type SignalTarget<Args extends unknown[]> = {
  connect(signal: string, callback: (...args: Args) => void): number;
  disconnect(id: number): void;
};

type ConnectObjectTarget<Owner> = {
  disconnectObject(owner: Owner): void;
};

export class CleanupBag {
  private _cleanups: Cleanup[] = [];
  private _disposed = false;

  add(cleanup: Cleanup): Cleanup {
    if (this._disposed) {
      cleanup();
      return cleanup;
    }
    this._cleanups.push(cleanup);
    return cleanup;
  }

  connect<Args extends unknown[]>(
    target: SignalTarget<Args>,
    signal: string,
    callback: (...args: Args) => void,
  ): number {
    const id = target.connect(signal, callback);
    this.add(() => target.disconnect(id));
    return id;
  }

  connectObject<Owner>(
    target: ConnectObjectTarget<Owner>,
    owner: Owner,
    connect: () => void,
  ): void {
    connect();
    this.add(() => target.disconnectObject(owner));
  }

  source(id: number, remove: (id: number) => void): number {
    this.add(() => remove(id));
    return id;
  }

  watch(id: number, unwatch: (id: number) => void): number {
    this.add(() => unwatch(id));
    return id;
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    const cleanups = this._cleanups;
    this._cleanups = [];
    for (let index = cleanups.length - 1; index >= 0; index--) {
      try {
        cleanups[index]?.();
      } catch {
        // Cleanup is best-effort; remaining resources must still be released.
      }
    }
  }
}
