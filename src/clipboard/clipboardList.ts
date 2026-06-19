import '@girs/gjs';
import { gettext as _ } from 'gettext';

import St from '@girs/st-18';
import GObject from '@girs/gobject-2.0';
import Clutter from '@girs/clutter-18';

import type { ClipboardEntry } from '~/clipboard/clipboardStore.ts';
import { ClipboardItem } from '~/clipboard/clipboardItem.ts';

type ListCallbacks = {
  onActivate: (entry: ClipboardEntry) => void;
  onRemove: (id: string) => void;
  onTogglePin: (id: string) => void;
};

@GObject.registerClass
export class ClipboardList extends St.BoxLayout {
  declare private _callbacks: ListCallbacks;
  declare private _items: ClipboardItem[];
  declare private _selectedIndex: number;
  declare private _emptyState: St.Bin;

  override _init(callbacks: ListCallbacks): void {
    super._init({
      orientation: Clutter.Orientation.VERTICAL,
      style_class: 'aurora-clipboard-list',
      x_expand: true,
      y_expand: true,
    });

    this._callbacks = callbacks;
    this._items = [];
    this._selectedIndex = -1;

    const emptyContent = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      style_class: 'aurora-clipboard-empty',
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });
    emptyContent.add_child(
      new St.Icon({
        icon_name: 'edit-paste-symbolic',
        icon_size: 32,
        style_class: 'aurora-clipboard-empty-icon',
        x_align: Clutter.ActorAlign.CENTER,
      }),
    );
    emptyContent.add_child(
      new St.Label({
        text: _('Clipboard history is empty'),
        style_class: 'aurora-clipboard-empty-title',
        x_align: Clutter.ActorAlign.CENTER,
      }),
    );
    const hint = new St.Label({
      text: _('Copy text, links, code, or images to see them here.'),
      style_class: 'aurora-clipboard-empty-hint',
      x_align: Clutter.ActorAlign.CENTER,
    });
    hint.clutter_text.set_line_wrap(true);
    emptyContent.add_child(hint);

    this._emptyState = new St.Bin({
      child: emptyContent,
      x_expand: true,
      y_expand: true,
      x_align: Clutter.ActorAlign.FILL,
      y_align: Clutter.ActorAlign.FILL,
      visible: false,
    });

    this.add_child(this._emptyState);
  }

  populate(pinned: ClipboardEntry[], history: ClipboardEntry[]): void {
    for (const item of this._items) item.destroy();
    this._items = [];
    this._selectedIndex = -1;

    const hasPinned = pinned.length > 0;
    const hasHistory = history.length > 0;

    this._emptyState.visible = !hasPinned && !hasHistory;

    this.remove_child(this._emptyState);

    if (hasPinned) {
      for (const entry of pinned) {
        this._addItem(entry);
      }
    }

    if (hasHistory) {
      for (const entry of history) {
        this._addItem(entry);
      }
    }
    this.add_child(this._emptyState);

    if (this._items.length > 0) {
      this._setSelected(0);
    }
  }

  moveFocus(delta: number): void {
    if (this._items.length === 0) return;
    const next = Math.max(0, Math.min(this._items.length - 1, this._selectedIndex + delta));
    this._setSelected(next);
  }

  activateSelected(): void {
    const item = this._items[this._selectedIndex] ?? null;
    if (item) this._callbacks.onActivate(item.entry);
  }

  removeSelected(): void {
    const item = this._items[this._selectedIndex] ?? null;
    if (item) this._callbacks.onRemove(item.entry.id);
  }

  togglePinSelected(): void {
    const item = this._items[this._selectedIndex] ?? null;
    if (item) this._callbacks.onTogglePin(item.entry.id);
  }

  get selectedItem(): ClipboardItem | null {
    return this._items[this._selectedIndex] ?? null;
  }

  getSelectedEntry(): ClipboardEntry | null {
    return this._items[this._selectedIndex]?.entry ?? null;
  }

  private _addItem(entry: ClipboardEntry): void {
    const item = new (ClipboardItem as unknown as new (
      e: ClipboardEntry,
      cbs: ListCallbacks,
    ) => ClipboardItem)(entry, this._callbacks);
    item.connect('clicked', () => this._callbacks.onActivate(entry));
    this._items.push(item);
    this.add_child(item);
  }

  private _setSelected(index: number): void {
    if (this._selectedIndex >= 0 && this._selectedIndex < this._items.length) {
      this._items[this._selectedIndex]!.remove_style_pseudo_class('selected');
      this._items[this._selectedIndex]!.setActionsVisible(false);
    }
    this._selectedIndex = index;
    if (index >= 0 && index < this._items.length) {
      this._items[index]!.add_style_pseudo_class('selected');
      this._items[index]!.setActionsVisible(true);
    }
  }
}
