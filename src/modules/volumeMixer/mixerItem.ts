// @ts-nocheck
import '@girs/gjs';

import St from '@girs/st-17';
import GObject from '@girs/gobject-2.0';
import Shell from '@girs/shell-17';
import type Gvc from 'gi://Gvc';
import Clutter from '@girs/clutter-17';

import { ApplicationStreamSlider } from '~/modules/volumeMixer/streamSlider.ts';
import type { ExtensionContext } from "~/core/context.ts";

/**
 * A single item in the volume mixer list.
 * Wraps an {@link ApplicationStreamSlider} with the application icon
 * and a label showing the application name and current media title.
 */
@GObject.registerClass
export class VolumeMixerItem extends St.BoxLayout {
  _init(
    context: ExtensionContext,
    control: Gvc.MixerControl,
    stream: Gvc.MixerStream,
    showIcon: boolean,
  ): void {
    super._init({
      orientation: Clutter.Orientation.VERTICAL,
      style_class: 'aurora-volume-mixer-item',
    });
    this._stream = stream;

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

    this._slider = new ApplicationStreamSlider(context, control, stream, showIcon);
    this.add_child(this._slider);

    this._updateHeader();
  }

  private _lookupApp(): typeof Shell.App.prototype | null {
    const appSystem = Shell.AppSystem.get_default();

    const appId = this._stream.get_application_id();
    if (appId) {
      const app =
        appSystem.lookup_app(`${appId}.desktop`) ||
        appSystem.lookup_app(appId);
      if (app) return app;
    }

    const iconName = this._stream.get_icon_name();
    if (iconName) {
      const app =
        appSystem.lookup_app(`${iconName}.desktop`) ||
        appSystem.lookup_app(iconName);
      if (app) return app;
    }

    const name = this._stream.get_name();
    if (name) {
      const app =
        appSystem.lookup_desktop_wmclass(name) ||
        appSystem.lookup_startup_wmclass(name);
      if (app) return app;
    }

    const lowerAppId = appId?.toLowerCase();
    const lowerName = name?.toLowerCase();
    const lowerIcon = iconName?.toLowerCase();
    for (const app of appSystem.get_running()) {
      const id = app.get_id()?.toLowerCase();
      if (!id) continue;
      if (
        (lowerAppId && id.includes(lowerAppId)) ||
        (lowerName && id.includes(lowerName)) ||
        (lowerIcon && id.includes(lowerIcon))
      ) {
        return app;
      }
    }

    return null;
  }

  private _updateHeader(): void {
    const app = this._lookupApp();
    const streamName = this._stream.get_name();
    const description = this._stream.get_description();

    if (app) {
      this._icon.gicon = app.get_icon();
      this._icon.show();
    } else if (this._stream.get_icon_name()) {
      this._icon.icon_name = this._stream.get_icon_name();
      this._icon.show();
    } else {
      this._icon.hide();
    }

    const appName = app ? app.get_name() : streamName;
    if (appName && description && description !== appName) {
      this._label.text = `${appName} — ${description}`;
    } else if (appName) {
      this._label.text = appName;
    } else if (description) {
      this._label.text = description;
    } else {
      this._label.text = _('Unknown');
    }

    this._label.show();
  }

  syncStream(): void {
    this._updateHeader();
    this._slider._sync();
  }
}
