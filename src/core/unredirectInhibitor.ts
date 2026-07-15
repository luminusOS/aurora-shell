export interface UnredirectController {
  disable_unredirect(): void;
  enable_unredirect(): void;
}

/**
 * Owns one balanced reference to Mutter's global unredirect inhibitor.
 *
 * Shell actors that are painted above client windows must inhibit unredirect
 * while mapped; otherwise a direct-scanned client buffer bypasses those actors.
 */
export class UnredirectInhibitor {
  private _inhibited = false;

  constructor(private readonly _controller: UnredirectController) {}

  get inhibited(): boolean {
    return this._inhibited;
  }

  setInhibited(inhibited: boolean): void {
    if (this._inhibited === inhibited) return;

    if (inhibited) {
      this._controller.disable_unredirect();
    } else {
      this._controller.enable_unredirect();
    }

    this._inhibited = inhibited;
  }

  release(): void {
    this.setInhibited(false);
  }
}
