# GNOME Extensions Review Notes

This file records the Aurora Shell review baseline for
[the GNOME Extensions review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)
and the
[EGO AI reference](https://blogs.gnome.org/jrahmatzadeh/2026/07/27/ego-ai-reference/).
It is not a replacement for reviewing the generated production ZIP.

## Accepted manual-review findings

### Clipboard access

Aurora Shell intentionally accesses the clipboard in Clipboard History and Capture Tools.
`metadata.json` describes both uses. Clipboard History stores data locally, its shortcut is unset by
default, and neither clipboard nor OCR data is shared with third parties.

### Capture Tools OCR subprocess

Capture Tools invokes the local `tesseract` executable only after an explicit OCR action. The command
uses `Gio.Subprocess.new()` with an argument vector rather than a shell, supports cancellation and forced
termination, and does not transmit captured content. A companion D-Bus service would add installation
and lifecycle complexity disproportionate to this optional, user-triggered operation, so this remains
a documented subprocess exception.

### Other subprocesses

Aurora Shell does not package executable binaries or invoke a command through a shell. The remaining
process launches use explicit argument vectors and follow direct user actions:

- Aurora Menu launches only commands configured by the user and selected from its menu.
- Volume Mixer opens `gnome-control-center sound` from its Sound Settings item.
- Background Apps first requests the application's `quit` action and uses `flatpak kill <app-id>` only
  as a fallback for a user-selected Quit action.

## Analyzer interpretation

Aurora Shell uses `LifecycleScope`, `connectObject()`, and actor ownership for cleanup. Static analyzers
can miss those indirect ownership paths. Treat a warning as a false positive only after tracing the
corresponding enable/disable or create/destroy path; do not suppress or ignore findings by category.

### Shexli baseline (2026-07-31)

The production ZIP reports four findings, zero errors, and three warnings:

- `EGO-A-005` is the declared clipboard manual review described above.
- `EGO-L-002` is an ownership-indirection false positive. Clipboard Item releases its menu before
  `super.destroy()` destroys the card actor tree; Trash and External Storage release their menus,
  monitors, cancellables, operations, and signals before their final `super.destroy()`; Meeting Clock
  Pill unregisters and destroys its widget in its own `destroy()` method.
- `EGO-L-005` reports child references retained by the short-lived owner object. Clipboard Item's
  actions and the Trash/External Storage `toggleButton` are actor-owned and released by
  `super.destroy()`. Meeting Clock Pill destroys its widget, after which the module drops the pill
  owner itself.
- `EGO-L-003` is an indirection false positive. The listed signals are owned by `LifecycleScope`,
  `connectObject()`, widget destruction, or the corresponding backend/manager `destroy()` method.
  This includes the signals in Capture Tools, Clipboard History/Panel, Tray Icons, Aurora Menu,
  Bluetooth, Meeting/Weather Clock, Lock Keys, Low Battery, Volume Mixer, App Search Tooltip, Privacy,
  Theme Changer, and Auto Theme Switcher. A scope deterministically disconnects its registrations in
  reverse order when the owning module or widget is disabled or destroyed.

Capture Tools destroys its session actors directly in `disable()`. Replaceable main-loop sources are
owned by `LifecycleScope` through `ManagedSource`; replacing a source removes the previous one and
disposing the scope removes the active source. Aurora Dash, Dock bindings, Clipboard History, Auto
Theme Switcher, clocks, tray widgets, Bluetooth, and the remaining single-source owners use this
path. Dynamic source collections in Icon Weave and Dock Intellihide remain explicitly removed because
their per-operation ownership is clearer as a set. Shexli does not currently report `EGO-L-004` for
either cleanup form.

Recheck this classification against every new Shexli run. A stable rule ID does not imply that new
locations are automatically accepted.

## Package policy

The production ZIP contains `LICENSE` and `CREDITS.md`, excludes developer tooling, targets only the
Shell versions declared in `metadata.json`, and is the only artifact submitted to EGO. The development
ZIP is separate and exists solely for the local DevTool integration test and development sessions.
