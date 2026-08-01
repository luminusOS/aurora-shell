import '@girs/gjs';

import GObject from '@girs/gobject-2.0';
import Gvc from 'gi://Gvc';
import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';

import { QuickSlider } from '@girs/gnome-shell/ui/quickSettings';
import type { ExtensionContext } from '~/core/context.ts';
import { LifecycleScope, type ManagedSource } from '~/core/lifecycleScope.ts';
import { createManagedSource } from '~/core/mainLoop.ts';

const ALLOW_AMPLIFIED_VOLUME_KEY = 'allow-volume-above-100-percent';

/**
 * Individual volume slider for a single audio stream.
 * Extends GNOME Shell's QuickSlider to show per-app volume control
 * with mute toggle on icon click and amplified volume support.
 */
@GObject.registerClass({
  Signals: {
    'stream-updated': {},
  },
})
export class ApplicationStreamSlider extends QuickSlider {
  declare private _control: Gvc.MixerControl;
  declare private _lifecycle: LifecycleScope;
  declare private _notifyVolumeChange: ManagedSource;
  declare private _volumeCancellable: Gio.Cancellable | null;
  declare private _showIcon: boolean;
  declare private _soundSettings: Gio.Settings;
  declare private _stream: Gvc.MixerStream | null;
  declare private _inDrag: boolean;
  declare private _sliderChangedId: number;
  declare private _allowAmplified: boolean;

  override _init(
    context?: ExtensionContext | Partial<QuickSlider.ConstructorProps>,
    control?: Gvc.MixerControl,
    stream?: Gvc.MixerStream,
    showIcon?: boolean,
  ): void {
    this._control = control!;
    this._volumeCancellable = null;
    this._showIcon = showIcon ?? false;
    super._init();
    this._lifecycle = new LifecycleScope();
    this._notifyVolumeChange = createManagedSource(this._lifecycle);
    this._lifecycle.onDispose(() => this._volumeCancellable?.cancel());

    this._soundSettings = (context as ExtensionContext).settings
      .getSchema('org.gnome.desktop.sound')
      .getRawSettings();
    this._soundSettings.connectObject(
      `changed::${ALLOW_AMPLIFIED_VOLUME_KEY}`,
      () => this._updateAllowAmplified(),
      this,
    );
    this._updateAllowAmplified();

    this.iconReactive = true;
    this._lifecycle.connect(this, 'icon-clicked', () => {
      if (!this._stream) return;
      this._stream.change_is_muted(!this._stream.is_muted);
    });

    this._inDrag = false;
    this._sliderChangedId = this._lifecycle.connect(this.slider, 'notify::value', () =>
      this._sliderChanged(),
    );
    this._lifecycle.connect(this.slider, 'drag-begin', () => {
      this._inDrag = true;
    });
    this._lifecycle.connect(this.slider, 'drag-end', () => {
      this._inDrag = false;
    });

    if (stream) {
      this.stream = stream;
    } else {
      this._stream = null;
    }
  }

  get stream(): Gvc.MixerStream | null {
    return this._stream;
  }

  set stream(stream: Gvc.MixerStream) {
    if (this._stream === stream) return;

    this._stream?.disconnectObject(this);
    this._stream = stream;

    if (stream) {
      stream.connectObject(
        'notify::is-muted',
        () => this._updateSlider(),
        'notify::volume',
        () => this._updateSlider(),
        this,
      );
      this._updateSlider();
    } else {
      this.emit('stream-updated');
    }

    this._sync();
  }

  _sync(): void {
    this.visible = this._stream != null;
    this.menuEnabled = false;

    if (this._showIcon && this._stream) {
      this._updateVolumeIcon();
    }
  }

  private _updateVolumeIcon(): void {
    if (!this._stream) return;

    let iconName: string;
    if (this._stream.is_muted || this._stream.volume === 0) {
      iconName = 'audio-volume-muted-symbolic';
    } else {
      const norm = this._control.get_vol_max_norm();
      const ratio = this._stream.volume / norm;
      if (ratio < 0.33) {
        iconName = 'audio-volume-low-symbolic';
      } else if (ratio < 0.66) {
        iconName = 'audio-volume-medium-symbolic';
      } else {
        iconName = 'audio-volume-high-symbolic';
      }
    }
    this.iconName = iconName;
  }

  private _feedbackVolumeChange(): void {
    if (this._volumeCancellable) this._volumeCancellable.cancel();
    this._volumeCancellable = null;

    if (this._stream!.state === Gvc.MixerStreamState.RUNNING) return;

    this._volumeCancellable = new Gio.Cancellable();
    global.display
      .get_sound_player()
      .play_from_theme('audio-volume-change', _('Volume changed'), this._volumeCancellable);
  }

  private _updateSlider(): void {
    this.slider.block_signal_handler(this._sliderChangedId);
    this.slider.value = this._stream!.is_muted
      ? 0
      : this._stream!.volume / this._control.get_vol_max_norm();
    this.slider.unblock_signal_handler(this._sliderChangedId);
    if (this._showIcon) this._updateVolumeIcon();
    this.emit('stream-updated');
  }

  private _sliderChanged(): void {
    if (!this._stream) return;

    const volume = this.slider.value * this._control.get_vol_max_norm();
    const prevMuted = this._stream.is_muted;
    const prevVolume = this._stream.volume;
    const volumeChanged = this._stream.volume !== prevVolume;
    if (volume < 1) {
      this._stream.volume = 0;
      if (!prevMuted) this._stream.change_is_muted(true);
    } else {
      this._stream.volume = volume;
      if (prevMuted) this._stream.change_is_muted(false);
    }
    this._stream.push_volume();

    if (volumeChanged && !this._notifyVolumeChange.active && !this._inDrag) {
      this._notifyVolumeChange.replace(() =>
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => {
          this._feedbackVolumeChange();
          this._notifyVolumeChange.complete();
          return GLib.SOURCE_REMOVE;
        }),
      );
    }
  }

  private _updateAllowAmplified(): void {
    this._allowAmplified = this._soundSettings.get_boolean(ALLOW_AMPLIFIED_VOLUME_KEY);
    const maxLevel = this._allowAmplified
      ? this._control.get_vol_max_amplified() / this._control.get_vol_max_norm()
      : 1;
    this.slider.maximumValue = maxLevel;
    if (this._stream) this._updateSlider();
  }

  override destroy(): void {
    this._lifecycle.dispose();
    if (this._volumeCancellable) {
      this._volumeCancellable.cancel();
      this._volumeCancellable = null;
    }
    this._soundSettings.disconnectObject(this);
    this._stream?.disconnectObject(this);
    super.destroy();
  }

  override vfunc_get_preferred_height(forWidth: number): [number, number] {
    return super.vfunc_get_preferred_height(forWidth).map(Math.floor) as [number, number];
  }
}
