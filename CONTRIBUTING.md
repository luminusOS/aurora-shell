# Contributing to Aurora Shell

Thank you for your interest in contributing to Aurora Shell! This document outlines the project architecture and provides guidelines for adding new modules and adhering to the project's code style.

## AI-Assisted Contributions

Contributions made with AI assistance are welcome, but the contributor remains
responsible for the change. Do not submit code you do not understand. You must
be able to explain what the code does, why it is correct, and what tradeoffs or
risks it introduces.

AI-assisted changes must be tested thoroughly. Maintainers may ask for evidence
that the functionality works and was tested, such as test output, screenshots,
screen recordings, logs, or clear reproduction steps.

## Architecture Overview

Aurora Shell keeps GNOME integration close to each functional area. `extension.ts` creates the
context and delegates module lifecycle to `ModuleManager`. The ordered `moduleCatalog.ts` is shared by
runtime and preferences; `registry.ts` only associates each manifest with its implementation factory.

Module descriptions live in Shell-free `*.manifest.ts` files. Implementations contain behavior and
lifecycle only. Pure calculations should be extracted when they are independently testable, while direct
`Main`/St/Clutter integration remains idiomatic for a GNOME Shell extension.

## Adding a Module

1. Create `feature.manifest.ts` and the `Module` implementation in the appropriate functional area.
2. Add the manifest to `moduleCatalog.ts` in preference order.
3. Associate the manifest key with its factory in `registry.ts`.
4. Add every module, option, and internal setting key to the GSettings schema.
5. Add unit coverage for pure logic and a Shell test for GNOME integration.

A minimal manifest looks like:

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
  options: [{ key: 'my-option', title: _('Option'), subtitle: _('Description'), type: 'switch' }],
};
```

The runtime implementation keeps the small `enable()`/`disable()` contract. Use
a fresh `LifecycleScope` to own signal connections and register teardown callbacks for each
enable/disable cycle; keep timers, D-Bus subscriptions, and other stateful GNOME APIs explicit at
their call sites.

`tests/unit/registry.test.ts` verifies catalog order, uniqueness, known sections, and factory
coverage through the TypeScript AST. `tests/unit/schema.test.ts` structurally validates XML and
requires catalog settings and schema keys to match exactly.

## Branching & Release Model

Aurora Shell follows a branching model aligned with GNOME Shell's own release cycle.

### Branches

| Branch          | Purpose                                             |
| --------------- | --------------------------------------------------- |
| `main`          | Active development targeting the next GNOME release |
| `release/v50.x` | Maintenance branch for GNOME 50                     |
| `release/v51.x` | Maintenance branch for GNOME 51                     |

Maintenance branches are created automatically when the first tag for a new major version is pushed.

### New features

Each major Aurora Shell release targets a single GNOME Shell version. New features land on `main` and are released alongside a new major GNOME Shell version.

Branches targeting already-released GNOME Shell versions are in maintenance mode. **Do not add new features to maintenance branches** — they are strictly for bug fixes and compatibility updates.

### Bug fixes

Bug fixes should target `main` first via a normal PR. If the fix is relevant to a maintenance release, open a **separate PR targeting that branch**:

```bash
git checkout release/v50.x
git cherry-pick <commit-sha>
# open a PR targeting release/v50.x
```

Maintainers decide which fixes are worth backporting. Not every fix needs to land in every maintenance branch.

### Automated backports

To request a maintenance backport, add a label such as `GNOME 50` to the original pull request.
After the original pull request is merged into `main`, GitHub Actions creates or updates a separate
backport PR targeting `release/v50.x`.

The backport branch is rebuilt from the target release branch, cherry-picks the original PR commits,
and adds a final version bump commit. For example, if `metadata.json` on `release/v50.x` says
`50.7`, the generated backport PR bumps it to `50.8`.

### Release candidates

Release candidates are published alongside GNOME Shell RCs. Tags follow the pattern `v50-rc1`, `v50-rc2`, etc. RC releases are marked as **pre-releases** on GitHub.

To publish an RC, trigger the `Release` workflow manually (`workflow_dispatch`) — no input is needed. Like the nightly flow, the workflow numbers the next candidate automatically (`v50-rc1`, then `v50-rc2`, ...), tags current `main`, runs CI against it, and publishes the pre-release. An RC supersedes the nightly line, so publishing one deletes all nightly pre-releases.

### Stable releases

Stable releases use tags like `v50.1`, `v50.2`, matching the GNOME Shell major version they target.

To publish a release, create an annotated tag and push it:

```bash
git tag -a v50.1 -m "Release v50.1"
git push origin v50.1
```

The CI pipeline runs all tests and, if they pass, publishes the GitHub Release automatically.

## Build System & Commands

- **Install deps:** `just deps` — runs an immutable Yarn install; use once or after changing branches
- **Build:** `just build` — compiles TypeScript and SCSS, copies metadata/schemas, compiles `.mo` files
- **Package:** `just package` — packs the extension as a `.zip` in `dist/target/` (depends on `build`)
- **Install:** `just install` — packages and installs the `.zip` to GNOME Shell
- **Uninstall:** `just uninstall` — disables and removes the extension
- **Run (host):** `just run` — launches a devkit GNOME Shell session (headless, Wayland)
- **Validate:** `just validate` — runs tsc, ESLint, Prettier check, and Stylelint
- **Lint:** `just lint` — runs ESLint only
- **Unit tests:** `just unit-test` — runs unit tests with Node's test runner (no GNOME Shell required)
- **Coverage:** `just coverage` — runs unit tests with coverage report
- **Single integration test:** `just test <script>` — packages and runs one shell test headlessly
- **All integration tests:** `just test-all` — packages and runs all shell tests on the host, printing a pass/fail summary
- **Shexli review scan:** `just shexli` — packages the extension and runs the extensions.gnome.org static analyzer on the generated ZIP
- **Watch SCSS:** `just watch` — watches `src/styles/` and recompiles on change
- **View logs:** `just logs` — shows recent `aurora` entries from the current boot journal
- **Clean:** `just clean` — removes `dist/`
- **Deep clean:** `just distclean` — removes `dist/` and `node_modules/`

For a full test environment, create the Fedora toolbox with `just toolbox create` and run
`just toolbox test-all` (preferred over `just test-all`). The toolbox uses the public,
versioned GNOME image from `ghcr.io/luminusos/aurora-shell-ci` shared with CI. Set
`AURORA_TOOLBOX_IMAGE` to test a locally built replacement.

The image is defined by `Containerfile`; its tag is derived from the first `shell-version` in
`metadata.json` and a hash of the container inputs. CI publishes a missing tag automatically for
amd64 and arm64. The GHCR package must remain public so forked pull requests and Toolbox can pull it
without repository credentials. Set `AURORA_TOOLBOX_NAME` when maintaining more than one Aurora
development toolbox. `Vagrantfile` remains available for manual testing against other GNOME
environments.

The first CI job derives a content-addressed tag from the GNOME metadata and container inputs. If
that tag does not exist, the job builds and publishes it to GHCR for amd64 and arm64; all remaining
jobs then run directly inside that exact image. No local-build fallback or separate image workflow
is involved.

To advance to a new GNOME generation, update `metadata.json`, the GNOME type dependencies, and the
single `FEDORA_VERSION` argument in `Containerfile`. Those changes produce a new image tag, which CI
publishes before starting validation and tests; Toolbox resolves the same tag automatically.

## GNOME Extensions Review

Aurora Shell can be checked locally with Shexli, the experimental static analyzer used by
extensions.gnome.org:

```bash
just shexli
```

The recipe depends on `just package` and scans the generated
`dist/target/aurora-shell@luminusos.github.io.shell-extension.zip`. Install Shexli with
`python3 -m pip install --user shexli`, or install `uvx` and the recipe will run
`uvx --from shexli shexli` automatically.

## CI

Every pull request and release runs the CI pipeline defined in `.github/workflows/ci.yml`. Its first
job ensures the CI image exists; the four validation jobs then run inside that same image:

1. **Validate** — runs tsc, ESLint, Prettier check, and Stylelint via `just validate`
2. **Unit & regression tests** — runs the Node test suite without GNOME Shell
3. **Build** — runs `just package` and uploads the extension `.zip` as an artifact (depends on lint)
4. **Integration tests** — runs the shared Shell-test runner against headless GNOME Shell (depends on build + unit tests)

The private `XDG_RUNTIME_DIR`, system D-Bus, and logind mock in the integration job belong only to
the isolated headless runtime. Toolbox does not replace the host XDG directories or install fake
D-Bus services.

All jobs must pass before a PR can be merged.

When a stable version tag (`v50.1`, `v50.2`, etc.) is pushed, `.github/workflows/release.yml` calls the CI pipeline and, if all jobs pass, publishes the GitHub Release automatically. Release candidate tags (`v50-rc1`, etc.) are excluded from this trigger and are published manually via `workflow_dispatch`, as described above.

## Coding Standards

- **File names:** `camelCase.ts`
- **Classes:** `PascalCase`
- **Private members:** `_prefixed`
- **Constants:** `UPPER_CASE`
- **Symmetry:** Everything connected in `enable()` **must** be disconnected or destroyed in `disable()`.
- **Dependency Injection:** Strictly follow DI; do not reach out to globals.

## Logging Style

Always prefix log messages with the module name in `[PascalCase]` brackets. Use the global `logger` from `~/core/logger.ts` for all logging — do not call `console.log/warn` or `GLib.log_structured` directly from module code.

```typescript
import { logger } from '~/core/logger.ts';

// Correct
logger.log('[AuroraTray] Item added: ' + id);
logger.warn('[IconWeave] No match found for ' + wmClass);

// Wrong — redundant prefix, wrong casing, or bypasses logger
logger.log('[Aurora Shell] [aurora-tray] Item added: ' + id);
console.warn('[aurora-shell] Something failed');
```

The `[Aurora Shell]` prefix is redundant: the SYSLOG_IDENTIFIER in structured logs already routes output to the right extension in the journal.
