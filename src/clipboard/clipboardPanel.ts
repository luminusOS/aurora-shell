import '@girs/gjs';
import { gettext as _ } from 'gettext';

import St from '@girs/st-18';
import GObject from '@girs/gobject-2.0';
import Clutter from '@girs/clutter-18';
import * as Main from '@girs/gnome-shell/ui/main';

import type { ClipboardEntry, ClipboardStore } from '~/clipboard/clipboardStore.ts';
import { ClipboardList } from '~/clipboard/clipboardList.ts';
import { placeClipboardPanelNearPointer } from '~/clipboard/clipboardPosition.ts';

const PANEL_WIDTH = 360;
const PANEL_HEIGHT = 480;
const PANEL_EDGE_MARGIN = 12;
const PANEL_POINTER_OFFSET = 12;

type PanelCallbacks = {
  onActivate: (entry: ClipboardEntry) => void;
  onRemove: (id: string) => void;
  onTogglePin: (id: string) => void;
};

@GObject.registerClass
export class ClipboardPanel extends St.BoxLayout {
  declare private _store: ClipboardStore;
  declare private _callbacks: PanelCallbacks;
  declare private _list: ClipboardList;
  declare private _searchEntry: St.Entry;
  declare private _scroll: St.ScrollView;

  private _isOpen: boolean = false;
  private _overlay: St.Bin | null = null;

  // Signal IDs
  private _capturedEventId: number = 0;
  private _searchChangedId: number = 0;
  private _monitorsChangedId: number = 0;
  private _sessionModeId: number = 0;

  override _init(store: ClipboardStore, callbacks: PanelCallbacks): void {
    super._init({
      style_class: 'aurora-clipboard-panel',
      orientation: Clutter.Orientation.VERTICAL,
      reactive: true,
      visible: false,
    });

    this._store = store;
    this._callbacks = callbacks;

    this._searchEntry = new St.Entry({
      style_class: 'aurora-clipboard-search',
      hint_text: _('Search…'),
      can_focus: true,
      x_expand: true,
    });
    this._searchEntry.set_primary_icon(
      new St.Icon({
        icon_name: 'edit-find-symbolic',
        icon_size: 16,
        style_class: 'aurora-clipboard-search-icon',
      }),
    );

    this._list = new (ClipboardList as unknown as new (cbs: {
      onActivate: (e: ClipboardEntry) => void;
      onRemove: (id: string) => void;
      onTogglePin: (id: string) => void;
    }) => ClipboardList)({
      onActivate: (entry) => this._callbacks.onActivate(entry),
      onRemove: (id) => this._callbacks.onRemove(id),
      onTogglePin: (id) => this._callbacks.onTogglePin(id),
    });

    this._scroll = new St.ScrollView({ x_expand: true, y_expand: true });
    this._scroll.set_child(this._list);

    this.add_child(this._searchEntry);
    this.add_child(this._scroll);
  }

  get isOpen(): boolean {
    return this._isOpen;
  }

  open(): void {
    if (this._isOpen) return;

    // Semi-transparent click-away overlay — no modal grab needed
    this._overlay = new St.Bin({ reactive: true });
    this._overlay.set_position(0, 0);
    this._overlay.set_size(global.stage.width, global.stage.height);
    this._overlay.connect('button-press-event', () => {
      this.close();
      return Clutter.EVENT_STOP;
    });

    Main.uiGroup.add_child(this._overlay);
    Main.uiGroup.add_child(this); // panel sits above overlay

    this._positionNearPointer();

    this.show();
    this._isOpen = true;

    // captured-event fires in the CAPTURE phase — before ClutterText (St.Entry
    // internals) has a chance to consume Escape, Up, Down, Enter, etc.
    this._capturedEventId = global.stage.connect(
      'captured-event',
      (_actor: Clutter.Actor, event: Clutter.Event) => this._onCapturedEvent(event),
    );

    this._searchChangedId = this._searchEntry.clutter_text.connect('text-changed', () =>
      this._syncList(this._searchEntry.get_text()),
    );

    this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => this.close());
    this._sessionModeId = Main.sessionMode.connect('updated', () => this.close());

    this._searchEntry.set_text('');
    this._syncList('');
    this._searchEntry.clutter_text.grab_key_focus();
  }

  close(): void {
    if (!this._isOpen) return;

    if (this._capturedEventId !== 0) {
      global.stage.disconnect(this._capturedEventId);
      this._capturedEventId = 0;
    }
    if (this._searchChangedId !== 0) {
      this._searchEntry.clutter_text.disconnect(this._searchChangedId);
      this._searchChangedId = 0;
    }
    if (this._monitorsChangedId !== 0) {
      Main.layoutManager.disconnect(this._monitorsChangedId);
      this._monitorsChangedId = 0;
    }
    if (this._sessionModeId !== 0) {
      Main.sessionMode.disconnect(this._sessionModeId);
      this._sessionModeId = 0;
    }

    if (this._overlay) {
      Main.uiGroup.remove_child(this._overlay);
      this._overlay.destroy();
      this._overlay = null;
    }

    Main.uiGroup.remove_child(this);
    this.hide();
    this._isOpen = false;
  }

  override destroy(): void {
    this.close();
    super.destroy();
  }

  refresh(): void {
    if (this._isOpen) this._syncList(this._searchEntry.get_text());
  }

  private _onCapturedEvent(event: Clutter.Event): boolean {
    if (event.type() !== Clutter.EventType.KEY_PRESS) return Clutter.EVENT_PROPAGATE;

    const sym = event.get_key_symbol();
    const mods = event.get_state();
    const ctrl = Boolean(mods & Clutter.ModifierType.CONTROL_MASK);
    const searchFocused = this._isSearchFocused();

    if (sym === Clutter.KEY_Escape) {
      this.close();
      return Clutter.EVENT_STOP;
    }
    if (sym === Clutter.KEY_Return || sym === Clutter.KEY_KP_Enter) {
      this._list.activateSelected();
      return Clutter.EVENT_STOP;
    }
    if (sym === Clutter.KEY_Up) {
      this._list.moveFocus(-1);
      this._scrollToSelected();
      return Clutter.EVENT_STOP;
    }
    if (sym === Clutter.KEY_Down) {
      this._list.moveFocus(1);
      this._scrollToSelected();
      return Clutter.EVENT_STOP;
    }
    if (sym === Clutter.KEY_Delete && !searchFocused) {
      this._list.removeSelected();
      return Clutter.EVENT_STOP;
    }
    if ((sym === Clutter.KEY_p || sym === Clutter.KEY_P) && !ctrl && !searchFocused) {
      this._list.togglePinSelected();
      return Clutter.EVENT_STOP;
    }
    if (ctrl && (sym === Clutter.KEY_f || sym === Clutter.KEY_F)) {
      this._searchEntry.clutter_text.grab_key_focus();
      return Clutter.EVENT_STOP;
    }

    return Clutter.EVENT_PROPAGATE;
  }

  private _syncList(query: string): void {
    this._list.populate(this._store.filterPinned(query), this._store.filterHistory(query));
  }

  private _isSearchFocused(): boolean {
    return global.stage.get_key_focus() === this._searchEntry.clutter_text;
  }

  private _scrollToSelected(): void {
    const item = this._list.selectedItem;
    if (!item) return;
    const adjustment = (this._scroll as unknown as { vadjustment: St.Adjustment }).vadjustment;
    if (!adjustment) return;
    const alloc = item.get_allocation_box();
    const itemTop = alloc.y1;
    const itemBottom = alloc.y2;
    const current = adjustment.value;
    const pageSize = adjustment.page_size;
    if (itemTop < current) {
      adjustment.value = itemTop;
    } else if (itemBottom > current + pageSize) {
      adjustment.value = itemBottom - pageSize;
    }
  }

  private _positionNearPointer(): void {
    const [pointerX, pointerY] = global.get_pointer();
    const monitorIndex = this._findMonitorIndexAt(pointerX, pointerY);
    const workArea = Main.layoutManager.getWorkAreaForMonitor(monitorIndex);
    const bounds = placeClipboardPanelNearPointer(
      pointerX,
      pointerY,
      workArea,
      PANEL_WIDTH,
      PANEL_HEIGHT,
      PANEL_EDGE_MARGIN,
      PANEL_POINTER_OFFSET,
    );

    this.set_size(bounds.width, bounds.height);
    this.set_position(bounds.x, bounds.y);
  }

  private _findMonitorIndexAt(x: number, y: number): number {
    const monitors = Main.layoutManager.monitors;
    for (let i = 0; i < monitors.length; i++) {
      const monitor = monitors[i]!;
      if (
        x >= monitor.x &&
        x < monitor.x + monitor.width &&
        y >= monitor.y &&
        y < monitor.y + monitor.height
      ) {
        return i;
      }
    }

    return Main.layoutManager.primaryIndex;
  }
}
