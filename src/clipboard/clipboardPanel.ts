import { gettext as _ } from '~/shared/i18n.ts';

import St from 'gi://St';
import Atk from 'gi://Atk';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Dialog from 'resource:///org/gnome/shell/ui/dialog.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

import type { ClipboardEntry, ClipboardStore } from '~/clipboard/clipboardStore.ts';
import { ClipboardList } from '~/clipboard/clipboardList.ts';
import { CaptureTooltip } from '~/capture/captureTooltip.ts';
import { LifecycleScope, type ManagedSource } from '~/core/lifecycleScope.ts';
import { createManagedSource } from '~/core/mainLoop.ts';
import { UnredirectInhibitor } from '~/core/unredirectInhibitor.ts';
import { createIcon } from '~/shared/icons.ts';
import {
  placeClipboardPanelNearPointer,
  resolveClipboardPanelMonitor,
} from '~/clipboard/clipboardPosition.ts';

const PANEL_WIDTH = 360;
const PANEL_HEIGHT = 480;
const PANEL_EDGE_MARGIN = 12;
const PANEL_POINTER_OFFSET = 12;

type PanelCallbacks = {
  onActivate: (entry: ClipboardEntry) => void;
  onRemove: (id: string) => void;
  onTogglePin: (id: string) => void;
  onToggleIncognito: (active: boolean) => void;
  onClear: () => void;
};

export const ClipboardPanel = GObject.registerClass(
  class ClipboardPanel extends St.BoxLayout {
    declare private _store: ClipboardStore;
    declare private _callbacks: PanelCallbacks;
    declare private _list: ClipboardList;
    declare private _searchEntry: St.Entry;
    declare private _scroll: St.ScrollView;
    declare private _incognitoButton: St.Button;
    declare private _incognitoTooltip: InstanceType<typeof CaptureTooltip>;
    declare private _clearButton: St.Button;
    declare private _clearTooltip: InstanceType<typeof CaptureTooltip>;
    private _clearDialog: ModalDialog.ModalDialog | null = null;

    private _isOpen: boolean = false;
    private _overlay: St.Bin | null = null;
    declare private _unredirectInhibitor: UnredirectInhibitor;

    declare private _lifecycle: LifecycleScope;
    declare private _menuActionSource: ManagedSource;
    declare private _pendingMenuActions: (() => void)[];
    private _openLifecycle: LifecycleScope | null = null;

    override _init(store: ClipboardStore, callbacks: PanelCallbacks): void {
      super._init({
        style_class: 'popup-menu-content aurora-clipboard-panel',
        orientation: Clutter.Orientation.VERTICAL,
        reactive: true,
        visible: false,
      });

      this._store = store;
      this._callbacks = callbacks;
      this._lifecycle = new LifecycleScope();
      this._menuActionSource = createManagedSource(this._lifecycle);
      this._pendingMenuActions = [];
      this._unredirectInhibitor = new UnredirectInhibitor(global.compositor);
      this._lifecycle.connect(this, 'notify::mapped', () =>
        this._unredirectInhibitor.setInhibited(this.mapped),
      );

      const searchRow = new St.BoxLayout({ style_class: 'aurora-clipboard-search-row' });
      this._searchEntry = new St.Entry({
        style_class: 'aurora-clipboard-search',
        hint_text: _('Search Clipboard History…'),
        accessible_name: _('Search Clipboard History…'),
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
      this._incognitoButton = new St.Button({
        style_class: 'icon-button flat',
        accessible_name: _('Pause Clipboard History'),
        accessible_role: Atk.Role.TOGGLE_BUTTON,
        can_focus: true,
        reactive: true,
        toggle_mode: true,
        child: createIcon('aurora-incognito-symbolic'),
      });
      this._incognitoTooltip = new CaptureTooltip();
      this._incognitoTooltip.configure(this._incognitoButton, _('Pause Clipboard History'));
      Main.uiGroup.add_child(this._incognitoTooltip);
      this._lifecycle.connect(this._incognitoButton, 'notify::checked', () => {
        const active = this._incognitoButton.checked;
        const label = active ? _('Resume Clipboard History') : _('Pause Clipboard History');
        this._incognitoButton.accessible_name = label;
        this._incognitoTooltip.text = label;
        this._callbacks.onToggleIncognito(active);
      });
      searchRow.add_child(this._searchEntry);
      searchRow.add_child(this._incognitoButton);
      this._clearButton = new St.Button({
        style_class: 'icon-button flat',
        accessible_name: _('Clear Clipboard History'),
        can_focus: true,
        reactive: false,
        child: new St.Icon({ icon_name: 'user-trash-symbolic' }),
      });
      this._clearTooltip = new CaptureTooltip();
      this._clearTooltip.configure(this._clearButton, _('Clear Clipboard History'));
      Main.uiGroup.add_child(this._clearTooltip);
      this._lifecycle.connect(this._clearButton, 'clicked', () => this._confirmClear());
      searchRow.add_child(this._clearButton);

      this._list = new ClipboardList({
        onActivate: (entry: ClipboardEntry) => this._callbacks.onActivate(entry),
        onRemove: (id: string) => this._callbacks.onRemove(id),
        onTogglePin: (id: string) => this._callbacks.onTogglePin(id),
        scheduleMenuAction: (action: () => void) => this._scheduleMenuAction(action),
      });

      this._scroll = new St.ScrollView({ x_expand: true, y_expand: true });
      this._scroll.set_child(this._list);

      this.add_child(searchRow);
      this.add_child(this._scroll);
    }

    get isOpen(): boolean {
      return this._isOpen;
    }

    get isConfirmingClear(): boolean {
      return this._clearDialog !== null;
    }

    private _scheduleMenuAction(action: () => void): void {
      this._pendingMenuActions.push(action);
      if (this._menuActionSource.active) return;

      this._menuActionSource.replace(() =>
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
          this._menuActionSource.complete();
          while (this._pendingMenuActions.length > 0) {
            const pendingAction = this._pendingMenuActions.shift();
            if (pendingAction) pendingAction();
          }
          return GLib.SOURCE_REMOVE;
        }),
      );
    }

    setIncognito(active: boolean): void {
      this._incognitoButton.checked = active;
    }

    setClearAvailable(available: boolean): void {
      this._clearButton.reactive = available;
      this._clearButton.can_focus = available;
    }

    open(anchor?: Clutter.Actor): void {
      if (this._isOpen || this._clearDialog) return;
      this._openLifecycle = new LifecycleScope();

      // Semi-transparent click-away overlay — no modal grab needed
      this._overlay = new St.Bin({ reactive: true });
      this._overlay.set_position(0, 0);
      this._overlay.set_size(global.stage.width, global.stage.height);
      const clickGesture = new Clutter.ClickGesture({ recognize_on_press: true });
      clickGesture.connect('recognize', () => this.close());
      this._overlay.add_action(clickGesture);

      Main.layoutManager.addTopChrome(this._overlay, { trackFullscreen: false });
      Main.layoutManager.addTopChrome(this, { trackFullscreen: false }); // panel sits above overlay

      if (anchor) this._positionAtIndicator(anchor);
      else this._positionNearPointer();

      this.show();
      this._isOpen = true;

      // The capture phase runs before ClutterText can consume navigation keys.
      const keyController = new Clutter.KeyController();
      keyController.connect('key-press', () => this._onKeyPress(keyController));
      global.stage.add_action_full(
        'aurora-clipboard-panel-keys',
        Clutter.EventPhase.CAPTURE,
        keyController,
      );
      this._openLifecycle.onDispose(() => global.stage.remove_action(keyController));

      this._openLifecycle.connect(this._searchEntry.clutter_text, 'text-changed', () =>
        this._syncList(this._searchEntry.get_text()),
      );

      this._openLifecycle.connect(Main.layoutManager, 'monitors-changed', () => this.close());
      this._openLifecycle.connect(Main.sessionMode, 'updated', () => this.close());

      this._searchEntry.set_text('');
      this._syncList('');
      this._searchEntry.clutter_text.grab_key_focus();
    }

    close(): void {
      if (!this._isOpen) return;

      this._openLifecycle?.dispose();
      this._openLifecycle = null;
      this._incognitoTooltip.close();
      this._clearTooltip.close();

      if (this._overlay) {
        Main.layoutManager.removeChrome(this._overlay);
        this._overlay.destroy();
        this._overlay = null;
      }

      Main.layoutManager.removeChrome(this);
      this.hide();
      this._isOpen = false;
    }

    override destroy(): void {
      this._pendingMenuActions.length = 0;
      this._lifecycle.dispose();
      this.close();
      this._list.destroy();
      this._incognitoTooltip.destroy();
      this._clearTooltip.destroy();
      if (this._clearDialog) {
        this._clearDialog.close();
        this._clearDialog.destroy();
        this._clearDialog = null;
      }
      this._unredirectInhibitor.release();
      super.destroy();
    }

    refresh(): void {
      if (this._isOpen) this._syncList(this._searchEntry.get_text());
    }

    private _confirmClear(): void {
      if (this._clearDialog) return;
      this._clearTooltip.close();
      const dialog = new ModalDialog.ModalDialog({
        styleClass: 'aurora-clipboard-clear-dialog',
      });
      this._clearDialog = dialog;
      if (this._overlay)
        Main.layoutManager.uiGroup.set_child_below_sibling(
          this._overlay,
          Main.layoutManager.modalDialogGroup,
        );
      Main.layoutManager.uiGroup.set_child_below_sibling(this, Main.layoutManager.modalDialogGroup);
      dialog.connect('destroy', () => {
        if (this._isOpen && this._overlay) {
          Main.layoutManager.uiGroup.set_child_above_sibling(this._overlay, null);
          Main.layoutManager.uiGroup.set_child_above_sibling(this, this._overlay);
          this._clearButton.grab_key_focus();
        }
        if (this._clearDialog === dialog) this._clearDialog = null;
      });
      dialog.contentLayout.add_child(
        new Dialog.MessageDialogContent({
          title: _('Clear History?'),
          description: _('Pinned items will be kept.'),
        }),
      );
      (dialog.buttonLayout.layout_manager as Clutter.BoxLayout).orientation =
        Clutter.Orientation.VERTICAL;
      const clearButton = dialog.addButton({
        label: _('Clear History'),
        action: () => {
          this._callbacks.onClear();
          dialog.close();
        },
      });
      clearButton.add_style_class_name('destructive-action');
      dialog.addButton({
        label: _('Cancel'),
        action: () => dialog.close(),
        key: Clutter.KEY_Escape,
        default: true,
      });
      if (!dialog.open()) {
        dialog.destroy();
      }
    }

    private _onKeyPress(controller: Clutter.KeyController): boolean {
      if (this._clearDialog) return Clutter.EVENT_PROPAGATE;
      const [, sym] = controller.get_key();
      const [, pressed, latched, locked] = controller.get_state();
      const mods = pressed | latched | locked;
      const ctrl = Boolean(mods & Clutter.ModifierType.CONTROL_MASK);
      const searchFocused = this._isSearchFocused();

      if (sym === Clutter.KEY_Escape) {
        this.close();
        return Clutter.EVENT_STOP;
      }
      const focused = global.stage.get_key_focus();
      if (focused === this._incognitoButton || focused === this._clearButton)
        return Clutter.EVENT_PROPAGATE;
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
      this._list.populate(this._store.filterPinned(query), this._store.filterHistory(query), query);
    }

    private _isSearchFocused(): boolean {
      return global.stage.get_key_focus() === this._searchEntry.clutter_text;
    }

    private _scrollToSelected(): void {
      const item = this._list.selectedItem;
      if (!item) return;
      const adjustment = this._scroll.vadjustment;
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

    private _positionAtIndicator(anchor: Clutter.Actor): void {
      const [x, y] = anchor.get_transformed_position();
      const [width, height] = anchor.get_transformed_size();
      const monitorIndex = this._findMonitorIndexAt(x + width / 2, y + height / 2);
      const workArea = Main.layoutManager.getWorkAreaForMonitor(monitorIndex);
      const panelWidth = Math.min(PANEL_WIDTH, Math.max(1, workArea.width - PANEL_EDGE_MARGIN * 2));
      const panelHeight = Math.min(
        PANEL_HEIGHT,
        Math.max(1, workArea.height - PANEL_EDGE_MARGIN * 2),
      );
      const panelX = Math.max(
        workArea.x + PANEL_EDGE_MARGIN,
        Math.min(
          x + width / 2 - panelWidth / 2,
          workArea.x + workArea.width - PANEL_EDGE_MARGIN - panelWidth,
        ),
      );
      const panelY = Math.max(
        workArea.y + PANEL_EDGE_MARGIN,
        Math.min(y + height + PANEL_EDGE_MARGIN, workArea.y + workArea.height - panelHeight),
      );
      this.set_size(panelWidth, panelHeight);
      this.set_position(panelX, panelY);
    }

    private _findMonitorIndexAt(x: number, y: number): number {
      return resolveClipboardPanelMonitor(
        global.display.get_current_monitor(),
        x,
        y,
        Main.layoutManager.monitors,
        Main.layoutManager.primaryIndex,
      );
    }
  },
);

export type ClipboardPanel = InstanceType<typeof ClipboardPanel>;
