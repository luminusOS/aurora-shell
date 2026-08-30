# Development

## Set up the checkout

Aurora Shell needs Node.js 20 or newer, Yarn 4, `just`, and GNOME 50 build/runtime tools. Clone the
repository, install the locked JavaScript dependencies, and confirm the source contracts:

```bash
git clone https://github.com/luminusOS/aurora-shell.git
cd aurora-shell
just deps
just validate
just test unit
```

`just deps` uses Yarn's immutable mode, so a lockfile mismatch fails instead of rewriting the
dependency graph.

## Edit, validate, run, debug

Use one short loop for most work:

1. Find the owning module and its manifest through [Module reference](module-reference.md).
2. Change the runtime code and the smallest observable test. Update the manifest/schema only when
   the settings contract changes.
3. Run the targeted Node or Shell test described in [Testing](testing.md).
4. Run `just validate` and `just test unit` before widening the check.
5. Install or start the development runtime only when the behavior needs visual inspection.

Build and install the development package into the current user account:

```bash
just install
```

Or build, install, and start an isolated GNOME Shell devkit session:

```bash
just run
```

The development package uses `extension.dev.ts` and enables DevTool only when the launcher supplies
`AURORA_DEVTOOLS=1`. It is separate from the production ZIP. To run the same session in Toolbox:

```bash
just toolbox create
just toolbox run
```

For stylesheet work, `just watch` recompiles SCSS on changes. It does not reload the extension or
run tests.

Read recent Aurora messages with `just logs`. Module logs include an owning prefix; start from the
first error rather than later teardown noise. [Troubleshooting](troubleshooting.md) covers common
load, Toolbox, OCR, Vela, and capability cases.

## Build and package

`just build` compiles TypeScript and Sass, copies schemas and metadata, and compiles translations
into `dist/`. Packaging adds GNOME's extension bundle step:

```bash
just package production
just package development
just package check
```

`just package check` builds both variants and verifies their contents and entry points. The
production ZIP is the EGO/release artifact; the development ZIP exists for contributors and its
DevTool integration test.

Use `just clean` to remove `dist/`. `just clean all` also removes `node_modules`, so the next build
needs `just deps`.

## Test in the right environment

Node tests need no Shell process. Host Shell tests need `gnome-shell-test-tool` and the services
expected by the feature. Toolbox provides the project's containerized GNOME environment:

```bash
just toolbox test tests/shell/desktop/trayIcons/trayIcons.test.js
just toolbox test
just toolbox test-dev
```

Set `AURORA_TOOLBOX_IMAGE` to use a prebuilt/local image and `AURORA_TOOLBOX_NAME` to select another
container. The default name is `aurora-shell-devel`.

CI derives its image name from `Containerfile`, the first `shell-version` in `metadata.json`, and a
hash of the container inputs. A new GNOME generation therefore requires coordinated metadata, GIR
type dependency, and `FEDORA_VERSION` changes.

## Before review

Run checks for every changed boundary. A normal runtime change ends with:

```bash
just validate
just test unit
just package check
just shexli
```

Add the relevant targeted Shell test, and use `just toolbox test` for lifecycle, infrastructure, or
cross-module changes. Documentation-only work does not need Shell tests.

Shexli scans the generated production ZIP. Review every location against
[GNOME Extensions review notes](extension-review.md); an existing rule ID does not approve a new
occurrence.
