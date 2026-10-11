# Contributing to Azeroth World Editor

Thanks for helping. This is the short version; the [contributor pages](https://dmck96.github.io/azeroth-world-editor/contributing/) go into more depth.

## Prerequisites

- Node.js 24 and npm, and Git.
- A MySQL AzerothCore world database to connect to. The integration and end-to-end tests need one too.
- A 3.3.5a game client folder. The World, the heart of the app, is drawn from it. The `test:world3d` tests use a fake client and need none.
- Build tools for native modules, used when `better-sqlite3` has no prebuilt binary for your platform (Visual Studio Build Tools, Xcode Command Line Tools, or `build-essential` and Python).

## Setup

```sh
npm ci
cp .env.example .env   # then fill in your world database
npm run dev
```

With a filled-in `.env`, the login screen is ready and you only choose **Connect**. The installed app ignores `.env`.

More: [Development setup](https://dmck96.github.io/azeroth-world-editor/contributing/development-setup/)

## Native module rebuilds

`better-sqlite3` must be built for whichever runtime loads it. `npm test` rebuilds it for Node; `npm run dev`, `npm run build` and `npm run dist` rebuild it for Electron. If you run `npx vitest` or `npx playwright test` directly, run `npm run rebuild:node` or `npm run rebuild:electron` first.

## Project layout

| Path | What lives there |
| --- | --- |
| `src/core` | Pure logic with no Electron or React: quest model, schema, SQL, scripts, combat, map maths. |
| `src/main` | Electron's main process: the IPC API, the project store, database connections, the game client's files. |
| `src/preload` | The bridge exposing the main process's API to the interface. |
| `src/renderer` | The React interface. `state/app/` holds the app store's slices, `preferences/` this computer's preferences. |
| `src/renderer/views/dock` | The **Quests** dock: `DockLayout` (the World plus a resizable dock under or beside it), `ChainDock` and its `ChainGraph`. |
| `src/renderer/views/settings` | The Settings dialog's sections, one tab each. |
| `src/renderer/world3d` | The World: the 3D view, its editing tools and its right-click menu. `scene/` is the vendored Three.js renderer. |
| `src/shared` | Types shared by main and renderer. |
| `drizzle/` | Migrations for the local project store. |
| `tests/` | `core`, `main`, `renderer`, `integration`, `e2e` and `docs` tests. |
| `site/` | The documentation site. |

More: [Architecture](https://dmck96.github.io/azeroth-world-editor/contributing/architecture/)

## The 3D view

The app opens on the World, and most new work touches it. The decisions to keep:

- **Files come from the user's client**, served by the main process at `awe-wow://`. Never commit game files; tests build their own.
- **World units are the server's** (yards, X north, Y west, Z up), with no conversion between a spawn's row and its place in the scene.
- **React drives the scene only through the `World3D` interface** in `world3d/world3d.ts`; components never reach into Three.js objects.
- **Every gesture is one undo step**, kept by the main process. The view keeps no history of its own. An action that cannot be undone is a bug.
- **Edits go where they belong:** the open quest's own spawns through the quest, everything else into the project's world layer, which keeps the database's original for reverts and the revert patch. The database is only read.
- **One bad file never blanks the view:** skip it, draw a stand-in, report it by name.
- **New right-click abilities are new section files** under `world3d/menu/sections/`.
- **Frame time is a budget:** measure per-frame work in a busy place such as Goldshire.
- **Ported code keeps its credit:** licence and authors beside the code, and an entry in [CREDITS.md](CREDITS.md).

### One interface

The World and the quest chain are one workspace, and these are the pieces that keep them so:

- **The dock.** `views/dock/DockLayout.tsx` lays out the World and the **Quests** dock under or beside it, closed when the app starts; the World keeps one wrapper, so it never remounts when the dock opens, closes or moves. The quest editor is a centred modal over both (`views/QuestEditorModal.tsx`).
- **The focus.** `state/app/focus.ts` is the one quest, and part of it, that every view agrees on. Opening a quest sets it; `world3d/useFocusFollow.ts` takes the camera there (unless the author moved it since: the controls report each drag, wheel turn and flying key as `onCameraInput`), and an NPC or object of the open quest selected in the World sets the focused part, which the quest's card marks.
- **Preferences.** `preferences/store.ts` keeps this computer's preferences (the dock's side and sizes) in local storage under `acqc.preferences`, never in the project. Settings is built from `views/settings/sections.ts`: a new tab is a new entry there.
- **Linking by drag.** Dragging from one quest card's handle to another's makes turning in the first unlock the second (`core/links/drag-link.ts` checks it, `state/app/links-edit.ts` writes it as one undo step). The graph makes no link while the quest editor is open, or stepped aside for the World.
- **Placing by drag.** A part row on the open quest's card drags onto the 3D view (`world3d/chain-drop.ts`, `CHAIN_DRAG_TYPE`) to place a spawn of it there, one undo step. Rows with a spawn already are marked **Placed** (`views/dock/usePlacedParts.ts`, from the one `questSpawnList` read of the open quest the World makes too); they still drag, since a second spawn is legal.
- **Quest positions.** Script and fight positions and the POI of the open quest are pins in the scene (`world3d/scene/marker/MarkerLayer.ts`, from `world3d/quest-markers.ts`), selected and dragged like spawns.

The 2D quest map is gone: placing, patrols and quest positions are all in the World, and Leaflet is no longer a dependency.

More: [Architecture: the 3D view](https://dmck96.github.io/azeroth-world-editor/contributing/architecture/#the-3d-view)

## Tests

| Command | Runs | Needs |
| --- | --- | --- |
| `npm run typecheck` | TypeScript | nothing |
| `npm test` | Unit tests (Vitest) | the fork's base SQL |
| `npm run test:int` | Integration tests | `ACQC_TEST_MYSQL_URL`, the fork's base SQL |
| `npm run test:e2e` | End-to-end tests (Playwright) | `ACQC_TEST_MYSQL_URL`, the server data and game client folders |
| `npm run test:world3d` | The real 3D code in a browser, against a fake game client | a Chromium build (`PW_CHROMIUM` if Playwright's own is not installed) |

Tests read `.env` like the app does. They find the fork's base SQL (`data/sql/base/db_world`) beside your `ACQC_WORLD_DB_DBC_DIR`, or at `ACQC_AC_SQL_DIR`, and the folders from `ACQC_WORLD_DB_DBC_DIR` and `ACQC_WORLD_DB_CLIENT_DIR`. `ACQC_TEST_MYSQL_URL` is `mysql://user:password@host:port/database`. Set it directly; do not `source` your `.env`, which mangles Windows paths.

More: [Testing](https://dmck96.github.io/azeroth-world-editor/contributing/testing/)

## Conventions

- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/) with a scope: `feat(quest): …`, `fix(ui): …`, `docs(site): …`.
- **Logic goes in `src/core`** and is unit-tested there. Write the failing test first; for the 3D view, check it fails against the old code, since its failures are often a silently empty view.
- **Creating and editing happen in centred modals**; the side panel is only for previews.
- **Interface copy is written in author terms**: quests, givers, NPCs and scenes, never table and column names.
- **Comments explain why**, not what.

## Docs

The docs site is in `site/` (Astro Starlight). Run it with `npm --prefix site ci` then `npm run docs:dev`; `npm run docs:build` fails on broken links or missing images. `npm run docs:screenshots` regenerates the screenshots from the real app using your `.env` (including the Goldshire route before and after, from `tests/docs/fixtures/goldshire.awe`), and `npm run app:icon` recaptures the app icon (`build/icon.png`).

More: [Docs and screenshots](https://dmck96.github.io/azeroth-world-editor/contributing/docs-and-screenshots/)

## Releases

1. `npm version X.Y.Z -m "chore(release): %s"` bumps `package.json` and `package-lock.json` together, commits and tags `vX.Y.Z`. Don't edit `version` by hand, or the lockfile falls behind.
2. `git push origin main vX.Y.Z`.
3. The Release workflow checks the tag matches, runs the tests, and builds unsigned installers for Windows, macOS and Linux into a draft release.
4. Edit the draft's notes so they list every change in `git log --oneline vPREVIOUS..vNEW`, one line each with its short commit hash (the generated notes list merged pull requests only and miss direct commits), then publish it. The app's update dialog shows these notes to users.

More: [Releases](https://dmck96.github.io/azeroth-world-editor/contributing/releases/)

## Pull requests

- One topic per pull request.
- `npm run typecheck` and `npm test` pass.
- Include screenshots for interface changes, and update the docs when behaviour changes.

## License

By contributing, you agree your contributions are licensed under [GPL-3.0-or-later](LICENSE).
