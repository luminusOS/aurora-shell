import { gettext as _ } from '~/shared/i18n.ts';
import St from '@girs/st-18';
import GLib from '@girs/glib-2.0';
import * as Main from '@girs/gnome-shell/ui/main';
import * as Search from '@girs/gnome-shell/ui/search';
import type { ExtensionContext } from '~/core/context.ts';
import { LifecycleScope, type ManagedSource } from '~/core/lifecycleScope.ts';
import { createManagedSource } from '~/core/mainLoop.ts';
import { Module } from '~/module.ts';

const SHOW_DELAY_MS = 300;

/**
 * Shows a tooltip with the full app name when hovering over icons
 * in the GNOME Shell search results.
 *
 * A single shared St.Label is lazily created and repositioned between icons.
 */
export class AppSearchTooltip extends Module {
  private _tooltipActor: any = null;
  private _lifecycle: LifecycleScope | null = null;
  private _showTimeout: ManagedSource | null = null;
  private _pendingActor: any = null;
  private _originalSearchAddItem: any = null;
  private _searchAddItemWrapper: any = null;
  private _trackedActors = new Set<any>();

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this._lifecycle = new LifecycleScope();
    this._showTimeout = createManagedSource(this._lifecycle);
    const prototype = Search.GridSearchResults.prototype;
    const originalAddItem = prototype._addItem;
    const connectHover = (display: any) => this._connectHover(display);
    const wrapper = function (this: any, display: any) {
      originalAddItem.call(this, display);
      connectHover(display);
    };

    this._originalSearchAddItem = originalAddItem;
    this._searchAddItemWrapper = wrapper;
    prototype._addItem = wrapper;

    this._lifecycle.connect(Main.overview, 'hiding', () => this._hideTooltip());
  }

  override disable(): void {
    const prototype = Search.GridSearchResults.prototype;
    if (
      this._originalSearchAddItem &&
      this._searchAddItemWrapper &&
      prototype._addItem === this._searchAddItemWrapper
    ) {
      prototype._addItem = this._originalSearchAddItem;
    }
    this._originalSearchAddItem = null;
    this._searchAddItemWrapper = null;

    this._lifecycle?.dispose();
    this._lifecycle = null;
    this._showTimeout = null;
    this._pendingActor = null;

    for (const actor of this._trackedActors) actor.disconnectObject(this);
    this._trackedActors.clear();

    this._hideTooltip();
  }

  private _connectHover(actor: any): void {
    if (!actor) return;

    const delegate = actor._delegate || actor;
    if (!delegate.metaInfo && !delegate.app) return;

    if (this._trackedActors.has(actor)) return;

    actor.connectObject(
      'notify::hover',
      () => this._onHover(actor),
      'key-focus-in',
      () => this._onHover(actor),
      'key-focus-out',
      () => this._onHover(actor),
      'destroy',
      () => {
        const showTimeout = this._showTimeout;
        if (this._pendingActor === actor && showTimeout && showTimeout.active) {
          showTimeout.clear();
          this._pendingActor = null;
        }
        this._trackedActors.delete(actor);
      },
      this,
    );

    this._trackedActors.add(actor);
  }

  private _onHover(actor: any): void {
    const showTimeout = this._showTimeout;
    if (!showTimeout) return;

    const isHovered = actor.get_hover() || actor.has_key_focus();

    if (isHovered) {
      if (this._tooltipActor) {
        this._showTooltip(actor);
        return;
      }
      if (showTimeout.active) return;

      showTimeout.replace(() =>
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, SHOW_DELAY_MS, () => {
          showTimeout.complete();
          this._pendingActor = null;
          if (actor.get_hover() || actor.has_key_focus()) this._showTooltip(actor);
          return GLib.SOURCE_REMOVE;
        }),
      );
      this._pendingActor = actor;
    } else {
      showTimeout.clear();
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
    if (delegate.app) return delegate.app.get_name() as string;
    if (typeof delegate.metaInfo?.name === 'string') return delegate.metaInfo.name;

    return null;
  }
}
