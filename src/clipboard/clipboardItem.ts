import '@girs/gjs';

import St from '@girs/st-18';
import GObject from '@girs/gobject-2.0';
import Clutter from '@girs/clutter-18';

import type { ClipboardEntry } from '~/clipboard/clipboardStore.ts';

const MAX_LABEL_CHARS = 80;

@GObject.registerClass
export class ClipboardItem extends St.Button {
  declare private _entry: ClipboardEntry;
  declare private _label: St.Label;
  declare private _pinIcon: St.Icon;

  override _init(entry: ClipboardEntry): void {
    super._init({
      style_class: 'aurora-clipboard-item',
      can_focus: true,
      x_expand: true,
      reactive: true,
      x_align: Clutter.ActorAlign.FILL,
    });

    this._entry = entry;

    const box = new St.BoxLayout({
      orientation: Clutter.Orientation.HORIZONTAL,
      x_expand: true,
    });

    this._label = new St.Label({
      text: _truncate(entry.text, MAX_LABEL_CHARS),
      style_class: 'aurora-clipboard-item-label',
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._label.clutter_text.ellipsize = 3; // Pango.EllipsizeMode.END

    this._pinIcon = new St.Icon({
      icon_name: 'view-pin-symbolic',
      icon_size: 14,
      style_class: 'aurora-clipboard-pin-icon',
      visible: entry.pinned,
      y_align: Clutter.ActorAlign.CENTER,
    });

    box.add_child(this._label);
    box.add_child(this._pinIcon);
    this.set_child(box);
  }

  get entry(): ClipboardEntry {
    return this._entry;
  }
}

function _truncate(text: string, maxChars: number): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length > maxChars ? single.slice(0, maxChars) + '…' : single;
}
