// Shake detection adapted from adityakrishnan005-a11y/adaptive-wiggle-cursor (MIT); see CREDITS.md.

type MotionPoint = { x: number; y: number; time: number };

// Times are milliseconds and distances are logical pixels.
const WINDOW_MS = 800;
const MAX_POINTS = 8;
// A larger jump is a warp between monitors or a pointer teleport, not hand motion.
const MAX_STEP = 500;
const MIN_SAMPLE_DISTANCE = 4;
// Each reversal adds one point, so five points are four strokes.
const MIN_POINTS = 5;
const MIN_DISTANCE = 120;
const MIN_DIAGONAL = 30;
// Path length over bounding-box diagonal: a straight sweep is 1, a shake grows with every stroke.
const MIN_PATH_RATIO = 3;
const DIRECTION_TOLERANCE = 2;

function sameDirection(a: number, b: number): boolean {
  return (
    (a >= -DIRECTION_TOLERANCE && b >= -DIRECTION_TOLERANCE) ||
    (a <= DIRECTION_TOLERANCE && b <= DIRECTION_TOLERANCE)
  );
}

export class ShakeDetector {
  private readonly _points: MotionPoint[] = [];

  reset(): void {
    this._points.length = 0;
  }

  update(x: number, y: number, time: number): boolean {
    const previous = this._points.at(-1);
    if (previous && (time < previous.time || Math.hypot(x - previous.x, y - previous.y) > MAX_STEP))
      this.reset();

    while (this._points.length > 0 && this._points[0]!.time < time - WINDOW_MS)
      this._points.shift();

    const last = this._points.at(-1);
    const beforeLast = this._points.at(-2);
    if (last && Math.hypot(x - last.x, y - last.y) < MIN_SAMPLE_DISTANCE) return false;

    if (
      last &&
      beforeLast &&
      sameDirection(last.x - beforeLast.x, x - last.x) &&
      sameDirection(last.y - beforeLast.y, y - last.y)
    ) {
      last.x = x;
      last.y = y;
      last.time = time;
    } else {
      this._points.push({ x, y, time });
      if (this._points.length > MAX_POINTS) this._points.shift();
    }

    // The stroke in progress counts too, so dense sampling detects as early as sparse sampling.
    // Judge only the latest strokes: a long sweep before the shake must not dilute its path ratio.
    for (let start = 0; start + MIN_POINTS <= this._points.length; start++) {
      if (this._isShake(start)) {
        this.reset();
        return true;
      }
    }

    return false;
  }

  private _isShake(start: number): boolean {
    const first = this._points[start]!;
    let left = first.x;
    let right = first.x;
    let top = first.y;
    let bottom = first.y;
    let distance = 0;

    for (let i = start + 1; i < this._points.length; i++) {
      const point = this._points[i]!;
      const preceding = this._points[i - 1]!;
      left = Math.min(left, point.x);
      right = Math.max(right, point.x);
      top = Math.min(top, point.y);
      bottom = Math.max(bottom, point.y);
      distance += Math.hypot(point.x - preceding.x, point.y - preceding.y);
    }

    const diagonal = Math.hypot(right - left, bottom - top);
    if (diagonal < MIN_DIAGONAL || distance < MIN_DISTANCE) return false;

    return distance / diagonal >= MIN_PATH_RATIO;
  }
}
