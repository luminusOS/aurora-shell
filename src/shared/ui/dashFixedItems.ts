import Shell from '@girs/shell-18';
import { logger } from '~/core/logger.ts';
import { TrashIcon, type TrashIconInstance } from '~/dock/trashIcon.ts';
import { canLaunchTrash, NAUTILUS_APP_ID } from '~/dock/trashLauncher.ts';
import {
  createExternalStorageIcon,
  ExternalStorageMonitor,
  type ExternalStorageIconInstance,
  type ExternalStorageItem,
} from '~/dock/externalStorageIcon.ts';

type FixedItemDash = {
  iconSize: number;
  _dashContainer: any;
  _showAppsIcon: any;
  _hookUpLabel(item: unknown): void;
};

type FixedItemOwner = {
  connectObject(...args: any[]): void;
};

export class DashFixedItems {
  private _trash: TrashIconInstance | null = null;
  private _monitor: ExternalStorageMonitor | null = null;
  private _storage: ExternalStorageIconInstance[] = [];

  constructor(
    private _owner: FixedItemOwner,
    private _dash: FixedItemDash,
    showTrash: boolean,
    showExternalStorage: boolean,
    private _onLayoutChanged: () => void,
  ) {
    if (showExternalStorage) {
      this._setupStorage();
    }

    if (showTrash) {
      this._setupTrash();
    }
  }

  destroy(): void {
    this._monitor?.destroy();
    this._monitor = null;
    for (const icon of this._storage) {
      icon.destroy();
    }

    this._storage = [];
    this._trash?.destroy();
    this._trash = null;
  }

  get icons(): any[] {
    return [...this._storage, ...(this._trash ? [this._trash] : [])];
  }

  get menuOpen(): boolean {
    return Boolean(this._trash?.menuIsOpen || this._storage.some((icon) => icon.menuIsOpen));
  }

  private _setupTrash(): void {
    const container = this._dash._dashContainer;

    const app = Shell.AppSystem.get_default().lookup_app(NAUTILUS_APP_ID);
    if (
      !canLaunchTrash({ getNautilusExecutable: () => app?.get_app_info().get_executable() ?? null })
    ) {
      logger.debug('Trash icon disabled: Nautilus is unavailable', { prefix: 'DockDash' });
      return;
    }

    this._trash = new TrashIcon() as TrashIconInstance;
    this._trash.show(false);
    this._trash.setIconSize(this._dash.iconSize);
    this._dash._hookUpLabel(this._trash);
    const anchorIndex = container.get_children().indexOf(this._dash._showAppsIcon);
    if (anchorIndex >= 0) {
      container.insert_child_at_index(this._trash, anchorIndex);
    } else {
      container.add_child(this._trash);
    }

    const trash = this._trash;
    this._owner.connectObject(
      'icon-size-changed',
      () => trash.setIconSize(this._dash.iconSize),
      this._owner,
    );
  }

  private _setupStorage(): void {
    this._monitor = new ExternalStorageMonitor((items) => this._syncStorage(items));
    this._syncStorage(this._monitor.items);
    this._owner.connectObject(
      'icon-size-changed',
      () => {
        for (const icon of this._storage) {
          icon.setIconSize(this._dash.iconSize);
        }
      },
      this._owner,
    );
  }

  private _syncStorage(items: readonly ExternalStorageItem[]): void {
    for (const icon of this._storage) {
      icon.destroy();
    }

    this._storage = [];
    const container = this._dash._dashContainer;
    if (!container) return;

    for (const item of items) {
      const icon = createExternalStorageIcon(item);
      icon.show(false);
      icon.setIconSize(this._dash.iconSize);
      this._dash._hookUpLabel(icon);
      this._storage.push(icon);
    }
    const anchor = this._trash ?? this._dash._showAppsIcon;
    const anchorIndex = anchor ? container.get_children().indexOf(anchor) : -1;

    for (const [offset, icon] of this._storage.entries()) {
      if (anchorIndex >= 0) {
        container.insert_child_at_index(icon, anchorIndex + offset);
      } else {
        container.add_child(icon);
      }
    }

    this._onLayoutChanged();
  }
}
