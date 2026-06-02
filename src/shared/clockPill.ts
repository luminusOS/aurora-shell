import '@girs/gjs';

import Clutter from '@girs/clutter-18';
import St from '@girs/st-18';
import * as Main from '@girs/gnome-shell/ui/main';
import { PopupAnimation } from '@girs/gnome-shell/ui/boxpointer';

type DateMenuButton = {
  _clockDisplay: St.Label;
  menu: {
    open(animation?: PopupAnimation): void;
  };
};

type ClockPillSide = 'left' | 'right';

type ClockPillEntry = {
  id: string;
  actor: St.Widget;
  side: ClockPillSide;
  order: number;
};

export type ClockPillRegistration = {
  unregister(): void;
};

let _dateMenu: DateMenuButton | null = null;
let _originalClockDisplay: St.Label | null = null;
let _topBox: St.BoxLayout | null = null;
const _entries = new Map<string, ClockPillEntry>();

function _ensureWrapper(): boolean {
  if (_topBox && _originalClockDisplay) return true;

  _dateMenu = Main.panel.statusArea.dateMenu as unknown as DateMenuButton;
  _originalClockDisplay = _dateMenu._clockDisplay;
  const clockParent = _originalClockDisplay.get_parent();
  if (!clockParent) return false;

  _topBox = new St.BoxLayout({
    style_class: 'clock aurora-clock-pill-box',
    y_align: Clutter.ActorAlign.CENTER,
    y_expand: true,
  });
  _originalClockDisplay.remove_style_class_name('clock');
  clockParent.replace_child(_originalClockDisplay, _topBox);
  _rebuild();
  return true;
}

function _removeFromTopBox(actor: St.Widget): void {
  if (_topBox && actor.get_parent() === _topBox) _topBox.remove_child(actor);
}

function _sortEntries(side: ClockPillSide): ClockPillEntry[] {
  return [..._entries.values()]
    .filter((entry) => entry.side === side)
    .sort((a, b) => a.order - b.order);
}

function _rebuild(): void {
  if (!_topBox || !_originalClockDisplay) return;

  for (const entry of _entries.values()) _removeFromTopBox(entry.actor);
  _removeFromTopBox(_originalClockDisplay);

  for (const entry of _sortEntries('left')) _topBox.add_child(entry.actor);
  _topBox.add_child(_originalClockDisplay);
  for (const entry of _sortEntries('right')) _topBox.add_child(entry.actor);
}

function _restoreIfEmpty(): void {
  if (_entries.size > 0 || !_topBox || !_originalClockDisplay) return;

  const topBoxParent = _topBox.get_parent();
  _removeFromTopBox(_originalClockDisplay);
  _originalClockDisplay.add_style_class_name('clock');
  topBoxParent?.replace_child(_topBox, _originalClockDisplay);
  _topBox.destroy();
  _topBox = null;
  _originalClockDisplay = null;
  _dateMenu = null;
}

export function registerClockPillWidget(
  id: string,
  actor: St.Widget,
  side: ClockPillSide,
  order: number,
): ClockPillRegistration | null {
  unregisterClockPillWidget(id);
  if (!_ensureWrapper()) return null;

  _entries.set(id, { id, actor, side, order });
  _rebuild();

  return {
    unregister: () => unregisterClockPillWidget(id),
  };
}

export function unregisterClockPillWidget(id: string): void {
  const entry = _entries.get(id);
  if (!entry) return;

  _removeFromTopBox(entry.actor);
  _entries.delete(id);
  _rebuild();
  _restoreIfEmpty();
}

export function openClockMenu(animation: PopupAnimation = PopupAnimation.FULL): boolean {
  const dateMenu = _dateMenu ?? (Main.panel.statusArea.dateMenu as unknown as DateMenuButton);
  if (!dateMenu) return false;

  dateMenu.menu.open(animation);
  return true;
}
