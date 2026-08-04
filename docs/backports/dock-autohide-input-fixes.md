# Dock autohide input fixes

This note documents two fixes that should be backported together to the current
stable branch. Both affect the dock when **Always Show Dock** is disabled.

## 1. Hidden dock creates a dead input area

### Symptom

After the dock hides, controls located behind its former bounds cannot be
clicked until the pointer leaves that area. Text fields near the bottom of a
window are a common reproduction case.

### Cause

The visible dash was hidden, but its outer `St.Bin` chrome container remained
allocated and `reactive: true`. The transparent container therefore continued
winning Clutter actor picking and intercepted events intended for the window
underneath.

### Fix

Synchronize the container's input state with dock visibility:

- Disable `container.reactive` immediately when `AuroraDash.hide()` starts.
- Re-enable it before `AuroraDash.show()` starts.
- Keep the separate 1 px `DockHotArea` actor active so the hidden dock can still
  be revealed from the monitor edge.

Relevant file:

- `src/shared/ui/dash.ts`

Regression coverage:

- `tests/shell/auroraDock.js` checks that a hidden dock container is not
  reactive and that showing the dock restores input.

## 2. Intellihide oscillates on external monitors

### Symptom

On some secondary or third monitors connected through HDMI/DisplayPort, pushing
the pointer against the bottom edge repeatedly opens and closes the dock. The
dock cannot stay open long enough to interact with it.

### Cause

The 1 px `DockHotArea` actor remained reactive after revealing the dock. At the
exact bottom pixel it could stay above the dock in Clutter picking, especially
with non-primary monitor coordinate layouts. The dock consequently did not
receive hover state. When the 1.5 second reveal timeout expired, the code
incorrectly concluded that the pointer had left, released the intellihide
block, hid the dock, and immediately triggered the hot area again.

The timeout also relied primarily on cached stage-coordinate bounds. Those
bounds are useful as a fallback, but direct actor hover is the stronger signal
for whether the user is interacting with the revealed dock.

After monitor rotation, GNOME Shell can emit several allocation, work-area, and
intellihide updates while the monitor topology settles. Each update requested
`show(true)`, and `AuroraDash` restarted every request from its fully hidden
transform. The dock therefore flashed without actually completing a hide.
Several Dock call sites also invoked `show(true)` immediately after
`blockAutoHide(true)`, even though `blockAutoHide()` already performs that
operation.

The intellihide calculation also checked only the focused window or the final
window in the actor list. Focus and stacking changes could therefore alternate
the result even when another window continued overlapping the dock. Workspace
filtering was applied only to the primary monitor, so secondary-monitor docks
could remain blocked by windows belonging to another workspace.

### Fix

- Add `DockHotArea.setEnabled()` to control both edge triggering and actor
  reactivity.
- Disable the hot area for the duration of a reveal so the dock receives hover
  events even at the bottommost pixel.
- Ignore duplicate hot-area triggers while a reveal is already active.
- Keep the reveal alive while `AuroraDash.pointerInsideDock` is true.
- Retain the coordinate check as a fallback, with complete X and Y bounds.
- Keep the reveal active and the hot area disabled throughout the complete
  hide animation.
- Poll the dash visibility and recreate the hot area/barrier only after the
  dash is fully hidden. Re-enabling it when the release timeout expires is too
  early and causes a new edge trigger during the closing animation.
- Disable the hot area while the overview is visible.
- Track the requested visibility target in `AuroraDash`, making repeated
  requests toward the active target idempotent.
- Preserve the current transform when a show interrupts an in-progress hide,
  instead of jumping back to the fully hidden pose.
- Remove redundant `show(true)` calls after `blockAutoHide(true)`.
- Evaluate every relevant window and block intellihide when any one overlaps
  the dock.
- Apply active-workspace filtering uniformly to every monitor, while retaining
  windows pinned to all workspaces.
- Recalculate overlap on `active-workspace-changed` and track allocation
  changes for every relevant window actor.
- Emit `status-changed` only for a real state transition, including the initial
  unknown-to-clear/blocked transition.

Relevant files:

- `src/dock/hotArea.ts`
- `src/dock/dock.ts`
- `src/shared/ui/dash.ts`

Regression coverage:

- `tests/shell/auroraDock.js` checks that revealing through the hot area marks
  the reveal active, makes the hot-area actor non-reactive, and rearms edge
  detection only after the hide animation completes. It also verifies that
  repeated show requests start the hidden-to-shown animation only once.

## Backport validation

Run:

```sh
just validate
just shexli
just toolbox test tests/shell/auroraDock.js
```

Manual verification should cover:

1. A maximized window with a clickable control behind the hidden dock bounds.
2. The primary monitor.
3. Every external monitor, including monitors with negative X/Y coordinates or
   different vertical alignment.
4. Repeated edge reveals while a window overlaps the dock.
5. Moving the pointer from the hot edge into the dock and then away from it.
6. Rotating one monitor while three or more monitors are active, then revealing
   and interacting with every dock.
