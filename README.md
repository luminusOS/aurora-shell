<div align="center">
  <img src="data/media/aurora-shell-logo.svg" width="128" alt="Aurora Shell logo" />

# Aurora Shell

_Optional desktop features for GNOME Shell, each one a switch away_

<a href="https://extensions.gnome.org/extension/9389/aurora-shell/"><img src="https://raw.githubusercontent.com/andyholmes/gnome-shell-extensions-badge/master/get-it-on-ego.svg" height="100" alt="Get it on GNOME Extensions" /></a>

[![CI](https://github.com/luminusOS/aurora-shell/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/luminusOS/aurora-shell/actions/workflows/ci.yml?query=branch%3Amain) [![Release](https://img.shields.io/github/v/release/luminusOS/aurora-shell?include_prereleases&sort=semver)](https://github.com/luminusOS/aurora-shell/releases) [![GNOME Shell 51](https://img.shields.io/badge/GNOME%20Shell-51-4a86cf?logo=gnome&logoColor=white)](metadata.json) [![License: GPL-3.0-only](https://img.shields.io/badge/license-GPL--3.0--only-blue)](LICENSE)

[Modules](#modules) · [Install](#install) · [Configure](#configure) · [Develop](#develop)

</div>

Aurora Shell adds dock and panel controls, appearance tweaks, window behavior and clipboard tools to GNOME Shell. Every feature is a separate module: turn on the ones you want in a single preferences window and the rest stay out of the way.

## Modules

Most modules are enabled by default. Auto Theme Switcher, Vela VPN Quick Settings and External Display Brightness are opt-in.

| Area | Modules |
| --- | --- |
| Dock and panel | Dock, Aurora Menu, Power Menu Avatar, Volume Mixer, External Display Brightness, Low Battery Percentage, Lock Key Indicators, Bluetooth Menu, Weather Clock, Calendar Reminders, Tray Icons |
| Appearance | Theme Changer, Icon Weave, App Search Tooltip, Auto Theme Switcher |
| Behavior | Skip Overview on Login, Pip On Top, Focus Launched Windows, Capture Tools, XWayland Indicator, Vela VPN Quick Settings, Wiggle Cursor |
| Privacy and clipboard | Privacy, Clipboard History |

Low Battery Percentage shows GNOME's battery percentage while the battery discharges below 30%, and leaves it alone if you already turned it on. Vela VPN Quick Settings routes the Quick Settings VPN toggle through Vela's D-Bus API; its fallback to GNOME Shell's own VPN handling is off by default.

Wiggle Cursor enlarges the pointer to five times its size after a quick shake of the mouse, and returns it to normal as soon as you stop shaking. It keeps your cursor theme, ignores shaking while a button is held, and yields to accessibility magnification.

The [module reference](docs/module-reference.md) lists every module's settings key, default, dependencies, runtime policy and where its code and tests live.

## Install

Install Aurora Shell from [extensions.gnome.org](https://extensions.gnome.org/extension/9389/aurora-shell/), with the browser or an app such as Extension Manager.

> [!IMPORTANT]
>
> Aurora Shell supports only the GNOME Shell versions listed in [metadata.json](metadata.json). Shell internals change between releases, so do not force-install it on another version.

To install a release by hand, download `aurora-shell@luminusos.github.io.shell-extension.zip` from the [releases page](https://github.com/luminusOS/aurora-shell/releases) and run:

```bash
gnome-extensions install --force aurora-shell@luminusos.github.io.shell-extension.zip
gnome-extensions enable aurora-shell@luminusos.github.io
```

> [!NOTE]
>
> On Wayland, GNOME Shell only loads a newly installed extension after you log out and back in.

Releases also include a `.development.shell-extension.zip` with tools for contributors and QA sessions.

Some modules need software that may not be installed:

| Module                         | Needs                           |
| ------------------------------ | ------------------------------- |
| Weather Clock                  | GNOME Weather                   |
| Capture Tools text recognition | Tesseract                       |
| Vela VPN Quick Settings        | Vela                            |
| External Display Brightness    | `ddcutil` and `ddcutil-service` |

### Update or remove

To update, install a newer ZIP with the same `--force` command. Your settings stay in the extension's GSettings schema unless you reset them.

To remove Aurora Shell:

```bash
gnome-extensions disable aurora-shell@luminusos.github.io
gnome-extensions uninstall aurora-shell@luminusos.github.io
```

If installation, loading or a module fails, see [Troubleshooting](docs/troubleshooting.md).

## Configure

Open the preferences from the Extensions app, or run:

```bash
gnome-extensions prefs aurora-shell@luminusos.github.io
```

Each module has its own switch, and modules with options show them below it.

## Develop

The [development guide](docs/development.md) covers the tools you need and the test environments you can use. Commands run through `just`, the Yarn version is pinned in [package.json](package.json), and [Containerfile](Containerfile) defines the GNOME environment that CI and Toolbox share.

```bash
just deps
just validate
just test unit
just package check
```

The [documentation index](docs/README.md) links to the architecture, the edit-run-debug loop, writing modules, choosing tests, troubleshooting and releases. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Credits

Aurora Shell includes and adapts work from the GNOME extension community. [CREDITS.md](CREDITS.md) records every source, license and inspiration.
