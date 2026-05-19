// src/modules/trayIcons/trayState.ts

// Type-only imports: erased at compile time, no GJS runtime dependency in unit tests.
import type Gio from '@girs/gio-2.0';
import type GdkPixbuf from '@girs/gdkpixbuf-2.0';

export type TrayItemStatus = 'Passive' | 'Active' | 'NeedsAttention';

export type TrayMenuItem = { label: string; action: () => void };

export interface TrayItem {
  readonly id: string;
  icon: Gio.Icon | GdkPixbuf.Pixbuf | string;
  tooltip?: string | undefined;
  status: TrayItemStatus;
  menuBusName?: string;
  menuObjectPath?: string | undefined;
  menuItems?: TrayMenuItem[];
  activate(x: number, y: number): void;
  secondaryActivate?(x: number, y: number): void;
  showMenu?(x: number, y: number): void;
  destroy(): void;
}

export interface TrayState {
  collapsed: boolean;
  scrollOffset: number;
  attentionIds: Set<string>;
  autoCollapseTimer: number | null;
}

export function createTrayState(): TrayState {
  return {
    collapsed: true,
    scrollOffset: 0,
    attentionIds: new Set(),
    autoCollapseTimer: null,
  };
}

export function toggleCollapsed(state: TrayState): void {
  state.collapsed = !state.collapsed;
  // scrollOffset is managed by TrayContainer._syncLayout (needs UI metrics)
}

export function applyScroll(state: TrayState, delta: number, maxScroll: number): void {
  if (maxScroll <= 0) return;
  state.scrollOffset = Math.max(0, Math.min(maxScroll, state.scrollOffset + delta));
}

export function addAttention(state: TrayState, id: string): void {
  state.attentionIds.add(id);
}

export function clearAttention(state: TrayState, id: string): void {
  state.attentionIds.delete(id);
}
