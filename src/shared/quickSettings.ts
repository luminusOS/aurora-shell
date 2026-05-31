import * as Main from '@girs/gnome-shell/ui/main';

/** The Quick Settings menu grid, or null if it does not exist yet. */
export function getQuickSettingsGrid(): any | null {
  return Main.panel.statusArea.quickSettings?.menu?._grid ?? null;
}

/**
 * Locates a Quick Settings widget now, or waits for it to appear in the grid.
 *
 * Quick Settings widgets (toggles, sliders) may not be present yet when a module
 * enables during shell startup. This finds the widget immediately when possible,
 * otherwise watches the grid's `child-added` until `find` succeeds.
 *
 * Returns a cleanup function to cancel a pending watcher (no-op once attached),
 * or `null` when the grid itself is unavailable so the caller can report it.
 */
export function attachToQuickSettings<T>(
  find: () => T | null,
  onAttach: (widget: T) => void,
): (() => void) | null {
  const existing = find();
  if (existing) {
    onAttach(existing);
    return () => {};
  }

  const grid = getQuickSettingsGrid();
  if (!grid) return null;

  let childAddedId = grid.connect('child-added', () => {
    const widget = find();
    if (!widget) return;
    grid.disconnect(childAddedId);
    childAddedId = 0;
    onAttach(widget);
  });

  return () => {
    if (childAddedId) {
      grid.disconnect(childAddedId);
      childAddedId = 0;
    }
  };
}
