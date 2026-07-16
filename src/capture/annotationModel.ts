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

export class AnnotationModel {
  private _annotations: Annotation[] = [];
  private _draft: Annotation | null = null;
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
    if (this._tool === 'select' || this._tool === 'pointer' || this._tool === 'text') return false;

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
  }

  undo(): boolean {
    this.cancelDraft();
    const removed = this._annotations.pop();
    if (!removed) return false;
    if (removed.tool === 'stamp') this._recalculateCounter();
    return true;
  }

  clear(): boolean {
    const changed = this._annotations.length > 0 || this._draft !== null;
    this._annotations = [];
    this._draft = null;
    this._nextCounter = 1;
    return changed;
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
