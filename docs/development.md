# Development and Testing

## Setup and Build

- `just deps` installs dependencies with Yarn's immutable mode.
- `just build` compiles TypeScript and SCSS, copies metadata and schemas, and compiles translations.
- `just package production` creates the production extension ZIP.
- `just package development` creates the DevTool-enabled development ZIP.
- `just package check` builds and inspects both packages.
- `just install` installs the development package.
- `just uninstall` disables and removes the extension.
- `just run` installs the development package and starts a devkit session.
- `just watch` recompiles SCSS as files change.
- `just logs` shows recent Aurora entries from the current boot journal.

Use `just clean` to remove `dist/` and `just clean all` to also remove `node_modules/`.

## Validation

- `just validate` runs TypeScript, ESLint, Prettier, and Stylelint checks.
- `just lint` runs ESLint only.
- `just test unit` runs Shell-free unit tests with the Node test runner.
- `just test coverage` runs unit tests with coverage.
- `just shexli` packages the extension and runs the extensions.gnome.org static analyzer.

Pure logic belongs in `tests/unit/`. GNOME Shell, St, and Clutter integration belongs in
`tests/shell/`.

## Shell Integration Tests

Run one feature test on the host with:

```bash
just test shell tests/shell/desktop/trayIcons
```

Run all Shell tests with `just test shell`, or use the preferred Toolbox environment:

```bash
just toolbox create
just toolbox test
```

The Toolbox uses the public, versioned GNOME image from
`ghcr.io/luminusos/aurora-shell-ci`. Set `AURORA_TOOLBOX_IMAGE` to test a local replacement and
`AURORA_TOOLBOX_NAME` when maintaining multiple development toolboxes. `Vagrantfile` remains
available for manual testing against other GNOME environments.

## CI Environment

`Containerfile` defines the Fedora/GNOME environment shared by CI and Toolbox. Its image tag is
derived from the first `shell-version` in `metadata.json` and a hash of the container inputs. CI
publishes a missing amd64 and arm64 image before running validation jobs.

To target a new GNOME generation, update `metadata.json`, the GNOME type dependencies, and
`FEDORA_VERSION` in `Containerfile`. The content change produces a new image tag automatically.

Every pull request runs four checks from `.github/workflows/ci.yml`:

1. Validation with `just validate`.
2. Unit and regression tests.
3. Package inspection with `just package check`.
4. Headless GNOME Shell integration tests.

The isolated integration runtime owns its private `XDG_RUNTIME_DIR`, system D-Bus, and logind mock;
Toolbox does not replace the host services.

## GNOME Extensions Review

Run `just shexli` to scan the production ZIP. The command uses an installed `shexli`, or falls back
to `uvx --from shexli shexli` when available. Review every finding and document accepted warnings
in [GNOME Extensions review notes](extension-review.md).
