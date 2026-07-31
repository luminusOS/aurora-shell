/**
 * Latches accidental edge activation while a pointer gesture is in progress.
 *
 * Once a pressed button or scroll is observed at the edge, suppression remains
 * active until the pointer leaves. Requiring a fresh edge entry prevents a
 * selection, drag, or scrollbar gesture from revealing the dock on release.
 */
export class EdgeGestureGuard {
  private _suppressedUntilLeave = false;
  private _cooldownUntilMs = 0;

  observeModifiers(modifiers: number, pointerButtonMask: number): boolean {
    if ((modifiers & pointerButtonMask) !== 0) this._suppressedUntilLeave = true;
    return this._suppressedUntilLeave;
  }

  suppressUntilLeave(): boolean {
    const changed = !this._suppressedUntilLeave;
    this._suppressedUntilLeave = true;
    return changed;
  }

  resetAfterPointerLeave(): void {
    this._suppressedUntilLeave = false;
  }

  beginCooldown(nowMs: number, durationMs: number): void {
    this._cooldownUntilMs = Math.max(this._cooldownUntilMs, nowMs + Math.max(0, durationMs));
  }

  isCoolingDown(nowMs: number): boolean {
    return nowMs < this._cooldownUntilMs;
  }
}
