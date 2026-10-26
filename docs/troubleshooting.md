# Troubleshooting

First identify whether installation, extension loading, a specific module, or the development environment failed. Preserve the first error before trying another build.

## Installation and loading

Confirm the running Shell version and extension state:

```bash
gnome-shell --version
gnome-extensions info aurora-shell@luminusos.github.io
```

Aurora Shell supports only the versions in `metadata.json`. If `gnome-extensions install` succeeds but the extension is unavailable, log out and back in, then enable it again. Wayland sessions cannot restart GNOME Shell with Alt+F2 and `r`.

For a local checkout, `just install` first builds and installs the development package. If `gnome-extensions` or `glib-compile-schemas` is missing, install the GNOME Shell command-line and GLib development tools provided by your distribution; the package recipe cannot complete without them.

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

`ModuleManager` logs the key it is enabling or disabling and catches factory/enable failures per module. A single failed module should not stop unrelated modules. Match the logged key to [Module reference](module-reference.md), disable that module in preferences, and reproduce once.

If no module appears, inspect the extension state with `gnome-extensions info`. Syntax, schema, or entry-point failures occur before module reconciliation and usually appear in the GNOME Shell journal.

## A module is enabled but inactive

The manager requires an enabled GSettings switch and a compatible runtime. The current catalog uses desktop role without manifest capability requirements. On a mobile-only topology, Aurora currently adds a desktop fallback role, so a missing UI usually means an optional dependency or Shell surface is absent rather than role gating.

Weather Clock needs the GNOME Weather schema and usable weather data. Bluetooth, audio, calendar, power-menu, and tray features wait for their corresponding Shell surfaces. Check the dependency in the [module reference](module-reference.md) and the first module-prefixed warning in the journal.

## Toolbox failures

`just toolbox create` builds the repository `Containerfile` unless `AURORA_TOOLBOX_IMAGE` is set. A missing `toolbox` or `podman` binary is a host setup problem. An image pull/build error should be resolved before changing tests.

Confirm the expected container name or choose a separate one:

```bash
AURORA_TOOLBOX_NAME=aurora-shell-test just toolbox create
AURORA_TOOLBOX_NAME=aurora-shell-test just toolbox test
```

If a test passes on the host but fails in Toolbox, rerun only that test in Toolbox and inspect its printed Shell output. Toolbox supplies the GNOME environment; the CI runner additionally creates system D-Bus, logind, and GDM mocks, so CI-only service failures may need reproduction through `scripts/run-ci-shell-tests.sh` inside the CI container.

## Capture Tools OCR

Annotation and export do not require OCR. The OCR button appears only when the option is enabled. Install `tesseract` and the language data named by the `+`-separated preference. Leave the language field empty to derive a language from the system locale.

Aurora passes an argument vector directly to `Gio.Subprocess`; it does not invoke a shell. OCR runs only after the user requests it and remains local. A missing executable or language pack is reported as a Capture Tools error. Test the same language outside Aurora before changing the extension:

```bash
tesseract --list-langs
```

## Vela VPN Quick Settings

The Vela module and its Shell fallback are both disabled by default. The intended path uses Vela's `org.luminus.Vela` D-Bus control service. Without that service, enable “Use GNOME Shell Fallback” or leave the module disabled.

When Vela cannot be reached, Aurora logs the remote D-Bus error. If “Use GNOME Shell Fallback” is enabled, fallback occurs only for service, owner, method, object, or interface absence. Vela errors from a live API are not hidden by calling Shell's original toggle. Disable the module to restore the unpatched GNOME behavior immediately.

## External Display Brightness

### Manual DDC ranges

Calibration lives in the Aurora Shell preferences: expand **External Display Brightness** and choose **Monitor calibration → Configure…**. Quick Settings only shows the brightness sliders. The preferences window asks the running Shell for its detected external displays over a session D-Bus interface owned by the extension, so the module must be enabled. Profiles are saved in GSettings, and the Shell applies them as soon as it sees the change. Enter raw integer DDC endpoints, not percentages. **Apply limits** is available once the range is valid. No test sweep is performed. Applying limits changes the slider mapping and reads the current value, without writing brightness. **Pause control** excludes that external display from both individual and master writes without affecting native backlights or other displays.

Profiles are saved in the `external-brightness-calibrations` key and survive logout and reboot. Each one is stored under a SHA-256 of the monitor model (EDID manufacturer, product code and model name), never the EDID or serial number. Every monitor of one model shares one profile, so two monitors of the same model cannot have different limits. A manual range only applies while the monitor reports the maximum it was calibrated against; if the monitor reports another maximum, its control is paused until the range is configured again. **Use reported range** removes the stored profile, including a pause. While Aurora re-detects displays after a monitor or service change, calibrated displays are paused and requests are dropped; the stored profile returns when detection finishes.

The master percentage is a position in the approved range, not a measurement of luminance or a promise to match the monitor's own percentage. Reads outside the configured range are clipped for display only; they never trigger corrective writes. Changing a range drops queued requests but cannot undo a command already sent to the service. Neither the service's success status nor an EDID match proves that a hardware range is safe.

For example, the RealTek/demoset-1 behavior in [ddcutil issue #200](https://github.com/rockowitz/ddcutil/issues/200) resembles an observed monitor whose physical maximum reads as raw 35 despite advertising 100. This is evidence for offering manual ranges, not for applying 35 to all RealTek monitors. Reading raw zero after a button adjustment does not prove that writing zero is safe. Validate endpoints separately with physical controls accessible; do not probe values already known to cause unexpected darkness.

### Detection and native brightness

When a controllable external display is detected, one unified Brightness slider replaces GNOME's visible brightness row. Its menu arrow opens named controls for the built-in display and every controllable external display. Native backlights still use GNOME's brightness manager, including its automatic-brightness behavior; external displays use DDC/CI.

The master shows the brightest display. Moving it adds the same difference to every display: with displays at 30% and 40%, raising the master by 5 points gives 35% and 45%. A display stops at 0% or 100% and loses its difference from the others there. Putting the master at 100% or 0% puts every display at that end, so a dimmer display can still reach full brightness. A calibrated display counts percentages inside its approved range, so 100% means its manual maximum. Unlike GNOME's own built-in brightness, the master does not keep the ratio between displays. Equal percentages on different monitors do not necessarily produce equal physical luminance.

If all external displays disappear, the service stops, or the module is disabled, the original GNOME brightness control is restored. Hardware brightness keys continue through GNOME's manager and affect its native displays; unifying the menu does not redirect those keys to DDC/CI.

When multiple Mutter monitors share the same EDID identity, Aurora cannot safely associate the service display with one connector. It keeps the DDC/CI control, uses the EDID model name, and neither targets an OSD nor applies the Mutter backlight filter to that ambiguous match.

The module is disabled by default. It needs `ddcutil`, which installs the udev rule that gives the logged-in user access to the I²C buses and loads `i2c-dev`, and `ddcutil-service`, which provides `com.ddcutil.DdcutilService` on the session bus. Without the service, Aurora logs once that the service is not available and adds no sliders.

A display gets a slider only when the service lists it and it answers a brightness read. Enable DDC/CI in the monitor's own menu if it is missing. Check what the service detects outside Aurora:

```bash
busctl --user call com.ddcutil.DdcutilService /com/ddcutil/DdcutilObject com.ddcutil.DdcutilInterface Detect u 0
```

When a monitor is connected, removed or replaced, Aurora waits briefly and asks the service for a new detection; other display changes, such as scale or arrangement, only re-read the last detection. Aurora may start the service once each time the module is enabled, which includes unlocking the session. If the service stops while the module runs, the sliders disappear until the service runs again; Aurora does not restart it.

Limitations:

- Monitors that GNOME already controls through a backlight keep GNOME's own brightness slider and get no DDC/CI slider. This includes an external monitor in HDR mode, where GNOME's slider changes the software luminance, not the monitor's hardware brightness.
- Displays that report identical EDIDs are addressed by ddcutil display number. Another program that runs a new detection can renumber them until Aurora's next refresh, after a monitor change or a service restart.
- A monitor that stays connected while switched off, and is switched on after the last detection, gets a slider only after the next detection. Reconnect it, or disable and enable the module.
- Brightness keys keep controlling GNOME's own brightness; they do not change external displays.

## Shexli or package failures

`just shexli` depends on a successful production package. A missing `gnome-extensions` failure comes from packaging, before Shexli runs. If packaging succeeds but no analyzer is installed, the wrapper uses `uvx --from shexli shexli` when available and otherwise prints the install command.

After any successful scan, compare rule IDs and locations with [GNOME Extensions review notes](extension-review.md). Never accept a new location because an older finding used the same rule ID.
