import '@girs/gjs';

import GLib from '@girs/glib-2.0';
import St from '@girs/st-18';

import { ClipboardHistory } from '~/clipboard/clipboardHistory.ts';
import { fingerprintBytes } from '~/clipboard/clipboardMonitor.ts';
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
    const panel = new St.BoxLayout({
      vertical: true,
      style_class: 'aurora-devtool-module-panel',
    });

    const summary = new St.BoxLayout({
      style_class: 'aurora-devtool-summary',
    });
    summary.add_child(
      new St.Icon({
        icon_name: this.iconName,
        icon_size: 18,
        style_class: 'aurora-devtool-summary-icon',
      }),
    );
    summary.add_child(
      new St.Label({
        text: clipboard ? `${clipboard.entryCount} history entries` : 'Clipboard History disabled',
        style_class: 'aurora-devtool-summary-label',
        x_expand: true,
      }),
    );
    panel.add_child(summary);

    const primaryRow = new St.BoxLayout({
      style_class: 'aurora-devtool-action-row',
    });
    primaryRow.add_child(
      this._createActionButton(
        'document-open-symbolic',
        'Open Panel',
        () => this.openPanel(),
        !clipboard,
      ),
    );
    primaryRow.add_child(
      this._createActionButton(
        'list-add-symbolic',
        'Add Message',
        () => this.addRandomMessage(),
        !clipboard,
      ),
    );
    panel.add_child(primaryRow);

    const secondaryRow = new St.BoxLayout({
      style_class: 'aurora-devtool-action-row',
    });
    secondaryRow.add_child(
      this._createActionButton(
        'format-justify-fill-symbolic',
        'Add 5 Messages',
        () => this.addRandomMessages(5),
        !clipboard,
      ),
    );
    secondaryRow.add_child(
      this._createActionButton(
        'user-trash-symbolic',
        'Clear History',
        () => this.clearHistory(),
        !clipboard || clipboard.entryCount === 0,
      ),
    );
    panel.add_child(secondaryRow);

    const sampleRow = new St.BoxLayout({
      style_class: 'aurora-devtool-action-row',
    });
    sampleRow.add_child(
      this._createActionButton(
        'image-x-generic-symbolic',
        'Add Image',
        () => void this.addSampleImage(),
        !clipboard,
      ),
    );
    sampleRow.add_child(
      this._createActionButton(
        'insert-link-symbolic',
        'Add Link',
        () => this.addSampleLink(),
        !clipboard,
      ),
    );
    sampleRow.add_child(
      this._createActionButton(
        'accessories-text-editor-symbolic',
        'Add Code',
        () => this.addSampleCode(),
        !clipboard,
      ),
    );
    panel.add_child(sampleRow);

    return panel;
  }

  destroy(): void {}

  openPanel(): boolean {
    return this._getClipboardHistory()?.openPanel() ?? false;
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
    if (!clipboard?.clearHistory()) return false;

    this._requestMenuRebuild();
    return true;
  }

  get entryCount(): number {
    return this._getClipboardHistory()?.entryCount ?? 0;
  }

  get isPanelOpen(): boolean {
    return this._getClipboardHistory()?.isPanelOpen ?? false;
  }

  private _getClipboardHistory(): ClipboardHistory | null {
    const module = this._getModule('clipboard-history');
    return module instanceof ClipboardHistory ? module : null;
  }

  private _makeRandomMessage(): string {
    const base = RANDOM_MESSAGES[Math.floor(Math.random() * RANDOM_MESSAGES.length)]!;
    return `${base} #${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }

  private _createActionButton(
    iconName: string,
    label: string,
    onClick: () => void,
    disabled = false,
  ): St.Button {
    const content = new St.BoxLayout({
      style_class: 'aurora-devtool-action-content',
    });
    content.add_child(
      new St.Icon({
        icon_name: iconName,
        icon_size: 16,
      }),
    );
    content.add_child(new St.Label({ text: label }));

    const button = new St.Button({
      child: content,
      style_class: 'button aurora-devtool-action-button',
      can_focus: !disabled,
      reactive: !disabled,
      x_expand: true,
      accessible_name: label,
    });
    if (disabled) button.opacity = 120;
    button.connect('clicked', onClick);
    return button;
  }
}
