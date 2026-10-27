export function vcpToSliderValue(current: number, max: number, min = 0): number {
  if (max <= min) return 0;

  return Math.min(1, Math.max(0, (current - min) / (max - min)));
}

export function sliderToVcpValue(value: number, max: number, min = 0): number {
  if (max <= min) return min;

  return Math.min(max, Math.max(min, Math.round(min + value * (max - min))));
}

/**
 * Serializes brightness writes for one display.
 *
 * Monitors keep VCP values in NVRAM that tolerates a limited number of writes, and a slider drag
 * produces far more positions than a monitor's own buttons would. Only one write runs at a time;
 * positions requested meanwhile collapse into the latest one, and a value equal to the last known
 * brightness is not written again.
 */
export class BrightnessWriteQueue {
  private _writing = false;
  private _pending: number | null = null;
  private _known: number | null;

  constructor(known: number | null = null) {
    this._known = known;
  }

  /** True while a write runs or waits; a brightness read made meanwhile may already be stale. */
  get busy(): boolean {
    return this._writing || this._pending !== null;
  }

  /** Returns the value to write now, or `null` when it was queued or is already applied. */
  request(value: number): number | null {
    if (this._writing) {
      this._pending = value;
      return null;
    }

    if (value === this._known) return null;

    this._writing = true;
    this._known = value;
    return value;
  }

  /** Ends the running write and returns the next value to write, if one was requested meanwhile. */
  finishWrite(succeeded: boolean): number | null {
    this._writing = false;
    if (!succeeded) this._known = null;

    const pending = this._pending;
    this._pending = null;
    if (pending === null) return null;

    return this.request(pending);
  }

  /** Records brightness applied outside this queue, by another client or the monitor itself. */
  noteKnownValue(value: number): void {
    // Signals and write replies do not establish which value reached the monitor last.
    this._known = this._writing ? null : value;
  }

  discardPending(): void {
    this._pending = null;
    this._known = null;
  }
}
