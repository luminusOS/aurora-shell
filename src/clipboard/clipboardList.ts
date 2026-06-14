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
  declare private _pinnedHeader: St.Label;
  declare private _historyHeader: St.Label;
  declare private _emptyLabel: St.Label;

  override _init(callbacks: ListCallbacks): void {
    super._init({
      orientation: Clutter.Orientation.VERTICAL,
      style_class: 'aurora-clipboard-list',
      x_expand: true,
    });

    this._callbacks = callbacks;
    this._items = [];
    this._selectedIndex = -1;

    this._pinnedHeader = new St.Label({
      text: _('Pinned'),
      style_class: 'aurora-clipboard-section-header',
      visible: false,
    });
    this._historyHeader = new St.Label({
      text: _('History'),
      style_class: 'aurora-clipboard-section-header',
      visible: false,
    });
    this._emptyLabel = new St.Label({
      text: _('No clipboard history yet'),
      style_class: 'aurora-clipboard-empty',
      x_align: Clutter.ActorAlign.CENTER,
      visible: false,
    });

    this.add_child(this._pinnedHeader);
    this.add_child(this._historyHeader);
    this.add_child(this._emptyLabel);
  }

  populate(pinned: ClipboardEntry[], history: ClipboardEntry[]): void {
    for (const item of this._items) item.destroy();
    this._items = [];
    this._selectedIndex = -1;

    const hasPinned = pinned.length > 0;
    const hasHistory = history.length > 0;

    this._pinnedHeader.visible = hasPinned;
    this._historyHeader.visible = hasHistory;
    this._emptyLabel.visible = !hasPinned && !hasHistory;

    this.remove_child(this._historyHeader);
    this.remove_child(this._emptyLabel);

    if (hasPinned) {
      for (const entry of pinned) {
        this._addItem(entry);
      }
    }

    this.add_child(this._historyHeader);
    if (hasHistory) {
      for (const entry of history) {
        this._addItem(entry);
      }
    }
    this.add_child(this._emptyLabel);

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
    const item = new (ClipboardItem as unknown as new (e: ClipboardEntry) => ClipboardItem)(entry);
    item.connect('clicked', () => this._callbacks.onActivate(entry));
    this._items.push(item);
    this.add_child(item);
  }

  private _setSelected(index: number): void {
    if (this._selectedIndex >= 0 && this._selectedIndex < this._items.length) {
      this._items[this._selectedIndex]!.remove_style_pseudo_class('selected');
    }
    this._selectedIndex = index;
    if (index >= 0 && index < this._items.length) {
      this._items[index]!.add_style_pseudo_class('selected');
    }
  }
}
