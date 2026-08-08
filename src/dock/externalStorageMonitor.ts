import Gio from '@girs/gio-2.0';

import { logger } from '~/core/logger.ts';
import {
  selectExternalStorageEntries,
  type ExternalStorageCandidate,
} from '~/dock/externalStorageModel.ts';

const FALLBACK_ICON = 'drive-harddisk';
const LOG_PREFIX = 'DockStorage';

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

  constructor(private _onChanged: (items: readonly ExternalStorageItem[]) => void) {
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
      if (!volume.get_drive()) {
        this._addVolume(volume, candidates, itemsById);
      }
    }

    for (const mount of this._volumeMonitor.get_mounts()) {
      if (!mount.get_volume() && !mount.is_shadowed() && mount.get_drive()) {
        this._addMount(mount, candidates, itemsById);
      }
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
    const root = mount ? mount.get_root() : volume.get_activation_root();
    let identifier = volume.get_uuid();
    if (!identifier) identifier = volume.get_identifier(Gio.VOLUME_IDENTIFIER_KIND_UUID);
    if (!identifier) identifier = volume.get_identifier(Gio.VOLUME_IDENTIFIER_KIND_UNIX_DEVICE);
    if (!identifier) identifier = volume.get_identifier(Gio.VOLUME_IDENTIFIER_KIND_LABEL);
    if (!identifier) identifier = volume.get_sort_key();
    if (!identifier) identifier = volume.get_name();
    const id = `volume:${identifier}`;

    candidates.push({
      id,
      name: volume.get_name(),
      kind: 'volume',
      sortKey: volume.get_sort_key(),
      volumeClass: volume.get_identifier(Gio.VOLUME_IDENTIFIER_KIND_CLASS),
      hasDrive: volume.get_drive() !== null,
      isNative: root ? root.is_native() : true,
      isShadowed: mount ? mount.is_shadowed() : false,
      canMount: volume.can_mount(),
      hasMount: mount !== null,
    });
    itemsById.set(id, {
      id,
      name: volume.get_name(),
      kind: 'volume',
      sortKey: volume.get_sort_key(),
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
    let identifier = mount.get_uuid();
    if (!identifier) identifier = mount.get_sort_key();
    if (!identifier) identifier = mount.get_default_location().get_uri();
    const id = `mount:${identifier}`;

    candidates.push({
      id,
      name: mount.get_name(),
      kind: 'mount',
      sortKey: mount.get_sort_key(),
      volumeClass: null,
      hasDrive: mount.get_drive() !== null,
      isNative: mount.get_default_location().is_native(),
      isShadowed: mount.is_shadowed(),
      canMount: false,
      hasMount: true,
    });
    itemsById.set(id, {
      id,
      name: mount.get_name(),
      kind: 'mount',
      sortKey: mount.get_sort_key(),
      icon: this._safeIcon(() => mount.get_icon()),
      volume: null,
      mount,
    });
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
