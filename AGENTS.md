# AGENTS instructions

## Git Policy

**Never create commits, pull requests, or push to any remote.** Do not run `git commit`, `git push`, `git pr`, or any equivalent. Leave all git operations to the user.

## Validation After Changes

After a change to code under `src/`, always follow these rules to ensure quality while being efficient.
For documentation, workflow, metadata, translation, or other non-`src/` changes, do not run `just validate`
or `just shexli` unless the task specifically requires that validation.

1.  **Run `just validate`** — type-checks the source, lints, and checks formatting. Fix any reported errors.
2.  **Run `just shexli`** — packages the extension and runs the extensions.gnome.org static analyzer on the generated ZIP. Review every finding. Some `warning` or `manual_review` findings can be false positives or accepted GNOME-review tradeoffs, but they must be called out explicitly; fix any real regression before finishing.
3.  **Run targeted integration tests:**
    *   If you modified only **one module**, run only the integration test for that module (e.g., `just test tests/shell/auroraTrayIcons.js`).
    *   If you made **formatting-only changes** (Prettier) and have already passed the tests in a previous turn, you only need to run `just validate` and `just shexli`.
    *   If you made **architectural or cross-cutting changes**, run `just toolbox test-all`.

**IMPORTANT:** Never execute the `test` command (or `test-all`) chained with another command using `&&`. Always run it as a separate standalone turn.

To read only the relevant output from a `test-all` run (pass/fail summary):
```sh
just toolbox test-all 2>&1 | grep -E "PASS:|FAIL:|Results:"
```

Do not leave a task incomplete if either command reports errors or failures.

## Commands

- **Install deps:** `just deps` — runs `yarn install`; use once or when updating packages
- **Build:** `just build` — compiles TypeScript and SCSS, copies metadata/schemas, and compiles `.mo` files
- **Package:** `just package` — packs the extension as a `.zip` in `dist/target/` (depends on `build`)
- **Install:** `just install` — installs the already-packaged `.zip` to GNOME Shell (requires `just package` first)
- **Full install:** `just full-install` — packages + installs in one step
- **All:** `just all` — clean + full-install
- **Uninstall:** `just uninstall` — disables and removes the extension
- **Run (host):** `just run` — packages, installs, then launches a devkit GNOME Shell session
- **Run (toolbox):** `just toolbox run` — packages/installs on the host, then runs GNOME Shell inside the Fedora toolbox
- **Create toolbox:** `just toolbox create` — create the `aurora-shell-devel` Fedora toolbox
- **Remove toolbox:** `just toolbox remove` — delete the toolbox
- **Validate:** `just validate` — runs tsc, ESLint, Prettier check, and Stylelint
- **Shexli:** `just shexli` — packages the extension and runs the extensions.gnome.org static analyzer on the generated ZIP
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

- **Regenerate POT template:** `just pot` — builds, then scans compiled JS (`dist/`) and writes the `.pot` into `dist/` (a build artifact, **not** committed — avoids `POT-Creation-Date` churn). Run this whenever translatable strings are added or removed.
- **Merge new strings into .po files:** `just update-po` — depends on `pot`; regenerates the template into `dist/` then runs `msgmerge` on every `data/po/*.po` against it. The hand-translated `data/po/*.po` files are the committed source of truth.
- **Compile .mo binaries:** `just compile-mo` — compiles each `po/*.po` into `dist/locale/<lang>/LC_MESSAGES/*.mo`. Called automatically by `just build`.

## Repository Structure

- `src/` — TypeScript source root
  - `extension.ts` — entry point; iterates the registry and instantiates modules via each definition's `factory`
  - `module.ts` — base `Module` class plus the shared `ModuleOption` / `ModuleMetadata` / `ModuleDefinition` / runtime policy types
  - `registry.ts` — aggregator; imports each module's `definition` export and returns them in UI order (used by `extension.ts`)
  - `prefsMetadata.ts` — pure metadata mirror for the prefs UI; cannot import modules because prefs runs in `gnome-extensions-app` (no `resource:///org/gnome/shell/*` available). Also exports `getSections()` (the ordered list of prefs sections)
  - `prefs.ts` — generic extension preferences UI driven by `prefsMetadata.ts`; renders one `Adw.PreferencesGroup` per section
  - `core/` — Clean Architecture core
    - `context.ts` — `ExtensionContext` interface and implementation
    - `logger.ts` — Abstracted logging
    - `settings.ts` — `SettingsManager` abstraction for GSettings
  - feature modules are grouped by semantic area instead of a single `modules/` root:
    - `dock/` — dock module and dock-specific helpers
    - `panel/` — GNOME panel and Quick Settings integrations
    - `desktop/` — desktop-only modules such as tray icons
    - `patches/` — focused Shell behavior patches and monkey-patches
    - `theme/` — theme and color-scheme modules
    - `privacy/` — privacy and screen-sharing behavior
    - `clipboard/` — clipboard history module and UI
  - `device/` — runtime target and hardware capability detection for future mobile work
  - `dev/` — developer-only tooling (e.g., `devTool.ts`), gated behind the `AURORA_DEVTOOLS=1` env var. **Not** a feature module: it is not in the registry, prefs, or gschema, and is instantiated directly by `extension.ts`
  - `shared/` — shared utilities used across modules (e.g., `quickSettings.ts`)
  - `styles/` — SCSS stylesheets (compiled to light + dark CSS)
  - `types/` — TypeScript type declarations (`@girs`, GJS, etc.)
- `data/` — resources files
  - `schemas/` — GSettings schema XML
  - `icons/` — SVG icons used in the project
  - `po/` — translation files
- `tests/` — automated tests
  - `unit/` — Node test-runner unit tests (`node --test` via `tsx`), auto-discovered by the `tests/unit/*.test.ts` glob — just drop a new `*.test.ts` file in here, no `package.json` edit needed. For pure logic that does not import shell internals.
  - `shell/` — GNOME Shell integration test scripts (run via `gnome-shell-test-tool`) — exercise modules against a real headless GNOME Shell
- `.github/workflows/ci.yml` — CI pipeline (lint + type-check → unit tests + build → integration tests)
- `scripts/` — helper shell scripts (`create-toolbox.sh`, `run-gnome-shell.sh`, `run-vagrant-gnome-shell.sh`)
- `esbuild.ts` — esbuild bundler configuration
- `sass.config.ts` — Sass compiler configuration
- `justfile` — all project commands
- `metadata.json` — GNOME extension metadata (uuid, version, shell versions)
- `dist/` — build output (gitignored)

## Architecture

1. **Settings via context:** Modules receive an `ExtensionContext` in their constructor and read configuration through `this.context.settings` (the `SettingsManager` abstraction) rather than touching `Gio.Settings` directly.
2. **`Main` is fair game:** Importing `Main` (`resource:///org/gnome/shell/ui/main.js`) directly is the idiomatic GNOME-extension way and is expected — there is no shell adapter. Confidence in shell interactions comes from the `tests/shell/` integration suite running a real headless GNOME Shell, not from mocking `Main`.
3. **Layering & testability:** Keep UI logic (Clutter/St) separated from pure domain logic. Extract complex algorithms into pure TypeScript files with no shell imports (e.g., `src/dock/monitorTopology.ts`, `src/desktop/trayIcons/trayState.ts`) so they can be unit-tested with `node --test`. UI/shell glue is covered by integration tests instead.
4. **Metadata-Driven UI:** The preferences window is generated dynamically from `src/prefsMetadata.ts` (a hand-maintained mirror of each module's metadata, kept in parity by `tests/unit/registry.test.ts`). If a module needs options, define them in the `options` array of its `ModuleDefinition` and mirror them into `prefsMetadata.ts`.
5. **Self-Registering Modules:** Each module file exports a `definition: ModuleDefinition` co-located with its class. The factory that constructs the module lives on the definition itself — `src/registry.ts` is a pure aggregator and never references module classes directly.

## Adding a Module

1. Create a module in the appropriate semantic area with a `Module` subclass **and** a co-located `definition` export. Single-file patches can live directly in `src/patches/`; complex modules should use a feature folder such as `src/panel/myModule/myModule.ts`.

```typescript
import { gettext as _ } from 'gettext';

import type { ExtensionContext } from '~/core/context.ts';
import type { ModuleDefinition } from '~/module.ts';
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
  section: 'behavior', // must match an id from getSections() in prefsMetadata.ts
  title: _('My Module'),
  subtitle: _('Description'),
  runtime: { targets: ['desktop'] }, // optional; omitted modules default to desktop-only
  options: [
    { key: 'my-option', title: _('Option'), subtitle: _('Desc'), type: 'switch' },
  ],
  factory: (ctx) => new MyModule(ctx),
};
```

2. Register the definition in `src/registry.ts` (one import + one array entry, preserving UI order):

```typescript
import { definition as myModule } from '~/patches/myModule.ts';
// …inside getModuleRegistry():
return [/* …, */ myModule];
```

3. Mirror the metadata into `src/prefsMetadata.ts` (prefs cannot import modules — see the file header). Include the same `section`:

```typescript
{
  key: 'my-module',
  settingsKey: 'module-my-module',
  section: 'behavior',
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

`tests/unit/registry.test.ts` enforces that steps 2, 3, and 4 stay in parity — including that every module's `section` is a known section id and matches between the registry and `prefsMetadata.ts`. A half-finished addition will fail CI.

### Prefs sections

The prefs window groups modules by `section`. The ordered section list lives in `getSections()` in `src/prefsMetadata.ts`:

```typescript
export function getSections(): ModuleSection[] {
  return [
    { id: 'dock-panel', title: _('Dock & Panel') },
    // …
  ];
}
```

To add a new section, append a `{ id, title }` entry here (the array order is the on-screen group order), then reference its `id` from a module's `section`. A module whose `section` matches no known id falls into a defensive "Other" group at the bottom.

### Clipboard shortcuts

Per the GNOME review guidelines, clipboard-related keyboard shortcuts must not ship with a default. The Clipboard History `clipboard-history-shortcut` key defaults to `[]`; users assign it via the `type: 'shortcut'` row in prefs. Keep any future clipboard shortcuts unset by default.

## Coding Standards

- File names: `camelCase.ts`
- Classes: `PascalCase`
- Private members: `_prefixed`
- Constants: `UPPER_CASE`
- Keep `enable()` and `disable()` symmetric.
- Read settings through `this.context.settings`. Importing `Main`/`Shell`/`St` directly is fine — keep heavy algorithms in shell-free pure files so they stay unit-testable.

## Human Review Quality Bar

Avoid code that only looks plausible. A human reviewer should be able to read a change and see a real contract, not a guess.

- Do not add optional calls such as `object?.method?.(...)` unless that method is a real, documented API or the local type intentionally models it. Never use patterns like `this.disconnectObject?.(this)` on objects that do not own that signal connection contract.
- Do not ship fake behavior. If a UI label, schema description, README entry, or module subtitle says a feature is wired to NetworkManager, ModemManager, UPower, sensors, widgets, or GNOME internals, the code must actually call the relevant API or clearly describe itself as a fallback.
- Keep runtime capability checks honest. Hardware-specific modules must detect missing services/devices at runtime and stay inactive or degrade explicitly.
- Do not scatter `as unknown as ...` casts through feature modules. If GObject construction or Shell internals require a cast, isolate it in a small shared helper/factory with a clear name.
- Do not leave placeholder helpers, legacy duplicates, or unused compatibility functions after a refactor. Remove dead code instead of keeping it “just in case”.
- Keep strings and metadata truthful and synchronized across module `definition`, `src/prefsMetadata.ts`, schema XML, README/architecture docs, and `.po` files when strings change.
- Search for obvious generated-code artifacts before finishing: broken joined words in docs, stale project names, obsolete env vars, and UI descriptions that exceed what is implemented.
- Prefer explicit D-Bus/property handling over no-op calls that only log success. If a feature cannot be safely implemented yet, make the limitation visible in the title/subtitle/docs rather than implying it works.

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
