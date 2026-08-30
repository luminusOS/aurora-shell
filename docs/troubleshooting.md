# Troubleshooting

First identify whether installation, extension loading, a specific module, or the development
environment failed. Preserve the first error before trying another build.

## Installation and loading

Confirm the running Shell version and extension state:

```bash
gnome-shell --version
gnome-extensions info aurora-shell@luminusos.github.io
```

Aurora Shell supports only the versions in `metadata.json`. If `gnome-extensions install` succeeds
but the extension is unavailable, log out and back in, then enable it again. Wayland sessions cannot
restart GNOME Shell with Alt+F2 and `r`.

For a local checkout, `just install` first builds and installs the development package. If
`gnome-extensions` or `glib-compile-schemas` is missing, install the GNOME Shell command-line and
GLib development tools provided by your distribution; the package recipe cannot complete without
them.

Remove a broken local installation before returning to the release build:

```bash
just uninstall
gnome-extensions install --force aurora-shell@luminusos.github.io.shell-extension.zip
```

## Logs and module load failures

Read recent extension messages from the current boot:

```bash
just logs
```

`ModuleManager` logs the key it is enabling or disabling and catches factory/enable failures per
module. A single failed module should not stop unrelated modules. Match the logged key to
[Module reference](module-reference.md), disable that module in preferences, and reproduce once.

If no module appears, inspect the extension state with `gnome-extensions info`. Syntax, schema, or
entry-point failures occur before module reconciliation and usually appear in the GNOME Shell
journal.

## A module is enabled but inactive

The manager requires an enabled GSettings switch and a compatible runtime. The current catalog uses
desktop role without manifest capability requirements. On a mobile-only topology, Aurora currently
adds a desktop fallback role, so a missing UI usually means an optional dependency or Shell surface
is absent rather than role gating.

Weather Clock needs the GNOME Weather schema and usable weather data. Bluetooth, audio, calendar,
power-menu, and tray features wait for their corresponding Shell surfaces. Check the dependency in
the [module reference](module-reference.md) and the first module-prefixed warning in the journal.

## Toolbox failures

`just toolbox create` builds the repository `Containerfile` unless `AURORA_TOOLBOX_IMAGE` is set. A
missing `toolbox` or `podman` binary is a host setup problem. An image pull/build error should be
resolved before changing tests.

Confirm the expected container name or choose a separate one:

```bash
AURORA_TOOLBOX_NAME=aurora-shell-test just toolbox create
AURORA_TOOLBOX_NAME=aurora-shell-test just toolbox test
```

If a test passes on the host but fails in Toolbox, rerun only that test in Toolbox and inspect its
printed Shell output. Toolbox supplies the GNOME environment; the CI runner additionally creates
system D-Bus, logind, and GDM mocks, so CI-only service failures may need reproduction through
`scripts/run-ci-shell-tests.sh` inside the CI container.

## Capture Tools OCR

Annotation and export do not require OCR. The OCR button appears only when the option is enabled.
Install `tesseract` and the language data named by the `+`-separated preference. Leave the language
field empty to derive a language from the system locale.

Aurora passes an argument vector directly to `Gio.Subprocess`; it does not invoke a shell. OCR runs
only after the user requests it and remains local. A missing executable or language pack is reported
as a Capture Tools error. Test the same language outside Aurora before changing the extension:

```bash
tesseract --list-langs
```

## Vela VPN Quick Settings

The Vela module and its Shell fallback are both disabled by default. The intended path uses Vela's
`org.luminus.Vela` D-Bus control service. Without that service, enable “Use GNOME Shell Fallback” or
leave the module disabled.

When Vela cannot be reached, Aurora logs the remote D-Bus error. If “Use GNOME Shell Fallback” is
enabled, fallback occurs only for service, owner, method, object, or interface absence. Vela errors
from a live API are not hidden by calling Shell's original toggle. Disable the module to restore the
unpatched GNOME behavior immediately.

## Shexli or package failures

`just shexli` depends on a successful production package. A missing `gnome-extensions` failure comes
from packaging, before Shexli runs. If packaging succeeds but no analyzer is installed, the wrapper
uses `uvx --from shexli shexli` when available and otherwise prints the install command.

After any successful scan, compare rule IDs and locations with
[GNOME Extensions review notes](extension-review.md). Never accept a new location because an older
finding used the same rule ID.
