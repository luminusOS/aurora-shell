import Clutter from '@girs/clutter-18';
import GLib from '@girs/glib-2.0';
import GObject from '@girs/gobject-2.0';
import St from '@girs/st-18';

const SHOW_DELAY_MS = 300;

export const CaptureTooltip = GObject.registerClass(
  class CaptureTooltip extends St.Label {
    private _anchor: St.Widget | null = null;
    private _hoverId = 0;
    private _timeoutId = 0;

    override _init(): void {
      super._init({
        style_class: 'screenshot-ui-tooltip capture-tools-ocr-tooltip',
        visible: false,
      });
    }

    configure(anchor: St.Widget, text: string): void {
      this._anchor = anchor;
      this.text = text;
      this._hoverId = anchor.connect('notify::hover', () => {
        if (anchor.hover) this.open();
        else this.close();
      });
    }

    open(): void {
      if (this._timeoutId !== 0 || !this._anchor) return;
      this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SHOW_DELAY_MS, () => {
        this._timeoutId = 0;
        const anchor = this._anchor;
        if (!anchor?.hover) return GLib.SOURCE_REMOVE;

        this.opacity = 0;
        this.show();
        const extents = anchor.get_transformed_extents();
        const xOffset = Math.floor((extents.get_width() - this.width) / 2);
        const x = Math.max(0, Math.min(extents.get_x() + xOffset, global.stage.width - this.width));
        const yOffset = this.get_theme_node().get_length('-y-offset');
        this.set_position(x, extents.get_y() - this.height - yOffset);
        this.ease({
          opacity: 255,
          duration: 150,
          mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        return GLib.SOURCE_REMOVE;
      });
    }

    close(): void {
      if (this._timeoutId !== 0) {
        GLib.source_remove(this._timeoutId);
        this._timeoutId = 0;
      }
      if (!this.visible) return;
      this.remove_all_transitions();
      this.ease({
        opacity: 0,
        duration: 100,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onComplete: () => this.hide(),
      });
    }

    override destroy(): void {
      if (this._timeoutId !== 0) GLib.source_remove(this._timeoutId);
      this._timeoutId = 0;
      if (this._anchor && this._hoverId !== 0) this._anchor.disconnect(this._hoverId);
      this._hoverId = 0;
      this._anchor = null;
      super.destroy();
    }
  },
);
