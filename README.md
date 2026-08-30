<div align="center">
  <img src="data/media/aurora-shell-logo.svg" width="200" alt="Aurora Shell logo" />
</div>

# Aurora Shell

Aurora Shell is a GNOME Shell 50 extension with 22 optional desktop features in one preferences
window. It runs inside GNOME Shell and supports no other desktop environment.

Supported Shell versions are listed in `metadata.json`. Shell internals change between GNOME
releases, so do not force-install Aurora Shell on an unlisted version. Some modules also depend on
services that may be absent: GNOME Weather for Weather Clock, Tesseract for Capture Tools OCR, and
Vela for Vela VPN Quick Settings.

Aurora Shell is licensed under GPL-3.0-only. See [LICENSE](LICENSE) and [CREDITS.md](CREDITS.md).

## Install

The recommended build is published on
[extensions.gnome.org](https://extensions.gnome.org/extension/9389/aurora-shell/).

To install a release asset manually, download
`aurora-shell@luminusos.github.io.shell-extension.zip` from the
[GitHub releases page](https://github.com/luminusOS/aurora-shell/releases), then run:

```bash
gnome-extensions install --force aurora-shell@luminusos.github.io.shell-extension.zip
gnome-extensions enable aurora-shell@luminusos.github.io
```

Log out and back in if the extension is not available in the current Shell session. Open the
Extensions app or run `gnome-extensions prefs aurora-shell@luminusos.github.io` to configure modules.

Release assets also include a `.development.shell-extension.zip` package with contributor tools for
development and QA sessions.

## Update or remove

Install a newer ZIP with the same `--force` command. Existing GSettings values remain in the
extension schema unless you reset them explicitly.

Disable or remove Aurora Shell with:

```bash
gnome-extensions disable aurora-shell@luminusos.github.io
gnome-extensions uninstall aurora-shell@luminusos.github.io
```

See [Troubleshooting](docs/troubleshooting.md) when installation, loading, or a module fails.

## Modules

All modules can be toggled independently. Most are enabled by default; Auto Theme Switcher and Vela
VPN Quick Settings are opt-in.

- **Dock and panel:** Dock, Aurora Menu, Power Menu Avatar, Volume Mixer, Low Battery Percentage,
  Lock Key Indicators, Bluetooth Menu, Weather Clock, Meeting Clock, and Tray Icons.
- **Appearance:** Theme Changer, Icon Weave, App Search Tooltip, and Auto Theme Switcher.
- **Behavior:** Skip Overview on Login, Pip On Top, Focus Launched Windows, Capture Tools, XWayland
  Indicator, and Vela VPN Quick Settings.
- **Privacy and clipboard:** Privacy and Clipboard History.

Low Battery Percentage temporarily enables GNOME's native percentage display while a battery is
discharging below 30%. It does not override a percentage display that the user enabled. Vela VPN
Quick Settings routes the Shell VPN toggle through Vela's D-Bus API; its optional GNOME Shell
fallback is also disabled by default.

The [module reference](docs/module-reference.md) records every module key, default, dependency,
runtime policy, and implementation/test location.

## Develop

Development requires Node.js 20 or newer, Yarn 4, `just`, and the GNOME 50 development/runtime tools
used by the selected test path.

```bash
just deps
just validate
just test unit
just package check
```

Start with the [documentation index](docs/README.md). It links to architecture, the edit-run-debug
loop, module authoring, test selection, troubleshooting, and releases. Contributions follow
[CONTRIBUTING.md](CONTRIBUTING.md).

## Credits

Aurora Shell incorporates or adapts work from the GNOME extension community. The complete source,
license, and inspiration record is in [CREDITS.md](CREDITS.md).
