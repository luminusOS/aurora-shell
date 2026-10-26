import '@girs/gjs';
import { gettext as _ } from '~/shared/i18n.ts';

import Clutter from '@girs/clutter-18';
import GObject from '@girs/gobject-2.0';
import St from '@girs/st-18';

import { QuickSlider } from '@girs/gnome-shell/ui/quickSettings';

import { LifecycleScope } from '~/core/lifecycleScope.ts';

type DeferredBrightness = {
  value: number;
  sliderValueWhenReceived: number;
};

/**
 * Quick Settings slider for one external display, labelled with the display's name.
 *
 * Emits `brightness-requested` with the slider position (0–1) when the user moves it. Brightness
 * read from the display goes through `showBrightness()` and never emits the signal.
 */
export const DisplayBrightnessSlider = GObject.registerClass(
  {
    Signals: {
      'brightness-requested': { param_types: [GObject.TYPE_DOUBLE] },
      'brightness-shown': {},
    },
  },
  class DisplayBrightnessSlider extends QuickSlider {
    declare private _lifecycle: LifecycleScope;
    declare private _label: St.Label;
    declare private _sliderChangedId: number;
    declare private _dragging: boolean;
    declare private _deferredBrightness: DeferredBrightness | null;

    override _init(): void {
      super._init({ iconName: 'display-brightness-symbolic' });

      this._lifecycle = new LifecycleScope();
      this._dragging = false;
      this._deferredBrightness = null;

      // QuickSlider is a single icon/slider row with no text, which cannot tell two external
      // displays apart, so the row is placed under a label with the display's name.
      const sliderRow = this.get_child()!;
      this.set_child(null);

      const content = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
      });
      this._label = new St.Label({
        style_class: 'aurora-external-brightness-label',
        x_align: Clutter.ActorAlign.START,
      });
      content.add_child(this._label);
      content.add_child(sliderRow);
      this.set_child(content);

      this._sliderChangedId = this._lifecycle.connect(this.slider, 'notify::value', () =>
        this.emit('brightness-requested', this.slider.value),
      );
      this._lifecycle.connect(this.slider, 'drag-begin', () => {
        this._dragging = true;
      });
      this._lifecycle.connect(this.slider, 'drag-end', () => this._handleDragEnd());
    }

    setDisplayName(name: string): void {
      this._label.text = name;
      this.slider.accessible_name = _('Brightness of %s').format(name);
    }

    configureMaster(): void {
      this._label.hide();
      this.add_style_class_name('aurora-external-brightness-master');
      this.slider.accessible_name = _('Brightness');
      this.set_property('menu-button-accessible-name', _('Open brightness menu'));
      this.menuEnabled = true;
      this.menu.setHeader('display-brightness-symbolic', _('Brightness'));
    }

    /** Shows brightness read from the display without emitting `brightness-requested`. */
    showBrightness(value: number): void {
      if (this._dragging) {
        this._deferredBrightness = { value, sliderValueWhenReceived: this.slider.value };
        return;
      }

      this._deferredBrightness = null;
      this.slider.block_signal_handler(this._sliderChangedId);
      this.slider.value = value;
      this.slider.unblock_signal_handler(this._sliderChangedId);
      this.emit('brightness-shown');
    }

    private _handleDragEnd(): void {
      this._dragging = false;

      // A change that arrived mid-drag is shown only if the user did not move the slider after it;
      // otherwise the user's own position, already requested, is the newer value.
      const deferred = this._deferredBrightness;
      this._deferredBrightness = null;
      if (deferred && this.slider.value === deferred.sliderValueWhenReceived)
        this.showBrightness(deferred.value);
    }

    override destroy(): void {
      this._lifecycle.dispose();
      // QuickSettingsMenu adds every item's menu actor to its overlay, and QuickSettingsItem does
      // not destroy that menu with the item.
      this.menu.destroy();
      super.destroy();
    }
  },
);

export type DisplayBrightnessSlider = InstanceType<typeof DisplayBrightnessSlider>;
