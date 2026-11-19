import {
  CaptureTools,
  type CaptureToolsDevInteraction,
  type CaptureToolsDevState,
} from '~/capture/captureTools.ts';
import type { AnnotationTool } from '~/capture/annotationModel.ts';
import { action, type RuntimeAction } from './protocol.ts';
import type { Module } from '~/module.ts';

const TOOLS: readonly AnnotationTool[] = [
  'select',
  'pointer',
  'freehand',
  'rectangle',
  'solid-rectangle',
  'highlighter',
  'arrow',
  'text',
  'stamp',
];
const COLORS = ['#e01b24', '#ff8800', '#ffdd00', '#44cc44', '#4488ff', '#aa44ff'] as const;
const WIDTHS = [2, 4, 8, 12, 16] as const;

export class CaptureToolsDevTool {
  readonly key = 'capture-tools';
  readonly title = 'Capture Tool';

  constructor(private readonly _getModule: (key: string) => Module | null) {}

  describe() {
    const capture = this._getCaptureTools();
    const state = capture ? capture.devState : null;
    const toolLabel = state ? state.tool : 'off';
    const colorLabel = state ? state.color : 'off';
    const widthLabel = state ? state.width : 0;
    const actions: RuntimeAction[] = [];
    const details: string[] = [];
    details.push(this._stateSummary(state));
    details.push(this._geometrySummary(state));

    actions.push(action('openPreview', 'Open Preview', () => this.openPreview(), !capture));
    actions.push(action('reset', 'Reset', () => this.reset(), !capture));

    actions.push(action('capture-tool', `Tool: ${toolLabel}`, () => this.cycleTool(), !capture));
    actions.push(
      action('capture-color', `Color: ${colorLabel}`, () => this.cycleColor(), !capture),
    );
    actions.push(
      action('capture-width', `Width: ${widthLabel}`, () => this.cycleWidth(), !capture),
    );

    actions.push(
      action(
        'capture-interaction-selection',
        'Move Selection',
        () => this.toggleInteraction('selection'),
        !capture,
        Boolean(state && state.interaction === 'selection'),
      ),
    );
    actions.push(
      action(
        'capture-interaction-drawing',
        'Draw',
        () => this.toggleInteraction('drawing'),
        !capture,
        Boolean(state && state.interaction === 'drawing'),
      ),
    );

    actions.push(
      action(
        'capture-tesseract-on',
        'Tesseract On',
        () => this.setTesseractAvailable(true),
        !capture,
        Boolean(state && state.ocrAvailabilityOverridden && state.ocrAvailable === true),
      ),
    );
    actions.push(
      action(
        'capture-tesseract-off',
        'Tesseract Off',
        () => this.setTesseractAvailable(false),
        !capture,
        Boolean(state && state.ocrAvailabilityOverridden && state.ocrAvailable === false),
      ),
    );

    actions.push(action('injectOcr', 'Inject OCR', () => this.injectOcr(), !capture));
    actions.push(
      action('copyOcr', 'Copy OCR', () => this.copyOcr(), !state || !state.ocrHasResult),
    );
    actions.push(
      action('searchOcr', 'Search OCR', () => this.searchOcr(), !state || !state.ocrHasResult),
    );

    actions.push(
      action('clearAnnotations', 'Clear Annotations', () => this.clearAnnotations(), !capture),
    );
    return { details, actions };
  }

  destroy(): void {
    const capture = this._getCaptureTools();
    if (capture) capture.resetDevState();
  }

  async openPreview(): Promise<boolean> {
    const capture = this._getCaptureTools();
    if (!capture) return false;

    return await capture.openDevPreview();
  }

  cycleTool(): AnnotationTool | null {
    const capture = this._getCaptureTools();
    const state = capture?.devState;
    if (!capture || !state) return null;
    const current = TOOLS.indexOf(state.tool);
    const next = TOOLS[(current + 1) % TOOLS.length]!;
    if (!capture.setDevTool(next)) return null;
    return next;
  }

  cycleColor(): string | null {
    const capture = this._getCaptureTools();
    const state = capture?.devState;
    if (!capture || !state) return null;
    const current = COLORS.indexOf(state.color as (typeof COLORS)[number]);
    const next = COLORS[(current + 1) % COLORS.length]!;
    if (!capture.setDevColor(next)) return null;
    return next;
  }

  cycleWidth(): number | null {
    const capture = this._getCaptureTools();
    const state = capture?.devState;
    if (!capture || !state) return null;
    const current = WIDTHS.indexOf(state.width as (typeof WIDTHS)[number]);
    const next = WIDTHS[(current + 1) % WIDTHS.length]!;
    if (!capture.setDevWidth(next)) return null;
    return next;
  }

  toggleInteraction(interaction: Exclude<CaptureToolsDevInteraction, 'idle'>): boolean {
    const capture = this._getCaptureTools();
    const state = capture?.devState;
    if (!capture || !state) return false;
    return capture.simulateDevInteraction(state.interaction === interaction ? 'idle' : interaction);
  }

  setTesseractAvailable(available: boolean): boolean {
    const capture = this._getCaptureTools();
    if (!capture) return false;

    return capture.setDevOcrAvailable(available);
  }

  injectOcr(): boolean {
    const capture = this._getCaptureTools();
    if (!capture) return false;

    return capture.injectDevOcrResult();
  }

  copyOcr(): boolean {
    const capture = this._getCaptureTools();
    if (!capture) return false;

    return capture.copyDevOcrText();
  }

  searchOcr(): boolean {
    const capture = this._getCaptureTools();
    if (!capture) return false;

    return capture.searchDevOcrText();
  }

  clearAnnotations(): boolean {
    const capture = this._getCaptureTools();
    if (!capture) return false;

    return capture.clearDevAnnotations();
  }

  reset(): boolean {
    const capture = this._getCaptureTools();
    if (!capture) return false;

    return capture.resetDevState();
  }

  get state(): CaptureToolsDevState | null {
    const capture = this._getCaptureTools();
    if (!capture) return null;

    return capture.devState;
  }

  private _stateSummary(state: CaptureToolsDevState | null): string {
    if (!state) return 'Capture Tools disabled';
    const ocr = state.ocrAvailable === null ? 'probing' : state.ocrAvailable ? 'on' : 'off';
    return `${state.tool} · ${state.color} · ${state.width}px · opacity ${state.controlsOpacity} · OCR ${ocr}`;
  }

  private _geometrySummary(state: CaptureToolsDevState | null): string {
    if (!state || !state.toolbarGeometry) return 'Toolbar geometry unavailable';

    const geometry = state.toolbarGeometry;
    const visibility = state.toolbarVisible ? 'visible' : 'hidden';
    return `Toolbar ${geometry.x},${geometry.y} · ${geometry.width}×${geometry.height} · ${visibility} · ${state.interaction}`;
  }

  private _getCaptureTools(): CaptureTools | null {
    const module = this._getModule('capture-tools');
    return module instanceof CaptureTools ? module : null;
  }
}
