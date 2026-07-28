import '@girs/gjs';
import { gettext as _ } from '~/shared/i18n.ts';

import Gio from '@girs/gio-2.0';
import Clutter from '@girs/clutter-18';
import GObject from '@girs/gobject-2.0';
import St from '@girs/st-18';
import * as Main from '@girs/gnome-shell/ui/main';
import * as PopupMenu from '@girs/gnome-shell/ui/popupMenu';
import * as IconGrid from '@girs/gnome-shell/ui/iconGrid';
import * as ShellMountOperation from '@girs/gnome-shell/ui/shellMountOperation';
import { DashItemContainer } from '@girs/gnome-shell/ui/dash';

import { logger } from '~/core/logger.ts';
import {
  selectExternalStorageEntries,
  type ExternalStorageCandidate,
} from '~/dock/externalStorageModel.ts';

const FALLBACK_ICON = 'drive-harddisk';
const LOG_PREFIX = 'DockStorage';

type SizableBaseIcon = InstanceType<typeof IconGrid.BaseIcon> & {
  setIconSize(size: number): void;
  y_align: Clutter.ActorAlign;
};

export interface ExternalStorageItem {
  id: string;
  name: string;
  kind: 'volume' | 'mount';
  sortKey: string | null;
  icon: Gio.Icon;
  volume: Gio.Volume | null;
  mount: Gio.Mount | null;
}

export class ExternalStorageMonitor {
  private _volumeMonitor: Gio.VolumeMonitor;
  private _items: ExternalStorageItem[] = [];
  private _onChanged: (items: readonly ExternalStorageItem[]) => void;

  constructor(onChanged: (items: readonly ExternalStorageItem[]) => void) {
    this._onChanged = onChanged;
    this._volumeMonitor = Gio.VolumeMonitor.get();
    this._volumeMonitor.connectObject(
      'volume-added',
      () => this._refresh(),
      'volume-removed',
      () => this._refresh(),
      'volume-changed',
      () => this._refresh(),
      'mount-added',
      () => this._refresh(),
      'mount-removed',
      () => this._refresh(),
      'mount-changed',
      () => this._refresh(),
      'drive-connected',
      () => this._refresh(),
      'drive-disconnected',
      () => this._refresh(),
      'drive-changed',
      () => this._refresh(),
      this,
    );
    this._refresh();
  }

  get items(): readonly ExternalStorageItem[] {
    return this._items;
  }

  destroy(): void {
    this._volumeMonitor.disconnectObject(this);
    this._items = [];
  }

  private _refresh(): void {
    const itemsById = new Map<string, ExternalStorageItem>();
    const candidates: ExternalStorageCandidate[] = [];

    for (const drive of this._volumeMonitor.get_connected_drives()) {
      for (const volume of drive.get_volumes()) {
        this._addVolume(volume, candidates, itemsById);
      }
    }

    for (const volume of this._volumeMonitor.get_volumes()) {
      if (volume.get_drive()) continue;
      this._addVolume(volume, candidates, itemsById);
    }

    for (const mount of this._volumeMonitor.get_mounts()) {
      if (mount.get_volume() || mount.is_shadowed()) continue;
      if (!mount.get_drive()) continue;
      this._addMount(mount, candidates, itemsById);
    }

    this._items = selectExternalStorageEntries(candidates)
      .map((entry) => itemsById.get(entry.id))
      .filter((item): item is ExternalStorageItem => item !== undefined);
    this._onChanged(this._items);
  }

  private _addVolume(
    volume: Gio.Volume,
    candidates: ExternalStorageCandidate[],
    itemsById: Map<string, ExternalStorageItem>,
  ): void {
    const mount = volume.get_mount();
    const root = mount?.get_root() ?? volume.get_activation_root();
    const id = this._volumeId(volume);
    const name = volume.get_name();
    const sortKey = volume.get_sort_key();

    candidates.push({
      id,
      name,
      kind: 'volume',
      sortKey,
      volumeClass: volume.get_identifier(Gio.VOLUME_IDENTIFIER_KIND_CLASS),
      hasDrive: volume.get_drive() !== null,
      isNative: root?.is_native() ?? true,
      isShadowed: mount?.is_shadowed() ?? false,
      canMount: volume.can_mount(),
      hasMount: mount !== null,
    });

    itemsById.set(id, {
      id,
      name,
      kind: 'volume',
      sortKey,
      icon: this._safeIcon(() => volume.get_icon()),
      volume,
      mount,
    });
  }

  private _addMount(
    mount: Gio.Mount,
    candidates: ExternalStorageCandidate[],
    itemsById: Map<string, ExternalStorageItem>,
  ): void {
    const id = this._mountId(mount);
    const name = mount.get_name();
    const sortKey = mount.get_sort_key();

    candidates.push({
      id,
      name,
      kind: 'mount',
      sortKey,
      volumeClass: null,
      hasDrive: mount.get_drive() !== null,
      isNative: mount.get_default_location().is_native(),
      isShadowed: mount.is_shadowed(),
      canMount: false,
      hasMount: true,
    });

    itemsById.set(id, {
      id,
      name,
      kind: 'mount',
      sortKey,
      icon: this._safeIcon(() => mount.get_icon()),
      volume: null,
      mount,
    });
  }

  private _volumeId(volume: Gio.Volume): string {
    const identifier =
      volume.get_uuid() ??
      volume.get_identifier(Gio.VOLUME_IDENTIFIER_KIND_UUID) ??
      volume.get_identifier(Gio.VOLUME_IDENTIFIER_KIND_UNIX_DEVICE) ??
      volume.get_identifier(Gio.VOLUME_IDENTIFIER_KIND_LABEL) ??
      volume.get_sort_key() ??
      volume.get_name();
    return `volume:${identifier}`;
  }

  private _mountId(mount: Gio.Mount): string {
    const identifier =
      mount.get_uuid() ?? mount.get_sort_key() ?? mount.get_default_location().get_uri();
    return `mount:${identifier}`;
  }

  private _safeIcon(getIcon: () => Gio.Icon): Gio.Icon {
    try {
      return getIcon();
    } catch (error) {
      logger.warn(`Failed to read storage icon: ${error}`, { prefix: LOG_PREFIX });
      return new Gio.ThemedIcon({ name: FALLBACK_ICON });
    }
  }
}

export const ExternalStorageIcon = GObject.registerClass(
  class ExternalStorageIcon extends DashItemContainer {
    declare toggleButton: St.Button;
    declare icon: SizableBaseIcon;
    declare private _iconActor: St.Icon | null;
    declare private _item: ExternalStorageItem;
    declare private _menu: PopupMenu.PopupMenu | null;
    declare private _menuManager: PopupMenu.PopupMenuManager | null;
    declare private _openItem: PopupMenu.PopupMenuItem | null;
    declare private _ejectItem: PopupMenu.PopupMenuItem | null;
    declare private _operationCancellable: Gio.Cancellable | null;
    declare private _busy: boolean;

    override _init(item?: ExternalStorageItem): void {
      super._init();

      if (!item) throw new Error('ExternalStorageIcon requires an item');

      this._iconActor = null;
      this._item = item;
      this._menu = null;
      this._menuManager = null;
      this._openItem = null;
      this._ejectItem = null;
      this._operationCancellable = new Gio.Cancellable();
      this._busy = false;

      this.toggleButton = new St.Button({
        style_class: 'show-apps',
        track_hover: true,
        can_focus: true,
        reactive: true,
      });

      this.icon = new IconGrid.BaseIcon(item.name, {
        setSizeManually: true,
        showLabel: false,
        createIcon: (size: number) => this._createIcon(size),
      }) as SizableBaseIcon;
      this.icon.y_align = Clutter.ActorAlign.CENTER;

      this.toggleButton.child = this.icon;
      (this.toggleButton as St.Button & { _delegate?: unknown })._delegate = this;
      (this as { _delegate?: unknown })._delegate = this;

      this.setChild(this.toggleButton);
      this.setLabelText(item.name);

      this._buildMenu();

      this.toggleButton.connectObject(
        'clicked',
        () => this._open(),
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
    }

    setIconSize(size: number): void {
      this.icon.setIconSize(size);
    }

    override destroy(): void {
      this._operationCancellable?.cancel();
      this._operationCancellable = null;
      this.toggleButton.disconnectObject(this);
      this._menu?.destroy();
      this._menu = null;
      this._menuManager = null;
      this._openItem = null;
      this._ejectItem = null;
      this._iconActor = null;
      super.destroy();
    }

    get menuIsOpen(): boolean {
      return this._menu?.isOpen ?? false;
    }

    private _createIcon(size: number): St.Icon {
      this._iconActor = new St.Icon({
        gicon: this._item.icon,
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

      this._openItem = new PopupMenu.PopupMenuItem(
        this._item.mount ? _('Open') : _('Mount and Open'),
      );
      this._openItem.connectObject('activate', () => this._open(), this);
      this._menu.addMenuItem(this._openItem);

      const ejectLabel = this._canEject() ? _('Eject') : _('Unmount');
      this._ejectItem = new PopupMenu.PopupMenuItem(ejectLabel);
      this._ejectItem.connectObject('activate', () => this._eject(), this);
      this._menu.addMenuItem(this._ejectItem);

      this._syncMenuSensitivity();
    }

    private _syncMenuSensitivity(): void {
      this._openItem?.setSensitive(!this._busy);
      this._ejectItem?.setSensitive(!this._busy && this._canUnmountOrEject());
    }

    private _open(): void {
      void this._openAsync();
    }

    private async _openAsync(): Promise<void> {
      const cancellable = this._operationCancellable;
      if (this._busy || !cancellable) return;
      this._setBusy(true);

      try {
        const mount = await this._ensureMounted(cancellable);
        if (!mount) throw new Error('Volume is not mounted');

        const uri = mount.get_root().get_uri();
        const launchContext = global.create_app_launch_context(global.get_current_time(), -1);
        await this._launchUri(uri, launchContext, cancellable);
      } catch (error) {
        this._reportFailure(_('Failed to open “%s”').format(this._item.name), error);
      } finally {
        if (this._operationCancellable === cancellable) this._setBusy(false);
      }
    }

    private async _ensureMounted(cancellable: Gio.Cancellable): Promise<Gio.Mount | null> {
      const currentMount = this._item.volume?.get_mount() ?? this._item.mount;
      if (currentMount) return currentMount;
      if (!this._item.volume?.can_mount()) return null;

      const operation = new ShellMountOperation.ShellMountOperation(this._item.volume);
      try {
        await this._mountVolume(this._item.volume, operation.mountOp, cancellable);
        return this._item.volume.get_mount();
      } finally {
        operation.close();
      }
    }

    private _eject(): void {
      void this._ejectAsync();
    }

    private async _ejectAsync(): Promise<void> {
      const cancellable = this._operationCancellable;
      if (this._busy || !cancellable || !this._canUnmountOrEject()) return;
      this._setBusy(true);

      try {
        const mount = this._item.volume?.get_mount() ?? this._item.mount;

        if (mount?.can_eject()) {
          const operation = new ShellMountOperation.ShellMountOperation(mount);
          try {
            await this._ejectMount(mount, operation.mountOp, cancellable);
          } finally {
            operation.close();
          }
        } else if (mount?.can_unmount()) {
          const operation = new ShellMountOperation.ShellMountOperation(mount);
          try {
            await this._unmountMount(mount, operation.mountOp, cancellable);
          } finally {
            operation.close();
          }
        } else if (this._item.volume?.can_eject()) {
          const operation = new ShellMountOperation.ShellMountOperation(this._item.volume);
          try {
            await this._ejectVolume(this._item.volume, operation.mountOp, cancellable);
          } finally {
            operation.close();
          }
        }
      } catch (error) {
        this._reportFailure(_('Failed to eject “%s”').format(this._item.name), error);
      } finally {
        if (this._operationCancellable === cancellable) this._setBusy(false);
      }
    }

    private _canUnmountOrEject(): boolean {
      const mount = this._item.volume?.get_mount() ?? this._item.mount;
      return (
        mount?.can_eject() === true ||
        mount?.can_unmount() === true ||
        this._item.volume?.can_eject() === true
      );
    }

    private _canEject(): boolean {
      const mount = this._item.volume?.get_mount() ?? this._item.mount;
      return mount?.can_eject() === true || this._item.volume?.can_eject() === true;
    }

    private _launchUri(
      uri: string,
      launchContext: Gio.AppLaunchContext,
      cancellable: Gio.Cancellable,
    ): Promise<void> {
      return new Promise((resolve, reject) => {
        Gio.app_info_launch_default_for_uri_async(
          uri,
          launchContext,
          cancellable,
          (_source, result) => {
            try {
              Gio.app_info_launch_default_for_uri_finish(result);
              resolve();
            } catch (error) {
              reject(error);
            }
          },
        );
      });
    }

    private _mountVolume(
      volume: Gio.Volume,
      mountOperation: Gio.MountOperation,
      cancellable: Gio.Cancellable,
    ): Promise<void> {
      return new Promise((resolve, reject) => {
        volume.mount(Gio.MountMountFlags.NONE, mountOperation, cancellable, (_source, result) => {
          try {
            volume.mount_finish(result);
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });
    }

    private _ejectMount(
      mount: Gio.Mount,
      mountOperation: Gio.MountOperation,
      cancellable: Gio.Cancellable,
    ): Promise<void> {
      return new Promise((resolve, reject) => {
        mount.eject_with_operation(
          Gio.MountUnmountFlags.NONE,
          mountOperation,
          cancellable,
          (_source, result) => {
            try {
              mount.eject_with_operation_finish(result);
              resolve();
            } catch (error) {
              reject(error);
            }
          },
        );
      });
    }

    private _unmountMount(
      mount: Gio.Mount,
      mountOperation: Gio.MountOperation,
      cancellable: Gio.Cancellable,
    ): Promise<void> {
      return new Promise((resolve, reject) => {
        mount.unmount_with_operation(
          Gio.MountUnmountFlags.NONE,
          mountOperation,
          cancellable,
          (_source, result) => {
            try {
              mount.unmount_with_operation_finish(result);
              resolve();
            } catch (error) {
              reject(error);
            }
          },
        );
      });
    }

    private _ejectVolume(
      volume: Gio.Volume,
      mountOperation: Gio.MountOperation,
      cancellable: Gio.Cancellable,
    ): Promise<void> {
      return new Promise((resolve, reject) => {
        volume.eject_with_operation(
          Gio.MountUnmountFlags.NONE,
          mountOperation,
          cancellable,
          (_source, result) => {
            try {
              volume.eject_with_operation_finish(result);
              resolve();
            } catch (error) {
              reject(error);
            }
          },
        );
      });
    }

    private _setBusy(busy: boolean): void {
      this._busy = busy;
      this._syncMenuSensitivity();
    }

    private _reportFailure(title: string, error: unknown): void {
      if (this._isHandledError(error)) return;

      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`${title}: ${message}`, { prefix: LOG_PREFIX });
      Main.notifyError(title, message);
    }

    private _isHandledError(error: unknown): boolean {
      const maybeGioError = error as {
        matches?: (domain: unknown, code: unknown) => boolean;
      } | null;
      return (
        maybeGioError?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.FAILED_HANDLED) === true ||
        maybeGioError?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) === true
      );
    }
  },
);

export type ExternalStorageIconInstance = InstanceType<typeof ExternalStorageIcon>;

export function createExternalStorageIcon(item: ExternalStorageItem): ExternalStorageIconInstance {
  return new (ExternalStorageIcon as unknown as new (
    storageItem: ExternalStorageItem,
  ) => ExternalStorageIconInstance)(item);
}
