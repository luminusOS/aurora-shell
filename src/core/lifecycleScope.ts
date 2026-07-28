export type Teardown = () => void;

type SignalTarget<Args extends unknown[]> = {
  connect(signal: string, callback: (...args: Args) => void): number;
  disconnect(id: number): void;
};

export class LifecycleScope {
  private _teardowns: Teardown[] | null = [];

  onDispose(teardown: Teardown): void {
    if (!this._teardowns) {
      teardown();
      return;
    }
    this._teardowns.push(teardown);
  }

  connect<Args extends unknown[]>(
    target: SignalTarget<Args>,
    signal: string,
    callback: (...args: Args) => void,
  ): void {
    const id = target.connect(signal, callback);
    this.onDispose(() => target.disconnect(id));
  }

  dispose(): void {
    if (!this._teardowns) return;
    const teardowns = this._teardowns;
    this._teardowns = null;
    for (let index = teardowns.length - 1; index >= 0; index--) {
      try {
        teardowns[index]?.();
      } catch {
        // Teardown is best-effort; remaining resources must still be released.
      }
    }
  }
}
