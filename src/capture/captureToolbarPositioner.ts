import Clutter from '@girs/clutter-18';
import type St from '@girs/st-18';
import * as Main from '@girs/gnome-shell/ui/main';

import type { Geometry, ScreenshotUi } from './screenshotUiAdapter.ts';
import { calculateToolbarTranslation, findMonitorForSelection } from './toolbarPlacement.ts';

type ToolbarDrag = {
  pointerX: number;
  pointerY: number;
  toolbarX: number;
  toolbarY: number;
  baseX: number;
  baseY: number;
};

export class CaptureToolbarPositioner {
  private _drag: ToolbarDrag | null = null;
  private _grab: Clutter.Grab | null = null;
  private _draggedByUser = false;

  constructor(
    private _ui: ScreenshotUi,
    private _toolbar: St.BoxLayout,
  ) {}

  beginDrag(handle: St.Button, event: Clutter.Event): boolean {
    if (event.get_button() !== Clutter.BUTTON_PRIMARY) {
      return Clutter.EVENT_PROPAGATE;
    }

    const [pointerX, pointerY] = event.get_coords();
    const [toolbarX, toolbarY] = this._toolbar.get_transformed_position();
    this._drag = {
      pointerX,
      pointerY,
      toolbarX,
      toolbarY,
      baseX: toolbarX - this._toolbar.translation_x,
      baseY: toolbarY - this._toolbar.translation_y,
    };

    this._grab?.dismiss();
    this._grab = global.stage.grab(handle);
    global.stage.get_grab_actor()?.set_cursor_type(Clutter.CursorType.GRABBING);

    return Clutter.EVENT_STOP;
  }

  moveDrag(event: Clutter.Event): boolean {
    const monitor = Main.layoutManager.primaryMonitor;
    if (!this._drag || !monitor) {
      return Clutter.EVENT_PROPAGATE;
    }

    const [pointerX, pointerY] = event.get_coords();
    const extents = this._toolbar.get_transformed_extents();
    const desiredX = this._drag.toolbarX + pointerX - this._drag.pointerX;
    const desiredY = this._drag.toolbarY + pointerY - this._drag.pointerY;
    const x = Math.max(
      monitor.x,
      Math.min(desiredX, monitor.x + monitor.width - extents.get_width()),
    );
    const y = Math.max(
      monitor.y,
      Math.min(desiredY, monitor.y + monitor.height - extents.get_height()),
    );

    this._toolbar.translation_x = Math.round(x - this._drag.baseX);
    this._toolbar.translation_y = Math.round(y - this._drag.baseY);

    return Clutter.EVENT_STOP;
  }

  releaseDrag(event: Clutter.Event): boolean {
    if (!this._drag || event.get_button() !== Clutter.BUTTON_PRIMARY) {
      return Clutter.EVENT_PROPAGATE;
    }

    this._draggedByUser = true;
    this.endDrag();
    return Clutter.EVENT_STOP;
  }

  endDrag(): void {
    this._drag = null;

    if (this._grab) {
      global.stage.get_grab_actor()?.set_cursor_type(Clutter.CursorType.INHERIT);
    }

    this._grab?.dismiss();
    this._grab = null;
  }

  sync(portalMode: boolean): void {
    if (!this._toolbar.visible || !this._toolbar.mapped || this._draggedByUser) return;

    const selection = this._getSelection(portalMode);
    if (!selection) {
      this._resetTranslation();
      return;
    }

    const [x, y, width, height] = selection;
    const selectionRectangle = { x, y, width, height };
    const monitor = findMonitorForSelection(
      selectionRectangle,
      Main.layoutManager.monitors ?? [],
      Main.layoutManager.primaryIndex,
    );
    if (!monitor) {
      this._resetTranslation();
      return;
    }

    const [stageX, stageY] = this._toolbar.get_transformed_position();
    const translation = calculateToolbarTranslation({
      monitor,
      selection: selectionRectangle,
      toolbar: {
        width: this._toolbar.width,
        height: this._toolbar.height,
        stageX,
        stageY,
        translationX: this._toolbar.translation_x,
        translationY: this._toolbar.translation_y,
      },
      margin: 12,
    });
    if (!translation) return;

    this._toolbar.translation_x = translation.x;
    this._toolbar.translation_y = translation.y;
  }

  reset(): void {
    this.endDrag();
    this._draggedByUser = false;
    this._resetTranslation();
  }

  handleMonitorsChanged(): void {
    this.endDrag();
    this._resetTranslation();
  }

  destroy(): void {
    this.endDrag();
  }

  private _getSelection(portalMode: boolean): Geometry | null {
    if (portalMode || !this._ui._shotButton.checked || !this._ui._selectionButton.checked) {
      return null;
    }

    const selection = this._ui._areaSelector.getGeometry();
    return selection[2] > 0 && selection[3] > 0 ? selection : null;
  }

  private _resetTranslation(): void {
    this._toolbar.translation_x = 0;
    this._toolbar.translation_y = 0;
  }
}
