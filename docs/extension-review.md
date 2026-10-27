# GNOME Extensions review notes

This page maps current Shexli findings to their source owners for manual review of the production ZIP. It applies the [GNOME Extensions review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html) to the current Shexli output; it is not a replacement for that output or a rule-ID allowlist.

## Current baseline

On 2026-10-25, the production ZIP reported six findings: one version-validation error, four warnings, and one manual-review item, the same totals as `main` before External Display Brightness. The installed Shexli entry point could not import its package, and tree-sitter 0.26 crashed during analysis. The complete scan used `uvx --python 3.13 --from shexli --with 'tree-sitter==0.25.2' shexli dist/target/aurora-shell@luminusos.github.io.shell-extension.zip --format json`; its output is retained in `dist/shexli-external-brightness.json`. These tool dependencies are isolated from the project.

| Rule | Classification | Affected files or owners | Decision |
| --- | --- | --- | --- |
| `EGO-A-005` | Expected manual review | `capture/captureOcrSession.js`, `capture/screenshotCapture.js`, `clipboard/clipboardHistory.js`, `clipboard/clipboardMonitor.js` | Accepted for the declared local clipboard features below. |
| `EGO-X-006` | Accepted warning for current logger | `core/logger.js` | `lookupByURL(import.meta.url)` obtains this extension's name and UUID for structured logging inside a shared module that has no Extension instance. It creates no object or lifecycle state. Revisit if GNOME provides a context-free structured logging identity or logger context is refactored. |
| `EGO-L-002` | Ownership-indirection false positive | `clipboard/clipboardItem.js`, `desktop/trayIcons/trayContainer.js`, `dock/externalStorageIcon.js`, `dock/trashIcon.js`, `panel/clock/calendarReminders/calendarRemindersPill.js`, `privacy/privacyPanel.js` | Owners release menus, monitors, cancellables, operations, and widgets before or through actor-tree destruction. TrayContainer attaches its scroll controller with `add_action()` and destroys the owning actor; Privacy Panel removes its motion controller from the panel and clears the reference on disable. |
| `EGO-L-005` | Actor/owner lifetime false positive | `clipboard/clipboardItem.js`, `desktop/trayIcons/trayContainer.js`, `dock/externalStorageIcon.js`, `dock/trashIcon.js`, `panel/clock/calendarReminders/calendarRemindersPill.js` | Child actor and action references are released with their owning actor; Calendar Reminders destroys its widget and the module drops the pill owner. |
| `EGO-L-003` | Lifecycle-indirection false positive | Capture Tools, Clipboard, Tray Icons, Aurora Menu, Bluetooth, clocks, Lock Keys, Low Battery, Volume Mixer, External Display Brightness, App Search Tooltip, Privacy, and themes | Signals are owned by `LifecycleScope`, `connectObject()`, widget destruction, or an explicit backend/manager `destroy()`. |
| `EGO-M-004` | Analyzer version ceiling | `metadata.json` | Shexli 0.2.1 rejects every major version above 50 in `analyzer/rules/metadata.py`. The project deliberately targets GNOME 51 and tests it in the GNOME 51 Toolbox. Keep the declared target; this scan cannot certify its version field until the analyzer supports it. |

Do not copy these decisions to a new line automatically. A future scan is accepted only after the reported source owner, teardown path, and package behavior are traced again.

## Clipboard declaration

Aurora Shell intentionally accesses the clipboard in Clipboard History and Capture Tools. `metadata.json` describes both uses, states that data remains local, and records that Clipboard History has no default shortcut. This satisfies the guideline that clipboard access be declared.

Clipboard History reads and stores clipboard content locally so the user can browse and restore it. Capture Tools writes the requested screenshot or recognized text to the clipboard. Neither feature shares clipboard or OCR data with a third party. A web search occurs only after an explicit user action and uses the configured provider.

Any new clipboard call requires all of the following evidence before acceptance:

- the use is declared accurately in packaged metadata;
- no clipboard shortcut ships with a default binding;
- sharing outside the machine requires explicit user action;
- the new call site and its data path are added to this baseline.

## Subprocess review

Capture Tools invokes the local `tesseract` executable only after an OCR action. It uses `Gio.Subprocess.new()` with an argument vector, supports cancellation and forced termination, and does not package a binary or transmit the image. A companion service would add installation and lifecycle work without changing this local, user-triggered boundary, so the direct subprocess is an accepted exception.

The direct subprocess calls below use argument vectors and follow direct user actions:

- Aurora Menu runs user-configured commands only after they are selected.
- Its Extensions item selects the first installed manager from `gnome-extensions-app`, `gnome-shell-extension-prefs`, or `flatpak run com.mattjakeman.ExtensionManager`.
- Volume Mixer opens `gnome-control-center sound` from its Sound Settings item.
- Background Apps requests the application's quit action first and uses `flatpak kill <app-id>` only as the fallback for a user-selected Quit action.

Trash asks Gio to open `trash:///`. Its file-manager fallback creates a `Gio.AppInfo` from the Shell-provided executable after `GLib.shell_quote()` and passes the fixed Trash URI to `launch_uris()`. No user-controlled command text enters that command-line string.

Aurora Shell packages no executable binary and invokes no command through a shell. A new subprocess must document why a GNOME API cannot perform the job, how arguments are separated, who terminates it, and what user action starts it.

## Lifecycle findings

`LifecycleScope` records signal disconnections and cleanup callbacks, disposes them in reverse order, and is idempotent. `ManagedSource` and `ManagedTimeout` bind replaceable GLib sources to that scope. This indirection accounts for the current `EGO-L-003` findings and for main-loop sources that Shexli does not report.

Actor-owning classes use their `destroy()` methods as the boundary. Clipboard Item releases its menu before `super.destroy()` destroys the card tree. Trash and External Storage release menus, monitors, cancellables, operations, and signals before their final actor destruction. Calendar Reminders Pill unregisters and destroys its widget, after which the module drops the pill owner. These paths account for the current `EGO-L-002` and `EGO-L-005` locations.

External Display Brightness adds twelve `EGO-L-003` locations, all `LifecycleScope.connect()` calls. `DisplayBrightnessSlider.destroy()` disposes its three slider connections before destroying its menu. In `externalBrightness.js`, calibration settings changes, monitor changes and master requests belong to the module scope, which `disable()` disposes; individual requests, displayed-level changes belong to per-display scopes. These scopes are disposed before their widgets are destroyed. `NativeBrightnessControls` owns its manager connection and three connections per native display; it rebuilds them on every manager `changed`, because GNOME creates new scale objects then, disposes them on destruction and restores the original brightness row. `BrightnessCalibrationService` exports `/org/gnome/Shell/Extensions/AuroraShell/Brightness` on the session bus while the module is enabled and unexports it in `disable()`. The interface is read-only: `GetTargets` lists the detected displays and `Changed` tells the preferences to list them again. The preferences save profiles to the extension's GSettings key; the Shell validates every entry when it reads it and applying a profile never writes brightness. Individual menu rows are destroyed after their slider; the master owns the submenu and its overlay actor. The Shell test checks overlay cleanup and restored native master/submenu functionality after reconnecting a new native scale.

The unified row does not alter GNOME's manager collections or replace its backlight operations. Native sliders write the existing scale's `value`, preserving GNOME's automatic-brightness and dimming path. Its manager `changed` callback runs after GNOME's own brightness item has finished rebuilding; only then does it hide that item, so restoring it cannot expose stale bindings. Correctness/lifecycle review found this ordering requirement in round one; the revised implementation passed round two. Validation passed with 290 unit tests and the targeted Shell test, including master adjustment through zero, native reconnection, and service loss. The master later changed from GNOME's proportional model to one percentage for every display, because a ratio captured before reaching zero left the built-in display below 100% when the master returned to 100%. The captured unified submenu is retained at `/tmp/opencode/unified-brightness.png` for this development session.

Manual calibration received three independent review rounds. Discovery generations now invalidate asynchronous results and pause calibrated displays until enumeration finishes; range changes discard pending writes without pretending to cancel hardware commands already dispatched. Maximum metadata is processed separately from current-value freshness, so changed or zero maxima suspend control even during a write or after a newer user request. Dialog callbacks reject obsolete target/generation/maximum state. Round three found no unresolved blocker or major. Validation, 293 unit tests and the targeted Shell test passed; the latter holds read/write/detection replies to exercise these races, including identical-EDID renumbering. Runtime screenshots are `/tmp/opencode/brightness-calibration.png` and `/tmp/opencode/calibration-submenu.png`. Tests use fake displays; no hardware range is automatically approved by these results.

A future lifecycle finding is accepted only when the concrete owner can be named and a disable or destroy path demonstrably releases it. “LifecycleScope is used elsewhere” is not evidence.

## D-Bus service activation

External Display Brightness talks to the third-party `com.ddcutil.DdcutilService` on the session bus and runs no subprocess. Only the first display listing after `enable()` may start the service through D-Bus activation; every later call uses `NO_AUTO_START`, so a service that is stopped or keeps crashing is not respawned by refreshes or slider moves. Losing the service removes the sliders without calling it, and the module logs its absence once.

## Package policy

The production ZIP is the only artifact submitted to extensions.gnome.org. It targets only the Shell versions in `metadata.json`, includes the schema XML, `LICENSE`, and `CREDITS.md`, and excludes developer tooling. The separately named development ZIP exists for DevTool tests and contributor sessions.

Re-run `just shexli` after any change to runtime code, metadata, schemas, package contents, clipboard/subprocess behavior, or ownership. Preserve the complete command output as location-level evidence; update this summary with the date, totals, every rule, affected owners, and evidence for each classification.

Calibration moved from a Shell modal to preferences at the user's request. The targeted Shell test now launches a real GTK/libadwaita preferences window that reads targets and applies limits over D-Bus, verifies that invalid ranges cannot be applied and that applying writes no brightness. The user later removed the endpoint-verification switch; the Shell still validates every range. The preferences process does not provide Shell's `String.prototype.format`; that defect was caught by this test and fixed.

Calibration profiles became persistent at the user's request. They are stored in the extension's own `external-brightness-calibrations` GSettings key as `<sha256 of model>:<mode>:<min>:<max>:<reported max>`, where the model is the EDID manufacturer, product code and model name; no EDID, serial or model name is stored. The EDID itself also holds each unit's serial number, so it would give every unit its own profile; every monitor of one model shares one profile by design; this replaces the earlier session-only binding whose purpose was to keep a profile from following a renumbered twin. A stored range applies only while the monitor reports the maximum it was calibrated against, and malformed entries are ignored rather than trusted. The targeted Shell test covers restoration after a re-listing, a shared profile across renumbered twins, persistence across disabling and re-enabling the module, and **Use reported range** removing a stored pause.
