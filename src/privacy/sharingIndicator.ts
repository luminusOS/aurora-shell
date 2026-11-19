import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export function getSharingIndicator(): any | null {
  const statusArea = Main.panel.statusArea as any;
  if (!statusArea.screenSharing) return null;

  return statusArea.screenSharing;
}
