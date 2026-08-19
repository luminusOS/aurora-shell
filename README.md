<div align="center">
  <img src="data/media/aurora-shell-logo.svg" width="200" />
</div>

# Aurora Shell

A modular GNOME Shell extension that adds quality-of-life features missing in vanilla GNOME.

Aurora Shell is distributed under the GNU General Public License, version 3 only. See
[LICENSE](LICENSE) and [CREDITS.md](CREDITS.md) for licensing and attribution details.

> **Project goal:** Aurora Shell is a proving ground. Over time, the aim is for some of its
> features to mature and make their way upstream into GNOME Shell itself. Modules here are
> meant to be useful on their own today and good candidates for upstream tomorrow.

## Modules

Aurora is split into independent modules, so you can enable only what you want.

### Dock & Panel

- **Dock** - replaces the stock dash with a dock on the bottom, left, or right edge of each monitor. It auto-hides by default and supports intellihide, an always-visible mode, adaptive icon sizes, edge reveal, Trash, and removable drive shortcuts.
- **Aurora Menu** - adds an Aurora panel menu with recent items, useful shortcuts, configurable panel icon, optional Activities button hiding, and a custom command slot.
- **Volume Mixer** - adds per-application volume sliders to Quick Settings with fast access to Sound Settings.
- **Low Battery Percentage** - uses GNOME's native battery percentage setting while the battery is discharging below 20%, without overriding users who already enabled it.
- **Lock Key Indicators** - shows Caps Lock and Num Lock indicators in the top panel.
- **Bluetooth Menu** - shows battery level and animated icons in the Bluetooth Quick Settings panel.
- **Weather Clock** - shows GNOME Weather next to the panel clock, with configurable placement before or after the clock.
- **Meeting Clock** - shows upcoming calendar events next to the panel clock, supports meeting alerts, snooze timing, lookahead controls, all-day event filtering, and events without join links.
- **Tray Icons** - adds a system tray for SNI app icons and GNOME background apps, with configurable icon limit, icon size, attention timeout, symbolic icon recoloring, background-app deduplication, and optional Quick Settings background-app hiding.

### Appearance

- **Theme Changer** - keeps GNOME light/dark color scheme behavior consistent.
- **Icon Weave** - automatically fixes missing app icons by matching untracked windows to their apps in memory.
- **App Search Tooltip** - shows app names on hover in the overview search results.
- **Auto Theme Switcher** - automatically switches between light and dark theme based on configured times.

### Behavior

- **Skip Overview on Login** - skips the overview on startup so GNOME Shell opens directly to the desktop.
- **Pip On Top** - keeps Picture-in-Picture windows above other windows automatically.
- **Focus Launched Windows** - focuses newly launched windows instead of showing window-ready notifications.
- **Capture Tools** - adds a Gradia-style floating annotation toolbar to the top of GNOME's screenshot interface as soon as it opens, with drawing, shapes, text, numbered annotations, annotated export, and optional local Tesseract OCR.
- **XWayland Indicator** - adds an X11 badge to XWayland apps in the Alt+Tab switcher.

### Privacy & Clipboard

- **Privacy** - adds screen sharing privacy features, including automatic Do Not Disturb and panel content hiding.
- **Clipboard History** - adds searchable clipboard history with pinning, keyboard navigation, configurable polling, and a user-assigned shortcut.

All modules can be toggled independently from the extension preferences.

## Requirements

- GNOME Shell 50+
- Tesseract with the desired language data (optional, for Capture Tools OCR)
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

Stable releases, release candidates, and nightly pre-releases publish two assets:

- `aurora-shell@luminusos.github.io.shell-extension.zip` — production package recommended for
  regular installations;
- `aurora-shell@luminusos.github.io.development.shell-extension.zip` — DevTool-enabled package for
  contributors, QA, and development sessions.

Do not use the development package as a regular desktop installation.

## Contributing

We welcome contributions. Start with [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and commit
conventions, then use the [documentation index](docs/README.md) for architecture, development,
module, and release guidance.

## Credits & Acknowledgements

Aurora Shell builds on the work of the wider GNOME community. Special thanks to:

- [**maniacx/Bluetooth-Battery-Meter**](https://github.com/maniacx/Bluetooth-Battery-Meter) the animated Bluetooth icons used by the Bluetooth Menu module come from this project.
- [**CleoMenezesJr/weather-oclock**](https://github.com/CleoMenezesJr/weather-oclock) inspired the Weather Clock module.
- [**danmoz/meetingtime**](https://github.com/danmoz/meetingtime) inspired the Meeting Clock module.
- [**swsnr/gnome-shell-extension-xwayland-indicator**](https://codeberg.org/swsnr/gnome-shell-extension-xwayland-indicator/) the inspiration behind the XWayland Indicator module.
- [**AlexanderVanhee/gradia-capture**](https://github.com/AlexanderVanhee/gradia-capture) inspired the Capture Tools annotation workflow.
- [**SamkitJain660/Shotzy**](https://github.com/SamkitJain660/Shotzy) inspired the local screenshot OCR workflow.
- [**Orsso/d2d-companion**](https://github.com/Orsso/d2d-companion) is the source of the adapted Dock motion behavior.

See [CREDITS.md](CREDITS.md) for the full list of attributed work.
