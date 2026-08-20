import '@girs/gjs';

import Clutter from '@girs/clutter-18';
import GLib from '@girs/glib-2.0';
import GObject from '@girs/gobject-2.0';
import Graphene from '@girs/graphene-1.0';
import type Meta from '@girs/meta-18';
import Pango from '@girs/pango-1.0';
import Shell from '@girs/shell-18';
import St from '@girs/st-18';
import * as BoxPointer from '@girs/gnome-shell/ui/boxpointer';
import * as Main from '@girs/gnome-shell/ui/main';
import * as PopupMenu from '@girs/gnome-shell/ui/popupMenu';

import { LifecycleScope, type ManagedSource } from '~/core/lifecycleScope.ts';
import { createManagedSource } from '~/core/mainLoop.ts';
import type { DockPosition } from '~/dock/dockConfiguration.ts';
import { gettext as _ } from '~/shared/i18n.ts';

const SHOW_DELAY = 300;
const HIDE_DELAY = 150;
const MAX_PREVIEW_WIDTH = 240;
const MAX_PREVIEW_HEIGHT = 150;
const CLOSE_BUTTON_OFFSET = 10;
const OPEN_SOURCE_STYLE_CLASS = 'aurora-window-preview-open';

const WindowPreviewOverlayLayout = GObject.registerClass(
  class WindowPreviewOverlayLayout extends Clutter.LayoutManager {
    override vfunc_get_preferred_width(
      container: Clutter.Actor,
      forHeight: number,
    ): [number, number] {
      const content = container.first_child;
      if (!content) return [0, 0];
      return content.get_preferred_width(forHeight);
    }

    override vfunc_get_preferred_height(
      container: Clutter.Actor,
      forWidth: number,
    ): [number, number] {
      const content = container.first_child;
      if (!content) return [0, 0];
      return content.get_preferred_height(forWidth);
    }

    override vfunc_allocate(container: Clutter.Actor, allocation: Clutter.ActorBox): void {
      const [content, close] = container.get_children();
      if (content) content.allocate(allocation);
      if (!close || !close.visible) return;

      const [, closeWidth] = close.get_preferred_width(-1);
      const [, closeHeight] = close.get_preferred_height(closeWidth);
      close.allocate(
        new Clutter.ActorBox({
          x1: allocation.x2 - closeWidth + CLOSE_BUTTON_OFFSET,
          y1: allocation.y1 - CLOSE_BUTTON_OFFSET,
          x2: allocation.x2 + CLOSE_BUTTON_OFFSET,
          y2: allocation.y1 - CLOSE_BUTTON_OFFSET + closeHeight,
        }),
      );
    }
  },
);

type AppIcon = St.Widget & {
  app?: Shell.App;
  hover: boolean;
  _menu?: PopupMenu.PopupMenu | null;
  _popupMenuSide?: St.Side;
};

type PreviewSource = {
  item: St.Widget & { hideLabel?: () => void };
  appIcon: AppIcon;
  app: Shell.App;
};

type DashWindowPreviewOptions = {
  position: DockPosition;
  isWindowRelevant: (window: Meta.Window) => boolean;
  onOpenStateChanged: () => void;
};

export class DashWindowPreviewController {
  private _lifecycle = new LifecycleScope();
  private _showTimer: ManagedSource = createManagedSource(this._lifecycle);
  private _hideTimer: ManagedSource = createManagedSource(this._lifecycle);
  private _attachedIcons = new WeakSet<object>();
  private _pendingSource: PreviewSource | null = null;
  private _source: PreviewSource | null = null;
  private _popup: PopupMenu.PopupMenu | null = null;

  constructor(private _options: DashWindowPreviewOptions) {}

  get isOpen(): boolean {
    if (!this._popup) return false;
    return this._popup.isOpen;
  }

  syncItems(items: readonly any[]): void {
    for (const item of items) {
      const appIcon = item.child?._delegate as AppIcon | undefined;
      const app = appIcon?.app;
      if (!appIcon || !app || this._attachedIcons.has(appIcon)) continue;

      this._attachedIcons.add(appIcon);
      const source = { item, appIcon, app } satisfies PreviewSource;
      appIcon.connectObject(
        'notify::hover',
        () => this._handleIconHover(source),
        'clicked',
        () => this.close(),
        'menu-state-changed',
        (_icon: AppIcon, opened: boolean) => {
          if (opened) this.close();
        },
        item,
      );
      item.connect('destroy', () => {
        if (this._pendingSource?.item === item) this._pendingSource = null;
        if (this._source?.item === item) this.close();
      });
    }
  }

  shouldSuppressTooltip(appIcon: AppIcon | null | undefined): boolean {
    if (!appIcon || !appIcon.hover || !appIcon.app) return false;
    return this._getWindows(appIcon.app).length > 0;
  }

  close(): void {
    this._showTimer.clear();
    this._hideTimer.clear();
    this._pendingSource = null;
    this._destroyPopup();
  }

  destroy(): void {
    this.close();
    this._lifecycle.dispose();
  }

  private _handleIconHover(source: PreviewSource): void {
    if (!source.appIcon.hover) {
      if (this._pendingSource && this._pendingSource.appIcon === source.appIcon) {
        this._showTimer.clear();
        this._pendingSource = null;
      }
      if (this._source && this._source.appIcon === source.appIcon) this._scheduleClose();
      return;
    }

    if (source.appIcon._menu && source.appIcon._menu.isOpen) return;
    if (this._getWindows(source.app).length === 0) return;

    if (source.item.hideLabel) source.item.hideLabel();
    this._hideTimer.clear();
    if (this._source && this._source.appIcon === source.appIcon && this.isOpen) return;

    const switchImmediately = this.isOpen;
    if (this._source && this._source.appIcon !== source.appIcon) this._destroyPopup();

    this._pendingSource = source;
    this._showTimer.replace(() =>
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, switchImmediately ? 0 : SHOW_DELAY, () => {
        this._showTimer.complete();
        const pending = this._pendingSource;
        this._pendingSource = null;
        if (pending && pending.appIcon.hover) this._open(pending);
        return GLib.SOURCE_REMOVE;
      }),
    );
  }

  private _open(source: PreviewSource): void {
    const windows = this._getWindows(source.app);
    if (windows.length === 0) return;
    if (source.appIcon._menu && source.appIcon._menu.isOpen) return;

    this._destroyPopup();
    this._source = source;
    source.item.add_style_class_name(OPEN_SOURCE_STYLE_CLASS);

    const popupSide = source.appIcon._popupMenuSide
      ? source.appIcon._popupMenuSide
      : this._popupSide();
    const popup = new PopupMenu.PopupMenu(source.appIcon, 0.5, popupSide);
    popup.actor.add_style_class_name('aurora-window-preview-popup');
    popup.actor.set_track_hover(true);
    Main.uiGroup.add_child(popup.actor);
    popup.actor.hide();
    this._popup = popup;
    popup.connect('open-state-changed', (_menu, opened) => {
      if (!opened && this._popup === popup) this._destroyPopup(true);
    });

    popup.actor.connectObject(
      'notify::hover',
      () => {
        if (popup.actor.hover) this._hideTimer.clear();
        else this._scheduleClose();
      },
      'key-press-event',
      (_actor: St.Widget, event: Clutter.Event) => {
        if (event.get_key_symbol() !== Clutter.KEY_Escape) return Clutter.EVENT_PROPAGATE;
        this.close();
        return Clutter.EVENT_STOP;
      },
      popup.actor,
    );
    source.app.connectObject('windows-changed', () => this._refresh(), popup.actor);
    global.display.connectObject('notify::focus-window', () => this._refresh(), popup.actor);

    if (!this._populate(popup, windows)) {
      this._destroyPopup();
      return;
    }

    if (source.item.hideLabel) source.item.hideLabel();
    popup.open(BoxPointer.PopupAnimation.FULL);
    popup.actor.grab_key_focus();
    this._options.onOpenStateChanged();
  }

  private _refresh(): void {
    if (!this._popup || !this._source) return;

    const windows = this._getWindows(this._source.app);
    this._popup.removeAll();
    if (windows.length === 0 || !this._populate(this._popup, windows)) {
      this.close();
      return;
    }

    this._popup.actor.queue_relayout();
  }

  private _populate(popup: PopupMenu.PopupMenu, windows: Meta.Window[]): boolean {
    const cards = new St.BoxLayout({
      style_class: 'aurora-window-preview-list',
      orientation:
        this._options.position === 'bottom'
          ? Clutter.Orientation.HORIZONTAL
          : Clutter.Orientation.VERTICAL,
    });

    if (!this._source) return false;

    let cardCount = 0;
    for (const window of windows) {
      const card = this._createCard(window, this._source.app.get_name());
      if (!card) continue;
      cards.add_child(card);
      cardCount++;
    }
    if (cardCount === 0) return false;

    const monitorIndex = Main.layoutManager.findIndexForActor(this._source.appIcon);
    const workArea = Main.layoutManager.getWorkAreaForMonitor(Math.max(0, monitorIndex));
    const workAreaWidth = workArea ? workArea.width : 1200;
    const workAreaHeight = workArea ? workArea.height : 800;
    const maxWidth = Math.max(300, Math.floor(workAreaWidth * 0.8));
    const maxHeight = Math.max(220, Math.floor(workAreaHeight * 0.8));
    const scroll = new St.ScrollView({
      style_class: 'aurora-window-preview-scroll',
      style:
        this._options.position === 'bottom'
          ? `max-width: ${maxWidth}px; max-height: 230px;`
          : `max-width: 280px; max-height: ${maxHeight}px;`,
      child: cards,
      overlay_scrollbars: true,
    });
    // Both axes stay AUTOMATIC: St compares the child width against the available
    // height when exactly one axis is AUTOMATIC, which would force a spurious
    // horizontal scrollbar on the bottom Dock where cards are wider than the
    // popup is tall. Overlay scrollbars keep St from permanently reserving the
    // vertical scrollbar width in the preferred size, which otherwise shows up
    // as an empty gutter on the right side of the popup.
    scroll.set_policy(St.PolicyType.AUTOMATIC, St.PolicyType.AUTOMATIC);
    const host = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      can_focus: false,
      style_class: 'aurora-window-preview-host',
    });
    host.add_child(scroll);
    popup.addMenuItem(host);
    return true;
  }

  private _createCard(window: Meta.Window, fallbackTitle: string): St.BoxLayout | null {
    if (!window.get_compositor_private()) return null;

    const preview = new Clutter.Actor({
      pivot_point: new Graphene.Point({ x: 0.5, y: 0.5 }),
    });
    const layout = new Shell.WindowPreviewLayout();
    preview.layout_manager = layout;
    const rect = window.get_buffer_rect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const scale = Math.min(MAX_PREVIEW_WIDTH / width, MAX_PREVIEW_HEIGHT / height);
    const previewWidth = Math.max(1, Math.round(width * scale));
    const previewHeight = Math.max(1, Math.round(height * scale));
    preview.set_size(previewWidth, previewHeight);
    const clone = layout.add_window(window);
    if (!clone) {
      preview.destroy();
      return null;
    }
    Shell.util_set_hidden_from_pick(clone, true);

    const previewFrame = new St.Bin({
      style_class: 'aurora-window-preview-thumbnail',
      child: preview,
      x_align: Clutter.ActorAlign.CENTER,
    });
    const title = new St.Label({
      style_class: 'aurora-window-preview-title',
      text: window.title || fallbackTitle,
      width: previewWidth,
      x_align: Clutter.ActorAlign.CENTER,
    });
    title.clutter_text.single_line_mode = true;
    title.clutter_text.ellipsize = Pango.EllipsizeMode.END;

    const activationContent = new St.BoxLayout({ orientation: Clutter.Orientation.VERTICAL });
    activationContent.add_child(previewFrame);
    activationContent.add_child(title);
    const activate = new St.Button({
      style_class: 'aurora-window-preview-activate',
      child: activationContent,
      can_focus: true,
      reactive: true,
      x_expand: true,
      y_expand: true,
      accessible_name: window.title || fallbackTitle,
    });
    activate.connect('clicked', () => {
      this.close();
      if (window.minimized) window.unminimize();
      Main.activateWindow(window);
    });
    window.connectObject(
      'notify::title',
      () => {
        const windowTitle = window.title || fallbackTitle;
        title.text = windowTitle;
        activate.accessible_name = windowTitle;
      },
      title,
    );

    const overlay = new St.Widget({
      style_class: 'aurora-window-preview-content',
      layout_manager: new WindowPreviewOverlayLayout(),
      x_expand: true,
      y_expand: true,
    });
    overlay.add_child(activate);

    if (window.can_close()) {
      const close = new St.Button({
        style_class: 'window-close aurora-window-preview-close',
        icon_name: 'preview-close-symbolic',
        can_focus: true,
        reactive: true,
        accessible_name: _('Close'),
      });
      close.connect('clicked', () => {
        window.delete(global.get_current_time());
      });
      overlay.add_child(close);
    }

    const card = new St.BoxLayout({
      style_class: 'aurora-window-preview-card',
      orientation: Clutter.Orientation.VERTICAL,
      reactive: true,
      track_hover: true,
    });
    card.add_child(overlay);
    return card;
  }

  private _getWindows(app: Shell.App): Meta.Window[] {
    return app.get_windows().filter((window) => this._options.isWindowRelevant(window));
  }

  private _scheduleClose(): void {
    this._hideTimer.replace(() =>
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, HIDE_DELAY, () => {
        this._hideTimer.complete();
        if (!this._source || !this._popup) return GLib.SOURCE_REMOVE;
        if (!this._source.appIcon.hover && !this._popup.actor.hover) this.close();
        return GLib.SOURCE_REMOVE;
      }),
    );
  }

  private _destroyPopup(notifyOpenState = this.isOpen): void {
    const ownedPopup = this._popup;
    const ownedSource = this._source;
    this._popup = null;
    this._source = null;
    if (ownedSource) ownedSource.item.remove_style_class_name(OPEN_SOURCE_STYLE_CLASS);
    if (ownedPopup) ownedPopup.destroy();
    if (notifyOpenState) this._options.onOpenStateChanged();
  }

  private _popupSide(): St.Side {
    if (this._options.position === 'left') return St.Side.RIGHT;
    if (this._options.position === 'right') return St.Side.LEFT;
    return St.Side.BOTTOM;
  }
}
