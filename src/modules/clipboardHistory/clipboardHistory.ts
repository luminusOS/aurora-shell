import '@girs/gjs';
import { gettext as _ } from 'gettext';

import GLib from '@girs/glib-2.0';
import St from '@girs/st-18';
import Meta from '@girs/meta-18';
import Shell from '@girs/shell-18';
import * as Main from '@girs/gnome-shell/ui/main';

import type { ExtensionContext } from '~/core/context.ts';
import { logger } from '~/core/logger.ts';
import { Module } from '~/module.ts';
import type { ModuleDefinition } from '~/module.ts';

import type { ClipboardEntry } from '~/modules/clipboardHistory/clipboardStore.ts';
import { ClipboardStore } from '~/modules/clipboardHistory/clipboardStore.ts';
import { ClipboardMonitor } from '~/modules/clipboardHistory/clipboardMonitor.ts';
import { ClipboardPanel } from '~/modules/clipboardHistory/clipboardPanel.ts';

const KEYBINDING_KEY = 'clipboard-history-shortcut';
const LOG_PREFIX = 'ClipboardHistory';

export class ClipboardHistory extends Module {
  private _store: ClipboardStore | null = null;
  private _monitor: ClipboardMonitor | null = null;
  private _panel: ClipboardPanel | null = null;
  private _settingsIds: number[] = [];
  private _startupIdleId: number = 0;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    const configDir = GLib.get_user_config_dir() + '/aurora-shell';
    const filePath = configDir + '/clipboard-history.json';
    const rawSettings = this.context.settings.getRawSettings();
    const maxItems = rawSettings.get_int('clipboard-history-max-items');
    const pollMs = rawSettings.get_int('clipboard-history-poll-interval');

    this._store = new ClipboardStore(filePath, maxItems);
    this._store.load();

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

    this._monitor = new ClipboardMonitor(pollMs, (text) => {
      this._store?.addText(text);
    });

    this._startupIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this._startupIdleId = 0;
      this._monitor?.start();
      return GLib.SOURCE_REMOVE;
    });

    try {
      Main.wm.addKeybinding(
        KEYBINDING_KEY,
        rawSettings,
        Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
        Shell.ActionMode.ALL,
        () => this._togglePanel(),
      );
    } catch (e) {
      logger.error('Failed to register keybinding:', { prefix: LOG_PREFIX }, e as Error);
    }

    this._settingsIds = [
      rawSettings.connect('changed::clipboard-history-max-items', () => {
        this._store?.setMaxItems(rawSettings.get_int('clipboard-history-max-items'));
      }),
      rawSettings.connect('changed::clipboard-history-poll-interval', () => {
        this._monitor?.setInterval(rawSettings.get_int('clipboard-history-poll-interval'));
      }),
    ];
  }

  override disable(): void {
    if (this._startupIdleId !== 0) {
      GLib.source_remove(this._startupIdleId);
      this._startupIdleId = 0;
    }

    try {
      Main.wm.removeKeybinding(KEYBINDING_KEY);
    } catch (_e) {
      // ignore if not registered
    }

    this._panel?.close();
    this._panel?.destroy();
    this._panel = null;

    this._monitor?.stop();
    this._monitor = null;

    this._store?.save();
    this._store = null;

    const rawSettings = this.context.settings.getRawSettings();
    for (const id of this._settingsIds) {
      rawSettings.disconnect(id);
    }
    this._settingsIds = [];
  }

  private _togglePanel(): void {
    if (this._panel?.isOpen) {
      this._panel.close();
    } else {
      this._panel?.open();
    }
  }

  private _onActivate(entry: ClipboardEntry): void {
    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, entry.text);
    this._panel?.close();
    logger.debug(`Restored clipboard entry: ${entry.text.slice(0, 40)}`, { prefix: LOG_PREFIX });
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

export const definition: ModuleDefinition = {
  key: 'clipboard-history',
  settingsKey: 'module-clipboard-history',
  title: _('Clipboard History'),
  subtitle: _('Searchable clipboard history with pinning and keyboard navigation'),
  options: [
    {
      key: 'clipboard-history-max-items',
      title: _('Max History Items'),
      subtitle: _('Number of non-pinned entries to retain'),
      type: 'spin',
      min: 10,
      max: 200,
    },
    {
      key: 'clipboard-history-poll-interval',
      title: _('Poll Interval (ms)'),
      subtitle: _('How often to check the clipboard for changes'),
      type: 'spin',
      min: 250,
      max: 5000,
    },
  ],
  factory: (ctx) => new ClipboardHistory(ctx),
};
