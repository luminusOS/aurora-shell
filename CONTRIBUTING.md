# Contributing to Aurora Shell

Understand every change you submit. Keep pull requests focused and include results reviewers can
reproduce.

## Start with an issue and branch

Search existing issues and pull requests before opening a duplicate. For a behavior change, describe
the current result, expected result, GNOME Shell version, and reproduction steps. Small documentation
or obvious fixes may go directly to a pull request; discuss broad UI, architecture, settings, or
compatibility changes before implementation.

Branch from current `main`:

```bash
git switch main
git pull --ff-only
git switch -c fix/short-description
```

Keep one feature, fix, or refactor per pull request. Bug fixes target `main`; released branches
receive separate backport pull requests through the process in
[Releases and backports](docs/releases.md#backports).

## Make the change

Read [Architecture](docs/architecture.md) before changing lifecycle, metadata, preferences, device
policy, or package boundaries. Use the [module guide](docs/modules.md) for module work.

Add a regression check that fails without a non-trivial fix. Prefer a Node unit test for pure logic
and a targeted Shell test for GNOME behavior. Do not add speculative abstractions, dependencies, or
tests unrelated to the changed contract.

## Choose validation

Use the matrix in [Testing](docs/testing.md#change-to-test-matrix). At minimum, source changes run:

```bash
just validate
just test unit
```

Add `just package check` for build/package changes, a targeted `just test shell …` for Shell behavior,
and `just shexli` for EGO-facing, clipboard, subprocess, or package-content changes. Use Toolbox when
the host lacks the project GNOME environment or the change crosses Shell infrastructure.

Record commands and results in the pull request. For user-visible behavior, include a focused
screenshot or screen recording when it proves the result better than logs. For a bug, include the
before/after reproduction. Do not claim a check you did not run; state environment blockers and the
exact error.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/) for the subject:

```text
<type>[optional scope][!]: <imperative description>
```

Use a standard type such as `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, or `chore`.
Keep the whole subject under 72 characters, omit the trailing period, and keep each commit reviewable
and revertible. Explain motivation and non-obvious tradeoffs in the body, not a summary of the diff.

```text
fix(clipboard): preserve card focus behavior

Reveal card actions when hover leaves a pinned item and keep short cards at a
stable height. Add Shell coverage for both cases.
```

Mark an incompatible contract with `!` and a `BREAKING CHANGE:` footer. Do not rewrite public release
tags or hide a breaking settings change in a normal fix.

## Pull requests

A pull request should answer four questions:

1. What observable problem does this solve?
2. Why is the change located in this component?
3. What compatibility, teardown, privacy, or regression risk remains?
4. Which commands and manual artifacts demonstrate the result?

Keep the branch current, respond to review with code or evidence, and wait for the CI gate. Reviewers
may ask for a smaller change when unrelated work obscures the behavior under review.

## AI-assisted contributions

AI tools may assist, but the human contributor owns every line and claim. Review generated changes
against the local GNOME Shell version and the
[GNOME Extensions review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html).
Remove imaginary APIs, redundant code, prompt-like comments, and claims without test evidence.

You must be able to explain the control flow, resource ownership, failure behavior, and test choice.
Disclose material AI assistance when project or employer policy requires it. Never upload secrets,
private user data, or code you are not authorized to share to an external service.

## Documentation map

- [Documentation index](docs/README.md)
- [Development loop](docs/development.md)
- [Module reference](docs/module-reference.md)
- [Troubleshooting](docs/troubleshooting.md)
- [GNOME Extensions review notes](docs/extension-review.md)
