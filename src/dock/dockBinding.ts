import type St from '@girs/st-18';
import * as Main from '@girs/gnome-shell/ui/main';

import { LifecycleScope, type ManagedSource } from '~/core/lifecycleScope.ts';
import { createManagedSource } from '~/core/mainLoop.ts';
import type { AuroraDash } from '~/shared/ui/dash.ts';
import type { DockHotArea } from '~/dock/hotArea.ts';
import type { DockIntellihide } from '~/dock/intellihide.ts';
import type { DashMotionIntegration } from '~/dock/motion/dashMotionIntegration.ts';

export type DockMode = 'always-show' | 'always-autohide' | 'intellihide';

export class ManagedDockBinding {
  public intellihide: InstanceType<typeof DockIntellihide> | null = null;
  public hotArea: InstanceType<typeof DockHotArea> | null = null;
  public strutActor: St.Widget | null = null;
  public hotAreaActive = false;
  public readonly lifecycle = new LifecycleScope();
  public readonly autoHideRelease: ManagedSource = createManagedSource(this.lifecycle);
  public readonly hotAreaEnable: ManagedSource = createManagedSource(this.lifecycle);

  constructor(
    public readonly monitorIndex: number,
    public readonly mode: DockMode,
    public readonly container: St.Bin,
    public readonly dash: AuroraDash,
    public readonly motion: DashMotionIntegration,
  ) {}

  destroy(signalOwner: object): void {
    this.lifecycle.dispose();
    this.intellihide?.disconnectObject(signalOwner);
    this.hotArea?.disconnectObject(signalOwner);
    this.container.disconnectObject(signalOwner);

    if (this.hotArea) {
      Main.layoutManager.removeChrome(this.hotArea);
      this.hotArea.destroy();
      this.hotArea = null;
    }

    if (this.strutActor) {
      Main.layoutManager.removeChrome(this.strutActor);
      this.strutActor.destroy();
      this.strutActor = null;
    }

    this.intellihide?.destroy();
    this.intellihide = null;
    this.motion.dispose();
    this.dash.detachFromContainer();
    this.dash.destroy();

    Main.layoutManager.removeChrome(this.container);
    this.container.destroy();
  }
}
