# Releases and Backports

Aurora Shell follows the GNOME Shell release cycle. `main` targets the next GNOME release. Branches
such as `release/v50.x` and `release/v51.x` receive maintenance fixes for released versions.

## Features and Fixes

New features go to `main`. Maintenance branches accept only bug fixes and compatibility updates.

Bug fixes land on `main` first. To include one in a maintenance release, create a separate backport
pull request from the release branch:

```bash
git checkout release/v50.x
git cherry-pick <commit-sha>
```

Maintainers decide which fixes to backport. Adding a label such as `GNOME 50` to the original pull
request requests an automated backport after merge. The automation rebuilds the branch from the
target release, cherry-picks the original commits, and bumps the patch version.

## Release Candidates

Release candidate tags use `v50-rc1`, `v50-rc2`, and so on. To publish one, run the `Release` workflow
manually and choose `release_candidate`. The workflow increments the candidate number, tags the
current `main`, runs CI, and publishes the pre-release.

Release notes start at the most recent stable release or release candidate, whichever came last.
Nightlies are ignored. Publishing a release candidate keeps older candidates and removes superseded
nightlies.

Nightly and release candidate publications include both the production ZIP and the separate
DevTool-enabled development ZIP.

## Stable Releases

Stable tags use the GNOME major version and an Aurora patch number, such as `v50.1`. To publish the
version in `metadata.json`, run the `Release` workflow manually and choose `stable`. You can also push
a stable tag directly:

```bash
git tag -a v50.1 -m "Release v50.1"
git push origin v50.1
```

The workflow runs the complete CI pipeline and publishes both extension packages after every check
passes. Stable release notes start at the previous stable release, never at a release candidate. The
first stable tag for a GNOME major version also creates its maintenance branch.
