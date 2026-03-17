# AGENTS instructions

## Environment Setup

- Install dependencies: `yarn install` (or just run `just build` — it runs `yarn install` automatically)
- Requires **Node.js 20+**, **Yarn 4+**, and **[just](https://github.com/casey/just)**.
- For a full test environment, create a Fedora toolbox: `just toolbox create` (first time only).
- To run GNOME Shell in devkit mode: `just run` (host) or `just toolbox run` (inside toolbox).
- **Never run gnome-shell directly** — always use `just run` or `just toolbox run` to ensure the correct environment flags (`--wayland --devkit`) are set.

## Commands

- **Build:** `just build` — installs deps, compiles TypeScript and SCSS, copies metadata/schemas, compiles `.mo` files
- **Install:** `just install` — builds + packages as `.zip` + installs to GNOME Shell
- **Quick update:** `just quick` — rebuild + rsync files to extension dir (skips full install)
- **Uninstall:** `just uninstall` — disables and removes the extension
- **Run (host):** `just run` — build + install + launch a devkit GNOME Shell session
- **Run (toolbox):** `just toolbox run` — same as above, but inside the Fedora toolbox
- **Create toolbox:** `just toolbox create` — create the `gnome-shell-devel` Fedora toolbox
- **Remove toolbox:** `just toolbox remove` — delete the toolbox
- **Type-check:** `just validate` — runs `tsc` without emitting output
- **Lint:** `just lint` — runs ESLint
- **Watch SCSS:** `just watch` — watches `src/styles/` and recompiles on change
- **View logs:** `just logs` — shows recent `aurora` entries from the current boot journal
- **Clean:** `just clean` — removes `dist/`
- **Deep clean:** `just distclean` — removes `dist/` and `node_modules/`

### Translation commands

- **Regenerate POT template:** `just pot` — scans compiled JS (`dist/`) and rewrites `po/aurora-shell@luminusos.github.io.pot` with all `_()` strings. Run this whenever translatable strings are added or removed.
- **Merge new strings into .po files:** `just update-po` — runs `msgmerge` on every `po/*.po` file against the current `.pot`. Run after `just pot`.
- **Compile .mo binaries:** `just compile-mo` — compiles each `po/*.po` into `dist/locale/<lang>/LC_MESSAGES/*.mo`. Called automatically by `just build`.

## Repository Structure

- `src/` — TypeScript source root
  - `extension.ts` — entry point; loads and manages all modules via `MODULE_FACTORIES`
  - `module.ts` — base `Module` class (`enable` / `disable` lifecycle)
  - `registry.ts` — `MODULE_REGISTRY` metadata list (key, settingsKey, title, subtitle)
  - `prefs.ts` — extension preferences UI
  - `modules/` — one file (or subfolder) per feature module
  - `shared/` — shared utilities used across modules
  - `styles/` — SCSS stylesheets (compiled to light + dark CSS)
  - `types/` — TypeScript type declarations (`@girs`, GJS, etc.)
- `data/` — resources files
  - `schemas/` — GSettings schema XML
  - `icons/` — SVG icons used in the project
  - `po/` — translation files
- `scripts/` — helper shell scripts (`create-toolbox.sh`, `run-gnome-shell.sh`, `bump-version.sh`)
- `esbuild.ts` — esbuild bundler configuration
- `sass.config.ts` — Sass compiler configuration
- `justfile` — all project commands
- `metadata.json` — GNOME extension metadata (uuid, version, shell versions)
- `dist/` — build output (gitignored)

## Architecture

1. `extension.ts` is the GNOME Shell extension entry point. It instantiates all modules from `MODULE_FACTORIES` on `enable()` and disposes them on `disable()`.
2. Each module is an independent class that extends `Module` and implements `enable()` and `disable()`.
3. `MODULE_REGISTRY` in `registry.ts` drives the preferences UI — every module needs an entry here.
4. GSettings keys (in `schemas/`) control per-module toggles from the preferences panel.
5. The build toolchain (esbuild + Sass) targets **GJS 1.73.2+ / Firefox 102** (ESM format).

## Adding a Module

1. Create `src/modules/myModule.ts` extending `Module`:

```typescript
import { Module } from './module.ts';

export class MyModule extends Module {
  override enable(): void { /* setup */ }
  override disable(): void { /* cleanup */ }
}
```

2. Register it in `MODULE_REGISTRY` (`src/registry.ts`):

```typescript
{ key: 'myModule', settingsKey: 'module-my-module', title: 'My Module', subtitle: 'Description' },
```

3. Add its factory to `MODULE_FACTORIES` (`src/extension.ts`):

```typescript
import { MyModule } from "./modules/myModule.ts";
// inside MODULE_FACTORIES:
myModule: () => new MyModule(),
```

4. Add a GSettings key (`schemas/org.gnome.shell.extensions.aurora-shell.gschema.xml`):

```xml
<key name="module-my-module" type="b">
  <default>true</default>
  <summary>Enable My Module</summary>
  <description>What this module does</description>
</key>
```

## Coding Standards

- File names: `camelCase.ts`
- Classes: `PascalCase`
- Private members: `_prefixed`
- Constants: `UPPER_CASE`
- Keep `enable()` and `disable()` symmetric — everything connected in `enable()` must be disconnected in `disable()`.
- Avoid importing GJS global modules at the top level in code paths that run in multiple processes; use lazy / conditional imports where needed.
