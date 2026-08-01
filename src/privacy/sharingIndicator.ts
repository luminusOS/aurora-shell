import * as Main from '@girs/gnome-shell/ui/main';

export function getSharingIndicator(): any | null {
  const statusArea = Main.panel.statusArea as any;
  if (!statusArea.screenSharing) return null;

  return statusArea.screenSharing;
}
