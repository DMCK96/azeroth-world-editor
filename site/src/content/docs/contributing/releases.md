---
title: Releases
description: Cut a release of Azeroth World Editor for Windows, macOS and Linux.
sidebar:
  order: 5
---

Releases are built by the **Release** workflow when a version tag is pushed. It makes unsigned installers for Windows, macOS and Linux and attaches them to a **draft** GitHub Release, which you check and publish.

## Cut a release

1. Bump the version with npm. It updates `package.json` and `package-lock.json` together, commits them and tags the commit `v0.2.0`:

   ```sh
   npm version 0.2.0 -m "chore(release): %s"
   ```

   Don't edit `version` by hand: `package-lock.json` would fall behind.
2. Push the commit and the tag:

   ```sh
   git push origin main v0.2.0
   ```

3. Wait for the Release workflow in the **Actions** tab. It:
   - checks the tag matches `package.json` (and stops if not),
   - runs the type check and unit tests,
   - builds on Windows (`.exe`), macOS (`.dmg` and `.zip` for Apple silicon and Intel) and Linux (`.AppImage` and `.deb`),
   - checks each Mac build carries the right native module for its processor,
   - uploads everything to a draft release for the tag.
4. Open the draft on the **Releases** page and edit the notes so they list every change since the previous release, one line each with its short commit hash. `git log --oneline v0.1.0..v0.2.0` lists them. The generated notes cover merged pull requests only and miss direct commits. Then publish the release. Users see these notes in the app's update dialog, so a change missing from them is a change they cannot read about.

Before a release, regenerate the [docs screenshots](/azeroth-world-editor/contributing/docs-and-screenshots/) if screens changed.

## If something fails

- **Tag does not match**: delete the tag (`git tag -d v0.2.0 && git push origin :refs/tags/v0.2.0`), then bump again with `npm version`.
- **One OS failed**: the others still upload to the draft. Fix the cause, then re-run the failed job from the Actions tab.

## Signing and updates

Builds are not code-signed, so Windows and macOS warn on first open; [Install](/azeroth-world-editor/getting-started/install/) explains how to get past it. The app does not update itself. On launch it looks for a newer published release and, if there is one, shows a dialog with the release notes: **Update** opens the release page, **Skip this update** stays quiet until a newer one is published, and **Remind me later** asks again on the next launch. Drafts and pre-releases are never offered, so users see the dialog only once you publish.

## Try the update dialog

Start the app with `AWE_FAKE_UPDATE=1` (for example `AWE_FAKE_UPDATE=1 npm run dev`) and it offers a made-up update, with sample notes, instead of asking GitHub. **Skip this update** stores nothing while it is set, so trying it never changes your real settings, and **Update** opens the real Releases page. To make an unpackaged build ask GitHub for real, set `AWE_UPDATE_CHECK=1` instead.

## Build locally

`npm run dist` builds installers for your own platform into `dist/`. For an unpacked build to try quickly, run `npx electron-vite build && npx electron-builder --dir`.

## The app icon

Installers take their icon from `build/icon.png`. See [Docs and screenshots](/azeroth-world-editor/contributing/docs-and-screenshots/#the-app-icon) to recapture it.
