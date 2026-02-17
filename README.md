# Aurora Shell

<div align="center">
  <img src="misc/aurora-logo.png" width="200" />
</div>

A modular GNOME Shell extension that adds quality-of-life features missing in vanilla GNOME.

## Modules

| Module | Description |
|--------|-------------|
| **Theme Changer** | Syncs panel style with system color scheme (light/dark) |
| **Dock** | Taskbar with auto-hide, intellihide, per-monitor and per-workspace activity filtering |
| **No Overview** | Disables the overview on startup |
| **Pip On Top** | Keeps Picture-in-Picture windows always on top (Wayland fix) |

All modules can be toggled independently via the extension preferences.

## Requirements

- GNOME Shell 45+
- [Node.js](https://nodejs.org/) 20+
- [Yarn](https://yarnpkg.com/) 4+
- [just](https://github.com/casey/just) (command runner)

## Installation

```bash
git clone https://github.com/luminusOS/aurora-shell.git
cd aurora-shell
just install
```

## Commands

```
just              # list all commands
just build        # build everything (deps + CSS + TS + zip)
just install      # build + install to GNOME Shell
just quick        # rebuild + copy files (skip full install)
just uninstall    # disable + remove extension
just logs         # show recent extension logs
just clean        # remove build artifacts
just distclean    # remove artifacts + node_modules
just validate     # type-check without emitting
just lint         # run eslint
just watch        # watch SCSS for changes
```

## Testing

```bash
# GNOME 49+
dbus-run-session -- gnome-shell --devkit

# GNOME 48 and earlier
dbus-run-session -- gnome-shell --nested --wayland
```

## Adding a Module

1. Create `src/modules/myModule.ts`:

```typescript
import { Module } from './module.ts';

export class MyModule extends Module {
  override enable(): void {
    // setup
  }

  override disable(): void {
    // cleanup
  }
}
```

2. Register in `src/registry.ts`:

```typescript
import { MyModule } from './modules/myModule.ts';

// Add to MODULE_REGISTRY:
{ key: 'myModule', settingsKey: 'module-my-module', create: () => new MyModule(), title: 'My Module', subtitle: 'Description' },
```

3. Add key to `schemas/org.gnome.shell.extensions.aurora-shell.gschema.xml`:

```xml
<key name="module-my-module" type="b">
  <default>true</default>
  <summary>Enable My Module</summary>
  <description>What this module does</description>
</key>
```

The module automatically appears in extension preferences and responds to runtime toggle.

## Build System

- **esbuild** bundles TypeScript (target: Firefox 102 / GJS 1.73.2+, format: ESM)
- **Sass** compiles SCSS stylesheets (light + dark variants)
- **AdmZip** packages the extension as a `.zip` for distribution

## Code Style

- Files: `camelCase.ts`
- Classes: `PascalCase`
- Private members: `_prefixed`
- Constants: `UPPER_CASE`

## License

LGPL-3.0-or-later
