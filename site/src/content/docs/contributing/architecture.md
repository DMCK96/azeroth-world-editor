---
title: Architecture
description: How Azeroth World Editor's code is laid out, how the 3D view is built and the rules it keeps, and how a change travels from the editor to SQL.
sidebar:
  order: 2
---

Azeroth World Editor is an [Electron](https://www.electronjs.org/) app written in TypeScript, with a React interface.

## Layout

```
src/
  core/       Pure logic: no Electron, no React. Quest model, schema, SQL, scripts, map maths.
  main/       Electron's main process: the IPC API, the project store, database connections, the game client's files.
  preload/    The bridge that exposes the main process's API to the interface.
  renderer/   The React interface: the World (world3d/), the Quests dock (views/dock/), views, modules, editors.
  shared/     Types shared by main and renderer, such as the IPC contract.
drizzle/      Migrations for the local project store.
tests/        core, main, renderer, integration, e2e and docs tests.
site/         This documentation site.
```

`src/core` never imports Electron or React, so almost everything the app decides can be unit-tested in plain Node.

Inside `src/core`, each feature has its own folder: `scripts` (quest scripting scenes), `combat` (the combat wizard), `entities` (new NPCs and objects), `patrol`, `map`, `client` (reading the game client's MPQ archives and BLP images), `game` (server data such as DBC files, map heights and navmesh), `export`, `sql`, `ids` (checking the ids a project allocated against the database) and more.

The id check works on kinds. A kind, in `src/core/ids/kinds/`, says which ids the project allocated, what the database holds at them, which database rows are the project's own, how to change one id everywhere it is used, and where free ones start. `findConflicts`, `planRenumber` and `applyRenames` in `src/core/ids/conflicts.ts` know no kind by name. Spawn guids are the first kind; to cover another id, add a file implementing `IdKind` and list it in `kinds/index.ts`.

## Processes

- The **main process** (`src/main`) owns everything with side effects: the MySQL connection to the world database (read-only) and optional dev database, the open project and its undo history, the local store (SQLite through Drizzle), the file system, the game client and server data folders, and the `awe-wow://` protocol that serves game client files to the 3D view.
- The **API** the renderer calls is `createApi` in `src/main/api/`. It has one module per area (`connection-api`, `lookup-api`, `quests-api`, `map-api`, `entities-api`, `world-layer-api`, `spawn-groups-api`, `history-api`, `export-api` and `project-api`), and each implements its interface from the contract in `src/shared/ipc/`, where each area has a file with its types and its part of `Api` (`QuestsApi`, `MapApi` and so on), and `requests.ts` validates every call as it arrives. The areas are built from shared services, made once in `services.ts`: the connection, the project context, the server data files, the export checks, patch building, spawn groups and history travel. A new call is declared in its area's interface, given a request schema, and written in its area's module; a new area is a new pair of files, its interface added to `Api` and its module spread into `createApi`.
- The **MCP server** (`src/main/mcp/`) lets an AI assistant work in the open project. It is off until the user turns it on in Settings (the MCP / AI tab), and listens on `127.0.0.1` behind a bearer token (`http.ts`). A tool is data (`tool.ts`): a name, an input schema, whether it writes, and a `run` that reaches the app only through `ctx.call`, which validates arguments with the same schemas the window's calls use (`api/invoke.ts`). `server.ts` turns the tool list (`tools/`) into MCP tools. Write tools go through the write guard (`write-guard.ts`): the window is asked to hand over pending edits, the tool's changes become one history step labelled `AI: …`, writes run one at a time, and the window is told what changed by the `app:external-change` event, shaped like an undo result so the renderer applies it with the same code (`applyExternalChange`). From the flush until that event the window holds its own quest edits back (`app:hold-edits`, `holdEdits`), so a copy of the quest older than the write is never sent over it; edits typed meanwhile are put on top of the change. The tools that tell the assistant what already exists (`tools/lore.ts`) are built on `src/core/lore/`: pure code over the existing database reads (zones and quests, the NPCs, objects, vendor stock and drops around a point with their facing, name and id clashes), called through the `LoreApi` in `src/main/api/lore-api.ts`. The same module has a small client for warcraft.wiki.gg (`core/lore/wiki.ts`): it takes a `fetch`, only ever builds requests to that host's `api.php`, sets no headers, spaces and caches its requests, and is guarded by the `Allow lookups on warcraft.wiki.gg` setting, off by default. The tools that write scenes, fights, patrols, loot and new NPCs, objects and items (`tools/authoring.ts`) are built on `src/core/authoring/`: the seven authoring models, each with the editor's own zod schema, a JSON Schema generated from it, a hand-written guide (a test fails if a model gains a kind the guide does not mention) and examples built from the editor's presets. Three workflow prompts (`src/main/mcp/prompts.ts`) are registered by `createMcpServer` and name real tools (a test checks they exist). The world database is never written and `applyToDev` is not exposed (`tests/main/mcp-tools-surface.test.ts` enforces it).
- The **renderer** (`src/renderer`) is the interface. It talks to the main process only through the API that `src/preload` exposes; state lives in [Zustand](https://zustand.docs.pmnd.rs/) stores in `src/renderer/state`. The app store (`app-store.ts`) is made of slices under `state/app/`, one per area (connection, quest, canvas, focus, links, rotations, world, export, project, ids, history, shell), each with its own interface; what they share that is not state (debounce timers, request tokens, the undo hold) is the `Kit` in `kit.ts`.

## The 3D view

The app is built around the **World**: the game world in 3D, drawn from the user's own game client. It is where the app opens, and the quest chain is in a dock under or beside it (`src/renderer/views/dock/`: `DockLayout`, `ChainDock` and its `ChainGraph`). The code is in `src/renderer/world3d/`.

### How it is built

- **Files come straight from the client.** The main process opens the client's MPQ archives in the game's own load order and serves each file at `awe-wow://file/<path>`. Nothing is extracted, copied or hosted, and the repo never contains game files.
- **Drawing is [Three.js](https://threejs.org/).** Terrain, doodads (trees, fences, carts) and animated models come from [wowserhq/scene](https://github.com/wowserhq/scene), copied into `world3d/scene/` because the editor changes its insides. Its README lists every change from upstream. Buildings (WMO), liquids, dressed characters and the editing tools were written here or adapted from MIT-licensed projects.
- **Loaders run in Web Workers;** the main thread only builds Three.js objects from what they return.
- **World units are the server's:** yards, X north, Y west, Z up. A spawn's `position_x/y/z` is its place in the scene, with no conversion anywhere. Keep it that way.
- **`world3d.ts` is the scene's API** (the `World3D` interface): React drives it through calls such as `lookAt`, `select`, `setWorldLayer` and `setPlacing`, and hears back through callbacks. React components never reach into Three.js objects. `World3DView.tsx` wires the scene to the app; `WorldWorkspace.tsx` is the workspace around it (the place card, Find, Teleport, the welcome).
- **NPC movement is a preview, never data.** The walkers in `src/core/world/walk/` are pure (no Three.js): each drawn NPC's walk plan comes from its path or wander distance (`plan.ts`), and `walker.ts` steps it at the server's default speeds. In the scene, `scene/spawn/walkers.ts` and `MovementDriver.ts` move the drawn models while the one `MovementControl` plays (the toolbar's **Play**, paused on every open); NPCs on a docked vessel walk through its frame, and the vessel never moves. To keep Play cheap, a walker looks for its ground only while its NPC is in view, and then once per half yard walked (`tuning.ts`); NPCs out of range or with the NPCs layer hidden are not stepped.
- **Spawns are read per map tile** through the `viewSpawns` call (`src/core/db/view-spawns.ts`): the camera's tile and the eight round it, capped per tile.

### Rules it keeps

- **Every change is a step of the project's history.** The view keeps no undo of its own: a gesture is sent to the main process as one step, and an undo hands the view a new layer to draw. A gesture that changes ten spawns is still one step. An action that cannot be undone is treated as a bug.
- **Where an edit goes is decided by what it touches.** The open quest's own spawns are edited through the quest. Everything else goes into the project's **world layer** (`src/core/world/layer.ts`): moved and placed spawns, routes, movements, respawn times and spawn groups, each keeping what the database had at the first edit, so it can be listed, reverted one by one, flagged when the database has moved since, and exported with a revert patch. New and edited NPCs, objects and items belong to the project, not to a quest.
- **The database is only ever read.** Edits become rows in a patch; nothing in the 3D view writes to the world database.
- **One bad file never takes the view down.** A model, building, texture or terrain tile that cannot be read is skipped, drawn as a stand-in where it can be, and reported by name (`scene/diagnostics.ts`); the rest still draws. Real clients, especially modded ones, are messier than the format specs.
- **The right-click menu is built from sections**, one file each under `world3d/menu/sections/`, registered in order. A section says which subject it applies to and gives its items. A new ability is a new section file, not a branch in a big switch.
- **Frame time is a budget.** Spawns are drawn within a set distance of the camera, simplified further out, and animated less often the further they are; copies of a doodad that never moves are batched into one draw call per model. Before this, Goldshire was 18,000 draw calls at one frame a second. A change that adds per-frame work should be measured in a busy place such as Goldshire, not in an empty field.

### Testing it

`npm run test:world3d` opens the real 3D code in a browser (software WebGL, no graphics card) against a fake game client built by `tests/world3d/fake-client.ts`. The failures here are usually silent, an empty view, so write each test to fail against the old code before fixing. See [Testing](/azeroth-world-editor/contributing/testing/).

### One interface

The World and the quest chain are one workspace:

- **The dock.** `views/dock/DockLayout.tsx` lays out the World and the **Quests** dock under or beside it. The dock is closed when the app starts and opens with **Quests** in the top bar or when a quest is opened; the World keeps one wrapper, so it never remounts. The quest editor is a centred modal over both (`views/QuestEditorModal.tsx`).
- **The focus.** `state/app/focus.ts` holds the one quest, and part of it, that every view agrees on. Opening a quest sets it, and `world3d/useFocusFollow.ts` takes the camera to the quest's nearest NPC or object, unless the author moved the camera after the focus was set. Selecting a giver, ender or objective of the open quest in the World (by a click or with Find) sets the focused part, and the quest's card marks it; that selection never moves the camera.
- **Preferences.** `preferences/store.ts` keeps this computer's preferences, such as the dock's side and its size on each side, in local storage under `acqc.preferences`, never in the project file. The Settings dialog is built from the sections in `views/settings/sections.ts`; a new tab is a new entry there.
- **Linking by drag.** Dragging from one quest card's handle to another's makes turning in the first unlock the second. `core/links/drag-link.ts` decides whether the link is allowed (no loops, no second prerequisite), and `state/app/links-edit.ts` writes it as one undo step without moving the focus.
- **Placing by drag.** The open quest's card lists its NPCs and objects; each row drags onto the 3D view (`world3d/chain-drop.ts`, `CHAIN_DRAG_TYPE`) to place a spawn there, as one undo step. A row with a spawn already is marked **Placed**, from one `questSpawnList` read of the open quest (`views/dock/usePlacedParts.ts`); it still drags, since a second spawn is legal.
- **Quest positions.** The open quest's script and fight positions and its POI are drawn as labelled pins (`world3d/scene/marker/MarkerLayer.ts`, built from `world3d/quest-markers.ts`), selected and dragged like spawns.

The 2D quest map and Leaflet were removed when the World took over placing, patrols and quest positions.

## From the editor to SQL

1. **Load.** The World reads spawns, routes and groups for the area around the camera. Opening an existing quest reads its rows from the world database and turns them into the app's quest model. A quest that would not read back exactly is marked unsafe to export.
2. **Edit.** The World edits the world layer and the project's NPCs, objects and items; modules edit the quest model. Scenes, fights, new NPCs and patrols are kept in author terms (for example "when the quest is accepted, say this"), not as rows.
3. **Validate.** Each module reports warnings and errors, shown as badges.
4. **Compile.** Export turns the model into rows: the project patch for the world layer and the project's NPCs, objects and items, and each quest's own tables, plus scripts compiled from scenes, fights and patrol actions.
5. **Write.** The rows become an SQL patch file, or are applied to the dev database. The **Changes** dialog shows the same rows before you commit to either.

See [What gets written to the database](/azeroth-world-editor/reference/database-tables/) for the tables involved.

## Interface conventions

- Creating and editing happen in **centred modals**. The side panel is only for previews.
- Copy is written in **author terms**: quests, givers, NPCs, scenes. Table and column names appear only where an admin needs them, such as the Changes dialog.
