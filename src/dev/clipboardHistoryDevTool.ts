import GLib from 'gi://GLib';

import { ClipboardHistory } from '~/clipboard/clipboardHistory.ts';
import { fingerprintBytes } from '~/clipboard/clipboardMonitor.ts';
import { action, type RuntimeAction } from './protocol.ts';
import type { Module } from '~/module.ts';
import { gettext as _ } from '~/shared/i18n.ts';

const RANDOM_MESSAGES = [
  'Aurora dev note: clipboard entry',
  'Release checklist item',
  'GNOME Shell test payload',
  'Temporary clipboard sample',
  'Debug message from DevTool',
] as const;

const SAMPLE_LINK = 'https://github.com/boerdereinar/copyous';

const SAMPLE_CODE_SNIPPET = `function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}`;

const SAMPLE_IMAGE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==';

export class ClipboardHistoryDevTool {
  readonly key = 'clipboard-history';
  readonly title = 'Clipboard';

  private _generatedSamples: string[] = [];

  constructor(private readonly _getModule: (key: string) => Module | null) {}

  describe() {
    const clipboard = this._getClipboardHistory();
    const actions: RuntimeAction[] = [];
    const details: string[] = [];
    details.push(
      clipboard ? `${clipboard.entryCount} history entries` : 'Clipboard History disabled',
    );

    actions.push(action('openPanel', 'Open Panel', () => this.openPanel(), !clipboard));
    actions.push(
      action('addRandomMessage', 'Add Message', () => this.addRandomMessage(), !clipboard),
    );

    actions.push(
      action('addRandomMessages', 'Add 5 Messages', () => this.addRandomMessages(5), !clipboard),
    );
    actions.push(
      action(
        'clearHistory',
        'Clear History',
        () => this.clearHistory(),
        !clipboard || clipboard.entryCount === 0,
      ),
    );

    actions.push(action('addSampleImage', 'Add Image', () => this.addSampleImage(), !clipboard));
    actions.push(action('addSampleLink', 'Add Link', () => this.addSampleLink(), !clipboard));
    actions.push(action('addSampleCode', 'Add Code', () => this.addSampleCode(), !clipboard));

    if (this._generatedSamples.length) {
      for (const sample of this._generatedSamples)
        details.push(sample + ': ' + _('Added by Aurora DevTool'));
    }

    return { details, actions };
  }

  openPanel(): boolean {
    const clipboard = this._getClipboardHistory();
    if (!clipboard) return false;

    return clipboard.openPanel();
  }

  addRandomMessage(): string | null {
    const clipboard = this._getClipboardHistory();
    if (!clipboard) return null;

    const text = this._makeRandomMessage();
    if (!clipboard.addText(text)) return null;
    this._remember(text);
    return text;
  }

  addRandomMessages(count: number): string[] {
    const messages: string[] = [];
    for (let i = 0; i < count; i++) {
      const message = this.addRandomMessage();
      if (message) messages.push(message);
    }
    return messages;
  }

  addSampleLink(): boolean {
    const clipboard = this._getClipboardHistory();
    if (!clipboard) return false;

    const added = clipboard.addText(SAMPLE_LINK);
    if (added) this._remember(SAMPLE_LINK);
    return added;
  }

  addSampleCode(): boolean {
    const clipboard = this._getClipboardHistory();
    if (!clipboard) return false;

    const added = clipboard.addText(SAMPLE_CODE_SNIPPET);
    if (added) this._remember(_('Generated code sample'));
    return added;
  }

  async addSampleImage(): Promise<boolean> {
    const clipboard = this._getClipboardHistory();
    if (!clipboard) return false;

    const data = GLib.base64_decode(SAMPLE_IMAGE_PNG_BASE64);
    const bytes = new GLib.Bytes(data);
    const added = await clipboard.addImage({
      mimeType: 'image/png',
      bytes,
      fingerprint: fingerprintBytes(bytes),
    });
    if (added) this._remember(_('Generated image sample'));
    return added;
  }

  clearHistory(): boolean {
    const clipboard = this._getClipboardHistory();
    if (!clipboard) return false;
    if (!clipboard.clearHistory()) return false;

    this._generatedSamples = [];
    return true;
  }

  get entryCount(): number {
    const clipboard = this._getClipboardHistory();
    if (!clipboard) return 0;

    return clipboard.entryCount;
  }

  get isPanelOpen(): boolean {
    const clipboard = this._getClipboardHistory();
    if (!clipboard) return false;

    return clipboard.isPanelOpen;
  }

  private _getClipboardHistory(): ClipboardHistory | null {
    const module = this._getModule('clipboard-history');
    return module instanceof ClipboardHistory ? module : null;
  }

  private _makeRandomMessage(): string {
    const base = RANDOM_MESSAGES[Math.floor(Math.random() * RANDOM_MESSAGES.length)]!;
    return `${base} #${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }

  private _remember(sample: string): void {
    this._generatedSamples = [sample, ...this._generatedSamples].slice(0, 5);
  }
}
