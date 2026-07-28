export type AnnotationTool =
  | 'select'
  | 'pointer'
  | 'freehand'
  | 'arrow'
  | 'rectangle'
  | 'solid-rectangle'
  | 'highlighter'
  | 'text'
  | 'stamp';

export type Point = { x: number; y: number };

export type Annotation = {
  tool: Exclude<AnnotationTool, 'select' | 'pointer'>;
  color: string;
  width: number;
  points: Point[];
  text?: string;
  counter?: number;
};

export type CaptureTransform = {
  originX: number;
  originY: number;
  scale: number;
};

const MIN_DRAG_DISTANCE = 2;
const POINTER_HIT_PADDING = 6;

type MoveState = {
  annotation: Annotation;
  origin: Point;
  originalPoints: Point[];
  changed: boolean;
};

export class AnnotationModel {
  private _annotations: Annotation[] = [];
  private _draft: Annotation | null = null;
  private _move: MoveState | null = null;
  private _tool: AnnotationTool = 'select';
  private _color = '#e01b24';
  private _width = 4;
  private _nextCounter = 1;

  get tool(): AnnotationTool {
    return this._tool;
  }

  get color(): string {
    return this._color;
  }

  get width(): number {
    return this._width;
  }

  get annotations(): readonly Annotation[] {
    return this._annotations;
  }

  get renderableAnnotations(): readonly Annotation[] {
    return this._draft ? [...this._annotations, this._draft] : this._annotations;
  }

  get hasAnnotations(): boolean {
    return this._annotations.length > 0;
  }

  setTool(tool: AnnotationTool): void {
    this.cancelDraft();
    this._tool = tool;
  }

  setColor(color: string): void {
    if (parseHexColor(color)) this._color = color.toLowerCase();
  }

  setWidth(width: number): void {
    if (Number.isFinite(width)) this._width = Math.max(1, Math.min(24, Math.round(width)));
  }

  begin(point: Point): boolean {
    if (this._tool === 'pointer') return this._beginMove(point);
    if (this._tool === 'select' || this._tool === 'text') return false;

    if (this._tool === 'stamp') {
      this._annotations.push({
        tool: 'stamp',
        color: this._color,
        width: this._width,
        points: [{ ...point }],
        counter: this._nextCounter++,
      });
      return true;
    }

    this._draft = {
      tool: this._tool,
      color: this._color,
      width: this._width,
      points: [{ ...point }],
    };
    return true;
  }

  update(point: Point): boolean {
    if (this._move) {
      const offsetX = point.x - this._move.origin.x;
      const offsetY = point.y - this._move.origin.y;
      this._move.annotation.points = this._move.originalPoints.map((original) => ({
        x: original.x + offsetX,
        y: original.y + offsetY,
      }));
      this._move.changed = offsetX !== 0 || offsetY !== 0;
      return true;
    }

    if (!this._draft) return false;

    if (this._draft.tool === 'freehand') {
      this._draft.points.push({ ...point });
    } else if (this._draft.points.length === 1) {
      this._draft.points.push({ ...point });
    } else {
      this._draft.points[this._draft.points.length - 1] = { ...point };
    }
    return true;
  }

  finish(): boolean {
    if (this._move) {
      const changed = this._move.changed;
      this._move = null;
      return changed;
    }

    const draft = this._draft;
    this._draft = null;
    if (!draft || !isUsefulAnnotation(draft)) return false;
    this._annotations.push(draft);
    return true;
  }

  addText(point: Point, text: string): boolean {
    const normalized = text.trim();
    if (!normalized) return false;
    this._annotations.push({
      tool: 'text',
      color: this._color,
      width: this._width,
      points: [{ ...point }],
      text: normalized,
    });
    return true;
  }

  cancelDraft(): void {
    this._draft = null;
    if (this._move) this._move.annotation.points = clonePoints(this._move.originalPoints);
    this._move = null;
  }

  undo(): boolean {
    this.cancelDraft();
    const removed = this._annotations.pop();
    if (!removed) return false;
    if (removed.tool === 'stamp') this._recalculateCounter();
    return true;
  }

  clear(): boolean {
    const changed = this._annotations.length > 0 || this._draft !== null || this._move !== null;
    this._annotations = [];
    this._draft = null;
    this._move = null;
    this._nextCounter = 1;
    return changed;
  }

  private _beginMove(point: Point): boolean {
    const annotation = findTopAnnotationAt(this._annotations, point);
    if (!annotation) return false;
    this._move = {
      annotation,
      origin: { ...point },
      originalPoints: clonePoints(annotation.points),
      changed: false,
    };
    return true;
  }

  private _recalculateCounter(): void {
    this._nextCounter =
      this._annotations.reduce(
        (highest, annotation) => Math.max(highest, annotation.counter ?? 0),
        0,
      ) + 1;
  }
}

export function transformPoint(point: Point, transform: CaptureTransform): Point {
  return {
    x: (point.x - transform.originX) * transform.scale,
    y: (point.y - transform.originY) * transform.scale,
  };
}

export function parseHexColor(color: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return null;
  const value = Number.parseInt(match[1]!, 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

function isUsefulAnnotation(annotation: Annotation): boolean {
  if (annotation.points.length < 2) return false;
  const first = annotation.points[0]!;
  const last = annotation.points[annotation.points.length - 1]!;
  return Math.hypot(last.x - first.x, last.y - first.y) >= MIN_DRAG_DISTANCE;
}

function findTopAnnotationAt(annotations: readonly Annotation[], point: Point): Annotation | null {
  for (let index = annotations.length - 1; index >= 0; index--) {
    const annotation = annotations[index]!;
    if (annotationContainsPoint(annotation, point)) return annotation;
  }
  return null;
}

function annotationContainsPoint(annotation: Annotation, point: Point): boolean {
  const points = annotation.points;
  if (points.length === 0) return false;
  const padding = POINTER_HIT_PADDING + annotation.width / 2;

  if (annotation.tool === 'rectangle' || annotation.tool === 'solid-rectangle')
    return points.length >= 2 && pointInBounds(point, points[0]!, points.at(-1)!, padding);

  if (annotation.tool === 'stamp') {
    const radius = Math.max(12, annotation.width * 2.5) + POINTER_HIT_PADDING;
    return distance(point, points[0]!) <= radius;
  }

  if (annotation.tool === 'text') return pointInText(annotation, point, padding);

  if (annotation.tool === 'arrow') {
    if (points.length < 2) return false;
    const start = points[0]!;
    const end = points.at(-1)!;
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const head = Math.max(10, annotation.width * 3);
    const headLeft = {
      x: end.x - head * Math.cos(angle - Math.PI / 6),
      y: end.y - head * Math.sin(angle - Math.PI / 6),
    };
    const headRight = {
      x: end.x - head * Math.cos(angle + Math.PI / 6),
      y: end.y - head * Math.sin(angle + Math.PI / 6),
    };
    return (
      distanceToSegment(point, start, end) <= padding ||
      distanceToSegment(point, end, headLeft) <= padding ||
      distanceToSegment(point, end, headRight) <= padding
    );
  }

  const visualWidth = annotation.tool === 'highlighter' ? annotation.width * 4 : annotation.width;
  return distanceToPolyline(point, points) <= POINTER_HIT_PADDING + visualWidth / 2;
}

function pointInText(annotation: Annotation, point: Point, padding: number): boolean {
  const origin = annotation.points[0]!;
  const lines = (annotation.text ?? '').split('\n');
  const fontSize = Math.max(16, annotation.width * 4);
  const width = Math.max(...lines.map((line) => line.length), 1) * fontSize * 0.65;
  const height = Math.max(lines.length, 1) * fontSize;
  return (
    point.x >= origin.x - padding &&
    point.x <= origin.x + width + padding &&
    point.y >= origin.y - padding &&
    point.y <= origin.y + height + padding
  );
}

function pointInBounds(point: Point, first: Point, last: Point, padding: number): boolean {
  return (
    point.x >= Math.min(first.x, last.x) - padding &&
    point.x <= Math.max(first.x, last.x) + padding &&
    point.y >= Math.min(first.y, last.y) - padding &&
    point.y <= Math.max(first.y, last.y) + padding
  );
}

function distanceToPolyline(point: Point, points: readonly Point[]): number {
  if (points.length === 1) return distance(point, points[0]!);
  let closest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index++)
    closest = Math.min(closest, distanceToSegment(point, points[index - 1]!, points[index]!));
  return closest;
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared === 0) return distance(point, start);
  const projection = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared),
  );
  return distance(point, {
    x: start.x + projection * deltaX,
    y: start.y + projection * deltaY,
  });
}

function distance(first: Point, second: Point): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function clonePoints(points: readonly Point[]): Point[] {
  return points.map((point) => ({ ...point }));
}
