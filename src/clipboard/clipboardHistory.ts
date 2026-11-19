import { gettext as _ } from '~/shared/i18n.ts';

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import type Clutter from 'gi://Clutter';
import St from 'gi://St';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import type { ExtensionContext } from '~/core/context.ts';
import { LifecycleScope, type ManagedSource } from '~/core/lifecycleScope.ts';
import { logger } from '~/core/logger.ts';
import { createManagedSource, createManagedTimeout } from '~/core/mainLoop.ts';
import { Module } from '~/module.ts';

import type { ClipboardEntry, ClipboardImagePayload } from '~/clipboard/clipboardStore.ts';
import { ClipboardStore } from '~/clipboard/clipboardStore.ts';
import { ClipboardMonitor } from '~/clipboard/clipboardMonitor.ts';
import { ClipboardPanel } from '~/clipboard/clipboardPanel.ts';
import { fetchPreview } from '~/clipboard/linkPreview.ts';
import { parseClipboardUrl } from '~/clipboard/clipboardCardState.ts';

const KEYBINDING_KEY = 'clipboard-history-shortcut';
const AUTO_PASTE_KEY = 'clipboard-history-auto-paste';
const AUTO_PASTE_DELAY_MS = 100;
const LOG_PREFIX = 'ClipboardHistory';

// @ts-ignore - _promisify is a GJS extension not reflected in .d.ts
Gio._promisify(Gio.File.prototype, 'load_bytes_async');

export class ClipboardHistory extends Module {
  private _store: ClipboardStore | null = null;
  private _previewRequests = new Map<string, Gio.Cancellable>();
  private _monitor: ClipboardMonitor | null = null;
  private _panel: ClipboardPanel | null = null;
  private _lifecycle: LifecycleScope | null = null;
  private _autoPasteTimeout: ManagedSource | null = null;
  private _restoreCancellable: Gio.Cancellable | null = null;
  private _pasteTargetWindow: Meta.Window | null = null;
  private _pasteTargetInputFocus: Clutter.InputFocus | null = null;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    const lifecycle = new LifecycleScope();
    const startupIdle = createManagedSource(lifecycle);
    const autoPasteTimeout = createManagedSource(lifecycle);
    this._lifecycle = lifecycle;
    this._autoPasteTimeout = autoPasteTimeout;
    const rawSettings = this.context.settings.getRawSettings();
    let storageRoot = GLib.get_user_runtime_dir();
    if (rawSettings.get_boolean('clipboard-history-persist'))
      storageRoot = GLib.get_user_data_dir();
    const historyDir = GLib.build_filenamev([storageRoot, 'aurora-shell', this.context.uuid]);
    const filePath = historyDir + '/clipboard-history.log';
    const mediaDir = historyDir + '/clipboard-media';
    lifecycle.connect(rawSettings, 'changed::clipboard-history-persist', () => {
      this.disable();
      this.enable();
    });
    lifecycle.connect(rawSettings, 'changed::clipboard-history-link-previews', () => {
      if (!rawSettings.get_boolean('clipboard-history-link-previews')) this._cancelPreviews();
    });
    lifecycle.onDispose(() => this._cancelPreviews());

    const store = new ClipboardStore(filePath, mediaDir);
    this._store = store;

    const panel = new ClipboardPanel(store, {
      onActivate: (entry: ClipboardEntry) => this._onActivate(entry),
      onRemove: (id: string) => this._onRemove(id),
      onTogglePin: (id: string) => this._onTogglePin(id),
    });
    this._panel = panel;

    const monitor = new ClipboardMonitor({
      onText: (text) => this.addText(text),
      onImage: (payload) => this.addImage(payload),
    });
    this._monitor = monitor;

    void store.load().then(() => {
      if (
        this._lifecycle !== lifecycle ||
        this._store !== store ||
        this._panel !== panel ||
        this._monitor !== monitor
      )
        return;

      panel.refresh();
      startupIdle.replace(() =>
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
          startupIdle.complete();
          monitor.start();
          return GLib.SOURCE_REMOVE;
        }),
      );
    });

    Main.wm.addKeybinding(
      KEYBINDING_KEY,
      rawSettings,
      Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
      Shell.ActionMode.ALL,
      () => this.togglePanel(),
    );
    lifecycle.onDispose(() => Main.wm.removeKeybinding(KEYBINDING_KEY));
  }

  override disable(): void {
    this._pasteTargetWindow = null;
    this._pasteTargetInputFocus = null;

    if (this._restoreCancellable) this._restoreCancellable.cancel();
    this._restoreCancellable = null;

    this._lifecycle?.dispose();
    this._lifecycle = null;
    this._autoPasteTimeout = null;

    this._panel?.close();
    this._panel?.destroy();
    this._panel = null;

    this._monitor?.destroy();
    this._monitor = null;

    this._store?.save();
    this._store?.destroy();
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
    if (!this._store || !this._panel) return false;

    const added = this._store.addText(text);
    if (added) {
      this._panel.refresh();
      void this._preview(text);
    }

    return added;
  }

  private _cancelPreviews(): void {
    for (const cancel of this._previewRequests.values()) cancel.cancel();
  }

  private async _preview(text: string): Promise<void> {
    const store = this._store;
    const entry = store?.entryForText(text);
    if (
      !store ||
      !entry ||
      entry.preview ||
      !this.context.settings.getBoolean('clipboard-history-link-previews') ||
      !parseClipboardUrl(text) ||
      this._previewRequests.has(text) ||
      this._previewRequests.size >= 2
    )
      return;
    const cancel = new Gio.Cancellable();
    this._previewRequests.set(text, cancel);
    const requestScope = new LifecycleScope();
    createManagedTimeout(requestScope).schedule(5000, () => cancel.cancel());
    try {
      const preview = await fetchPreview(text.trim(), cancel);
      if (
        preview &&
        !cancel.is_cancelled() &&
        store === this._store &&
        entry === store.entryForText(text)
      ) {
        entry.preview = preview;
        this._panel?.refresh();
      }
    } catch {
      // The URL remains usable when the site is offline or has no preview.
    } finally {
      requestScope.dispose();
      this._previewRequests.delete(text);
    }
  }

  async addImage(payload: ClipboardImagePayload): Promise<boolean> {
    const store = this._store;
    const panel = this._panel;
    if (!store || !panel) {
      return false;
    }

    const added = await store.addImage(payload);
    if (added && this._panel === panel) {
      panel.refresh();
    }

    return added;
  }

  clearHistory(): boolean {
    if (!this._store || !this._panel) return false;

    const cleared = this._store.clear();
    if (cleared) {
      this._panel.refresh();
    }

    return cleared;
  }

  get entryCount(): number {
    if (!this._store) return 0;

    return this._store.getPinned().length + this._store.getHistory().length;
  }

  get isPanelOpen(): boolean {
    if (!this._panel) return false;

    return this._panel.isOpen;
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
    this._monitor?.suppressNextOwnerChange();
    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, entry.text);
    this.closePanel();
    if (pasteTarget && pasteTargetInputFocus)
      this._scheduleAutoPaste(pasteTarget, pasteTargetInputFocus, entry.text);
    logger.debug(`Restored clipboard entry: ${entry.text.slice(0, 40)}`, { prefix: LOG_PREFIX });
  }

  private async _restoreImage(entry: ClipboardEntry): Promise<void> {
    if (!this._lifecycle || !entry.filePath || !entry.mimeType) return;

    if (this._restoreCancellable) this._restoreCancellable.cancel();
    const restoreCancellable = new Gio.Cancellable();
    this._restoreCancellable = restoreCancellable;

    try {
      const [bytes] = await Gio.File.new_for_path(entry.filePath).load_bytes_async(
        restoreCancellable,
      );
      if (this._restoreCancellable !== restoreCancellable || restoreCancellable.is_cancelled())
        return;

      if (!this._monitor) return;
      this._monitor.suppressNextOwnerChange();
      St.Clipboard.get_default().set_content(St.ClipboardType.CLIPBOARD, entry.mimeType, bytes);
      logger.debug(`Restored clipboard image: ${entry.mimeType}`, { prefix: LOG_PREFIX });
    } catch (e) {
      if (restoreCancellable.is_cancelled()) return;

      logger.warn('Failed to restore clipboard image:', { prefix: LOG_PREFIX }, e as Error);
    } finally {
      if (this._restoreCancellable === restoreCancellable) this._restoreCancellable = null;
    }
  }

  private _scheduleAutoPaste(
    targetWindow: Meta.Window,
    targetInputFocus: Clutter.InputFocus,
    text: string,
  ): void {
    const autoPasteTimeout = this._autoPasteTimeout;
    if (!this._lifecycle || !autoPasteTimeout) return;

    autoPasteTimeout.clear();
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

    autoPasteTimeout.replace(() =>
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, AUTO_PASTE_DELAY_MS, () => {
        autoPasteTimeout.complete();
        if (!this._lifecycle) return GLib.SOURCE_REMOVE;
        if (!targetWindow.has_focus()) return GLib.SOURCE_REMOVE;

        // Restore the Wayland input focus stolen by the panel search entry
        Main.inputMethod.focus_in(targetInputFocus);
        if (Main.inputMethod.currentFocus === targetInputFocus) Main.inputMethod.commit(text);
        return GLib.SOURCE_REMOVE;
      }),
    );
  }

  private _onRemove(id: string): void {
    if (!this._store || !this._panel) return;

    this._store.remove(id);
    this._panel.refresh();
  }

  private _onTogglePin(id: string): void {
    if (!this._store || !this._panel) return;

    const pinned = this._store.getPinned();
    if (pinned.find((e) => e.id === id)) {
      this._store.unpin(id);
    } else {
      this._store.pin(id);
    }
    this._panel.refresh();
  }
}
