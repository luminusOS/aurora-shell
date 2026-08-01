import '@girs/gjs';

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import St from '@girs/st-18';
import Clutter from '@girs/clutter-18';

import { LifecycleScope, type ManagedSource } from '~/core/lifecycleScope.ts';
import { logger } from '~/core/logger.ts';
import { createManagedSource } from '~/core/mainLoop.ts';
import { createIcon, loadIcon } from '~/shared/icons.ts';

const LOG_PREFIX = 'BluetoothMenu';

type DisableOptions = {
  restoreOriginalChildren?: boolean;
};

type StateIconStatus = 'animating' | 'connected' | 'disconnected';

export class BluetoothDeviceItemPatcher {
  private _item: any;
  private _stateIcon: St.Icon | null = null;
  private _batteryLabel: St.Label | null = null;
  private _lifecycle: LifecycleScope | null = null;
  private _pendingUpdate: ManagedSource | null = null;
  private _animationTimeout: ManagedSource | null = null;
  private _animationFrame = 1;
  private _animatingState: 'connecting' | 'disconnecting' | null = null;

  constructor(item: any) {
    this._item = item;
  }

  enable(): void {
    this._lifecycle = new LifecycleScope();
    this._pendingUpdate = createManagedSource(this._lifecycle);
    this._animationTimeout = createManagedSource(this._lifecycle);
    const item = this._item;

    // Override activate so clicking a device doesn't close the menu.
    // The parent PopupMenuBase listens to 'activate' and calls menu.close();
    // calling _toggleConnected() directly bypasses that signal path.
    item.activate = (_event: any) => {
      item
        ._toggleConnected()
        .catch((e: Error) => logger.error(`toggleConnected failed: ${e}`, { prefix: LOG_PREFIX }));
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

    this._stateIcon = createIcon('bbm-bluetooth-symbolic', {
      icon_size: 16,
      style_class: 'popup-menu-icon aurora-bt-state-icon',
      y_align: Clutter.ActorAlign.CENTER,
      x_expand: false,
    });

    // _label already has x_expand: true — append after it so layout is:
    // [ornament] [_label(expand)] [battery] [stateIcon]
    item.add_child(this._batteryLabel);
    item.add_child(this._stateIcon);

    this._updateStateIcon();
    this._updateBatteryLabel();

    this._lifecycle.connect(item._spinner, 'notify::visible', () => {
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

    this._lifecycle.connect(item._device, 'notify::battery-percentage', () => {
      this._updateBatteryLabel();
    });

    this._lifecycle.connect(item._device, 'notify::connected', () => {
      this._updateBatteryLabel();
      this._updateStateIcon();
    });
  }

  private _scheduleUpdate(): void {
    const pendingUpdate = this._pendingUpdate;
    if (!pendingUpdate) return;

    pendingUpdate.replace(() =>
      GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        pendingUpdate.complete();
        if (!this._stateIcon || !this._batteryLabel) return GLib.SOURCE_REMOVE;

        this._updateStateIcon();
        this._updateBatteryLabel();
        return GLib.SOURCE_REMOVE;
      }),
    );
  }

  private _loadIcon(name: string): Gio.Icon {
    try {
      return loadIcon(name);
    } catch (_e) {
      return Gio.Icon.new_for_string('image-missing-symbolic');
    }
  }

  private _updateStateIcon(): void {
    if (!this._stateIcon) return;

    const connected: boolean = this._item._device.connected;
    const isWorking: boolean = this._item._spinner.visible;
    const animationTimeout = this._animationTimeout;
    if (!animationTimeout) return;

    if (isWorking) {
      if (!animationTimeout.active) {
        this._animationFrame = 1;
        // Latch the state when animation starts: if not connected, we are connecting.
        this._animatingState = connected ? 'disconnecting' : 'connecting';

        animationTimeout.replace(() =>
          GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            if (!this._stateIcon) {
              animationTimeout.complete();
              return GLib.SOURCE_REMOVE;
            }

            this._animationFrame = (this._animationFrame % 4) + 1;
            this._stateIcon.gicon = this._loadIcon(
              `bbm-bluetooth-${this._animatingState}-${this._animationFrame}-symbolic`,
            );
            this._setStateIconStatus('animating');
            return GLib.SOURCE_CONTINUE;
          }),
        );
      }
      const state = this._animatingState || (connected ? 'disconnecting' : 'connecting');
      this._stateIcon.gicon = this._loadIcon(
        `bbm-bluetooth-${state}-${this._animationFrame}-symbolic`,
      );
      this._setStateIconStatus('animating');
    } else {
      this._animatingState = null;
      animationTimeout.clear();
      if (connected) {
        this._stateIcon.gicon = this._loadIcon('bbm-bluetooth-connected-symbolic');
        this._setStateIconStatus('connected');
      } else {
        this._stateIcon.gicon = this._loadIcon('bbm-bluetooth-symbolic');
        this._setStateIconStatus('disconnected');
      }
    }
  }

  private _setStateIconStatus(status: StateIconStatus): void {
    if (!this._stateIcon) return;

    this._stateIcon.remove_style_class_name('aurora-bt-state-animating');
    this._stateIcon.remove_style_class_name('aurora-bt-state-connected');
    this._stateIcon.remove_style_class_name('aurora-bt-state-disconnected');
    this._stateIcon.add_style_class_name(`aurora-bt-state-${status}`);
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

  disable(options: DisableOptions = {}): void {
    const restoreOriginalChildren = options.restoreOriginalChildren ?? true;

    this._lifecycle?.dispose();
    this._lifecycle = null;
    this._pendingUpdate = null;
    this._animationTimeout = null;

    if (restoreOriginalChildren) this._stateIcon?.destroy();
    this._stateIcon = null;

    if (restoreOriginalChildren) this._batteryLabel?.destroy();
    this._batteryLabel = null;

    if (!restoreOriginalChildren) {
      delete this._item.activate;
      delete this._item.__auroraBtPatched;
      return;
    }

    // Re-insert removed children at their original positions.
    // Original layout: [ornament] [icon] [label] [subtitle] [spinner]
    if (this._item._icon) {
      this._restoreChild(this._item._icon, 1);
    }
    if (this._item._subtitle) {
      this._restoreChild(this._item._subtitle, 3);
    }
    if (this._item._spinner) {
      this._restoreChild(this._item._spinner, 4);
      this._item._spinner.opacity = 255;
      this._item._spinner.set_scale(1, 1);
    }

    // Remove per-instance activate override so prototype method is restored.
    delete this._item.activate;
    delete this._item.__auroraBtPatched;
  }

  private _restoreChild(child: Clutter.Actor, index: number): void {
    if (child.get_parent() !== this._item) {
      this._item.insert_child_at_index(child, index);
    }
  }
}
