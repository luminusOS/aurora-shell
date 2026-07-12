import '@girs/gjs';

import type St from '@girs/st-18';
import * as Main from '@girs/gnome-shell/ui/main';

import {
  createDevToolActionButton,
  createDevToolActionRow,
  createDevToolModulePanel,
  createDevToolSummary,
} from '~/dev/devToolUi.ts';
import type { TrayItem } from '~/desktop/trayIcons/trayState.ts';

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
  readonly iconName = 'view-grid-symbolic';

  private _counter = 0;
  private _fakeItems = new Map<string, TrayItem>();
  private _attentionEnabled = false;

  constructor(private readonly _requestMenuRebuild: () => void) {}

  buildPanel(): St.Widget {
    const tray = this._getTray();
    const hasFakeItems = this._fakeItems.size > 0;

    const panel = createDevToolModulePanel();
    panel.add_child(
      createDevToolSummary(
        this.iconName,
        tray ? `${this._fakeItems.size} fake icons` : 'Tray unavailable',
      ),
    );

    const primaryRow = createDevToolActionRow();
    primaryRow.add_child(
      createDevToolActionButton('list-add-symbolic', 'Add Random Icon', () => {
        this.addRandomFakeIcon();
      }),
    );
    primaryRow.add_child(
      createDevToolActionButton(
        'dialog-warning-symbolic',
        this._attentionEnabled ? 'Alerts On' : 'Alert Icons',
        () => this.toggleAttentionOnAll(),
        !hasFakeItems,
        this._attentionEnabled,
      ),
    );
    panel.add_child(primaryRow);

    const secondaryRow = createDevToolActionRow();
    secondaryRow.add_child(
      createDevToolActionButton(
        'user-trash-symbolic',
        'Remove All',
        () => this.removeAllFakeIcons(),
        !hasFakeItems,
      ),
    );
    panel.add_child(secondaryRow);

    if (!tray) {
      for (const row of [primaryRow, secondaryRow]) {
        for (const button of row.get_children()) {
          (button as St.Button).reactive = false;
          (button as St.Button).can_focus = false;
          button.opacity = 120;
        }
      }
    }

    return panel;
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
    this._requestMenuRebuild();
    return id;
  }

  removeFakeIcon(id: string): void {
    const tray = this._getTray();
    if (!tray) return;

    this._fakeItems.delete(id);
    tray.clearAttentionBadge(id);
    tray.removeItem(id);
    if (this._fakeItems.size === 0) this._attentionEnabled = false;
    this._requestMenuRebuild();
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
    this._requestMenuRebuild();
  }

  toggleAttentionOnAll(): boolean {
    this.setAttentionOnAll(!this._attentionEnabled);
    return this._attentionEnabled;
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
    this._requestMenuRebuild();
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
