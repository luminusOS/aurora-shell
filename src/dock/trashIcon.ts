import '@girs/gjs';
import { gettext as _ } from 'gettext';

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import Clutter from '@girs/clutter-18';
import GObject from '@girs/gobject-2.0';
import Shell from '@girs/shell-18';
import St from '@girs/st-18';
import * as Main from '@girs/gnome-shell/ui/main';
import * as DND from '@girs/gnome-shell/ui/dnd';
import * as PopupMenu from '@girs/gnome-shell/ui/popupMenu';
import * as IconGrid from '@girs/gnome-shell/ui/iconGrid';
import { DashItemContainer } from '@girs/gnome-shell/ui/dash';

import { logger } from '~/core/logger.ts';
import { launchTrash, NAUTILUS_APP_ID, TRASH_URI } from '~/dock/trashLauncher.ts';

const ICON_EMPTY = 'user-trash';
const ICON_FULL = 'user-trash-full';
const LOG_PREFIX = 'DockTrash';

type SizableBaseIcon = InstanceType<typeof IconGrid.BaseIcon> & {
  setIconSize(size: number): void;
  y_align: Clutter.ActorAlign;
};

export const TrashIcon = GObject.registerClass(
  class TrashIcon extends DashItemContainer {
    declare toggleButton: St.Button;
    declare icon: SizableBaseIcon;
    declare private _iconActor: St.Icon | null;
    declare private _empty: boolean;
    declare private _trashFile: Gio.File;
    declare private _monitor: Gio.FileMonitor | null;
    declare private _refreshCancellable: Gio.Cancellable | null;
    declare private _menu: PopupMenu.PopupMenu | null;
    declare private _menuManager: PopupMenu.PopupMenuManager | null;
    declare private _emptyItem: PopupMenu.PopupMenuItem | null;
    declare private _destroyed: boolean;

    override _init(): void {
      super._init();

      // GObject invokes _init() during construction. These must be declared
      // fields initialized here, otherwise emitted class-field initializers
      // run afterwards and overwrite the live Gio objects with undefined.
      this._iconActor = null;
      this._empty = true;
      this._trashFile = Gio.File.new_for_uri(TRASH_URI);
      this._monitor = null;
      this._refreshCancellable = null;
      this._menu = null;
      this._menuManager = null;
      this._emptyItem = null;
      this._destroyed = false;

      this.toggleButton = new St.Button({
        style_class: 'show-apps',
        track_hover: true,
        can_focus: true,
        reactive: true,
      });

      this.icon = new IconGrid.BaseIcon(_('Trash'), {
        setSizeManually: true,
        showLabel: false,
        createIcon: (size: number) => this._createIcon(size),
      }) as SizableBaseIcon;
      this.icon.y_align = Clutter.ActorAlign.CENTER;

      this.toggleButton.child = this.icon;
      (this.toggleButton as St.Button & { _delegate?: unknown })._delegate = this;
      (this as { _delegate?: unknown })._delegate = this;

      this.setChild(this.toggleButton);
      this.setLabelText(_('Trash'));

      this._buildMenu();

      this.toggleButton.connectObject(
        'clicked',
        () => this._openTrash(),
        'button-press-event',
        (_actor: St.Button, event: Clutter.Event) => {
          if (event.get_button() === Clutter.BUTTON_SECONDARY) {
            this._menu?.toggle();
            return Clutter.EVENT_STOP;
          }
          return Clutter.EVENT_PROPAGATE;
        },
        this,
      );

      this._startMonitor();
      this._refresh();

      this.connect('destroy', () => this._onDestroy());
    }

    setIconSize(size: number): void {
      this.icon.setIconSize(size);
    }

    get menuIsOpen(): boolean {
      return this._menu?.isOpen ?? false;
    }

    private _createIcon(size: number): St.Icon {
      this._iconActor = new St.Icon({
        icon_name: this._empty ? ICON_EMPTY : ICON_FULL,
        icon_size: size,
        style_class: 'show-apps-icon',
        track_hover: true,
      });
      return this._iconActor;
    }

    private _buildMenu(): void {
      this._menu = new PopupMenu.PopupMenu(this.toggleButton, 0.5, St.Side.TOP);
      this._menu.actor.add_style_class_name('app-menu');
      Main.uiGroup.add_child(this._menu.actor);
      this._menu.actor.hide();

      this._menuManager = new PopupMenu.PopupMenuManager(this.toggleButton);
      this._menuManager.addMenu(this._menu);

      const openItem = new PopupMenu.PopupMenuItem(_('Open'));
      openItem.connectObject('activate', () => this._openTrash(), this);
      this._menu.addMenuItem(openItem);

      this._emptyItem = new PopupMenu.PopupMenuItem(_('Empty Trash'));
      this._emptyItem.connectObject('activate', () => this._emptyTrash(), this);
      this._menu.addMenuItem(this._emptyItem);

      this._syncMenuSensitivity();
    }

    private _startMonitor(): void {
      try {
        this._monitor = this._trashFile.monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
        this._monitor.connectObject('changed', () => this._refresh(), this);
      } catch (e) {
        this._warn('Failed to monitor trash', e);
      }
    }

    private _refresh(): void {
      if (this._destroyed) return;

      this._refreshCancellable?.cancel();
      const cancellable = new Gio.Cancellable();
      this._refreshCancellable = cancellable;

      this._trashFile.query_info_async(
        'trash::item-count',
        Gio.FileQueryInfoFlags.NONE,
        0,
        cancellable,
        (file, res) => {
          if (this._destroyed || cancellable.is_cancelled()) return;

          let count = 0;
          try {
            const info = (file as Gio.File).query_info_finish(res);
            count = info.get_attribute_uint32('trash::item-count');
          } catch (e) {
            this._warn('Failed to read trash item count', e);
            return;
          }
          this._refreshCancellable = null;
          this._setEmpty(count === 0);
        },
      );
    }

    private _setEmpty(empty: boolean): void {
      if (empty === this._empty && this._iconActor) return;
      this._empty = empty;
      if (this._iconActor) {
        this._iconActor.icon_name = empty ? ICON_EMPTY : ICON_FULL;
      }
      this._syncMenuSensitivity();
    }

    private _syncMenuSensitivity(): void {
      this._emptyItem?.setSensitive(!this._empty);
    }

    private _openTrash(): void {
      void this._openTrashAsync();
    }

    private _openTrashAsync(): void {
      const launchContext = global.create_app_launch_context(global.get_current_time(), -1);

      try {
        launchTrash({
          launchNautilus: () => {
            const fileManager = Shell.AppSystem.get_default().lookup_app(NAUTILUS_APP_ID);
            const executable = fileManager?.get_app_info().get_executable();
            if (!executable) return false;

            const launcher = Gio.AppInfo.create_from_commandline(
              GLib.shell_quote(executable),
              NAUTILUS_APP_ID,
              Gio.AppInfoCreateFlags.SUPPORTS_URIS |
                Gio.AppInfoCreateFlags.SUPPORTS_STARTUP_NOTIFICATION,
            );
            return launcher.launch_uris([TRASH_URI], launchContext);
          },
        });
      } catch (error) {
        if (!this._destroyed) this._warn('Failed to open trash', error);
      }
    }

    private _emptyTrash(): void {
      this._trashFile.enumerate_children_async(
        'standard::name',
        Gio.FileQueryInfoFlags.NONE,
        0,
        null,
        (file, res) => {
          let enumerator: Gio.FileEnumerator;
          try {
            enumerator = (file as Gio.File).enumerate_children_finish(res);
          } catch (e) {
            this._warn('Failed to enumerate trash', e);
            return;
          }
          this._deleteNext(enumerator);
        },
      );
    }

    private _deleteNext(enumerator: Gio.FileEnumerator): void {
      enumerator.next_files_async(32, 0, null, (src, res) => {
        let infos: Gio.FileInfo[];
        try {
          infos = (src as Gio.FileEnumerator).next_files_finish(res);
        } catch (e) {
          this._warn('Failed to list trash batch', e);
          enumerator.close_async(0, null, null);
          return;
        }

        if (infos.length === 0) {
          enumerator.close_async(0, null, null);
          return;
        }

        for (const info of infos) {
          const child = enumerator.get_child(info);
          child.delete_async(0, null, (childFile, deleteRes) => {
            try {
              (childFile as Gio.File).delete_finish(deleteRes);
            } catch (e) {
              this._warn('Failed to delete trashed item', e);
            }
          });
        }

        this._deleteNext(enumerator);
      });
    }

    handleDragOver(source: unknown): DND.DragMotionResult {
      return this._extractUris(source).length > 0
        ? DND.DragMotionResult.MOVE_DROP
        : DND.DragMotionResult.NO_DROP;
    }

    acceptDrop(source: unknown): boolean {
      const uris = this._extractUris(source);
      if (uris.length === 0) return false;

      for (const uri of uris) {
        Gio.File.new_for_uri(uri).trash_async(0, null, (file, res) => {
          try {
            (file as Gio.File).trash_finish(res);
          } catch (e) {
            this._warn('Failed to trash dropped item', e);
          }
        });
      }
      return true;
    }

    private _extractUris(source: unknown): string[] {
      const s = source as {
        getUris?: () => string[] | null;
        uri?: string;
        file?: { get_uri?: () => string };
        _file?: { get_uri?: () => string };
      } | null;
      if (!s) return [];
      if (typeof s.getUris === 'function') return s.getUris() ?? [];
      if (typeof s.uri === 'string') return [s.uri];
      const file = s.file ?? s._file;
      if (file?.get_uri) return [file.get_uri()];
      return [];
    }

    private _warn(message: string, error: unknown): void {
      logger.warn(`${message}: ${error}`, { prefix: LOG_PREFIX });
    }

    private _onDestroy(): void {
      this._destroyed = true;
      this.toggleButton.disconnectObject(this);
      this._refreshCancellable?.cancel();
      this._refreshCancellable = null;
      this._monitor?.disconnectObject(this);
      this._monitor?.cancel();
      this._monitor = null;
      this._menu?.destroy();
      this._menu = null;
      this._menuManager = null;
      this._emptyItem = null;
      this._iconActor = null;
    }
  },
);

export type TrashIconInstance = InstanceType<typeof TrashIcon>;
