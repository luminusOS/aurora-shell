import '@girs/gjs';

import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from '@girs/gnome-shell/ui/main';
import { BaseModule } from './baseModule.ts';
import { AuroraDash, type AuroraDashActor, type AuroraDashParams, type DashBounds } from '../ui/dash.ts';

interface SignalConnection {
    object: any;
    id: number;
}

interface DesktopDock {
    dash: AuroraDashActor;
    container: St.Bin;
    layoutIdleId: number;
    intellihide: DesktopIntellihide;
    isBlocked: boolean;
}

const HANDLED_WINDOW_TYPES: Meta.WindowType[] = [
    Meta.WindowType.NORMAL,
    Meta.WindowType.DOCK,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
    Meta.WindowType.TOOLBAR,
    Meta.WindowType.MENU,
    Meta.WindowType.UTILITY,
    Meta.WindowType.SPLASHSCREEN,
];

enum OverlapStatus {
    UNDEFINED = -1,
    CLEAR = 0,
    BLOCKED = 1,
}

export class SmartDock extends BaseModule {
    private _overviewDashActor: St.Widget | null = null;
    private _desktopDocks: Map<number, DesktopDock> = new Map();
    private _connections: SignalConnection[] = [];
    private _isOverviewVisible = false;

    override enable(): void {
        this._captureOverviewDash();

        this._connect(Main.overview, 'showing', () => this._onOverviewShowing());
        this._connect(Main.overview, 'hiding', () => this._onOverviewShowing());
        this._connect(Main.overview, 'hidden', () => this._onOverviewHidden());
        this._connect(Main.layoutManager, 'monitors-changed', () => this._onMonitorsChanged());
        this._connect((globalThis as any).display, 'workareas-changed', () => this._queueLayoutAll());

        this._ensureDesktopDocks();
        this._syncOverviewVisibility();

        this.log('Aurora Shell SmartDock: Desktop dock enabled (intellihide active)');
    }

    override disable(): void {
        this._disconnectAll();
        this._destroyDesktopDocks();
        this._restoreOverviewDash();

        this.log('Aurora Shell SmartDock: Desktop dock disabled');
    }

    private _captureOverviewDash(): void {
        const overview = Main.overview as any;
        const controls = overview?._controls as Record<string, any> | undefined;
        const overviewDash = (controls?.['dash'] ?? overview?.dash) as St.Widget | undefined;
        if (!overviewDash) {
            this.warn('Aurora Shell SmartDock: Unable to locate overview dash');
            return;
        }

        this._overviewDashActor = overviewDash;
    }

    private _restoreOverviewDash(): void {
        this._overviewDashActor = null;
    }

    private _setOverviewDashVisible(visible: boolean): void {
        const dash = this._overviewDashActor;
        if (!dash) {
            return;
        }

        if (visible) {
            dash.show();
        } else {
            dash.hide();
        }
    }

    private _ensureDesktopDocks(): void {
        const monitorCount = this._monitorCount();
        const seen = new Set<number>();

        for (let index = 0; index < monitorCount; index++) {
            seen.add(index);
            const existing = this._desktopDocks.get(index);
            if (!existing) {
                const entry = this._createDesktopDock(index);
                this._desktopDocks.set(index, entry);
            } else {
                existing.intellihide.updateMonitorIndex(index);
            }
            this._queueLayoutFor(index);
        }

        for (const index of this._desktopDocks.keys()) {
            if (!seen.has(index)) {
                this._destroyDesktopDock(index);
            }
        }
    }

    private _createDesktopDock(index: number): DesktopDock {
        const DashCtor = AuroraDash as unknown as new (params: AuroraDashParams) => AuroraDashActor;
        const dash = new DashCtor({ monitorIndex: index });
        dash.set_reactive(true);

        const container = new St.Bin({
            x_expand: true,
            y_expand: false,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.END,
            reactive: false,
        });

        container.add_child(dash as unknown as St.Widget);
        Main.layoutManager.addTopChrome(container);

        const entry: DesktopDock = {
            dash,
            container,
            layoutIdleId: 0,
            intellihide: new DesktopIntellihide(index, blocked => this._onIntellihideStatusChanged(index, blocked)),
            isBlocked: false,
        };

    dash.setTargetBoxListener((bounds: DashBounds | null) => entry.intellihide.updateTargetBox(bounds));
        dash.refresh();

        return entry;
    }

    private _destroyDesktopDock(index: number): void {
        const entry = this._desktopDocks.get(index);
        if (!entry) {
            return;
        }

        if (entry.layoutIdleId) {
            GLib.source_remove(entry.layoutIdleId);
        }

        entry.dash.setTargetBoxListener(null);
        entry.intellihide.destroy();

        Main.layoutManager.removeChrome(entry.container);
        entry.container.destroy();
        entry.dash.destroy();

        this._desktopDocks.delete(index);
    }

    private _destroyDesktopDocks(): void {
        for (const index of Array.from(this._desktopDocks.keys())) {
            this._destroyDesktopDock(index);
        }
    }

    private _connect(object: any, signal: string, handler: (...args: any[]) => void): void {
        if (!object?.connect) {
            return;
        }

        const id = object.connect(signal, handler);
        this._connections.push({ object, id });
    }

    private _disconnectAll(): void {
        for (const { object, id } of this._connections) {
            try {
                object.disconnect(id);
            } catch (error) {
                this.warn('Aurora Shell SmartDock: Failed to disconnect signal', error);
            }
        }

        this._connections = [];
    }

    private _monitorCount(): number {
        const monitors = (Main.layoutManager as any).monitors;
        return Array.isArray(monitors) ? monitors.length : monitors?.length ?? 0;
    }

    private _onMonitorsChanged(): void {
        this._ensureDesktopDocks();
        this._queueLayoutAll();
    }

    private _onOverviewShowing(): void {
        this._isOverviewVisible = true;
        this._setOverviewDashVisible(true);
        this._updateDockVisibility();
    }

    private _onOverviewHidden(): void {
        this._isOverviewVisible = false;
        this._setOverviewDashVisible(false);
        this._updateDockVisibility();

        for (const [index, entry] of this._desktopDocks) {
            if (entry.container.visible) {
                entry.dash.refresh();
            }
            entry.intellihide.updateTargetBox(entry.dash.targetBox);
            this._queueLayoutFor(index);
        }
    }

    private _queueLayoutAll(): void {
        for (const index of this._desktopDocks.keys()) {
            this._queueLayoutFor(index);
        }
    }

    private _queueLayoutFor(index: number): void {
        const entry = this._desktopDocks.get(index);
        if (!entry) {
            return;
        }

        if (entry.layoutIdleId !== 0) {
            return;
        }

        entry.layoutIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            entry.layoutIdleId = 0;
            this._layoutDesktopDock(index, entry);
            return GLib.SOURCE_REMOVE;
        });
    }

    private _layoutDesktopDock(index: number, entry: DesktopDock): void {
        const workArea = Main.layoutManager.getWorkAreaForMonitor(index);
        if (!workArea) {
            return;
        }

        const referenceDash = this._overviewDashActor ?? ((Main.overview as any)?.dash as St.Widget | undefined) ?? null;
        const bounds: DashBounds = {
            x: workArea.x,
            y: workArea.y,
            width: workArea.width,
            height: workArea.height,
        };

        entry.dash.updateLayout(entry.container, bounds, referenceDash);
    }

    private _syncOverviewVisibility(): void {
        if (Main.overview.visible) {
            this._onOverviewShowing();
        } else {
            this._onOverviewHidden();
        }
    }

    private _onIntellihideStatusChanged(index: number, blocked: boolean): void {
        const entry = this._desktopDocks.get(index);
        if (!entry) {
            return;
        }

        if (entry.isBlocked === blocked) {
            return;
        }

        entry.isBlocked = blocked;
        this._updateDockVisibility();
    }

    private _updateDockVisibility(): void {
        for (const entry of this._desktopDocks.values()) {
            const shouldHide = this._isOverviewVisible || entry.isBlocked;
            this._setEntryVisible(entry, !shouldHide);
        }
    }

    private _setEntryVisible(entry: DesktopDock, visible: boolean): void {
        const containerVisible = entry.container.visible;

        if (visible) {
            if (!containerVisible) {
                entry.container.show();
                entry.dash.show();
            }
            return;
        }

        if (containerVisible) {
            entry.dash.hide();
            entry.container.hide();
        }
    }
}

class DesktopIntellihide {
    private _monitorIndex: number;
    private _targetBox: DashBounds | null = null;
    private _status: OverlapStatus = OverlapStatus.UNDEFINED;
    private _focusActor: Clutter.Actor | null = null;
    private _focusActorId = 0;
    private readonly _tracker = Shell.WindowTracker.get_default();
    private readonly _onStatusChanged: (blocked: boolean) => void;
    private _connections: SignalConnection[] = [];

    constructor(monitorIndex: number, onStatusChanged: (blocked: boolean) => void) {
        this._monitorIndex = monitorIndex;
        this._onStatusChanged = onStatusChanged;
        this._connectSignals();
    }

    updateMonitorIndex(index: number): void {
        if (this._monitorIndex === index) {
            return;
        }
        this._monitorIndex = index;
        this._checkOverlap();
    }

    updateTargetBox(bounds: DashBounds | null): void {
        this._targetBox = bounds;
        if (!bounds) {
            this._resetFocusActor();
            this._applyOverlapStatus(false, true);
            return;
        }

        this._checkOverlap();
    }

    destroy(): void {
        this._disconnectAll();
        this._resetFocusActor();
    }

    private _connectSignals(): void {
        const display = (globalThis as any).display;
        this._connect(display, 'window-entered-monitor', () => this._checkOverlap());
        this._connect(display, 'window-left-monitor', () => this._checkOverlap());
        this._connect(display, 'restacked', () => this._checkOverlap());
        this._connect(display, 'notify::focus-window', () => this._checkOverlap());

        this._connect(Main.layoutManager, 'monitors-changed', () => this._checkOverlap());

        if (this._tracker) {
            this._connect(this._tracker, 'notify::focus-app', () => this._checkOverlap());
        }

        if (Main.keyboard) {
            this._connect(Main.keyboard, 'visibility-changed', () => this._onKeyboardVisibilityChanged());
        }
    }

    private _onKeyboardVisibilityChanged(): void {
        const keyboardVisible = (Main.keyboard as any)?.visible ?? false;
        if (keyboardVisible) {
            this._applyOverlapStatus(true, true);
        } else {
            this._applyOverlapStatus(false, true);
            this._checkOverlap();
        }
    }

    private _checkOverlap(): void {
        if (!this._targetBox) {
            return;
        }

        this._resetFocusActor();

        const focusApp = this._tracker?.focus_app;
        if (!focusApp) {
            this._checkOverlapOnRemainingWindows();
            return;
        }

    let focusWin = focusApp.get_windows().find((window: Meta.Window) => this._isWindowRelevant(window));

        if (focusWin && this._monitorIndex === Main.layoutManager.primaryIndex) {
            const activeWorkspace = (globalThis as any).workspace_manager?.get_active_workspace?.();
            if (activeWorkspace && focusWin.get_workspace && focusWin.get_workspace() !== activeWorkspace) {
                focusWin = undefined;
            }
        }

        if (!focusWin) {
            this._checkOverlapOnRemainingWindows();
            return;
        }

        const winBox = focusWin.get_frame_rect?.();
        if (!winBox) {
            this._applyOverlapStatus(false, true);
            return;
        }

        this._applyOverlapStatus(this._test(this._toBounds(winBox), this._targetBox), true);

        const focusActor = focusWin.get_compositor_private?.() as Clutter.Actor | null;
        if (focusActor) {
            this._focusActor = focusActor;
            this._focusActorId = focusActor.connect('notify::allocation', () => {
                const updatedBox = focusWin.get_frame_rect?.();
                if (!updatedBox || !this._targetBox) {
                    return;
                }
                this._applyOverlapStatus(this._test(this._toBounds(updatedBox), this._targetBox), false);
            });
        }
    }

    private _checkOverlapOnRemainingWindows(): void {
        if (!this._targetBox) {
            this._applyOverlapStatus(false, true);
            return;
        }

        const windowActors = (globalThis as any).get_window_actors?.() ?? [];
        let windows = windowActors
            .map((actor: any) => actor?.meta_window ?? actor?.get_meta_window?.())
            .filter((window: Meta.Window | undefined) => this._isWindowRelevant(window)) as Meta.Window[];

        if (this._monitorIndex === Main.layoutManager.primaryIndex) {
            const activeWorkspace = (globalThis as any).workspace_manager?.get_active_workspace?.();
            windows = windows.filter(window => {
                if (!window.get_workspace) {
                    return true;
                }
                return !activeWorkspace || window.get_workspace() === activeWorkspace;
            });
        }

        if (windows.length === 0) {
            this._applyOverlapStatus(false, true);
            return;
        }

        const overlap = windows.some(window => {
            const rect = window.get_frame_rect?.();
            if (!rect) {
                return false;
            }
            return this._test(this._toBounds(rect), this._targetBox!);
        });

        this._applyOverlapStatus(overlap);
    }

    private _applyOverlapStatus(overlap: boolean, force = false): void {
        const newStatus = overlap ? OverlapStatus.BLOCKED : OverlapStatus.CLEAR;
        if (!force && newStatus === this._status) {
            return;
        }

        this._status = newStatus;
        this._onStatusChanged(overlap);
    }

    private _isWindowRelevant(window: Meta.Window | undefined): boolean {
        if (!window) {
            return false;
        }

        if (!this._isHandledWindow(window)) {
            return false;
        }

        if (typeof window.get_monitor === 'function' && window.get_monitor() !== this._monitorIndex) {
            return false;
        }

        if ((window as any).minimized) {
            return false;
        }

        if (typeof window.showing_on_its_workspace === 'function' && !window.showing_on_its_workspace()) {
            return false;
        }

        return true;
    }

    private _isHandledWindow(window: Meta.Window): boolean {
        const type = window.get_window_type?.();
        if (type === undefined) {
            return false;
        }
        return HANDLED_WINDOW_TYPES.includes(type);
    }

    private _test(winBox: DashBounds, targetBox: DashBounds): boolean {
        return !(
            winBox.x + winBox.width < targetBox.x ||
            targetBox.x + targetBox.width < winBox.x ||
            winBox.y + winBox.height < targetBox.y ||
            targetBox.y + targetBox.height < winBox.y
        );
    }

    private _toBounds(rect: { x: number; y: number; width: number; height: number }): DashBounds {
        return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
        };
    }

    private _resetFocusActor(): void {
        if (this._focusActor && this._focusActorId) {
            try {
                this._focusActor.disconnect(this._focusActorId);
            } catch (_error) {
                // Ignore failures; actor may already be disposed.
            }
        }
        this._focusActorId = 0;
        this._focusActor = null;
    }

    private _connect(object: any, signal: string, handler: (...args: any[]) => void): void {
        if (!object?.connect) {
            return;
        }

        const id = object.connect(signal, handler);
        this._connections.push({ object, id });
    }

    private _disconnectAll(): void {
        for (const { object, id } of this._connections) {
            try {
                object.disconnect(id);
            } catch (_error) {
                // Ignore disconnection issues during teardown.
            }
        }

        this._connections = [];
    }
}
