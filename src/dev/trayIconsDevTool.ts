import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { action, type RuntimeAction } from './protocol.ts';
import type { TrayItem } from '~/desktop/trayIcons/trayState.ts';
import { gettext as _ } from '~/shared/i18n.ts';

const TRAY_ID = 'aurora-tray-icons';
const FAKE_ICON_NAMES = [
  'face-smile-symbolic',
  'computer-symbolic',
  'network-wireless-symbolic',
  'audio-headphones-symbolic',
  'bluetooth-symbolic',
  'camera-symbolic',
  'mail-unread-symbolic',
  'printer-symbolic',
] as const;

type AuroraTrayApi = {
  addItem(item: TrayItem): void;
  removeItem(id: string): void;
  notifyAttention(id: string): void;
  clearAttentionBadge(id: string): void;
};

export class TrayIconsDevTool {
  readonly key = 'tray-icons';
  readonly title = 'Tray Icons';

  private _counter = 0;
  private _fakeItems = new Map<string, TrayItem>();
  private _attentionEnabled = false;

  describe() {
    const tray = this._getTray();
    const hasFakeItems = this._fakeItems.size > 0;

    const actions: RuntimeAction[] = [];
    const details: string[] = [];
    details.push(tray ? `${this._fakeItems.size} fake icons` : 'Tray unavailable');

    actions.push(
      action('addRandomFakeIcon', 'Add Random Icon', () => this.addRandomFakeIcon(), !tray),
    );
    actions.push(
      action(
        'tray-attention',
        this._attentionEnabled ? 'Alerts On' : 'Alert Icons',
        () => this.toggleAttentionOnAll(),
        !tray || !hasFakeItems,
        this._attentionEnabled,
      ),
    );

    actions.push(
      action(
        'removeAllFakeIcons',
        'Remove All',
        () => this.removeAllFakeIcons(),
        !tray || !hasFakeItems,
      ),
    );

    if (hasFakeItems) {
      for (const item of this._fakeItems.values())
        details.push((item.tooltip || item.id) + ': ' + (item.status || _('Active')));
    }

    return { details, actions };
  }

  destroy(): void {
    this.removeAllFakeIcons();
    this._fakeItems.clear();
  }

  addRandomFakeIcon(): string | null {
    const iconName = FAKE_ICON_NAMES[Math.floor(Math.random() * FAKE_ICON_NAMES.length)]!;
    return this.addFakeIcon(iconName);
  }

  addFakeIcon(iconName: string): string | null {
    const tray = this._getTray();
    if (!tray) return null;

    const id = `devtool-fake-${this._counter++}`;
    const item: TrayItem = {
      id,
      icon: iconName,
      status: 'Active',
      tooltip: `DevTool: ${iconName}`,
      menuItems: [
        {
          label: 'Remove Icon',
          action: () => this.removeFakeIcon(id),
        },
      ],
      activate: () => {},
      destroy: () => {
        if (this._fakeItems.get(id) === item) {
          this._fakeItems.delete(id);
        }
      },
    };

    this._fakeItems.set(id, item);
    tray.addItem(item);
    if (this._attentionEnabled) tray.notifyAttention(id);
    return id;
  }

  removeFakeIcon(id: string): void {
    const tray = this._getTray();
    if (!tray) return;

    this._fakeItems.delete(id);
    tray.clearAttentionBadge(id);
    tray.removeItem(id);
    if (this._fakeItems.size === 0) this._attentionEnabled = false;
  }

  removeAllFakeIcons(): void {
    const tray = this._getTray();
    if (!tray) return;

    for (const id of [...this._fakeItems.keys()]) {
      tray.clearAttentionBadge(id);
      tray.removeItem(id);
    }
    this._fakeItems.clear();
    this._attentionEnabled = false;
  }

  toggleAttentionOnAll(): void {
    this.setAttentionOnAll(!this._attentionEnabled);
  }

  setAttentionOnAll(enabled: boolean): void {
    const tray = this._getTray();
    if (!tray) return;

    for (const id of this._fakeItems.keys()) {
      if (enabled) {
        tray.notifyAttention(id);
      } else {
        tray.clearAttentionBadge(id);
      }
    }
    this._attentionEnabled = enabled;
  }

  triggerAttentionOnAll(): void {
    this.setAttentionOnAll(true);
  }

  clearAttentionOnAll(): void {
    this.setAttentionOnAll(false);
  }

  get fakeItemIds(): string[] {
    return [...this._fakeItems.keys()];
  }

  private _getTray(): AuroraTrayApi | null {
    const tray = (Main.panel.statusArea as Record<string, unknown>)[TRAY_ID] as
      | AuroraTrayApi
      | null
      | undefined;

    if (
      !tray ||
      typeof tray.addItem !== 'function' ||
      typeof tray.removeItem !== 'function' ||
      typeof tray.notifyAttention !== 'function' ||
      typeof tray.clearAttentionBadge !== 'function'
    ) {
      this._fakeItems.clear();
      this._attentionEnabled = false;
      return null;
    }

    return tray;
  }
}
