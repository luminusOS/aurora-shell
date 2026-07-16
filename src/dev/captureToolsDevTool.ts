import '@girs/gjs';

import type St from '@girs/st-18';

import {
  CaptureTools,
  type CaptureToolsDevInteraction,
  type CaptureToolsDevState,
} from '~/capture/captureTools.ts';
import type { AnnotationTool } from '~/capture/annotationModel.ts';
import {
  createDevToolActionButton,
  createDevToolActionRow,
  createDevToolModulePanel,
  createDevToolSummary,
} from '~/dev/devToolUi.ts';
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
  readonly iconName = 'camera-photo-symbolic';

  constructor(
    private readonly _getModule: (key: string) => Module | null,
    private readonly _requestMenuRebuild: () => void,
  ) {}

  buildPanel(): St.Widget {
    const capture = this._getCaptureTools();
    const state = capture?.devState ?? null;
    const panel = createDevToolModulePanel();
    panel.add_child(createDevToolSummary(this.iconName, this._stateSummary(state)));
    panel.add_child(createDevToolSummary('find-location-symbolic', this._geometrySummary(state)));

    const sessionRow = createDevToolActionRow();
    sessionRow.add_child(
      createDevToolActionButton(
        'camera-photo-symbolic',
        'Open Preview',
        () => void this.openPreview(),
        !capture,
      ),
    );
    sessionRow.add_child(
      createDevToolActionButton('view-refresh-symbolic', 'Reset', () => this.reset(), !capture),
    );
    panel.add_child(sessionRow);

    const appearanceRow = createDevToolActionRow();
    appearanceRow.add_child(
      createDevToolActionButton(
        'document-edit-symbolic',
        `Tool: ${state?.tool ?? 'off'}`,
        () => this.cycleTool(),
        !capture,
      ),
    );
    appearanceRow.add_child(
      createDevToolActionButton(
        'applications-graphics-symbolic',
        `Color: ${state?.color ?? 'off'}`,
        () => this.cycleColor(),
        !capture,
      ),
    );
    appearanceRow.add_child(
      createDevToolActionButton(
        'format-text-bold-symbolic',
        `Width: ${state?.width ?? 0}`,
        () => this.cycleWidth(),
        !capture,
      ),
    );
    panel.add_child(appearanceRow);

    const opacityRow = createDevToolActionRow();
    opacityRow.add_child(
      createDevToolActionButton(
        'selection-opaque-3-symbolic',
        'Move Selection',
        () => this.toggleInteraction('selection'),
        !capture,
        state?.interaction === 'selection',
      ),
    );
    opacityRow.add_child(
      createDevToolActionButton(
        'document-edit-symbolic',
        'Draw',
        () => this.toggleInteraction('drawing'),
        !capture,
        state?.interaction === 'drawing',
      ),
    );
    panel.add_child(opacityRow);

    const tesseractRow = createDevToolActionRow();
    tesseractRow.add_child(
      createDevToolActionButton(
        'emblem-ok-symbolic',
        'Tesseract On',
        () => this.setTesseractAvailable(true),
        !capture,
        state?.ocrAvailabilityOverridden === true && state.ocrAvailable === true,
      ),
    );
    tesseractRow.add_child(
      createDevToolActionButton(
        'action-unavailable-symbolic',
        'Tesseract Off',
        () => this.setTesseractAvailable(false),
        !capture,
        state?.ocrAvailabilityOverridden === true && state.ocrAvailable === false,
      ),
    );
    panel.add_child(tesseractRow);

    const ocrRow = createDevToolActionRow();
    ocrRow.add_child(
      createDevToolActionButton('scanner-symbolic', 'Inject OCR', () => this.injectOcr(), !capture),
    );
    ocrRow.add_child(
      createDevToolActionButton(
        'edit-copy-symbolic',
        'Copy OCR',
        () => this.copyOcr(),
        !state?.ocrHasResult,
      ),
    );
    ocrRow.add_child(
      createDevToolActionButton(
        'system-search-symbolic',
        'Search OCR',
        () => this.searchOcr(),
        !state?.ocrHasResult,
      ),
    );
    panel.add_child(ocrRow);

    const cleanupRow = createDevToolActionRow();
    cleanupRow.add_child(
      createDevToolActionButton(
        'user-trash-symbolic',
        'Clear Annotations',
        () => this.clearAnnotations(),
        !capture,
      ),
    );
    panel.add_child(cleanupRow);
    return panel;
  }

  destroy(): void {
    this._getCaptureTools()?.resetDevState();
  }

  async openPreview(): Promise<boolean> {
    const opened = (await this._getCaptureTools()?.openDevPreview()) ?? false;
    this._requestMenuRebuild();
    return opened;
  }

  cycleTool(): AnnotationTool | null {
    const capture = this._getCaptureTools();
    const state = capture?.devState;
    if (!capture || !state) return null;
    const current = TOOLS.indexOf(state.tool);
    const next = TOOLS[(current + 1) % TOOLS.length]!;
    if (!capture.setDevTool(next)) return null;
    this._requestMenuRebuild();
    return next;
  }

  cycleColor(): string | null {
    const capture = this._getCaptureTools();
    const state = capture?.devState;
    if (!capture || !state) return null;
    const current = COLORS.indexOf(state.color as (typeof COLORS)[number]);
    const next = COLORS[(current + 1) % COLORS.length]!;
    if (!capture.setDevColor(next)) return null;
    this._requestMenuRebuild();
    return next;
  }

  cycleWidth(): number | null {
    const capture = this._getCaptureTools();
    const state = capture?.devState;
    if (!capture || !state) return null;
    const current = WIDTHS.indexOf(state.width as (typeof WIDTHS)[number]);
    const next = WIDTHS[(current + 1) % WIDTHS.length]!;
    if (!capture.setDevWidth(next)) return null;
    this._requestMenuRebuild();
    return next;
  }

  toggleInteraction(interaction: Exclude<CaptureToolsDevInteraction, 'idle'>): boolean {
    const capture = this._getCaptureTools();
    const state = capture?.devState;
    if (!capture || !state) return false;
    const changed = capture.simulateDevInteraction(
      state.interaction === interaction ? 'idle' : interaction,
    );
    if (changed) this._requestMenuRebuild();
    return changed;
  }

  setTesseractAvailable(available: boolean): boolean {
    const changed = this._getCaptureTools()?.setDevOcrAvailable(available) ?? false;
    if (changed) this._requestMenuRebuild();
    return changed;
  }

  injectOcr(): boolean {
    const changed = this._getCaptureTools()?.injectDevOcrResult() ?? false;
    if (changed) this._requestMenuRebuild();
    return changed;
  }

  copyOcr(): boolean {
    const changed = this._getCaptureTools()?.copyDevOcrText() ?? false;
    if (changed) this._requestMenuRebuild();
    return changed;
  }

  searchOcr(): boolean {
    return this._getCaptureTools()?.searchDevOcrText() ?? false;
  }

  clearAnnotations(): boolean {
    const changed = this._getCaptureTools()?.clearDevAnnotations() ?? false;
    if (changed) this._requestMenuRebuild();
    return changed;
  }

  reset(): boolean {
    const changed = this._getCaptureTools()?.resetDevState() ?? false;
    if (changed) this._requestMenuRebuild();
    return changed;
  }

  get state(): CaptureToolsDevState | null {
    return this._getCaptureTools()?.devState ?? null;
  }

  private _stateSummary(state: CaptureToolsDevState | null): string {
    if (!state) return 'Capture Tools disabled';
    const ocr = state.ocrAvailable === null ? 'probing' : state.ocrAvailable ? 'on' : 'off';
    return `${state.tool} · ${state.color} · ${state.width}px · opacity ${state.controlsOpacity} · OCR ${ocr}`;
  }

  private _geometrySummary(state: CaptureToolsDevState | null): string {
    const geometry = state?.toolbarGeometry;
    if (!state || !geometry) return 'Toolbar geometry unavailable';
    const visibility = state.toolbarVisible ? 'visible' : 'hidden';
    return `Toolbar ${geometry.x},${geometry.y} · ${geometry.width}×${geometry.height} · ${visibility} · ${state.interaction}`;
  }

  private _getCaptureTools(): CaptureTools | null {
    const module = this._getModule('capture-tools');
    return module instanceof CaptureTools ? module : null;
  }
}
