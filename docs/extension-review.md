# GNOME Extensions review notes

This page maps current Shexli findings to their source owners for manual review of the production
ZIP. It applies the
[GNOME Extensions review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)
to the current Shexli output; it is not a replacement for that output or a rule-ID allowlist.

## Current baseline

On 2026-08-28, `just shexli` ran successfully inside the `aurora-shell-devel` Toolbox against
`aurora-shell@luminusos.github.io.shell-extension.zip` and reported five findings: zero errors, four
warnings, and one manual-review item.

| Rule        | Classification                       | Affected files or owners                                                                                                                            | Decision                                                                                                                                                                                                                                                                                           |
| ----------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EGO-A-005` | Expected manual review               | `capture/captureOcrSession.js`, `capture/screenshotCapture.js`, `clipboard/clipboardHistory.js`, `clipboard/clipboardMonitor.js`                    | Accepted for the declared local clipboard features below.                                                                                                                                                                                                                                          |
| `EGO-X-006` | Accepted warning for current logger  | `core/logger.js`                                                                                                                                    | `lookupByURL(import.meta.url)` obtains this extension's name and UUID for structured logging inside a shared module that has no Extension instance. It creates no object or lifecycle state. Revisit if GNOME provides a context-free structured logging identity or logger context is refactored. |
| `EGO-L-002` | Ownership-indirection false positive | `clipboard/clipboardItem.js`, `dock/externalStorageIcon.js`, `dock/trashIcon.js`, `panel/clock/meetingClock/meetingClockPill.js`                    | Owners release menus, monitors, cancellables, operations, and widgets before or through actor-tree destruction.                                                                                                                                                                                    |
| `EGO-L-005` | Actor/owner lifetime false positive  | `clipboard/clipboardItem.js`, `dock/externalStorageIcon.js`, `dock/trashIcon.js`, `panel/clock/meetingClock/meetingClockPill.js`                    | Child actor references die with `super.destroy()`; Meeting Clock destroys its widget and the module drops the pill owner.                                                                                                                                                                          |
| `EGO-L-003` | Lifecycle-indirection false positive | Capture Tools, Clipboard, Tray Icons, Aurora Menu, Bluetooth, clocks, Lock Keys, Low Battery, Volume Mixer, App Search Tooltip, Privacy, and themes | Signals are owned by `LifecycleScope`, `connectObject()`, widget destruction, or an explicit backend/manager `destroy()`.                                                                                                                                                                          |

Do not copy these decisions to a new line automatically. A future scan is accepted only after the
reported source owner, teardown path, and package behavior are traced again.

## Clipboard declaration

Aurora Shell intentionally accesses the clipboard in Clipboard History and Capture Tools.
`metadata.json` describes both uses, states that data remains local, and records that Clipboard
History has no default shortcut. This satisfies the guideline that clipboard access be declared.

Clipboard History reads and stores clipboard content locally so the user can browse and restore it.
Capture Tools writes the requested screenshot or recognized text to the clipboard. Neither feature
shares clipboard or OCR data with a third party. A web search occurs only after an explicit user
action and uses the configured provider.

Any new clipboard call requires all of the following evidence before acceptance:

- the use is declared accurately in packaged metadata;
- no clipboard shortcut ships with a default binding;
- sharing outside the machine requires explicit user action;
- the new call site and its data path are added to this baseline.

## Subprocess review

Capture Tools invokes the local `tesseract` executable only after an OCR action. It uses
`Gio.Subprocess.new()` with an argument vector, supports cancellation and forced termination, and
does not package a binary or transmit the image. A companion service would add installation and
lifecycle work without changing this local, user-triggered boundary, so the direct subprocess is an
accepted exception.

The direct subprocess calls below use argument vectors and follow direct user actions:

- Aurora Menu runs user-configured commands only after they are selected.
- Its Extensions item selects the first installed manager from `gnome-extensions-app`,
  `gnome-shell-extension-prefs`, or `flatpak run com.mattjakeman.ExtensionManager`.
- Volume Mixer opens `gnome-control-center sound` from its Sound Settings item.
- Background Apps requests the application's quit action first and uses `flatpak kill <app-id>` only
  as the fallback for a user-selected Quit action.

Trash asks Gio to open `trash:///`. Its file-manager fallback creates a `Gio.AppInfo` from the
Shell-provided executable after `GLib.shell_quote()` and passes the fixed Trash URI to
`launch_uris()`. No user-controlled command text enters that command-line string.

Aurora Shell packages no executable binary and invokes no command through a shell. A new subprocess
must document why a GNOME API cannot perform the job, how arguments are separated, who terminates
it, and what user action starts it.

## Lifecycle findings

`LifecycleScope` records signal disconnections and cleanup callbacks, disposes them in reverse
order, and is idempotent. `ManagedSource` and `ManagedTimeout` bind replaceable GLib sources to that
scope. This indirection accounts for the current `EGO-L-003` findings and for main-loop sources that
Shexli does not report.

Actor-owning classes use their `destroy()` methods as the boundary. Clipboard Item releases its menu
before `super.destroy()` destroys the card tree. Trash and External Storage release menus, monitors,
cancellables, operations, and signals before their final actor destruction. Meeting Clock Pill
unregisters and destroys its widget, after which the module drops the pill owner. These paths account
for the current `EGO-L-002` and `EGO-L-005` locations.

A future lifecycle finding is accepted only when the concrete owner can be named and a disable or
destroy path demonstrably releases it. “LifecycleScope is used elsewhere” is not evidence.

## Package policy

The production ZIP is the only artifact submitted to extensions.gnome.org. It targets only the Shell
versions in `metadata.json`, includes the schema XML, `LICENSE`, and `CREDITS.md`, and excludes
developer tooling. The separately named development ZIP exists for DevTool tests and contributor
sessions.

Re-run `just shexli` after any change to runtime code, metadata, schemas, package contents,
clipboard/subprocess behavior, or ownership. Preserve the complete command output as location-level
evidence; update this summary with the date, totals, every rule, affected owners, and evidence for
each classification.
