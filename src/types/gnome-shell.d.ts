import type Clutter from 'gi://Clutter';
import type St from 'gi://St';

declare module 'resource:///org/gnome/shell/ui/dash.js' {
  export class Dash extends St.Widget {
    showAppsButton?: { set_toggle_mode(toggle: boolean): void };
    _init(params?: Record<string, unknown>): void;
    queue_relayout(): void;
    set_width(width: number): void;
    hide(): void;
    show(): void;
    destroy(): void;
  }

  export const OPACITY_VISIBLE: number;
}
