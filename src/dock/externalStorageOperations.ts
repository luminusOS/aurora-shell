import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import * as Main from '@girs/gnome-shell/ui/main';
import * as ShellMountOperation from '@girs/gnome-shell/ui/shellMountOperation';

import { gettext as _ } from '~/shared/i18n.ts';
import { logger } from '~/core/logger.ts';
import type { ExternalStorageItem } from '~/dock/externalStorageMonitor.ts';

export class ExternalStorageOperations {
  private _cancellable = new Gio.Cancellable();
  private _busy = false;
  private _onBusyChanged: ((busy: boolean) => void) | null;

  constructor(
    private _item: ExternalStorageItem,
    onBusyChanged: (busy: boolean) => void,
  ) {
    this._onBusyChanged = onBusyChanged;
  }

  get busy(): boolean {
    return this._busy;
  }

  get canUnmountOrEject(): boolean {
    const mount = this._currentMount();

    return Boolean(mount?.can_eject() || mount?.can_unmount() || this._item.volume?.can_eject());
  }

  get canEject(): boolean {
    return Boolean(this._currentMount()?.can_eject() || this._item.volume?.can_eject());
  }

  open(): void {
    void this._open();
  }

  eject(): void {
    void this._eject();
  }

  destroy(): void {
    this._cancellable.cancel();
    this._onBusyChanged = null;
  }

  private async _open(): Promise<void> {
    if (this._busy) return;

    this._setBusy(true);

    try {
      const mount = await this._ensureMounted();
      if (!mount) throw new Error('Volume is not mounted');

      const launchContext = global.create_app_launch_context(global.get_current_time(), -1);
      await this._launchUri(mount.get_root().get_uri(), launchContext);
    } catch (error) {
      this._reportFailure(_('Failed to open “%s”').format(this._item.name), error);
    } finally {
      this._setBusy(false);
    }
  }

  private async _ensureMounted(): Promise<Gio.Mount | null> {
    const currentMount = this._currentMount();
    if (currentMount) return currentMount;
    if (!this._item.volume?.can_mount()) return null;

    const operation = new ShellMountOperation.ShellMountOperation(this._item.volume);

    try {
      await this._mountVolume(this._item.volume, operation.mountOp);
      return this._item.volume.get_mount();
    } finally {
      operation.close();
    }
  }

  private async _eject(): Promise<void> {
    if (this._busy || !this.canUnmountOrEject) return;

    this._setBusy(true);

    try {
      const mount = this._currentMount();

      if (mount?.can_eject()) {
        await this._withMountOperation(mount, (operation) => this._ejectMount(mount, operation));
      } else if (mount?.can_unmount()) {
        await this._withMountOperation(mount, (operation) => this._unmountMount(mount, operation));
      } else if (this._item.volume?.can_eject()) {
        const volume = this._item.volume;
        await this._withMountOperation(volume, (operation) => this._ejectVolume(volume, operation));
      }
    } catch (error) {
      this._reportFailure(_('Failed to eject “%s”').format(this._item.name), error);
    } finally {
      this._setBusy(false);
    }
  }

  private async _withMountOperation(
    owner: Gio.Mount | Gio.Volume,
    operation: (mountOperation: Gio.MountOperation) => Promise<void>,
  ): Promise<void> {
    const shellOperation = new ShellMountOperation.ShellMountOperation(owner);

    try {
      await operation(shellOperation.mountOp);
    } finally {
      shellOperation.close();
    }
  }

  private _currentMount(): Gio.Mount | null {
    return this._item.volume?.get_mount() ?? this._item.mount;
  }

  private _launchUri(uri: string, context: Gio.AppLaunchContext): Promise<void> {
    return new Promise((resolve, reject) => {
      Gio.app_info_launch_default_for_uri_async(
        uri,
        context,
        this._cancellable,
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

  private _mountVolume(volume: Gio.Volume, operation: Gio.MountOperation): Promise<void> {
    return new Promise((resolve, reject) => {
      volume.mount(Gio.MountMountFlags.NONE, operation, this._cancellable, (_source, result) => {
        try {
          volume.mount_finish(result);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  private _ejectMount(mount: Gio.Mount, operation: Gio.MountOperation): Promise<void> {
    return new Promise((resolve, reject) => {
      mount.eject_with_operation(
        Gio.MountUnmountFlags.NONE,
        operation,
        this._cancellable,
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

  private _unmountMount(mount: Gio.Mount, operation: Gio.MountOperation): Promise<void> {
    return new Promise((resolve, reject) => {
      mount.unmount_with_operation(
        Gio.MountUnmountFlags.NONE,
        operation,
        this._cancellable,
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

  private _ejectVolume(volume: Gio.Volume, operation: Gio.MountOperation): Promise<void> {
    return new Promise((resolve, reject) => {
      volume.eject_with_operation(
        Gio.MountUnmountFlags.NONE,
        operation,
        this._cancellable,
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
    if (this._onBusyChanged) {
      this._onBusyChanged(busy);
    }
  }

  private _reportFailure(title: string, error: unknown): void {
    const handled =
      error instanceof GLib.Error &&
      (error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.FAILED_HANDLED) ||
        error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED));
    if (handled) return;

    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`${title}: ${message}`, { prefix: 'DockStorage' });
    Main.notifyError(title, message);
  }
}
