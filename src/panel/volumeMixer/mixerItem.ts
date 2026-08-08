import '@girs/gjs';

import St from '@girs/st-18';
import GObject from '@girs/gobject-2.0';
import type Gvc from 'gi://Gvc';
import Clutter from '@girs/clutter-18';

import { ApplicationStreamSlider } from '~/panel/volumeMixer/streamSlider.ts';
import type { ExtensionContext } from '~/core/context.ts';

export const VolumeMixerItem = GObject.registerClass(
  class VolumeMixerItem extends St.BoxLayout {
    declare private _stream: Gvc.MixerStream;
    declare private _icon: St.Icon;
    declare private _label: St.Label;
    declare private _slider: ApplicationStreamSlider;
    declare private _baseLabel: string;
    declare private _identityKey: string;
    declare private _duplicateIndex: number;
    declare private _duplicateCount: number;

    override _init(
      context?: ExtensionContext | Partial<St.BoxLayout.ConstructorProps>,
      control?: Gvc.MixerControl,
      stream?: Gvc.MixerStream,
      showIcon?: boolean,
    ): void {
      super._init({
        orientation: Clutter.Orientation.VERTICAL,
        style_class: 'aurora-volume-mixer-item',
      });

      this._stream = stream!;
      this._baseLabel = '';
      this._identityKey = '';
      this._duplicateIndex = 0;
      this._duplicateCount = 1;

      const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        style_class: 'aurora-volume-mixer-header',
        x_expand: true,
      });

      this._icon = new St.Icon({
        style_class: 'aurora-volume-mixer-app-icon',
        icon_size: 16,
      });

      this._label = new St.Label({
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style_class: 'aurora-volume-mixer-label',
      });

      headerBox.add_child(this._icon);
      headerBox.add_child(this._label);
      this.add_child(headerBox);

      this._slider = new ApplicationStreamSlider(
        context as ExtensionContext,
        control!,
        stream!,
        showIcon,
      );
      this.add_child(this._slider);

      this._updateHeader();
    }

    get identityKey(): string {
      return this._identityKey;
    }

    setDuplicatePosition(index: number, count: number): void {
      this._duplicateIndex = index;
      this._duplicateCount = count;
      this._renderLabel();
    }

    private _renderLabel(): void {
      this._label.text =
        this._duplicateCount > 1
          ? `${this._baseLabel} · ${_('Audio')} ${this._duplicateIndex}`
          : this._baseLabel;
      this._label.show();
    }

    private _updateHeader(): void {
      const streamName = this._stream.get_name();
      const description = this._stream.get_description();
      const gicon = this._stream.get_gicon();

      if (gicon) {
        this._icon.gicon = gicon;
        this._icon.show();
      } else {
        this._icon.hide();
      }

      if (streamName && description && description !== streamName) {
        this._baseLabel = `${streamName} — ${description}`;
      } else if (streamName) {
        this._baseLabel = streamName;
      } else if (description) {
        this._baseLabel = description;
      } else {
        this._baseLabel = _('Unknown');
      }
      this._identityKey = this._baseLabel;
      this._renderLabel();
    }

    syncStream(): void {
      this._updateHeader();
      this._slider._sync();
    }
  },
);

export type VolumeMixerItem = InstanceType<typeof VolumeMixerItem>;
