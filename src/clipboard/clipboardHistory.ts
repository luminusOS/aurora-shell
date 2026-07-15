import '@girs/gjs';
import { gettext as _ } from 'gettext';

import GLib from '@girs/glib-2.0';
import Gio from '@girs/gio-2.0';
import type Clutter from '@girs/clutter-18';
import St from '@girs/st-18';
import Meta from '@girs/meta-18';
import Shell from '@girs/shell-18';
import * as Main from '@girs/gnome-shell/ui/main';

import type { ExtensionContext } from '~/core/context.ts';
import type { CleanupBag } from '~/core/cleanupBag.ts';
import { logger } from '~/core/logger.ts';
import { Module } from '~/module.ts';

import type { ClipboardEntry, ClipboardImagePayload } from '~/clipboard/clipboardStore.ts';
import { ClipboardStore } from '~/clipboard/clipboardStore.ts';
import { ClipboardMonitor } from '~/clipboard/clipboardMonitor.ts';
import { ClipboardPanel } from '~/clipboard/clipboardPanel.ts';

const KEYBINDING_KEY = 'clipboard-history-shortcut';
const AUTO_PASTE_KEY = 'clipboard-history-auto-paste';
const AUTO_PASTE_DELAY_MS = 100;
const LOG_PREFIX = 'ClipboardHistory';

// @ts-ignore - _promisify is a GJS extension not reflected in .d.ts
Gio._promisify(Gio.File.prototype, 'load_contents_async');

export class ClipboardHistory extends Module {
  private _store: ClipboardStore | null = null;
  private _monitor: ClipboardMonitor | null = null;
  private _panel: ClipboardPanel | null = null;
  private _cleanup: CleanupBag | null = null;
  private _startupIdleId: number = 0;
  private _autoPasteTimeoutId: number = 0;
  private _pasteTargetWindow: Meta.Window | null = null;
  private _pasteTargetInputFocus: Clutter.InputFocus | null = null;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this._cleanup = this.context.createCleanupBag();
    const sessionDir = GLib.get_user_runtime_dir() + '/aurora-shell/' + this.context.uuid;
    const filePath = sessionDir + '/clipboard-history.log';
    const mediaDir = sessionDir + '/clipboard-media';
    const rawSettings = this.context.settings.getRawSettings();
    const pollMs = rawSettings.get_int('clipboard-history-poll-interval');

    this._store = new ClipboardStore(filePath, mediaDir);

    this._panel = new (ClipboardPanel as unknown as new (
      store: ClipboardStore,
      callbacks: {
        onActivate: (entry: ClipboardEntry) => void;
        onRemove: (id: string) => void;
        onTogglePin: (id: string) => void;
      },
    ) => ClipboardPanel)(this._store, {
      onActivate: (entry) => this._onActivate(entry),
      onRemove: (id) => this._onRemove(id),
      onTogglePin: (id) => this._onTogglePin(id),
    });

    this._monitor = new ClipboardMonitor(pollMs, {
      onText: (text) => this.addText(text),
      onImage: (payload) => void this.addImage(payload),
    });

    void this._store.load().then(() => this._panel?.refresh());

    this._startupIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this._startupIdleId = 0;
      this._monitor?.start();
      return GLib.SOURCE_REMOVE;
    });
    const startupIdleId = this._startupIdleId;
    this._cleanup.source(startupIdleId, (id) => {
      if (this._startupIdleId !== id) return;
      GLib.source_remove(id);
      this._startupIdleId = 0;
    });

    try {
      Main.wm.addKeybinding(
        KEYBINDING_KEY,
        rawSettings,
        Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
        Shell.ActionMode.ALL,
        () => this.togglePanel(),
      );
      this._cleanup.add(() => {
        try {
          Main.wm.removeKeybinding(KEYBINDING_KEY);
        } catch {
          // The Shell may already have removed it during shutdown.
        }
      });
    } catch (e) {
      logger.error('Failed to register keybinding:', { prefix: LOG_PREFIX }, e as Error);
    }

    this._cleanup.connect(rawSettings, 'changed::clipboard-history-poll-interval', () => {
      this._monitor?.setInterval(rawSettings.get_int('clipboard-history-poll-interval'));
    });
  }

  override disable(): void {
    this._cancelScheduledAutoPaste();
    this._pasteTargetWindow = null;
    this._pasteTargetInputFocus = null;

    this._cleanup?.dispose();
    this._cleanup = null;

    this._panel?.close();
    this._panel?.destroy();
    this._panel = null;

    this._monitor?.stop();
    this._monitor = null;

    this._store?.save();
    this._store = null;
  }

  openPanel(): boolean {
    if (!this._panel) return false;
    if (!this._panel.isOpen) {
      this._pasteTargetWindow = global.display.focus_window;
      this._pasteTargetInputFocus = Main.inputMethod.currentFocus;
    }
    this._panel.open();
    return true;
  }

  closePanel(): boolean {
    if (!this._panel) return false;
    this._panel.close();
    this._pasteTargetWindow = null;
    this._pasteTargetInputFocus = null;
    return true;
  }

  togglePanel(): boolean {
    return this.isPanelOpen ? this.closePanel() : this.openPanel();
  }

  addText(text: string): boolean {
    const added = this._store?.addText(text) ?? false;
    if (added) this._panel?.refresh();
    return added;
  }

  async addImage(payload: ClipboardImagePayload): Promise<boolean> {
    const added = (await this._store?.addImage(payload)) ?? false;
    if (added) this._panel?.refresh();
    return added;
  }

  clearHistory(): boolean {
    const cleared = this._store?.clear() ?? false;
    if (cleared) this._panel?.refresh();
    return cleared;
  }

  get entryCount(): number {
    return (this._store?.getPinned().length ?? 0) + (this._store?.getHistory().length ?? 0);
  }

  get isPanelOpen(): boolean {
    return this._panel?.isOpen ?? false;
  }

  private _onActivate(entry: ClipboardEntry): void {
    if (entry.kind === 'image') {
      void this._restoreImage(entry);
      this.closePanel();
      return;
    }

    const pasteTarget = this.context.settings.getBoolean(AUTO_PASTE_KEY)
      ? this._pasteTargetWindow
      : null;
    const pasteTargetInputFocus = pasteTarget ? this._pasteTargetInputFocus : null;
    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, entry.text);
    this.closePanel();
    if (pasteTarget && pasteTargetInputFocus)
      this._scheduleAutoPaste(pasteTarget, pasteTargetInputFocus, entry.text);
    logger.debug(`Restored clipboard entry: ${entry.text.slice(0, 40)}`, { prefix: LOG_PREFIX });
  }

  private async _restoreImage(entry: ClipboardEntry): Promise<void> {
    if (!entry.filePath || !entry.mimeType) return;

    try {
      const [contents] = await Gio.File.new_for_path(entry.filePath).load_contents_async(null);
      St.Clipboard.get_default().set_content(St.ClipboardType.CLIPBOARD, entry.mimeType, contents);
      logger.debug(`Restored clipboard image: ${entry.mimeType}`, { prefix: LOG_PREFIX });
    } catch (e) {
      logger.warn('Failed to restore clipboard image:', { prefix: LOG_PREFIX }, e as Error);
    }
  }

  private _scheduleAutoPaste(
    targetWindow: Meta.Window,
    targetInputFocus: Clutter.InputFocus,
    text: string,
  ): void {
    if (!this._cleanup) return;

    this._cancelScheduledAutoPaste();
    try {
      targetWindow.activate(global.get_current_time());
    } catch (e) {
      logger.warn(
        'Failed to restore focus before automatic paste:',
        { prefix: LOG_PREFIX },
        e as Error,
      );
      return;
    }

    this._autoPasteTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, AUTO_PASTE_DELAY_MS, () => {
      this._autoPasteTimeoutId = 0;
      if (!this._cleanup) return GLib.SOURCE_REMOVE;
      if (!targetWindow.has_focus()) return GLib.SOURCE_REMOVE;

      // Restore the Wayland input focus stolen by the panel search entry
      Main.inputMethod.focus_in(targetInputFocus);
      if (Main.inputMethod.currentFocus === targetInputFocus) Main.inputMethod.commit(text);
      return GLib.SOURCE_REMOVE;
    });
  }

  private _cancelScheduledAutoPaste(): void {
    if (this._autoPasteTimeoutId === 0) return;
    GLib.source_remove(this._autoPasteTimeoutId);
    this._autoPasteTimeoutId = 0;
  }

  private _onRemove(id: string): void {
    this._store?.remove(id);
    this._panel?.refresh();
  }

  private _onTogglePin(id: string): void {
    if (!this._store) return;
    const pinned = this._store.getPinned();
    if (pinned.find((e) => e.id === id)) {
      this._store.unpin(id);
    } else {
      this._store.pin(id);
    }
    this._panel?.refresh();
  }
}
