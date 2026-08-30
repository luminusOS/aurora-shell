# Testing

Choose the narrowest check that can observe the change, then add broader checks for every boundary
it crosses.

## Change-to-test matrix

| Change                                                        | Run                                         | Why                                                                 |
| ------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------- |
| Markdown only                                                 | documentation unit test, `just validate`    | checks links, module keys, recipes, and formatting                  |
| Pure TypeScript logic                                         | targeted Node test, then `just test unit`   | runs without GNOME Shell                                            |
| Manifest, catalog, registry, or schema                        | `just test unit`, `just validate`           | structural tests reject metadata drift and schema errors            |
| Styles or TypeScript build                                    | `just validate`, `just package check`       | checks sources and both package variants                            |
| Panel, Quick Settings, overview, window, or actor behavior    | targeted `just test shell …`                | exercises real Shell APIs and teardown                              |
| Development-only DevTool                                      | `just test dev` or `just toolbox test-dev`  | installs the development entry point with `AURORA_DEVTOOLS=1`       |
| Cross-cutting lifecycle, packaging, or Shell infrastructure   | `just toolbox test`                         | runs the complete production Shell suite in the project environment |
| Clipboard, subprocess, package contents, or EGO-facing change | `just shexli` plus relevant tests           | refreshes the production-package review evidence                    |
| Workflow or release YAML                                      | `just validate` plus GitHub workflow checks | CI runs actionlint when workflow files change                       |

For documentation-only changes, Shell tests do not add evidence because no runtime or package
behavior changed.

## Unit tests

`just test unit` runs `tests/unit/**/*.test.ts` with Node's test runner and the installed `tsx`
loader. Unit tests cover pure calculations and project contracts such as catalog order, factory
coverage, schema synchronization, metadata, logging policy, and documentation.

Run one file while iterating:

```bash
node --import tsx/esm --test tests/unit/project/documentation.test.ts
```

Use `just test coverage` only when coverage data answers a review question; it is not required for
every change.

## Shell tests

`just test shell` builds the production ZIP, collects every `.test.js` below `tests/shell` except
the development directory, and runs each script in a separate `dbus-run-session` with
`gnome-shell-test-tool`. A file or directory argument narrows collection:

```bash
just test shell tests/shell/panel/powerMenuAvatar.test.js
```

Capture Tools and Clipboard History request one extra virtual monitor; Dock requests two. The
runner sorts and deduplicates targets, prints each pass or failure, preserves failing Shell output,
and returns nonzero if any script fails.

`just test dev` builds the development ZIP and runs only the DevTool integration test with
`AURORA_DEVTOOLS=1`.

## Toolbox and CI

Create the versioned environment once, then run a target or the full suite:

```bash
just toolbox create
just toolbox test tests/shell/patches/pipOnTop.test.js
just toolbox test
```

Without `AURORA_TOOLBOX_IMAGE`, `just toolbox create` builds the repository `Containerfile` locally.
Set `AURORA_TOOLBOX_IMAGE` to use another image and `AURORA_TOOLBOX_NAME` to keep multiple toolboxes.

CI uses the same container inputs but provides private runtime state, system D-Bus, and logind/GDM
mocks. Its full gate requires validation, unit tests, package inspection, the production Shell suite,
and the development-package test. Package artifacts are retained for the release workflow.

## Diagnose a failure

- A Node stack trace points to a pure assertion or project contract. Run that one file first.
- “Extension package not found” means the Shell runner was invoked directly without a built ZIP;
  use the `just test shell` recipe.
- “Shell test target not found” means the path is neither a `.test.js` file nor a directory.
- A Shell failure prints the captured `gnome-shell-test-tool` output before its `FAIL` line. Re-run
  that file alone before running the suite.
- Toolbox lookup or image failures belong to the environment, not the test. Follow
  [Troubleshooting](troubleshooting.md#toolbox-failures).
- A Shexli rule ID is not self-explanatory evidence. Compare every reported location with
  [GNOME Extensions review notes](extension-review.md) and the owning teardown path.
