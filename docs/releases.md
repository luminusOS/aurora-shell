# Releases and Backports

Aurora Shell follows the GNOME Shell release cycle. `main` targets the next GNOME release, while
branches such as `release/v50.x` and `release/v51.x` receive maintenance fixes for released GNOME
versions.

## Features and Fixes

Land new features on `main`. Maintenance branches accept only bug fixes and compatibility updates.

Bug fixes also target `main` first. When a maintenance release needs the fix, create a separate
backport pull request based on the release branch:

```bash
git checkout release/v50.x
git cherry-pick <commit-sha>
```

Maintainers decide which fixes warrant backports. A label such as `GNOME 50` on the original pull
request requests an automated backport after merge. The automation rebuilds its branch from the
target release, cherry-picks the original commits, and adds the next patch-version bump.

## Release Candidates

Release candidate tags use `v50-rc1`, `v50-rc2`, and so on. Trigger the `Release` workflow manually;
it chooses the next candidate number, tags current `main`, runs CI, and publishes a pre-release.
Publishing a release candidate removes nightly pre-releases that it supersedes.

Nightly and release candidate publications include both the production ZIP and the separate
DevTool-enabled development ZIP.

## Stable Releases

Stable tags use the GNOME major version and an Aurora patch number, such as `v50.1`:

```bash
git tag -a v50.1 -m "Release v50.1"
git push origin v50.1
```

The release workflow calls the complete CI pipeline and publishes both extension packages after
all checks pass. The first tag for a GNOME major version also establishes its maintenance branch.
