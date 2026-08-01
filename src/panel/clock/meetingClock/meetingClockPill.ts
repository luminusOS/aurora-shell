import Clutter from '@girs/clutter-18';
import GLib from '@girs/glib-2.0';
import St from '@girs/st-18';

import type { LifecycleScope, ManagedSource } from '~/core/lifecycleScope.ts';
import { createManagedSource } from '~/core/mainLoop.ts';
import {
  openClockMenu,
  registerClockPillWidget,
  type ClockPillRegistration,
} from '~/shared/clockPill.ts';

const CLOCK_PILL_ID = 'meeting-clock';
const VISIBLE_SECONDS = 8;
const ANIMATION_MS = 260;
const OFFSET = 18;

export class MeetingClockPill {
  private _widget: St.BoxLayout;
  private _label: St.Label;
  private _registration: ClockPillRegistration | null;
  private _hideTimer: ManagedSource;
  private _eventId = '';

  constructor(lifecycle: LifecycleScope) {
    this._hideTimer = createManagedSource(lifecycle);
    this._widget = new St.BoxLayout({
      style_class: 'aurora-meeting-clock-widget',
      y_align: Clutter.ActorAlign.CENTER,
      y_expand: true,
      visible: false,
      opacity: 0,
      reactive: false,
    });
    this._label = new St.Label({
      style_class: 'clock-label aurora-meeting-clock-label',
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._widget.add_child(this._label);
    this._widget.add_child(
      new St.Icon({
        icon_name: 'x-office-calendar-symbolic',
        style_class: 'aurora-meeting-clock-icon',
        y_align: Clutter.ActorAlign.CENTER,
      }),
    );
    this._registration = registerClockPillWidget(CLOCK_PILL_ID, this._widget, 'right', 100);
  }

  setPresentation(eventId: string | null, label = ''): void {
    if (!eventId) {
      this._eventId = '';
      this.hide(false);
      return;
    }

    this._label.text = label;
    if (eventId === this._eventId) return;

    this._eventId = eventId;
    this.reveal();
  }

  reveal(): void {
    if (!this._eventId) return;

    this._removeTransitions();

    const targetWidth = this._naturalWidth();

    this._widget.visible = true;
    this._widget.width = 0;
    this._widget.opacity = 0;
    this._widget.translation_x = OFFSET;
    this._widget.ease({
      width: targetWidth,
      opacity: 255,
      translationX: 0,
      duration: ANIMATION_MS,
      mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
      onComplete: () => {
        this._widget.width = -1;
      },
    });

    this._hideTimer.replace(() =>
      GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, VISIBLE_SECONDS, () => {
        this._hideTimer.complete();
        this.hide(true);
        return GLib.SOURCE_REMOVE;
      }),
    );
  }

  hide(animated: boolean): void {
    this._hideTimer.clear();
    this._removeTransitions();

    if (!animated || !this._widget.visible) {
      this._widget.opacity = 0;
      this._widget.translation_x = OFFSET;
      this._widget.width = -1;
      this._widget.visible = false;
      return;
    }

    this._widget.width = this._naturalWidth();
    this._widget.ease({
      width: 0,
      opacity: 0,
      translationX: OFFSET,
      duration: ANIMATION_MS,
      mode: Clutter.AnimationMode.EASE_IN_CUBIC,
      onComplete: () => {
        this._widget.width = -1;
        this._widget.visible = false;
      },
    });
  }

  openMenu(): boolean {
    return openClockMenu();
  }

  destroy(): void {
    this._hideTimer.clear();
    this._removeTransitions();
    if (this._registration) {
      this._registration.unregister();
      this._registration = null;
    }
    this._widget.destroy();
  }

  private _removeTransitions(): void {
    this._widget.remove_transition('opacity');
    this._widget.remove_transition('translation-x');
    this._widget.remove_transition('width');
  }

  private _naturalWidth(): number {
    this._widget.width = -1;
    const [, naturalWidth] = this._widget.get_preferred_width(-1);

    return Math.ceil(naturalWidth);
  }
}
