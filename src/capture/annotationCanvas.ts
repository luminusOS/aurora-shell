import Cairo from 'cairo';
import Clutter from '@girs/clutter-18';
import GObject from '@girs/gobject-2.0';
import St from '@girs/st-18';
import {
  parseHexColor,
  type Annotation,
  type AnnotationModel,
  type CaptureTransform,
  type Point,
  transformPoint,
} from '~/capture/annotationModel.ts';
import type { OcrWord } from '~/capture/ocrLogic.ts';

type PointMapper = (point: Point) => Point | null;
type TextRequest = (point: Point) => void;
type DrawingStateChanged = (drawing: boolean) => void;

export const AnnotationCanvas = GObject.registerClass(
  class AnnotationCanvas extends St.DrawingArea {
    private _model: AnnotationModel | null = null;
    private _ocrWords: readonly OcrWord[] = [];
    private _requestText: TextRequest = () => {};
    private _drawingStateChanged: DrawingStateChanged = () => {};
    private _drawing = false;
    private _stageGrab: Clutter.Grab | null = null;

    override _init(): void {
      super._init({
        reactive: false,
        x_expand: true,
        y_expand: true,
        style_class: 'capture-tools-canvas',
      });
    }

    configure(
      model: AnnotationModel,
      requestText: TextRequest,
      drawingStateChanged: DrawingStateChanged = () => {},
    ): void {
      this._model = model;
      this._requestText = requestText;
      this._drawingStateChanged = drawingStateChanged;

      this.connect('button-press-event', (_actor: St.DrawingArea, event: Clutter.Event) => {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY) return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        if (!this._model) return Clutter.EVENT_PROPAGATE;
        if (this._model.tool === 'text') {
          this._requestText({ x, y });
          return Clutter.EVENT_STOP;
        }
        if (!this._model.begin({ x, y })) return Clutter.EVENT_PROPAGATE;
        this._setDrawing(this._model.tool !== 'stamp');
        if (this._drawing) this._stageGrab = global.stage.grab(this);
        this.queue_repaint();
        return Clutter.EVENT_STOP;
      });

      this.connect('motion-event', (_actor: St.DrawingArea, event: Clutter.Event) => {
        if (!this._drawing || !this._model) return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        this._model.update({ x, y });
        this.queue_repaint();
        return Clutter.EVENT_STOP;
      });

      this.connect('button-release-event', (_actor: St.DrawingArea, event: Clutter.Event) => {
        if (!this._drawing || !this._model || event.get_button() !== Clutter.BUTTON_PRIMARY)
          return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        this._model.update({ x, y });
        this._finishDrawing();
        return Clutter.EVENT_STOP;
      });
    }

    setDrawingEnabled(enabled: boolean): void {
      this.reactive = enabled;
      if (!enabled) this.cancelDrawing();
    }

    setOcrWords(words: readonly OcrWord[]): void {
      this._ocrWords = words;
      this.queue_repaint();
    }

    refresh(): void {
      this.queue_repaint();
    }

    cancelDrawing(): void {
      this._model?.cancelDraft();
      this._setDrawing(false);
      this._stageGrab?.dismiss();
      this._stageGrab = null;
      this.queue_repaint();
    }

    override vfunc_repaint(): void {
      const cr = this.get_context();
      if (!this._model) {
        cr.$dispose();
        return;
      }
      const mapper: PointMapper = (point) => {
        const [ok, x, y] = this.transform_stage_point(point.x, point.y);
        return ok ? { x, y } : null;
      };

      renderAnnotations(cr, this._model.renderableAnnotations, mapper, 1);
      renderOcrHighlights(cr, this._ocrWords, mapper);
      cr.$dispose();
    }

    private _finishDrawing(): void {
      this._model?.finish();
      this._setDrawing(false);
      this._stageGrab?.dismiss();
      this._stageGrab = null;
      this.queue_repaint();
    }

    private _setDrawing(drawing: boolean): void {
      if (this._drawing === drawing) return;
      this._drawing = drawing;
      this._drawingStateChanged(drawing);
    }
  },
);

export const OutputAnnotationCanvas = GObject.registerClass(
  class OutputAnnotationCanvas extends St.DrawingArea {
    private _annotations: readonly Annotation[] = [];
    private _transform: CaptureTransform = { originX: 0, originY: 0, scale: 1 };

    override _init(): void {
      super._init({ reactive: false, x_expand: true, y_expand: true });
    }

    configure(annotations: readonly Annotation[], transform: CaptureTransform): void {
      this._annotations = annotations;
      this._transform = transform;
    }

    override vfunc_repaint(): void {
      const cr = this.get_context();
      renderAnnotations(
        cr,
        this._annotations,
        (point) => transformPoint(point, this._transform),
        this._transform.scale,
      );
      cr.$dispose();
    }
  },
);

export function renderAnnotations(
  cr: Cairo.Context,
  annotations: readonly Annotation[],
  mapPoint: PointMapper,
  widthScale: number,
): void {
  for (const annotation of annotations) {
    const points = annotation.points
      .map(mapPoint)
      .filter((point): point is Point => point !== null);
    if (points.length === 0) continue;
    renderAnnotation(cr, annotation, points, widthScale);
  }
}

function renderAnnotation(
  cr: Cairo.Context,
  annotation: Annotation,
  points: readonly Point[],
  widthScale: number,
): void {
  const color = parseHexColor(annotation.color) ?? [1, 0, 0];
  const lineWidth = Math.max(1, annotation.width * widthScale);
  cr.setLineCap(Cairo.LineCap.ROUND);
  cr.setLineJoin(Cairo.LineJoin.ROUND);
  cr.setLineWidth(annotation.tool === 'highlighter' ? lineWidth * 4 : lineWidth);
  cr.setSourceRGBA(color[0], color[1], color[2], annotation.tool === 'highlighter' ? 0.45 : 1);

  if (annotation.tool === 'freehand' || annotation.tool === 'highlighter') {
    if (points.length < 2) return;
    cr.moveTo(points[0]!.x, points[0]!.y);
    for (const point of points.slice(1)) cr.lineTo(point.x, point.y);
    cr.stroke();
    return;
  }

  if (annotation.tool === 'arrow') {
    if (points.length < 2) return;
    const start = points[0]!;
    const end = points[points.length - 1]!;
    cr.moveTo(start.x, start.y);
    cr.lineTo(end.x, end.y);
    cr.stroke();

    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const head = Math.max(10 * widthScale, lineWidth * 3);
    cr.moveTo(end.x, end.y);
    cr.lineTo(
      end.x - head * Math.cos(angle - Math.PI / 6),
      end.y - head * Math.sin(angle - Math.PI / 6),
    );
    cr.moveTo(end.x, end.y);
    cr.lineTo(
      end.x - head * Math.cos(angle + Math.PI / 6),
      end.y - head * Math.sin(angle + Math.PI / 6),
    );
    cr.stroke();
    return;
  }

  if (annotation.tool === 'rectangle') {
    if (points.length < 2) return;
    const start = points[0]!;
    const end = points[points.length - 1]!;
    cr.rectangle(
      Math.min(start.x, end.x),
      Math.min(start.y, end.y),
      Math.abs(end.x - start.x),
      Math.abs(end.y - start.y),
    );
    cr.stroke();
    return;
  }

  if (annotation.tool === 'solid-rectangle') {
    if (points.length < 2) return;
    const start = points[0]!;
    const end = points[points.length - 1]!;
    cr.rectangle(
      Math.min(start.x, end.x),
      Math.min(start.y, end.y),
      Math.abs(end.x - start.x),
      Math.abs(end.y - start.y),
    );
    cr.fill();
    return;
  }

  if (annotation.tool === 'text') {
    const start = points[0]!;
    const fontSize = Math.max(16 * widthScale, lineWidth * 4);
    cr.selectFontFace('Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
    cr.setFontSize(fontSize);
    for (const [index, line] of (annotation.text ?? '').split('\n').entries()) {
      cr.moveTo(start.x, start.y + fontSize * (index + 1));
      cr.showText(line);
    }
    return;
  }

  if (annotation.tool === 'stamp') {
    const center = points[0]!;
    const radius = Math.max(12 * widthScale, lineWidth * 2.5);
    cr.arc(center.x, center.y, radius, 0, Math.PI * 2);
    cr.fill();
    const label = String(annotation.counter ?? 1);
    cr.setSourceRGBA(1, 1, 1, 1);
    cr.selectFontFace('Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
    cr.setFontSize(radius * 1.15);
    const extents = cr.textExtents(label);
    cr.moveTo(
      center.x - extents.width / 2 - extents.xBearing,
      center.y - extents.height / 2 - extents.yBearing,
    );
    cr.showText(label);
  }
}

function renderOcrHighlights(
  cr: Cairo.Context,
  words: readonly OcrWord[],
  mapPoint: PointMapper,
): void {
  for (const word of words) {
    const topLeft = mapPoint({ x: word.bounds.x, y: word.bounds.y });
    const bottomRight = mapPoint({
      x: word.bounds.x + word.bounds.width,
      y: word.bounds.y + word.bounds.height,
    });
    if (!topLeft || !bottomRight) continue;
    cr.setSourceRGBA(0.2, 0.65, 1, 0.24);
    cr.rectangle(
      topLeft.x - 2,
      topLeft.y - 2,
      bottomRight.x - topLeft.x + 4,
      bottomRight.y - topLeft.y + 4,
    );
    cr.fillPreserve();
    cr.setSourceRGBA(0.55, 0.85, 1, 0.8);
    cr.setLineWidth(1);
    cr.stroke();
  }
}
