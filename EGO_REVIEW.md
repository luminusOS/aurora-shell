# EGO Review Notes

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
uses `Gio.SubprocessLauncher` arguments directly rather than a shell, supports cancellation and forced
termination, and does not transmit captured content. A companion D-Bus service would add installation
and lifecycle complexity disproportionate to this optional, user-triggered operation, so this remains
a documented subprocess exception.

## Analyzer interpretation

Aurora Shell uses `LifecycleScope`, `connectObject()`, and actor ownership for cleanup. Static analyzers
can miss those indirect ownership paths. Treat a warning as a false positive only after tracing the
corresponding enable/disable or create/destroy path; do not suppress or ignore findings by category.

`AuroraDash._isDestroyed` is a narrow compatibility exception. The GNOME Shell base Dash creates raw
connections that may call overridden methods after the subclass begins teardown, so the guard protects
those callbacks until the base actor finishes destruction. Keep the invariant comment and Shell
integration coverage if this exception changes.

### Shexli baseline (2026-07-28)

The production ZIP reports five findings, zero errors, and four warnings:

- `EGO-A-005` is the declared clipboard manual review described above.
- `EGO-L-002` is a structural false positive. Capture Tools destroys session actors through its
  session `LifecycleScope`; Trash and External Storage are custom actors whose menus, monitors,
  cancellables, and signals are released by their `destroy()` overrides before `super.destroy()`
  destroys the owned child tree.
- `EGO-L-005` is a custom-actor false positive for the non-null `toggleButton` child expected by
  `DashItemContainer`. It remains actor-owned and is released by `super.destroy()`.
- `EGO-L-003` is an indirection false positive. The listed signals are owned by `LifecycleScope`,
  `connectObject()`, widget destruction, or the corresponding backend/manager `destroy()` method.
- `EGO-L-004` is an indirection false positive. Clipboard History removes its startup idle through
  `LifecycleScope`; Aurora Dash removes all six stored source IDs in `destroy()`; Auto Theme Switcher
  registers `_cancelScheduledTick()` in its `LifecycleScope`.

Recheck this classification against every new Shexli run. A stable rule ID does not imply that new
locations are automatically accepted.

## Package policy

The production ZIP contains `LICENSE` and `CREDITS.md`, excludes developer tooling, targets only the
Shell versions declared in `metadata.json`, and is the only artifact submitted to EGO. The development
ZIP is separate and exists solely for the local DevTool integration test and development sessions.
