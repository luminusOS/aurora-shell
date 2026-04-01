// @ts-nocheck
import '@girs/gjs';

import St from '@girs/st-17';
import GObject from '@girs/gobject-2.0';
import Gvc from 'gi://Gvc';
import Clutter from '@girs/clutter-17';

import * as Volume from '@girs/gnome-shell/ui/status/volume';

import { VolumeMixerItem } from '~/modules/volumeMixer/mixerItem.ts';
import type { ExtensionContext } from "~/core/context.ts";

/**
 * Container that manages all per-application stream sliders.
 * Listens to {@link Gvc.MixerControl} signals to dynamically add/remove streams.
 * Only {@link Gvc.MixerSinkInput} streams (application audio outputs) are shown.
 */
@GObject.registerClass({
  Properties: {
    'should-show': GObject.ParamSpec.boolean(
      'should-show',
      null,
      null,
      GObject.ParamFlags.READWRITE,
      false,
    ),
  },
})
export class VolumeMixerList extends St.BoxLayout {
  declare should_show: boolean;
  declare shouldShow: boolean;

  _init(context: ExtensionContext): void {
    super._init({
      orientation: Clutter.Orientation.VERTICAL,
      style_class: 'aurora-volume-mixer-list',
      clip_to_allocation: true,
      x_expand: true,
    });

    this._context = context;
    this._sliders = new Map();
    this._control = Volume.getMixerControl();

    this._control.connectObject(
      'stream-added',
      (_ctrl: Gvc.MixerControl, id: number) => this._streamAdded(id),
      'stream-removed',
      (_ctrl: Gvc.MixerControl, id: number) => this._streamRemoved(id),
      'stream-changed',
      (_ctrl: Gvc.MixerControl, id: number) => this._streamChanged(id),
      this,
    );

    for (const stream of this._control.get_streams()) {
      this._streamAdded(stream.get_id());
    }

    this.connect('destroy', () => {
      this._control.disconnectObject(this);
      for (const slider of this._sliders.values()) {
        slider.destroy();
      }
      this._sliders.clear();
    });
  }

  private _streamAdded(id: number): void {
    if (this._sliders.has(id)) return;

    const stream = this._control.lookup_stream_id(id);
    if (!stream) return;
    if (stream.is_event_stream || !(stream instanceof Gvc.MixerSinkInput))
      return;

    const item = new VolumeMixerItem(this._context, this._control, stream, true);
    this._sliders.set(id, item);
    this.add_child(item);
    this._sync();
  }

  private _streamChanged(id: number): void {
    const slider = this._sliders.get(id);
    if (!slider) return;
    slider.syncStream();
  }

  private _streamRemoved(id: number): void {
    const slider = this._sliders.get(id);
    if (!slider) return;
    slider.destroy();
    this._sliders.delete(id);
    this._sync();
  }

  private _sync(): void {
    if (!this._sliders.size) {
      this.shouldShow = false;
      return;
    }
    for (const slider of this._sliders.values()) {
      if (slider.visible) {
        this.shouldShow = true;
        return;
      }
    }
    this.shouldShow = false;
  }
}
