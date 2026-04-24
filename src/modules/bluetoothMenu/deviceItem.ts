// @ts-nocheck
import '@girs/gjs';

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import St from '@girs/st-17';
import Clutter from '@girs/clutter-17';

import type { IconThemeLoader } from '~/shared/icons.ts';

const COLOR_DISCONNECTED = '#9a9a9a';
const COLOR_CONNECTED = '#1c71d8';
const COLOR_ANIMATING = '#3584e4';

export class BluetoothDeviceItemPatcher {
  private _item: any;
  private _iconLoader: IconThemeLoader;
  private _stateIcon: St.Icon | null = null;
  private _batteryLabel: St.Label | null = null;
  private _spinnerNotifyId = 0;
  private _batteryNotifyId = 0;
  private _connectedNotifyId = 0;
  private _pendingUpdateId = 0;
  private _animationTimeoutId = 0;
  private _animationFrame = 1;
  private _animatingState: 'connecting' | 'disconnecting' | null = null;

  constructor(item: any, iconLoader: IconThemeLoader) {
    this._item = item;
    this._iconLoader = iconLoader;
    this._patch();
  }

  private _patch(): void {
    const item = this._item;

    // Override activate so clicking a device doesn't close the menu.
    // The parent PopupMenuBase listens to 'activate' and calls menu.close();
    // calling _toggleConnected() directly bypasses that signal path.
    item.activate = (_event: any) => {
      item._toggleConnected().catch(console.error);
    };

    // Remove icon, subtitle, and spinner from actor hierarchy entirely.
    // Keeping them hidden via notify::visible has a one-frame race: GNOME Shell
    // can re-show them (e.g. icon via device.icon binding) before our handler
    // fires. Removing from the tree makes rendering impossible.
    if (item._icon) {
      item.remove_child(item._icon);
    }
    if (item._subtitle) {
      item.remove_child(item._subtitle);
    }
    if (item._spinner) {
      item.remove_child(item._spinner);
    }

    this._batteryLabel = new St.Label({
      style_class: 'aurora-bt-battery-label',
      y_align: Clutter.ActorAlign.CENTER,
      x_expand: false,
    });
    this._batteryLabel.set_margin_right(4);

    this._stateIcon = new St.Icon({
      icon_size: 16,
      style_class: 'popup-menu-icon',
      y_align: Clutter.ActorAlign.CENTER,
      x_expand: false,
    });

    // _label already has x_expand: true — append after it so layout is:
    // [ornament] [_label(expand)] [battery] [stateIcon]
    item.add_child(this._batteryLabel);
    item.add_child(this._stateIcon);

    this._updateStateIcon();
    this._updateBatteryLabel();

    this._spinnerNotifyId = item._spinner.connect('notify::visible', () => {
      if (item._spinner.visible) {
        // Spinner starting — update immediately to begin animation.
        this._updateStateIcon();
        this._updateBatteryLabel();
      } else {
        // Spinner stopping — defer so device.connected and battery_percentage
        // can settle first. connect_service() resolves before BlueZ fires the
        // connected property change, so device.connected may still be false here.
        this._scheduleUpdate();
      }
    });

    if (item._spinner.visible) {
      this._updateStateIcon();
    }

    this._batteryNotifyId = item._device.connect('notify::battery-percentage', () => {
      this._updateBatteryLabel();
    });

    this._connectedNotifyId = item._device.connect('notify::connected', () => {
      this._updateBatteryLabel();
      this._updateStateIcon();
    });
  }

  private _scheduleUpdate(): void {
    if (this._pendingUpdateId !== 0) {
      GLib.source_remove(this._pendingUpdateId);
      this._pendingUpdateId = 0;
    }
    this._pendingUpdateId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this._pendingUpdateId = 0;
      this._updateStateIcon();
      this._updateBatteryLabel();
      return GLib.SOURCE_REMOVE;
    });
  }

  private _loadIcon(name: string): Gio.Icon {
    try {
      return this._iconLoader.lookupIcon(name);
    } catch (_e) {
      return Gio.Icon.new_for_string('image-missing-symbolic');
    }
  }

  private _updateStateIcon(): void {
    if (!this._stateIcon) return;

    const connected: boolean = this._item._device.connected;
    const isWorking: boolean = this._item._spinner.visible;

    if (isWorking) {
      if (this._animationTimeoutId === 0) {
        this._animationFrame = 1;
        // Latch the state when animation starts: if not connected, we are connecting.
        this._animatingState = connected ? 'disconnecting' : 'connecting';

        this._animationTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
          this._animationFrame = (this._animationFrame % 4) + 1;
          this._stateIcon!.gicon = this._loadIcon(
            `bbm-bluetooth-${this._animatingState}-${this._animationFrame}-symbolic`,
          );
          this._stateIcon!.set_style(`color: ${COLOR_ANIMATING};`);
          return GLib.SOURCE_CONTINUE;
        });
      }
      const state = this._animatingState || (connected ? 'disconnecting' : 'connecting');
      this._stateIcon.gicon = this._loadIcon(
        `bbm-bluetooth-${state}-${this._animationFrame}-symbolic`,
      );
      this._stateIcon.set_style(`color: ${COLOR_ANIMATING};`);
    } else {
      this._animatingState = null;
      if (this._animationTimeoutId !== 0) {
        GLib.source_remove(this._animationTimeoutId);
        this._animationTimeoutId = 0;
      }
      if (connected) {
        this._stateIcon.gicon = this._loadIcon('bbm-bluetooth-connected-symbolic');
        this._stateIcon.set_style(`color: ${COLOR_CONNECTED};`);
      } else {
        this._stateIcon.gicon = this._loadIcon('bbm-bluetooth-symbolic');
        this._stateIcon.set_style(`color: ${COLOR_DISCONNECTED};`);
      }
    }
  }

  private _updateBatteryLabel(): void {
    if (!this._batteryLabel) return;
    const connected: boolean = this._item._device.connected;
    const pct: number = this._item._device.battery_percentage;
    // Filter out 0% which is often a placeholder during initial connection
    if (connected && pct > 0) {
      this._batteryLabel.text = `${Math.round(pct)}%`;
      this._batteryLabel.show();
    } else {
      this._batteryLabel.hide();
    }
  }

  restore(): void {
    if (this._spinnerNotifyId) {
      this._item._spinner?.disconnect(this._spinnerNotifyId);
      this._spinnerNotifyId = 0;
    }
    if (this._batteryNotifyId) {
      this._item._device?.disconnect(this._batteryNotifyId);
      this._batteryNotifyId = 0;
    }
    if (this._connectedNotifyId) {
      this._item._device?.disconnect(this._connectedNotifyId);
      this._connectedNotifyId = 0;
    }

    if (this._pendingUpdateId !== 0) {
      GLib.source_remove(this._pendingUpdateId);
      this._pendingUpdateId = 0;
    }

    if (this._animationTimeoutId !== 0) {
      GLib.source_remove(this._animationTimeoutId);
      this._animationTimeoutId = 0;
    }

    this._stateIcon?.destroy();
    this._stateIcon = null;

    this._batteryLabel?.destroy();
    this._batteryLabel = null;

    // Re-insert removed children at their original positions.
    // Original layout: [ornament] [icon] [label] [subtitle] [spinner]
    if (this._item._icon) {
      this._item.insert_child_at(this._item._icon, 1);
    }
    if (this._item._subtitle) {
      this._item.insert_child_at(this._item._subtitle, 3);
    }
    if (this._item._spinner) {
      this._item.insert_child_at(this._item._spinner, 4);
      this._item._spinner.opacity = 255;
      this._item._spinner.set_scale(1, 1);
    }

    // Remove per-instance activate override so prototype method is restored.
    delete this._item.activate;
    delete this._item.__auroraBtPatched;
  }
}
