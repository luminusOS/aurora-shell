# Aurora Shell

<div align="center">
  <img src="data/media/aurora-shell-logo.png" width="200" />
</div>

A modular GNOME Shell extension that adds quality-of-life features missing in vanilla GNOME.

## Modules

Aurora is split into independent modules, so you can enable only what you want.

| Module | Description |
|--------|-------------|
| **No Overview** | Skips the overview on startup so you land directly on your desktop |
| **Pip On Top** | Keeps Picture-in-Picture windows above other windows automatically |
| **Theme Changer** | Keeps GNOME light/dark color scheme behavior consistent |
| **Dock** | Replaces the stock dash with a smart per-monitor dock with intellihide and edge reveal |
| **Volume Mixer** | Adds per-application volume sliders to Quick Settings with fast access to Sound Settings |
| **XWayland Indicator** | Adds an indicator to the app activities in Ctrl + Tab to indicate where XWayland is running |
| **DND on Screen Share** | Automatically enables Do Not Disturb mode when screen sharing or recording is active |
| **Icon Weave** | Automatically fixes missing app icons by matching untracked windows to their apps in-memory |

All modules can be toggled independently from the extension preferences.

## Requirements

- GNOME Shell 45+
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

```bash
git clone https://github.com/luminusOS/aurora-shell.git
cd aurora-shell
just install
```

## Testing

```bash
# Run directly on the host (builds, installs, and launches GNOME Shell)
just run

# Run inside a toolbox (useful when host lacks gnome-shell dev packages)
just create-toolbox   # first time only
just toolbox-run
```

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for information on project architecture, code style, and step-by-step instructions on how to add a new module.
