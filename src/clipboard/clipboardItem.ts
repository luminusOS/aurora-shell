import '@girs/gjs';
import { gettext as _ } from 'gettext';

import St from '@girs/st-18';
import GObject from '@girs/gobject-2.0';
import Clutter from '@girs/clutter-18';
import * as Main from '@girs/gnome-shell/ui/main';
import * as PopupMenu from '@girs/gnome-shell/ui/popupMenu';

import type { ClipboardEntry } from '~/clipboard/clipboardStore.ts';
import { highlightCodeMarkup } from '~/clipboard/codeHighlight.ts';
import { fetchLinkMetadata } from '~/clipboard/linkMetadata.ts';

const MAX_LABEL_CHARS = 360;
const MAX_DESCRIPTION_CHARS = 240;
// Code lines shown in the preview (with a line-number gutter); the full count is
// still reported in the footer.
const MAX_CODE_LINES = 5;

export type ClipboardItemCallbacks = {
  onActivate: (entry: ClipboardEntry) => void;
  onRemove: (id: string) => void;
  onTogglePin: (id: string) => void;
};

const _menuManagers = new WeakMap<PopupMenu.PopupMenu, PopupMenu.PopupMenuManager>();

function _getOverlayPreferredHeight(container: Clutter.Actor, forWidth: number): [number, number] {
  const [content, actions] = container.get_children();
  const [contentMin, contentNatural] = content?.get_preferred_height(forWidth) ?? [0, 0];
  const [actionsMin, actionsNatural] = actions?.visible
    ? actions.get_preferred_height(forWidth)
    : [0, 0];
  return [Math.max(contentMin, actionsMin), Math.max(contentNatural, actionsNatural)];
}

function _allocateTopRight(actor: Clutter.Actor | undefined, allocation: Clutter.ActorBox): void {
  if (!actor?.visible) return;

  const [, width] = actor.get_preferred_width(-1);
  const [, height] = actor.get_preferred_height(width);
  actor.allocate(
    new Clutter.ActorBox({
      x1: allocation.x2 - width,
      y1: allocation.y1,
      x2: allocation.x2,
      y2: allocation.y1 + height,
    }),
  );
}

@GObject.registerClass
class FloatingActionsLayout extends Clutter.LayoutManager {
  override vfunc_get_preferred_width(
    container: Clutter.Actor,
    forHeight: number,
  ): [number, number] {
    return container.first_child?.get_preferred_width(forHeight) ?? [0, 0];
  }

  override vfunc_get_preferred_height(
    container: Clutter.Actor,
    forWidth: number,
  ): [number, number] {
    return _getOverlayPreferredHeight(container, forWidth);
  }

  override vfunc_allocate(container: Clutter.Actor, allocation: Clutter.ActorBox): void {
    const [content, actions] = container.get_children();
    content?.allocate(allocation);
    _allocateTopRight(actions, allocation);
  }
}

@GObject.registerClass
class CodeCardOverlayLayout extends Clutter.LayoutManager {
  override vfunc_get_preferred_width(
    container: Clutter.Actor,
    forHeight: number,
  ): [number, number] {
    return container.first_child?.get_preferred_width(forHeight) ?? [0, 0];
  }

  override vfunc_get_preferred_height(
    container: Clutter.Actor,
    forWidth: number,
  ): [number, number] {
    return _getOverlayPreferredHeight(container, forWidth);
  }

  override vfunc_allocate(container: Clutter.Actor, allocation: Clutter.ActorBox): void {
    const [content, actions, badge] = container.get_children();
    content?.allocate(allocation);
    _allocateTopRight(actions, allocation);
    if (!badge) return;

    const [, badgeWidth] = badge.get_preferred_width(-1);
    const [, badgeHeight] = badge.get_preferred_height(badgeWidth);
    badge.allocate(
      new Clutter.ActorBox({
        x1: allocation.x2 - badgeWidth,
        y1: allocation.y2 - badgeHeight,
        x2: allocation.x2,
        y2: allocation.y2,
      }),
    );
  }
}

@GObject.registerClass
export class ClipboardItem extends St.Button {
  declare private _entry: ClipboardEntry;
  declare private _callbacks: ClipboardItemCallbacks;
  declare private _actions: St.BoxLayout;
  declare private _pinButton: St.Button;
  declare private _removeButton: St.Button;
  declare private _menuButton: St.Button;
  declare private _menu: PopupMenu.PopupMenu | null;
  declare private _disposed: boolean;
  declare private _linkTitle: St.Label | null;
  declare private _linkDescription: St.Label | null;
  declare private _linkThumb: St.Widget | null;

  override _init(entry: ClipboardEntry, callbacks: ClipboardItemCallbacks): void {
    super._init({
      style_class: 'aurora-clipboard-item',
      can_focus: true,
      x_expand: true,
      // Pin vertical expansion off explicitly. Otherwise Clutter computes
      // "needs expand" from descendants, and cards whose inner overlay sets
      // y_expand (image, code) would propagate it up and stretch the card to
      // fill the whole list. Inner overlays still expand within the card.
      y_expand: false,
      reactive: true,
      track_hover: true,
      x_align: Clutter.ActorAlign.FILL,
      y_align: Clutter.ActorAlign.START,
    });

    this._entry = entry;
    this._callbacks = callbacks;
    this._menu = null;
    this._disposed = false;
    this._linkTitle = null;
    this._linkDescription = null;
    this._linkThumb = null;

    this._actions = new St.BoxLayout({
      orientation: Clutter.Orientation.HORIZONTAL,
      y_align: Clutter.ActorAlign.START,
      style_class: 'aurora-clipboard-item-actions',
    });

    this._pinButton = this._createActionButton(
      'view-pin-symbolic',
      entry.pinned ? 'aurora-clipboard-item-action checked' : 'aurora-clipboard-item-action',
      () => this._callbacks.onTogglePin(this._entry.id),
    );
    this._actions.add_child(this._pinButton);

    this._removeButton = this._createActionButton(
      'user-trash-symbolic',
      'aurora-clipboard-item-action',
      () => this._callbacks.onRemove(this._entry.id),
    );
    this._actions.add_child(this._removeButton);

    this._menuButton = this._createActionButton(
      'view-more-symbolic',
      'aurora-clipboard-item-action menu',
      () => this._openMenu(),
    );
    this._actions.add_child(this._menuButton);
    this.setActionsVisible(false);

    if (entry.kind === 'image') {
      this._initImageCard(entry);
    } else {
      const url = _parseUrl(entry.text);
      if (url) {
        this._initLinkCard(entry.text.trim(), url);
      } else if (_isCode(entry.text)) {
        this._initCodeCard(entry);
      } else {
        this._initTextCard(entry);
      }
    }
  }

  get entry(): ClipboardEntry {
    return this._entry;
  }

  override destroy(): void {
    this._disposed = true;
    this._destroyMenu();
    super.destroy();
  }

  setActionsVisible(visible: boolean): void {
    const showPinnedBadge = !visible && this._entry.pinned;
    this._actions.visible = visible || showPinnedBadge;

    this._pinButton.visible = visible || this._entry.pinned;
    this._pinButton.reactive = visible || showPinnedBadge;
    this._pinButton.can_focus = visible;

    for (const button of [this._removeButton, this._menuButton]) {
      button.visible = visible;
      button.reactive = visible;
      button.can_focus = visible;
    }
  }

  private _initImageCard(entry: ClipboardEntry): void {
    this.add_style_class_name('aurora-clipboard-item--image');

    if (entry.filePath) {
      this.style = `background-image: url("file://${entry.filePath}"); background-size: cover;`;
    }

    const overlay = new St.Widget({
      layout_manager: new FloatingActionsLayout(),
      x_expand: true,
      y_expand: true,
      style_class: 'aurora-clipboard-image-overlay',
    });

    const content = new St.Widget({
      layout_manager: new Clutter.BinLayout(),
      x_expand: true,
      y_expand: true,
    });
    if (!entry.filePath) {
      content.add_child(
        new St.Icon({
          icon_name: 'image-missing-symbolic',
          icon_size: 28,
          style_class: 'aurora-clipboard-image-missing',
          x_align: Clutter.ActorAlign.CENTER,
          y_align: Clutter.ActorAlign.CENTER,
        }),
      );
    }
    overlay.add_child(content);

    this._actions.add_style_class_name('aurora-clipboard-image-actions');
    overlay.add_child(this._actions);

    this.set_child(overlay);
  }

  private _initLinkCard(url: string, parsed: { host: string; path: string }): void {
    this.add_style_class_name('aurora-clipboard-item--link');

    const overlay = new St.Widget({
      layout_manager: new FloatingActionsLayout(),
      x_expand: true,
      x_align: Clutter.ActorAlign.FILL,
      style_class: 'aurora-clipboard-item-link-overlay',
    });

    const box = new St.BoxLayout({
      orientation: Clutter.Orientation.HORIZONTAL,
      x_expand: true,
      style_class: 'aurora-clipboard-item-content',
    });

    this._linkThumb = new St.Widget({
      style_class: 'aurora-clipboard-item-link-thumb',
      y_align: Clutter.ActorAlign.CENTER,
      visible: false,
    });
    box.add_child(this._linkThumb);

    const body = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
      style_class: 'aurora-clipboard-item-body',
    });

    // The title starts as the host and is replaced by the page title once the
    // metadata fetch resolves.
    this._linkTitle = new St.Label({
      text: parsed.host,
      style_class: 'aurora-clipboard-item-link-title',
      x_expand: true,
    });
    this._linkTitle.clutter_text.ellipsize = 3;
    body.add_child(this._linkTitle);

    this._linkDescription = new St.Label({
      style_class: 'aurora-clipboard-item-link-desc',
      x_expand: true,
      visible: false,
    });
    this._linkDescription.clutter_text.set_line_wrap(true);
    this._linkDescription.clutter_text.ellipsize = 3;
    body.add_child(this._linkDescription);

    const urlLabel = new St.Label({
      text: parsed.host + (parsed.path && parsed.path !== '/' ? parsed.path : ''),
      style_class: 'aurora-clipboard-item-meta',
      x_expand: true,
    });
    urlLabel.clutter_text.ellipsize = 3;
    body.add_child(urlLabel);

    box.add_child(body);
    overlay.add_child(box);
    overlay.add_child(this._actions);
    this.set_child(overlay);

    void this._loadLinkPreview(url);
  }

  private async _loadLinkPreview(url: string): Promise<void> {
    const meta = await fetchLinkMetadata(url);
    if (this._disposed) return;

    if (meta.title && this._linkTitle) {
      this._linkTitle.text = meta.title;
    }

    if (meta.description && this._linkDescription) {
      this._linkDescription.text = _truncate(meta.description, MAX_DESCRIPTION_CHARS);
      this._linkDescription.visible = true;
    }

    if (meta.imagePath && this._linkThumb) {
      this._linkThumb.style = `background-image: url("file://${meta.imagePath}"); background-size: cover;`;
      this._linkThumb.visible = true;
    }
  }

  private _initCodeCard(entry: ClipboardEntry): void {
    const overlay = new St.Widget({
      layout_manager: new CodeCardOverlayLayout(),
      x_expand: true,
      y_expand: true,
      x_align: Clutter.ActorAlign.FILL,
      y_align: Clutter.ActorAlign.FILL,
      style_class: 'aurora-clipboard-item-code-overlay',
    });

    const box = new St.BoxLayout({
      orientation: Clutter.Orientation.HORIZONTAL,
      x_expand: true,
      y_expand: true,
      x_align: Clutter.ActorAlign.FILL,
      y_align: Clutter.ActorAlign.FILL,
      style_class: 'aurora-clipboard-item-content',
    });

    const allLines = entry.text.split('\n');
    const shownLines = allLines.slice(0, MAX_CODE_LINES);
    const snippet = shownLines.join('\n');

    const codeRow = new St.BoxLayout({
      orientation: Clutter.Orientation.HORIZONTAL,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
      style_class: 'aurora-clipboard-item-code',
    });

    const gutter = new St.Label({
      text: shownLines.map((_line, i) => String(i + 1)).join('\n'),
      style_class: 'aurora-clipboard-item-code-gutter',
      y_align: Clutter.ActorAlign.START,
    });
    codeRow.add_child(gutter);

    // No line wrap: each source line stays on its own visual row so the gutter
    // numbers line up 1:1. Over-long lines ellipsize per line, which also keeps
    // the label's minimum width small so one long line can't widen the panel.
    const code = new St.Label({
      style_class: 'aurora-clipboard-item-code-label',
      x_expand: true,
      y_align: Clutter.ActorAlign.START,
    });
    code.clutter_text.set_line_wrap(false);
    code.clutter_text.ellipsize = 3;
    code.clutter_text.set_markup(highlightCodeMarkup(snippet));
    codeRow.add_child(code);

    box.add_child(codeRow);
    overlay.add_child(box);
    overlay.add_child(this._actions);

    if (allLines.length > MAX_CODE_LINES) {
      overlay.add_child(
        new St.Label({
          text: _('%d lines').format(allLines.length),
          style_class: 'aurora-clipboard-item-code-badge',
        }),
      );
    }

    this.set_child(overlay);
  }

  private _initTextCard(entry: ClipboardEntry): void {
    const overlay = new St.Widget({
      layout_manager: new FloatingActionsLayout(),
      request_mode: Clutter.RequestMode.HEIGHT_FOR_WIDTH,
      x_expand: true,
      x_align: Clutter.ActorAlign.FILL,
      style_class: 'aurora-clipboard-item-text-overlay',
    });

    const textBody = new St.Bin({
      x_align: Clutter.ActorAlign.START,
      style_class: 'aurora-clipboard-item-text-body',
    });

    const label = new St.Label({
      text: _truncate(entry.text.replace(/\s+/g, ' ').trim(), MAX_LABEL_CHARS),
      style_class: 'aurora-clipboard-item-label',
      x_expand: true,
      x_align: Clutter.ActorAlign.FILL,
      y_align: Clutter.ActorAlign.START,
    });
    label.clutter_text.set_line_wrap(true);
    label.clutter_text.set_single_line_mode(false);
    label.clutter_text.ellipsize = 0;

    textBody.set_child(label);
    overlay.add_child(textBody);

    overlay.add_child(this._actions);
    this.set_child(overlay);
  }

  private _createActionButton(iconName: string, styleClass: string, action: () => void): St.Button {
    const button = new St.Button({
      style_class: styleClass,
      reactive: true,
      can_focus: true,
      track_hover: true,
      child: new St.Icon({
        icon_name: iconName,
        icon_size: 14,
      }),
    });
    button.connect('clicked', () => action());
    return button;
  }

  private _openMenu(): void {
    if (!this._menu) this._createMenu();
    this._menu?.toggle();
  }

  private _createMenu(): void {
    this._menu = new PopupMenu.PopupMenu(this._menuButton, 0.5, St.Side.TOP);
    this._menu.actor.add_style_class_name('aurora-clipboard-item-menu');

    const copyItem = new PopupMenu.PopupMenuItem(_('Copy'));
    copyItem.connect('activate', () => this._callbacks.onActivate(this._entry));
    this._menu.addMenuItem(copyItem);

    const pinItem = new PopupMenu.PopupMenuItem(this._entry.pinned ? _('Unpin') : _('Pin'));
    pinItem.connect('activate', () => this._callbacks.onTogglePin(this._entry.id));
    this._menu.addMenuItem(pinItem);

    const deleteItem = new PopupMenu.PopupMenuItem(_('Delete'));
    deleteItem.connect('activate', () => this._callbacks.onRemove(this._entry.id));
    this._menu.addMenuItem(deleteItem);

    const manager = new PopupMenu.PopupMenuManager(this);
    manager.addMenu(this._menu);
    _menuManagers.set(this._menu, manager);

    Main.uiGroup.add_child(this._menu.actor);
    this._menu.actor.hide();
  }

  private _destroyMenu(): void {
    if (!this._menu) return;

    const manager = _menuManagers.get(this._menu);
    manager?.removeMenu(this._menu);
    _menuManagers.delete(this._menu);
    this._menu.destroy();
    this._menu = null;
  }
}

function _parseUrl(text: string): { host: string; path: string } | null {
  const trimmed = text.trim();
  if (trimmed.includes('\n') || trimmed.includes(' ') || trimmed.length > 2048) return null;
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return null;

  try {
    const withoutScheme = trimmed.replace(/^https?:\/\//, '');
    const slashIdx = withoutScheme.indexOf('/');
    const host = slashIdx === -1 ? withoutScheme : withoutScheme.slice(0, slashIdx);
    const rawPath = slashIdx === -1 ? '' : withoutScheme.slice(slashIdx);
    const path = rawPath.split('?')[0]!;

    if (!host || !host.includes('.')) return null;
    return { host, path };
  } catch {
    return null;
  }
}

function _isCode(text: string): boolean {
  const lines = text.split('\n');
  if (lines.length < 2) return false;

  let score = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\s{2,}/.test(line)) score++;
    if (/[{};]\s*$/.test(line)) score++;
    if (/\\$/.test(trimmed)) score++;
    if (/^\s*(\/\/|#|\/\*|\*)/.test(line)) score++;
    if (/^(curl|wget|git|npm|yarn|pnpm|just|docker|kubectl|ssh|sudo)\b/.test(trimmed)) score += 2;
    if (/^-[A-Za-z]/.test(trimmed)) score++;
    if (/^(https?:\/\/|\/[\w.-]+|\w+=)/.test(trimmed)) score++;
    if (
      /^\s*(function|class|def|import|export|const|let|var|return|if|else|for|while|try|catch|async|await|public|private|protected)\b/.test(
        line,
      )
    )
      score += 2;
  }

  return score >= 3;
}

function _truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(0, maxChars) + '…' : text;
}
