// @ts-nocheck
import '@girs/gjs';

import St from '@girs/st-17';
import GObject from '@girs/gobject-2.0';
import Clutter from '@girs/clutter-17';

import type { ExtensionContext } from '~/core/context.ts';
import { VolumeMixerList } from '~/modules/volumeMixer/mixerList.ts';

export const MAX_MIXER_HEIGHT = 300;

/**
 * Scrollable panel containing the list of per-application volume mixers.
 * Hides itself automatically when there are no active audio streams.
 */
@GObject.registerClass
export class VolumeMixerPanel extends St.BoxLayout {
  _init(context: ExtensionContext): void {
    super._init({
      orientation: Clutter.Orientation.VERTICAL,
      style_class: 'aurora-volume-mixer',
      style: `max-height: ${MAX_MIXER_HEIGHT}px;`,
    });

    this._emptyLabel = new St.Label({
      text: _('No audio playing'),
      style_class: 'aurora-volume-mixer-empty',
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
      x_expand: true,
      y_expand: true,
    });
    this.add_child(this._emptyLabel);

    const sections = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      x_expand: true,
      y_expand: true,
    });

    const scroll = new St.ScrollView({
      x_expand: true,
      y_expand: true,
      child: sections,
    });

    this._list = new VolumeMixerList(context);
    sections.add_child(this._list);
    this._scroll = scroll;
    this.add_child(scroll);

    this._list.connectObject('notify::should-show', () => this._sync(), this);
    this._sync();
  }

  private _sync(): void {
    const hasStreams = this._list.shouldShow;
    this._scroll.visible = hasStreams;
    this._emptyLabel.visible = !hasStreams;
  }

  vfunc_get_preferred_height(forWidth: number): [number, number] {
    if (!this.get_stage()) return [0, 0];

    if (!this._list.shouldShow) {
      return this._emptyLabel.get_preferred_height(forWidth) as [number, number];
    }

    const contentHeight = this._list.get_preferred_height(forWidth);
    return [
      Math.min(MAX_MIXER_HEIGHT, contentHeight[0]),
      Math.min(MAX_MIXER_HEIGHT, contentHeight[1]),
    ];
  }
}
