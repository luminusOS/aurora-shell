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
    - If you modified only **one module**, run only the integration test for that module (e.g., `just test shell tests/shell/auroraTrayIcons.js`).
    - If you made **formatting-only changes** (Prettier) and have already passed the tests in a previous turn, you only need to run `just validate` and `just shexli`.
    - If you made **architectural or cross-cutting changes**, run `just toolbox test all`.

**IMPORTANT:** Never execute `just test shell`, `just test all`, or `just toolbox test` chained with another command using `&&`. Always run tests as a separate standalone turn.

To read only the relevant output from a full test run (pass/fail summary):

```sh
just toolbox test all 2>&1 | grep -E "PASS:|FAIL:|Results:"
```

Do not leave a task incomplete if either command reports errors or failures.

## Commands

- **Install deps:** `just deps` — runs `yarn install --immutable`; use once or after changing branches
- **Build:** `just build` — compiles TypeScript and SCSS, copies metadata/schemas, and compiles `.mo` files
- **Package:** `just package production` — packs the production extension as a `.zip` in `dist/target/`
- **Development package:** `just package development` — packs the separate DevTool-enabled development ZIP
- **Inspect packages:** `just package check` — builds both ZIPs and verifies their contents and generated line lengths
- **Install:** `just install` — packages and installs the DevTool-enabled development ZIP
- **Uninstall:** `just uninstall` — disables and removes the extension
- **Run (host):** `just run` — installs development, then launches a DevTool-enabled devkit session
- **Run (toolbox):** `just toolbox run` — packages/installs on the host, then runs GNOME Shell inside the Fedora toolbox
- **Create toolbox:** `just toolbox create` — creates `aurora-shell-devel` from the same Fedora/GNOME image used by CI
- **Remove toolbox:** `just toolbox remove` — delete the toolbox
- **Validate:** `just validate` — runs tsc, ESLint, Prettier check, and Stylelint
- **Shexli:** `just shexli` — packages the extension and runs the extensions.gnome.org static analyzer on the generated ZIP
- **Lint:** `just lint` — runs ESLint only
- **Watch SCSS:** `just watch` — watches `src/styles/` and recompiles on change
- **View logs:** `just logs` — shows recent `aurora` entries from the current boot journal
- **Clean:** `just clean` — removes `dist/`
- **Deep clean:** `just clean all` — removes `dist/` and `node_modules/`
- **Unit tests:** `just test unit` — runs unit tests with Node's test runner
- **Coverage:** `just test coverage` — runs unit tests with coverage report
- **Single integration test:** `just test shell <script>` — packages and runs one shell test script headlessly (e.g., `just test shell tests/shell/auroraTrayIcons.js`)
- **All integration tests:** `just test all` — packages and runs all `tests/shell/aurora*.js` on the host, printing a pass/fail summary
- **DevTool integration test:** `just test dev` — tests `auroraDevTool.js` against the development ZIP
- **All integration tests (toolbox):** `just toolbox test all` — same as above but inside the Fedora toolbox (preferred; use this instead of `just test all`)
- **Single integration test (toolbox):** `just toolbox test <script>` — packages and runs one test inside the toolbox
- **Vagrant VM:** `just vagrant create|run|ssh|remove` — full Arch VM kept for manual GNOME environment testing

### Translation commands

- **Regenerate POT template:** `just translation pot` — builds, then scans compiled JS (`dist/`) and writes the `.pot` into `dist/` (a build artifact, **not** committed — avoids `POT-Creation-Date` churn). Run this whenever translatable strings are added or removed.
- **Merge new strings into .po files:** `just translation update` — depends on `translation pot`; regenerates the template into `dist/` then runs `msgmerge` on every `data/po/*.po` against it. The hand-translated `data/po/*.po` files are the committed source of truth.
- **Compile .mo binaries:** `just translation compile` — compiles each `po/*.po` into `dist/locale/<lang>/LC_MESSAGES/*.mo`. Called automatically by `just build`.

## Repository Structure

- `src/` — TypeScript source root
  - `extension.ts` — minimal production entry point
  - `extension.dev.ts` — development entry point used only by the development ZIP
  - `core/extensionBase.ts` — shared extension lifecycle; creates the context and delegates to `ModuleManager`
  - `module.ts` — base `Module` plus manifest, option, factory, and runtime policy types
  - `moduleCatalog.ts` — ordered Shell-free manifest catalog shared by runtime and preferences
  - `moduleManager.ts` — settings/runtime reconciliation, failure isolation, and teardown
  - `registry.ts` — associates every catalog manifest with its runtime factory
  - `prefs.ts` — generic preferences UI driven directly by `moduleCatalog.ts`
  - `core/` — small shared context, cleanup, logging, and settings utilities
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
  - `dev/` — developer-only tooling (e.g., `devTool.ts`), gated behind the `AURORA_DEVTOOLS=1` env var and excluded from the production ZIP. **Not** a feature module: it is not in the registry, prefs, or gschema
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
- `Containerfile` — shared Fedora/GNOME build and integration-test environment used by CI and Toolbox
- `scripts/` — focused helpers for GNOME Shell tests, Toolbox devkit, and Vagrant devkit
- `esbuild.ts` — esbuild bundler configuration
- `sass.config.ts` — Sass compiler configuration
- `justfile` — all project commands
- `metadata.json` — GNOME extension metadata (uuid, version, shell versions)
- `dist/` — build output (gitignored)

## Architecture

1. **Settings via context:** Modules receive an `ExtensionContext` in their constructor and read configuration through `this.context.settings` (the `SettingsManager` abstraction) rather than touching `Gio.Settings` directly.
2. **`Main` is fair game:** Importing `Main` (`resource:///org/gnome/shell/ui/main.js`) directly is the idiomatic GNOME-extension way and is expected — there is no shell adapter. Confidence in shell interactions comes from the `tests/shell/` integration suite running a real headless GNOME Shell, not from mocking `Main`.
3. **Layering & testability:** Keep UI logic (Clutter/St) separated from pure domain logic. Extract complex algorithms into pure TypeScript files with no shell imports (e.g., `src/dock/monitorTopology.ts`, `src/desktop/trayIcons/trayState.ts`) so they can be unit-tested with `node --test`. UI/shell glue is covered by integration tests instead.
4. **Metadata-Driven UI:** Each feature owns a Shell-free `*.manifest.ts`. `moduleCatalog.ts` is the single ordered metadata source consumed by preferences and runtime.
5. **Factories:** Runtime implementations export their classes. `registry.ts` is the explicit association between catalog keys and factories; implementation files contain no preference metadata.

## Adding a Module

1. Create a Shell-free `*.manifest.ts` beside the implementation:

```typescript
import { gettext as _ } from 'gettext';
import type { ModuleManifest } from '~/module.ts';

export const manifest: ModuleManifest = {
  key: 'my-module',
  settingsKey: 'module-my-module',
  section: 'behavior',
  title: _('My Module'),
  subtitle: _('Description'),
  runtime: { roles: ['desktop'], scope: 'session' },
  options: [{ key: 'my-option', title: _('Option'), subtitle: _('Desc'), type: 'switch' }],
};
```

2. Export the `Module` implementation class from its behavior file. Keep preference metadata out of
   that implementation.
3. Add the manifest to `moduleCatalog.ts` in display order and associate its class factory in
   `registry.ts`.
4. Add every declared module, option, and internal setting key to the GSettings schema.
5. Add unit and Shell integration coverage as appropriate.

`registry.test.ts` checks the catalog/factory relationship through the TypeScript AST.
`schema.test.ts` structurally validates that every catalog setting is present in the XML and
that no stale schema setting remains.

### Prefs sections

The prefs window groups modules by `section`. The ordered section list lives in `getSections()` in `src/moduleCatalog.ts`:

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
- Optimize refactors for human readability, not line count. Do not compress control flow, callback bodies,
  object literals, or several operations onto one line merely to shorten a file.
- Visually separate guard clauses, state preparation, actor mutation, animation, scheduling, and cleanup
  with blank lines. Keep local constants next to the logical block that consumes them; avoid unexplained
  aliases in the middle of a stateful method.
- Do not add pass-through methods that only forward the same arguments to a stored function or object.
  Expose a meaningful domain operation, return the required callable directly, or keep the call at its
  natural owner.
- Do not hide lifecycle invariants behind optional chaining with fallback values, such as
  `owner?.value ?? default` or `owner?.operation() ?? false`. At public boundaries, guard the inactive
  state explicitly and access stable fields directly during synchronous work. Reserve optional
  chaining and nullish fallbacks for genuinely optional external data and idempotent cleanup.
- Do not create a local alias for an instance field merely to shorten `this._field`, repeat the same
  name, or satisfy nullable type narrowing during synchronous work. Guard the field explicitly and
  use it directly when it cannot change inside the block. A snapshot of an instance field is justified
  only when it transfers ownership before the field is cleared or captures the exact resource across
  an `await` or asynchronous callback. A local result is also appropriate for a genuinely dynamic
  lookup or computation that must remain stable; directly reading `this._field` is not such a lookup.
  Name identity captures explicitly, such as `scheduledRetry` or `activeRequest`, so the reason is
  visible.
- Before finishing a refactor, review every newly created or substantially edited file as prose: expand
  dense one-line branches and loops, remove redundant wrappers, and make lifecycle ownership obvious
  without requiring the reader to infer it from implementation details.

## Human Review Quality Bar

Avoid code that only looks plausible. A human reviewer should be able to read a change and see a real contract, not a guess.

### EGO review policy

Changes intended for the production extension must follow both:

- [GNOME Extensions review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)
- [EGO AI reference](https://blogs.gnome.org/jrahmatzadeh/2026/07/27/ego-ai-reference/)

Apply these rules during implementation and review:

- Target only the Shell versions declared in `metadata.json`. Do not add speculative compatibility
  branches, `typeof method === 'function'` checks, or optional calls for methods guaranteed by those
  versions. For real multi-version support, follow the
  [official port guide](https://gjs.guide/extensions/upgrading/gnome-shell.html).
- Do not wrap deterministic lifecycle methods such as `destroy()`, `connect()`, `disconnect()`,
  `disconnectObject()`, `abort()`, `GLib.Source.remove()`, or `Gio.DBusConnection.unregister_object()`
  in defensive `try`/`catch`. Catch failures only at operations whose contract can genuinely fail,
  such as I/O, parsing, D-Bus calls, subprocesses, and asynchronous result propagation.
- Do not add optional calls such as `object?.method(...)` or `object?.method?.(...)` when the object and
  method are guaranteed by the active lifecycle or the targeted API. Use an explicit boundary guard
  when the owning object itself is legitimately inactive or absent.
- Do not add `_enabled`, `_destroyed`, or similar lifecycle flags when owned references, cancellables,
  or the underlying GObject lifecycle already express the state. After destruction, the owner must
  clear its reference and must not call the instance again.
- In widget `destroy()` overrides, remove GLib sources and timeouts first, disconnect signals next,
  release owned children and references after that, and call `super.destroy()` last. A widget must
  override its own `destroy()` method instead of connecting its own `destroy` signal for cleanup;
  observing the destruction of an external actor is valid when the observer owns that connection.
- Every signal, GLib source, cancellable, child actor, menu, Soup session, and other resource created
  by a component must be cleaned up by that same component. Never spread initialization and cleanup
  ownership across unrelated classes.
- When a repeatable operation creates a timeout, remove or replace its prior source immediately next
  to the new source creation. Do not separate replacement and creation into distant methods or blocks.
- Keep `extension.ts` minimal. Keep `enable()` and `disable()` adjacent, symmetric, and limited to
  lifecycle orchestration; avoid aliases that merely forward lifecycle calls. Never ship empty,
  placeholder, or partially implemented lifecycle methods.
- Split large features into cohesive, single-responsibility modules. Extract repeated logic into
  helpers instead of copying blocks. Modules imported by both Shell and preferences must remain free
  of `St`, `Clutter`, `Gtk`, `Gdk`, and `Adw`; keep process-specific UI under clearly named runtime or
  `preferences/` directories.
- Keep the extension's schema ID in `metadata.json` as `settings-schema` and call `this.getSettings()`
  without repeating the schema ID in source code.
- Use `St.Icon` or `icon_name` for Shell UI and `Gtk.Image` for preferences. Do not use Unicode emoji
  as icons or ASCII strings as progress indicators; use Shell widgets such as `BarLevel` or `St.Bin`.
- Keep generated JavaScript lines at 200 characters or fewer. Prefer self-explanatory names and remove
  comments that restate syntax or translate the following statement into prose.
- Avoid subprocesses in the Shell process. Prefer D-Bus for system services and move heavy work to a
  separate application. If a subprocess is unavoidable, document why D-Bus is not practical and keep
  invocation local, explicit, cancellable, and free of shell interpretation.
- Review every Shexli finding. Fix real ownership/lifecycle defects and record accepted manual-review
  findings or analyzer false positives in `EGO_REVIEW.md`.

- Never use patterns like `this.disconnectObject?.(this)` on objects that do not own that signal
  connection contract.
- Do not ship fake behavior. If a UI label, schema description, README entry, or module subtitle says a feature is wired to NetworkManager, ModemManager, UPower, sensors, widgets, or GNOME internals, the code must actually call the relevant API or clearly describe itself as a fallback.
- Keep runtime capability checks honest. Hardware-specific modules must detect missing services/devices at runtime and stay inactive or degrade explicitly.
- Do not scatter `as unknown as ...` casts through feature modules. If GObject construction or Shell internals require a cast, isolate it in a small shared helper/factory with a clear name.
- Do not leave placeholder helpers, legacy duplicates, or unused compatibility functions after a refactor. Remove dead code instead of keeping it “just in case”.
- Keep strings and metadata truthful and synchronized across `*.manifest.ts`, `moduleCatalog.ts`, schema XML, README/architecture docs, and `.po` files when strings change.
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
