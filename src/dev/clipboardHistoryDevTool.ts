import '@girs/gjs';

import GLib from '@girs/glib-2.0';
import type St from '@girs/st-18';

import { ClipboardHistory } from '~/clipboard/clipboardHistory.ts';
import { fingerprintBytes } from '~/clipboard/clipboardMonitor.ts';
import {
  createDevToolActionButton,
  createDevToolActionRow,
  createDevToolModulePanel,
  createDevToolSummary,
} from '~/dev/devToolUi.ts';
import type { Module } from '~/module.ts';

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
  readonly iconName = 'edit-paste-symbolic';

  constructor(
    private readonly _getModule: (key: string) => Module | null,
    private readonly _requestMenuRebuild: () => void,
  ) {}

  buildPanel(): St.Widget {
    const clipboard = this._getClipboardHistory();
    const panel = createDevToolModulePanel();
    panel.add_child(
      createDevToolSummary(
        this.iconName,
        clipboard ? `${clipboard.entryCount} history entries` : 'Clipboard History disabled',
      ),
    );

    const primaryRow = createDevToolActionRow();
    primaryRow.add_child(
      createDevToolActionButton(
        'document-open-symbolic',
        'Open Panel',
        () => this.openPanel(),
        !clipboard,
      ),
    );
    primaryRow.add_child(
      createDevToolActionButton(
        'list-add-symbolic',
        'Add Message',
        () => this.addRandomMessage(),
        !clipboard,
      ),
    );
    panel.add_child(primaryRow);

    const secondaryRow = createDevToolActionRow();
    secondaryRow.add_child(
      createDevToolActionButton(
        'format-justify-fill-symbolic',
        'Add 5 Messages',
        () => this.addRandomMessages(5),
        !clipboard,
      ),
    );
    secondaryRow.add_child(
      createDevToolActionButton(
        'user-trash-symbolic',
        'Clear History',
        () => this.clearHistory(),
        !clipboard || clipboard.entryCount === 0,
      ),
    );
    panel.add_child(secondaryRow);

    const sampleRow = createDevToolActionRow();
    sampleRow.add_child(
      createDevToolActionButton(
        'image-x-generic-symbolic',
        'Add Image',
        () => void this.addSampleImage(),
        !clipboard,
      ),
    );
    sampleRow.add_child(
      createDevToolActionButton(
        'insert-link-symbolic',
        'Add Link',
        () => this.addSampleLink(),
        !clipboard,
      ),
    );
    sampleRow.add_child(
      createDevToolActionButton(
        'accessories-text-editor-symbolic',
        'Add Code',
        () => this.addSampleCode(),
        !clipboard,
      ),
    );
    panel.add_child(sampleRow);

    return panel;
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
    this._requestMenuRebuild();
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
    if (added) this._requestMenuRebuild();
    return added;
  }

  addSampleCode(): boolean {
    const clipboard = this._getClipboardHistory();
    if (!clipboard) return false;

    const added = clipboard.addText(SAMPLE_CODE_SNIPPET);
    if (added) this._requestMenuRebuild();
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
    if (added) this._requestMenuRebuild();
    return added;
  }

  clearHistory(): boolean {
    const clipboard = this._getClipboardHistory();
    if (!clipboard) return false;
    if (!clipboard.clearHistory()) return false;

    this._requestMenuRebuild();
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
}
