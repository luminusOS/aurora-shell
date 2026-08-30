# Releases and backports

`main` is the source for the next release. Stable GNOME generations are maintained on branches named
`release/v<major>.x`. Release automation always runs the reusable CI workflow and publishes the two
ZIPs produced by its package job.

## Preconditions

Before publishing, confirm that:

- `metadata.json` has the intended numeric `version-name` and supported `shell-version`;
- the target commit is on `main` for nightlies, release candidates, and the first stable release;
- required CI checks pass and package inspection produced both ZIP variants;
- the production ZIP has a current Shexli review in [GNOME Extensions review notes](extension-review.md);
- release notes and credited work are ready for the commits being published.

Use the **Bump version** workflow to change `version-name` on `main` or a maintenance branch. It
validates numeric components, pushes `bot/bump-version-<branch>-<version>`, and opens or updates a
pull request. It does not publish a release.

## Nightly pre-releases

Run the **Nightly pre-release** workflow. It checks out `main`, reads `version-name`, and chooses
`v<version>-nightly<N>`. It skips publication when the latest nightly already points at current
`main`, unless the manual `force` input is set.

The workflow runs CI for the resolved SHA, downloads both package artifacts, and generates notes
from the latest stable release. It marks the release as a non-latest pre-release and deletes older
nightly releases and their tags. It does not delete release candidates.

If state resolution or CI fails, fix `main` and rerun. If release creation fails after CI, rerun the
workflow only after checking whether the chosen tag or release already exists.

## Release candidates

Run the **Release** workflow on `main` with `release_candidate`. It reads `version-name`, increments
the greatest matching `v<version>-rc<N>` tag, refuses to replace an existing tag, and runs CI on the
resolved commit.

Release notes begin at the newest published stable release or release candidate; nightlies are
ignored. A successful RC publishes both ZIPs, keeps older RCs, and deletes superseded nightlies.
Release candidates do not create maintenance branches.

## Stable releases

Run the **Release** workflow with `stable`. It publishes `v<version-name>` from current `main`, runs
CI, and generates notes from the previous stable release. The workflow refuses an existing tag.

A pushed stable-looking tag (`v[0-9]*`, excluding `-rc` tags) also invokes the workflow. Manual
dispatch is safer because it derives the tag from reviewed metadata; direct tags must point at the
intended commit and match the version policy.

After publication, the workflow creates `release/v<major>.x` at the released commit if the branch
does not already exist. Existing maintenance branches are left unchanged.

If GitHub Release creation succeeds but maintenance-branch creation fails, do not republish or move
the release tag. Inspect the release commit, create the missing branch at that exact commit, and push
the branch. If CI fails, fix the source and publish a new version; never replace a public stable tag.

## Backports

Bug fixes land on `main` first. A maintenance backport is a separate pull request based on the target
`release/v<major>.x` branch and contains only the commits needed for that released line.

```bash
git switch release/v50.x
git pull --ff-only
git switch -c backport/fix-name
git cherry-pick <commit-sha>
```

Resolve conflicts against the maintenance branch's APIs, then run the tests appropriate to the
backported change. Do not merge unrelated refactors to make a cherry-pick clean.

The repository has no backport workflow, so labels do not replace the branch and cherry-pick steps
above. After the backport lands, use **Bump version** against the maintenance branch and publish the
resulting stable tag from the intended maintenance commit.

## Artifact and failure checks

Every nightly, RC, and stable release must contain:

- `aurora-shell@luminusos.github.io.shell-extension.zip` for users and EGO;
- `aurora-shell@luminusos.github.io.development.shell-extension.zip` for contributor and QA sessions.

The CI artifact is retained for one day, so a delayed release job may need a clean workflow rerun.
Never substitute a locally built ZIP into an automated release without recording and validating the
different build provenance.
