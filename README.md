<div align="center">
  <img src="data/media/aurora-shell-logo.svg" width="200" />
</div>

# Aurora Shell

A modular GNOME Shell extension that adds quality-of-life features missing in vanilla GNOME.

> **Project goal:** Aurora Shell is a proving ground. Over time, the aim is for some of its
> features to mature and make their way upstream into GNOME Shell itself. Modules here are
> meant to be useful on their own today and good candidates for upstream tomorrow.

## Modules

Aurora is split into independent modules, so you can enable only what you want.

### Dock & Panel

| Module | Description |
|--------|-------------|
| **Dock** | Replaces the stock dash with a smart per-monitor dock with intellihide and edge reveal |
| **Volume Mixer** | Adds per-application volume sliders to Quick Settings with fast access to Sound Settings |
| **Bluetooth Menu** | Shows battery level and animated icons in the Bluetooth Quick Settings panel |
| **Weather Clock** | Shows GNOME Weather next to the panel clock |
| **Meeting Clock** | Shows upcoming calendar events next to the panel clock and notifies when meetings are about to start |
| **Tray Icons** | System tray in the panel that shows SNI app icons and GNOME background apps, with configurable icon limit, icon size, attention notifications, and smart SNI/background-app deduplication |

### Appearance

| Module | Description |
|--------|-------------|
| **Theme Changer** | Keeps GNOME light/dark color scheme behavior consistent |
| **Icon Weave** | Automatically fixes missing app icons by matching untracked windows to their apps in-memory |
| **App Search Tooltip** | Shows app names on hover in the overview search results |
| **Auto Theme Switcher** | Automatically switches between light and dark theme based on time |

### Behavior

| Module | Description |
|--------|-------------|
| **No Overview** | Skips the overview on startup so you land directly on your desktop |
| **Pip On Top** | Keeps Picture-in-Picture windows above other windows automatically |
| **XWayland Indicator** | Adds an X11 badge to XWayland apps in the Alt+Tab switcher |

### Privacy & Clipboard

| Module | Description |
|--------|-------------|
| **Privacy** | Adds screen sharing privacy features, including automatic Do Not Disturb and panel content hiding |
| **Clipboard History** | Adds searchable clipboard history with pinning and keyboard navigation |

All modules can be toggled independently from the extension preferences.

## Requirements

- GNOME Shell 50+
- [Node.js](https://nodejs.org/) 20+
- [Yarn](https://yarnpkg.com/) 4+
- [just](https://github.com/casey/just) (command runner)

## Installation

### From extensions.gnome.org (Recommended)

The easiest way to install is from the official GNOME Extensions website.

<a href="https://extensions.gnome.org/extension/9389/aurora-shell/">
  <img src="https://github.com/andyholmes/gnome-shell-extensions-badge/raw/master/get-it-on-ego.svg" alt="Get it on EGO" width="200" />
</a>

### From command-line

Download the latest `aurora-shell@luminusos.github.io.shell-extension.zip` file from the
[GitHub releases page](https://github.com/luminusOS/aurora-shell/releases), then install it:

```bash
gnome-extensions install --force aurora-shell@luminusos.github.io.shell-extension.zip
gnome-extensions enable aurora-shell@luminusos.github.io
```

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for information on project architecture, code style, and step-by-step instructions on how to add a new module.

## Credits & Acknowledgements

Aurora Shell builds on the work of the wider GNOME community. Special thanks to:

- [**maniacx/Bluetooth-Battery-Meter**](https://github.com/maniacx/Bluetooth-Battery-Meter) the animated Bluetooth icons used by the Bluetooth Menu module come from this project.
- [**CleoMenezesJr/weather-oclock**](https://github.com/CleoMenezesJr/weather-oclock) inspired the Weather Clock module.
- [**danmoz/meetingtime**](https://github.com/danmoz/meetingtime) inspired the Meeting Clock module.
- [**swsnr/gnome-shell-extension-xwayland-indicator**](https://codeberg.org/swsnr/gnome-shell-extension-xwayland-indicator/) the inspiration behind the XWayland Indicator module.

See [CREDITS.md](CREDITS.md) for the full list of attributed work.
