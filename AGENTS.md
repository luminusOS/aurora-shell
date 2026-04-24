# AGENTS instructions

## Git Policy

**Never create commits, pull requests, or push to any remote.** Do not run `git commit`, `git push`, `git pr`, or any equivalent. Leave all git operations to the user.

## Validation After Changes

After **any** code change, always run these two commands and fix any errors before considering the task done:

1. `just validate` — type-checks the TypeScript source without emitting output
2. `just test-all` — builds and runs all integration tests, printing a pass/fail summary

Do not leave a task incomplete if either command reports errors or failures.

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
- **Unit tests:** `just unit-test` — runs unit tests via `yarn test:unit` (vitest)
- **Single integration test:** `just test <script>` — runs one shell test script with `gnome-shell-test-tool` (headless); requires `just package` first
- **All integration tests:** `just test-all` — builds and runs all `tests/shell/aurora*.js` scripts, printing a pass/fail summary
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
  - `extension.ts` — entry point; iterates the registry and instantiates modules via each definition's `factory`
  - `module.ts` — base `Module` class (accepts `ExtensionContext`)
  - `moduleDefinition.ts` — shared `ModuleOption` / `ModuleMetadata` / `ModuleDefinition` types
  - `registry.ts` — aggregator; imports each module's `definition` export and returns them in UI order (used by `extension.ts`)
  - `prefsMetadata.ts` — pure metadata mirror for the prefs UI; cannot import modules because prefs runs in `gnome-extensions-app` (no `resource:///org/gnome/shell/*` available)
  - `prefs.ts` — generic extension preferences UI driven by `prefsMetadata.ts`
  - `core/` — Clean Architecture core
    - `context.ts` — `ExtensionContext` interface and implementation
    - `logger.ts` — Abstracted logging
    - `settings.ts` — `SettingsManager` abstraction for GSettings
    - `adapters/` — Infrastructure adapters (e.g., `ShellEnvironment`)
  - `modules/` — one file (or subfolder) per feature module
  - `shared/` — shared utilities used across modules
  - `styles/` — SCSS stylesheets (compiled to light + dark CSS)
  - `types/` — TypeScript type declarations (`@girs`, GJS, etc.)
- `data/` — resources files
  - `schemas/` — GSettings schema XML
  - `icons/` — SVG icons used in the project
  - `po/` — translation files
- `tests/` — automated tests
  - `unit/` — vitest unit tests (metadata, registry, schema)
  - `shell/` — GNOME Shell integration test scripts (run via `gnome-shell-test-tool`)
- `.github/workflows/ci.yml` — CI pipeline (lint + type-check → unit tests + build → integration tests)
- `scripts/` — helper shell scripts (`create-toolbox.sh`, `run-gnome-shell.sh`, `bump-version.sh`)
- `esbuild.ts` — esbuild bundler configuration
- `sass.config.ts` — Sass compiler configuration
- `justfile` — all project commands
- `metadata.json` — GNOME extension metadata (uuid, version, shell versions)
- `dist/` — build output (gitignored)

## Architecture

1. **Dependency Injection:** Modules **must not** access global variables (like `Main` or `Gio.Settings`) directly. Instead, they receive an `ExtensionContext` in their constructor.
2. **Abstractions:** Use `this.context.settings` for configuration and `this.context.shell` for GNOME Shell environment interactions.
3. **Layering:** Keep UI logic (Clutter/St) separated from pure domain logic. Complex algorithms should be extracted into pure TypeScript files (e.g., `src/modules/dock/monitorTopology.ts`).
4. **Metadata-Driven UI:** The preferences window is generated dynamically from `src/prefsMetadata.ts` (a hand-maintained mirror of each module's metadata, kept in parity by `tests/unit/registry.test.ts`). If a module needs options, define them in the `options` array of its `ModuleDefinition` and mirror them into `prefsMetadata.ts`.
5. **Self-Registering Modules:** Each module file exports a `definition: ModuleDefinition` co-located with its class. The factory that constructs the module lives on the definition itself — `src/registry.ts` is a pure aggregator and never references module classes directly.

## Adding a Module

1. Create `src/modules/myModule.ts` with a `Module` subclass **and** a co-located `definition` export:

```typescript
import { gettext as _ } from 'gettext';

import type { ExtensionContext } from '~/core/context.ts';
import type { ModuleDefinition } from '~/moduleDefinition.ts';
import { Module } from '~/module.ts';

export class MyModule extends Module {
  constructor(context: ExtensionContext) {
    super(context);
  }
  override enable(): void { /* setup using this.context */ }
  override disable(): void { /* cleanup */ }
}

export const definition: ModuleDefinition = {
  key: 'my-module',
  settingsKey: 'module-my-module',
  title: _('My Module'),
  subtitle: _('Description'),
  options: [
    { key: 'my-option', title: _('Option'), subtitle: _('Desc'), type: 'switch' },
  ],
  factory: (ctx) => new MyModule(ctx),
};
```

2. Register the definition in `src/registry.ts` (one import + one array entry, preserving UI order):

```typescript
import { definition as myModule } from '~/modules/myModule.ts';
// …inside getModuleRegistry():
return [/* …, */ myModule];
```

3. Mirror the metadata into `src/prefsMetadata.ts` (prefs cannot import modules — see the file header):

```typescript
{
  key: 'my-module',
  settingsKey: 'module-my-module',
  title: _('My Module'),
  subtitle: _('Description'),
  options: [
    { key: 'my-option', title: _('Option'), subtitle: _('Desc'), type: 'switch' },
  ],
},
```

4. Add a GSettings key (`data/schemas/org.gnome.shell.extensions.aurora-shell.gschema.xml`):

```xml
<key name="module-my-module" type="b">
  <default>true</default>
  <summary>Enable My Module</summary>
  <description>What this module does</description>
</key>
```

`tests/unit/registry.test.ts` enforces that step 2, step 3, and step 4 stay in parity — a half-finished addition will fail CI.

## Coding Standards

- File names: `camelCase.ts`
- Classes: `PascalCase`
- Private members: `_prefixed`
- Constants: `UPPER_CASE`
- Keep `enable()` and `disable()` symmetric.
- **Strictly follow Dependency Injection.** No direct imports of `gi://Shell`, `Main`, etc., inside module domain logic.

## Reading GNOME Shell Source

GNOME Shell JS source is embedded in `libshell-XX.so` as a GResource archive. The stylesheet files is `gnome-shell-theme.gresource`. Use `gresource` to read it without needing the source checkout.

List available resources:

```sh
gresource list /usr/lib64/gnome-shell/libshell-18.so
gresource list /usr/share/gnome-shell/gnome-shell-theme.gresource
```

Extract a specific file:

```sh
gresource extract /usr/lib64/gnome-shell/libshell-18.so /org/gnome/shell/ui/dash.js
gresource extract /usr/share/gnome-shell/gnome-shell-theme.gresource /org/gnome/shell/theme/gnome-shell-dark.css
```

Extract css file:



Common files of interest:

- `/org/gnome/shell/ui/dash.js` — Dash widget (DashIcon, Dash class, DnD handling)
- `/org/gnome/shell/ui/appFavorites.js` — AppFavorites (reads/writes `favorite-apps` gsettings)
- `/org/gnome/shell/ui/dnd.js` — drag-and-drop infrastructure (DragMotionResult, DragDropResult)
- `/org/gnome/shell/ui/main.js` — global singletons (layoutManager, overview, etc.)
- `/org/gnome/shell/theme/gnome-shell-dark.css` — stylesheets
