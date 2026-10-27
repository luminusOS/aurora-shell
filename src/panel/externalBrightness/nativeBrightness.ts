import * as Main from '@girs/gnome-shell/ui/main';
import type { QuickSlider } from '@girs/gnome-shell/ui/quickSettings';
import { PopupBaseMenuItem } from '@girs/gnome-shell/ui/popupMenu';
import { LifecycleScope } from '~/core/lifecycleScope.ts';
import { shiftBrightness } from './brightnessLevels.ts';
import { DisplayBrightnessSlider } from './brightnessSliders.ts';

type NativeControl = {
  scale: Main.NativeBrightnessScale;
  slider: DisplayBrightnessSlider;
  menuItem: PopupBaseMenuItem;
  lifecycle: LifecycleScope;
};

export type MonitorLevel = {
  monitorIndex: number;
  level: number;
};

export class NativeBrightnessControls {
  private _lifecycle = new LifecycleScope();
  private _controls: NativeControl[] = [];
  private _restoreVisibility: boolean | null = null;

  constructor(
    private readonly _master: DisplayBrightnessSlider,
    private readonly _nativeSlider: QuickSlider,
    private readonly _onChanged: () => void,
  ) {
    this._lifecycle.connect(Main.brightnessManager, 'changed', () => this._syncControls());
    this._syncControls();
  }

  get levels(): number[] {
    return this._controls.map((control) => control.slider.slider.value);
  }

  get monitorLevels(): MonitorLevel[] {
    return this._controls.map(({ scale }) => ({
      monitorIndex: scale.monitor.get_number(),
      level: scale.value,
    }));
  }

  setCombined(active: boolean): void {
    if (active) {
      if (this._restoreVisibility === null) this._restoreVisibility = this._nativeSlider.visible;
      this._nativeSlider.menu.close();
      this._nativeSlider.hide();
    } else if (this._restoreVisibility !== null) {
      this._nativeSlider.visible = this._restoreVisibility;
      this._restoreVisibility = null;
    }
  }

  applyMaster(from: number, to: number): void {
    for (const control of this._controls)
      control.scale.value = shiftBrightness(control.slider.slider.value, from, to);
  }

  private _syncControls(): void {
    // GNOME's earlier `changed` handler has already applied the new native visibility.
    if (this._restoreVisibility !== null) {
      this._restoreVisibility = this._nativeSlider.visible;
      this._nativeSlider.hide();
    }

    // GNOME creates new scale objects on every `changed`, so no existing control can be kept.
    this._clearControls();
    for (const [position, scale] of Main.brightnessManager.scales.entries())
      this._addControl(scale, position);

    this._onChanged();
  }

  private _addControl(scale: Main.NativeBrightnessScale, position: number): void {
    const lifecycle = new LifecycleScope();
    const slider = new DisplayBrightnessSlider();
    slider.x_expand = true;
    slider.setDisplayName(scale.name);
    slider.showBrightness(scale.value);
    const menuItem = new PopupBaseMenuItem({ reactive: false, can_focus: false });
    menuItem.add_child(slider);
    this._master.menu.addMenuItem(menuItem, position);
    this._controls.push({ scale, slider, menuItem, lifecycle });

    lifecycle.connect(slider, 'brightness-requested', (_slider, value: number) => {
      scale.value = value;
      this._onChanged();
    });
    lifecycle.connect(slider, 'brightness-shown', () => this._onChanged());
    lifecycle.connect(scale, 'notify::value', () => slider.showBrightness(scale.value));
  }

  private _clearControls(): void {
    for (const control of this._controls) {
      control.lifecycle.dispose();
      control.slider.destroy();
      control.menuItem.destroy();
    }
    this._controls = [];
  }

  destroy(): void {
    this._lifecycle.dispose();
    if (this._restoreVisibility !== null) this._nativeSlider.visible = this._restoreVisibility;
    this._restoreVisibility = null;
    this._clearControls();
  }
}
