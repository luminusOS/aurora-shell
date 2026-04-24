// @ts-nocheck
import { gettext as _ } from 'gettext';
import St from '@girs/st-17';
import GLib from '@girs/glib-2.0';
import * as Main from '@girs/gnome-shell/ui/main';
import * as Search from '@girs/gnome-shell/ui/search';
import type { ExtensionContext } from '~/core/context.ts';
import { Module } from '~/module.ts';
import type { ModuleDefinition } from '~/moduleDefinition.ts';

const SHOW_DELAY_MS = 300;

/**
 * Shows a tooltip with the full app name when hovering over icons
 * in the GNOME Shell search results.
 *
 * A single shared St.Label is lazily created and repositioned between icons.
 */
export class AppSearchTooltip extends Module {
  private _tooltipActor: any = null;
  private _showTimeoutId = 0;
  private _pendingActor: any = null;
  private _overviewHidingId = 0;
  private _patchedSearchAddItem: any = null;
  private _trackedActors = new Map<any, number[]>();

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    if (!this._patchedSearchAddItem) {
      const originalAddItem = Search.GridSearchResults.prototype._addItem;
      this._patchedSearchAddItem = originalAddItem;

      const connectHover = (display: any) => this._connectHover(display);

      Search.GridSearchResults.prototype._addItem = function (display: any) {
        originalAddItem.call(this, display);
        connectHover(display);
      };
    }

    this._overviewHidingId = Main.overview.connect('hiding', () => this._hideTooltip());
  }

  override disable(): void {
    if (this._patchedSearchAddItem) {
      Search.GridSearchResults.prototype._addItem = this._patchedSearchAddItem;
      this._patchedSearchAddItem = null;
    }

    if (this._overviewHidingId > 0) {
      Main.overview.disconnect(this._overviewHidingId);
      this._overviewHidingId = 0;
    }

    if (this._showTimeoutId > 0) {
      GLib.source_remove(this._showTimeoutId);
      this._showTimeoutId = 0;
    }
    this._pendingActor = null;

    for (const [actor, ids] of this._trackedActors) {
      try {
        for (const id of ids) {
          actor.disconnect(id);
        }
      } catch (_e) {
        // actor may already be destroyed
      }
    }
    this._trackedActors.clear();

    this._hideTooltip();
  }

  private _connectHover(actor: any): void {
    if (!actor || typeof actor.connect !== 'function') return;

    const delegate = actor._delegate || actor;
    if (!delegate.metaInfo && !delegate.app) return;

    if (this._trackedActors.has(actor)) return;

    const ids = [
      actor.connect('notify::hover', () => this._onHover(actor)),
      actor.connect('key-focus-in', () => this._onHover(actor)),
      actor.connect('key-focus-out', () => this._onHover(actor)),
      actor.connect('destroy', () => {
        if (this._pendingActor === actor && this._showTimeoutId > 0) {
          GLib.source_remove(this._showTimeoutId);
          this._showTimeoutId = 0;
          this._pendingActor = null;
        }
        this._trackedActors.delete(actor);
      }),
    ];

    this._trackedActors.set(actor, ids);
  }

  private _onHover(actor: any): void {
    const isHovered = actor.get_hover() || actor.has_key_focus();

    if (isHovered) {
      if (this._tooltipActor) {
        this._showTooltip(actor);
        return;
      }
      if (this._showTimeoutId > 0) return; // already scheduled
      this._showTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SHOW_DELAY_MS, () => {
        this._showTimeoutId = 0;
        this._pendingActor = null;
        if (actor.get_hover() || actor.has_key_focus()) this._showTooltip(actor);
        return GLib.SOURCE_REMOVE;
      });
      this._pendingActor = actor;
    } else {
      if (this._showTimeoutId > 0) {
        GLib.source_remove(this._showTimeoutId);
        this._showTimeoutId = 0;
      }
      this._hideTooltip();
    }
  }

  private _showTooltip(actor: any): void {
    const name = this._getActorName(actor);
    if (!name) return;

    if (!this._tooltipActor) {
      this._tooltipActor = new St.Label({
        style_class: 'app-search-tooltip',
        text: name,
      });
      Main.uiGroup.add_child(this._tooltipActor);
    } else {
      this._tooltipActor.text = name;
    }

    this._positionTooltip(actor);
  }

  private _positionTooltip(actor: any): void {
    if (!this._tooltipActor) return;

    const [stageX, stageY] = actor.get_transformed_position();
    const [iconWidth, iconHeight] = actor.get_transformed_size();
    const [, tooltipWidth] = this._tooltipActor.get_preferred_width(-1);

    const x = stageX + Math.round((iconWidth - tooltipWidth) / 2);
    const y = stageY + iconHeight + 4;

    this._tooltipActor.set_position(x, y);
  }

  private _hideTooltip(): void {
    if (this._tooltipActor) {
      Main.uiGroup.remove_child(this._tooltipActor);
      this._tooltipActor.destroy();
      this._tooltipActor = null;
    }
  }

  private _getActorName(actor: any): string | null {
    const delegate = actor._delegate || actor;
    if (delegate.app) return (delegate.app.get_name() as string) ?? null;
    if (delegate.metaInfo) return (delegate.metaInfo['name'] as string) ?? null;
    return null;
  }
}

export const definition: ModuleDefinition = {
  key: 'app-search-tooltip',
  settingsKey: 'module-app-search-tooltip',
  title: _('App Search Tooltip'),
  subtitle: _('Shows app name on hover in the overview search results'),
  factory: (ctx) => new AppSearchTooltip(ctx),
};
