import * as Main from '@girs/gnome-shell/ui/main';

/**
 * Resolves the panel screen-sharing indicator, shared by the privacy submodules.
 *
 * GNOME Shell 49+ exposes a dedicated `screenSharing` status area indicator;
 * older shells only have `quickSettings._remoteAccess`.
 */
export function getSharingIndicator(): any | null {
  const statusArea = Main.panel.statusArea as any;
  if (statusArea.screenSharing) return statusArea.screenSharing;
  return statusArea.quickSettings?._remoteAccess ?? null;
}
