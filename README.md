# Aurora Shell

<div align="center">
  <img src="misc/aurora-shell-logo.png" width="200" />
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

## Commands

```bash
just                # list all commands
just build          # build everything (deps + CSS + TS + zip)
just install        # build + install to GNOME Shell
just quick          # rebuild + copy files (skip full install)
just uninstall      # disable + remove extension
just run            # build + install + run GNOME Shell (auto-detects --devkit or --nested)
just toolbox-run    # same as run, but inside a toolbox
just create-toolbox # create a Fedora toolbox for testing
just logs           # show recent extension logs
just clean          # remove build artifacts
just distclean      # remove artifacts + node_modules
just validate       # type-check without emitting
just lint           # run eslint
just watch          # watch SCSS for changes
```

## Testing

```bash
# Run directly on the host (builds, installs, and launches GNOME Shell)
just run

# Run inside a toolbox (useful when host lacks gnome-shell dev packages)
just create-toolbox   # first time only
just toolbox-run
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

2. Add an entry to `MODULE_REGISTRY` in `src/registry.ts`:

```typescript
{
  key: 'myModule',
  settingsKey: 'module-my-module',
  title: 'My Module',
  subtitle: 'Description',
},
```

3. Add the import and factory to `MODULE_FACTORIES` in `src/extension.ts`:

```typescript
import { MyModule } from "./modules/myModule.ts";

const MODULE_FACTORIES: Record<string, () => Module> = {
  // ...existing entries...
  myModule: () => new MyModule(),
};
```

4. Add the key to `schemas/org.gnome.shell.extensions.aurora-shell.gschema.xml`:

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
