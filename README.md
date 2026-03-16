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

## Adding a Module

Adding a module is quick. You wire it in once, and Aurora handles lifecycle + preferences automatically.

1. Create your module file at `src/modules/myModule.ts`.

```typescript
import { Module } from '~/module.ts';

export class MyModule extends Module {
  override enable(): void {
    // setup
  }

  override disable(): void {
    // cleanup (mirror enable)
  }
}
```

2. Register the module in `src/registry.ts` so it appears in Preferences.

```typescript
// Inside getModuleRegistry()
{
  key: 'my-module',
  settingsKey: 'module-my-module',
  title: _('My Module'),
  subtitle: _('Short, user-facing description'),
},
```

3. Add the module factory in `src/extension.ts`.

```typescript
import { MyModule } from '~/modules/myModule.ts';

const MODULE_FACTORIES: Record<string, () => Module> = {
  // ...existing entries...
  'my-module': () => new MyModule(),
};
```

4. Add a toggle key to `schemas/org.gnome.shell.extensions.aurora-shell.gschema.xml`.

```xml
<key name="module-my-module" type="b">
  <default>true</default>
  <summary>Enable My Module</summary>
  <description>What this module does</description>
</key>
```

5. Build and verify.

```bash
just build
```

After that, your module should appear in Preferences and respect runtime enable/disable.

## Build System

- **esbuild** bundles TypeScript (target: Firefox 102 / GJS 1.73.2+, format: ESM)
- **Sass** compiles SCSS stylesheets (light + dark variants)
- **AdmZip** packages the extension as a `.zip` for distribution

## Code Style

- Files: `camelCase.ts`
- Classes: `PascalCase`
- Private members: `_prefixed`
- Constants: `UPPER_CASE`
