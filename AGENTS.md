# AGENTS instructions

## Git Policy

**Never create commits, pull requests, or push to any remote.** Do not run `git commit`, `git push`, `git pr`, or any equivalent. Leave all git operations to the user.

## Validation After Changes

After **any** code change, always follow these rules to ensure quality while being efficient:

1.  **Always run `just validate`** — type-checks the source, lints, and checks formatting. Fix any reported errors.
2.  **Run targeted integration tests:**
    *   If you modified only **one module**, run only the integration test for that module (e.g., `just test tests/shell/auroraTrayIcons.js`).
    *   If you made **formatting-only changes** (Prettier) and have already passed the tests in a previous turn, you only need to run `just validate`.
    *   If you made **architectural or cross-cutting changes**, run `just toolbox test-all`.

**IMPORTANT:** Never execute the `test` command (or `test-all`) chained with another command using `&&`. Always run it as a separate standalone turn.

To read only the relevant output from a `test-all` run (pass/fail summary):
```sh
just toolbox test-all 2>&1 | grep -E "PASS:|FAIL:|Results:"
```

Do not leave a task incomplete if either command reports errors or failures.

## Commands

- **Install deps:** `just deps` — runs `yarn install`; use once or when updating packages
- **Build:** `just build` — compiles TypeScript and SCSS, copies metadata/schemas, compiles `.mo` files
- **Package:** `just package` — packs the extension as a `.zip` in `dist/target/` (depends on `build`)
- **Install:** `just install` — installs the already-packaged `.zip` to GNOME Shell (requires `just package` first)
- **Full install:** `just full-install` — packages + installs in one step
- **All:** `just all` — clean + full-install
- **Uninstall:** `just uninstall` — disables and removes the extension
- **Run (host):** `just run` — launches a devkit GNOME Shell session (headless, Wayland)
- **Run (toolbox):** `just toolbox run` — same as above, but inside the Fedora toolbox
- **Create toolbox:** `just toolbox create` — create the `aurora-shell-devel` Fedora toolbox
- **Remove toolbox:** `just toolbox remove` — delete the toolbox
- **Validate:** `just validate` — runs tsc, ESLint, Prettier check, and Stylelint
- **Lint:** `just lint` — runs ESLint only
- **Watch SCSS:** `just watch` — watches `src/styles/` and recompiles on change
- **View logs:** `just logs` — shows recent `aurora` entries from the current boot journal
- **Clean:** `just clean` — removes `dist/`
- **Deep clean:** `just distclean` — removes `dist/` and `node_modules/`
- **Unit tests:** `just unit-test` — runs unit tests via `yarn test:unit` (vitest)
- **Coverage:** `just coverage` — runs unit tests with coverage report
- **Single integration test:** `just test <script>` — packages and runs one shell test script headlessly (e.g., `just test tests/shell/auroraTrayIcons.js`)
- **All integration tests:** `just test-all` — packages and runs all `tests/shell/aurora*.js` on the host, printing a pass/fail summary
- **All integration tests (toolbox):** `just toolbox test-all` — same as above but inside the Fedora toolbox (preferred; use this instead of `just test-all`)
- **Single integration test (toolbox):** `just toolbox test <script>` — packages and runs one test inside the toolbox
- **Vagrant VM:** `just vagrant create|run|ssh|remove` — Vagrant-based devkit VM (mirrors `toolbox` but uses a full Fedora VM via Vagrant)

### Translation commands

- **Regenerate POT template:** `just pot` — builds then scans compiled JS (`dist/`) and rewrites the `.pot` file with all `_()` strings. Run this whenever translatable strings are added or removed.
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
  - `modules/` — one **folder** per feature module, named after the module (e.g., `dock/dock.ts`); the main entry file shares the folder name
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
- `scripts/` — helper shell scripts (`create-toolbox.sh`, `run-gnome-shell.sh`, `run-vagrant-gnome-shell.sh`)
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

1. Create `src/modules/myModule/myModule.ts` with a `Module` subclass **and** a co-located `definition` export. Every module **must** live in its own folder named after the module (e.g., `dock/dock.ts`, `panel/panel.ts`):

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
import { definition as myModule } from '~/modules/myModule/myModule.ts';
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

## Logging Style

Prefix every log message with the module name in `[PascalCase]` brackets. Use the global `logger` from `~/core/logger.ts` — never `console.log/warn` or `GLib.log_structured` directly from module code.

```typescript
import { logger } from '~/core/logger.ts';

// Correct
logger.log('[AuroraTray] Item added: ' + id);

// Wrong
logger.log('[Aurora Shell] [aurora-tray] Item added: ' + id);
console.warn('[aurora-shell] Something failed');
```

The `[Aurora Shell]` prefix is redundant — SYSLOG_IDENTIFIER already routes journal output to the extension.

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
