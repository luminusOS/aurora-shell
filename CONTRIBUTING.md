# Contributing to Aurora Shell

Thank you for contributing to Aurora Shell. Keep changes focused, test the behavior they affect,
and make the intent easy to understand in review.

## Before You Start

- Branch from the latest `main`.
- Keep each pull request limited to one feature, fix, or refactor.
- Add regression coverage for bug fixes and tests for new behavior.
- Read the [documentation index](docs/README.md) for architecture and development guidance.

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/) for the subject and breaking-change
notation:

```text
<type>[optional scope][!]: <description>
```

- Use a standard type such as `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, or `chore`.
- Add a short scope when it helps identify the affected area.
- Write the description in imperative present tense: `fix(clipboard): preserve card height`, not
  `fixed` or `fixes`.
- Keep the complete subject under 72 characters and omit the trailing period.
- Mark a breaking change with `!` before the colon and explain it in a `BREAKING CHANGE:` footer.

Follow the Chromium Embedded Framework writing style for the remaining message:

- Separate the subject, optional body, and optional footers with blank lines.
- Use the body to explain motivation, behavior, and non-obvious tradeoffs.
- Keep every commit focused on one concern so it can be reviewed or reverted independently.

For example:

```text
fix(clipboard): preserve card focus behavior

Reveal card actions when hover moves away from a pinned item and keep short
cards at a stable height. Add Shell coverage for both cases.
```

A breaking change uses both Conventional Commits markers:

```text
feat(settings)!: replace the legacy module keys

Move module configuration to the manifest-backed key format.

BREAKING CHANGE: Existing custom module keys must be migrated.
```

## Validate Your Change

For source changes, run the standard checks:

```bash
just validate
just test unit
just shexli
```

Run the relevant Shell integration test for a feature-level change. Use
`just toolbox test` for architectural or cross-cutting work. See
[Development and testing](docs/development.md) for the complete command reference and environment
details.

## Pull Requests

Describe the problem, the chosen solution, and how you validated it. Include screenshots, screen
recordings, logs, or reproduction steps when they make user-visible or Shell behavior easier to
review. All CI jobs must pass before merge.

Bug fixes target `main` first. Maintenance backports use separate pull requests; see
[Releases and backports](docs/releases.md).

## AI-Assisted Contributions

AI-assisted contributions are welcome, but the contributor remains responsible for every change.
Do not submit code you do not understand. You must be able to explain why it is correct, what risks
it introduces, and how it was tested.

## Further Reading

- [Documentation index](docs/README.md)
- [Architecture](docs/architecture.md)
- [Development and testing](docs/development.md)
- [Adding and maintaining modules](docs/modules.md)
- [Releases and backports](docs/releases.md)
- [GNOME Extensions review notes](docs/extension-review.md)
- [GJS extension debugging](https://gjs.guide/extensions/development/debugging.html)
- [GJS imports and modules](https://gjs.guide/extensions/overview/imports-and-modules.html)
- [GNOME Shell Extensions review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)
- [Automated testing of GNOME Shell](https://blogs.gnome.org/shell-dev/2022/12/02/automated-testing-of-gnome-shell/)
