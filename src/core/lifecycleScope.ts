export type Teardown = () => void;
export type SourceRemover = (sourceId: number) => void;

export interface ManagedSource {
  readonly active: boolean;
  replace(createSource: () => number): void;
  clear(): void;
  complete(): void;
}

type SignalTarget<Args extends unknown[]> = {
  connect(signal: string, callback: (...args: Args) => void): number;
  disconnect(id: number): void;
};

class ManagedSourceImpl implements ManagedSource {
  private _sourceId: number | null = 0;

  constructor(private readonly _remove: SourceRemover) {}

  get active(): boolean {
    return this._sourceId !== null && this._sourceId !== 0;
  }

  replace(createSource: () => number): void {
    this.clear();
    if (this._sourceId === null) return;

    this._sourceId = createSource();
  }

  clear(): void {
    if (!this._sourceId) return;
    const sourceId = this._sourceId;
    this._sourceId = 0;
    this._remove(sourceId);
  }

  complete(): void {
    if (this._sourceId === null) return;
    this._sourceId = 0;
  }

  dispose(): void {
    if (this._sourceId === null) return;
    this.clear();
    this._sourceId = null;
  }
}

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
  ): number {
    const id = target.connect(signal, callback);
    this.onDispose(() => target.disconnect(id));
    return id;
  }

  manageSource(remove: SourceRemover): ManagedSource {
    const source = new ManagedSourceImpl(remove);
    this.onDispose(() => source.dispose());
    return source;
  }

  dispose(): void {
    if (!this._teardowns) return;
    const teardowns = this._teardowns;
    this._teardowns = null;
    for (const teardown of teardowns.reverse()) {
      teardown();
    }
  }
}
