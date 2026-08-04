# Aurora Shell Documentation

This directory contains detailed project guidance. The repository root keeps only the entry points
and files required by GitHub, contributors, or packaging.

## Project Design

- [Architecture](architecture.md) describes the runtime, source layout, and test boundaries.
- [GNOME Shell adapter decision](gnome-shell-adapter.md) records why modules use Shell APIs
  directly.
- [Adding and maintaining modules](modules.md) covers manifests, lifecycle, settings, and coding
  conventions.

## Development and Delivery

- [Development and testing](development.md) covers setup, builds, validation, integration tests,
  Toolbox, and CI.
- [Releases and backports](releases.md) covers maintenance branches, release candidates, stable
  releases, and automated backports.
- [Dock autohide input fixes](backports/dock-autohide-input-fixes.md) records the related fixes and
  validation required for their maintenance backport.
- [GNOME Extensions review notes](extension-review.md) records the current Shexli findings and
  review decisions.

Start with the root [contribution guide](../CONTRIBUTING.md) when preparing a change.
