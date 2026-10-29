---
title: Working with an AI assistant (MCP)
description: Let an AI assistant connected over MCP research the world and build quests, NPCs and spawns in your open project.
sidebar:
  order: 14
---

Azeroth World Editor can run an [MCP](https://modelcontextprotocol.io/) server, so an AI assistant (Claude Code, Claude Desktop, or any other MCP client) can work in the project you have open: look things up in your world, draft a quest chain, place NPCs, and export a patch. You watch it happen, and anything it does can be undone.

It is off until you turn it on.

## Turn it on

1. Open **Settings** and choose the **MCP / AI** tab.
2. Tick **Allow AI to edit this project**.
3. The tab shows the **address** and a **token**. Press **Show** to see the token, or **Copy token** to copy it.

The server only listens on this computer (`127.0.0.1`), and every request must carry the token. **Make a new token** replaces it at once; a client using the old one is refused.

## Connect an assistant

Any MCP client that supports HTTP servers needs two things: the address, and the header `Authorization: Bearer <your token>`.

For Claude Code, press **Copy Claude Code command** and run it in a terminal. It looks like this:

```sh
claude mcp add --transport http awe http://127.0.0.1:47600/mcp --header "Authorization: Bearer <your token>"
```

Connect the editor to your world database first, as you do for any work. The assistant can also connect for you using one of your saved connections. Then ask for what you want.

## What the assistant can do

- **Look things up:** quests, NPCs, objects, items and spells by name; who stands where; what a quest chain links to.
- **Write quests:** start a new quest, import an existing one, set its fields, and check it for problems. Quest text is written in English.
- **Make NPCs, objects and items,** or take over an existing one and change it.
- **Place and move spawns,** set patrol routes, movement and respawn times in the World.
- **Export:** write a quest's or the project's SQL patch into your export folder.
- **Merge projects:** preview merging another project file into the open one, and write the result to a new file. See [Merging projects](/azeroth-world-editor/guides/merge-projects/#with-an-ai-assistant-mcp).
- **Undo and redo.**

## Knowing your world

Before it writes, the assistant can look at what already exists, so new content fits in:

- **Quests by zone and level:** the quests listed under a zone (such as Elwynn Forest), filtered by level, and the full text, objectives, rewards and chain links of up to 25 quests at a time, read without importing them.
- **What is around a point:** the NPCs and objects within a radius (100 yards by default, at most 500), what each does (vendor, innkeeper, quest giver), their level and faction, the quests they offer, what vendors sell and what NPCs drop. Every spawn includes where it stands and **which way it faces**, so the assistant knows what is already there and can aim its own NPC at something sensible, such as a campfire or a doorway, rather than at a tent, a wall or the NPC beside it.
- **Name and id clashes:** whether a name or an id is already used in your database or in your project.

Zones and factions are shown by name when the connection has a server data folder, and by number otherwise.

The assistant reads your project before the database, so it does not work from outdated information. Quests you added or retitled, NPCs and objects you made, and spawns you moved, placed or deleted are laid over what the database has. A result that comes from the project rather than the database is marked `source: "project"`, and a spawn you moved also says where the database has it (`movedFrom`).

## Lore from the wiki

The assistant can also search and read pages on [warcraft.wiki.gg](https://warcraft.wiki.gg/) to check new content against the story. This is **off until you turn it on**: in Settings, MCP / AI tab, tick **Allow lookups on warcraft.wiki.gg**.

- Only the words the assistant searches for are sent to the wiki; nothing else leaves your computer. It reads one page at a time, and repeats are remembered for an hour.
- Every answer carries the page link and the wiki's licence (Creative Commons Attribution-ShareAlike 4.0), so what it borrows can be credited.
- The wiki covers every expansion, while your server is at Wrath of the Lich King. The assistant is told that later events have not happened in your world's story yet, and that later content is welcome as inspiration, as long as it says where an idea comes from.
- If the wiki refuses the request, the assistant is told so and carries on without it.

## Scenes, fights, patrols and loot

Beyond quest text, the assistant can write the parts that make a quest or an encounter come alive, in the editor's own terms:

- **Scenes** on a quest: when something happens to an NPC, object or area (the quest is accepted, a player talks to it, it dies, someone enters an area), and only if some conditions hold, a list of steps runs, such as saying a line, giving credit, spawning an NPC or escorting one.
- **Boss fights** for the NPCs it makes: abilities on timers, reactions at health thresholds, phases, adds and surrender.
- **Patrol routes** for the spawns of its NPCs, with pauses and actions at each point.
- **Loot** for its NPCs and chests, **what its NPCs sell**, **what its NPCs teach**, **what its NPCs say** (gossip menus), and **what its NPCs do** (scenes of their own, with or without a quest).
- **New NPCs, objects and items**, such as a legendary sword and the captain who guards it.

It learns each of these from a built-in guide and examples, and the editor checks everything it writes and tells it what is still wrong, so it can fix it. If a scene stored on a quest cannot be read (an older or hand-edited one), the assistant is told its id and leaves it exactly as it is, and moving a marker in the World does the same, so it is never erased by a save. An existing database NPC's fight or loot is left alone when the editor locks it. None of this changes the database until you export a patch and apply it yourself.

## Ready-made workflows

A client such as Claude Code offers three workflows as slash commands: **quest_chain** (research a zone and build a chain that fits it), **legendary_item** (brainstorm an outline with you first, then build the item, its guardian and the chain) and **populate_place** (add NPCs or objects that fit a place and face what they are there for, such as a campfire or a road). Each one works in your open project, labels its steps "AI: …", and asks before exporting.

## What it cannot do

- It never writes to your world database, and it cannot apply a patch to your dev database. You apply patches yourself, as always.
- It has no access to your connection passwords.

## While it writes

A write usually takes a moment. While one runs, editing in the window pauses so your changes and the assistant's cannot cross:

- Panels that edit the project grey out and take no clicks or typing. An open quest editor shows *The assistant is changing this quest. Editing is paused for a moment.*
- In the World you can still look around and move the camera, but gizmos, placing, deleting and the right-click menu's editing items wait (the menu says why). A drag under way is dropped and the part goes back where it was. Copying and looking things up still work.
- Anything you typed in a quest meanwhile is kept and put on top of the assistant's change when it arrives, and closing the app never loses an edit.

The pause only shows if the write takes longer than a moment.

## Undoing its work

Every change the assistant makes is one step in **History**, named **AI: …** (for example *AI: edit quest 60001*). The open quest, the quest graph and the World update as it works. Undo with **Ctrl+Z** or from History, like any other change. See [Undo and redo](/azeroth-world-editor/guides/undo/).

## Moving the 3D camera

An assistant can go and look at a place in the World view, then take a `screenshot` of it. None of these change the project, and they work with Debug mode off. The Back button returns from a teleport.

| Tool | What it does |
| --- | --- |
| `camera_status` | The map, position and area the camera is at now. |
| `teleport_search` | Named places (cities, towns, landmarks, instances) whose name, zone or region match the words, best match first, with their map and coordinates. |
| `teleport` | Takes the camera to a named place (`spot`) or to `map`, `x`, `y`, `z`, and says where it landed. An ambiguous name answers the candidates. |

## Debug mode and the screenshot tool

For tracking down a fault that only shows in the live window, such as text fields that stop taking the keyboard, or a view that runs slowly in one place, the app has a **Debug mode**. It is off by default, and only you can switch it on: **Settings**, **Preferences**, **Diagnostics**, **Debug mode**. An assistant cannot turn it on.

While it is on, the app keeps a timeline of what both the window and the main process see, in memory and in a log file (`logs` in the app's data folder, the newest five kept, each stopping at 20 MB). It records key **codes** and focus changes, window and dialog events, errors, crashes and hangs, and once a second the 3D view's frame rate, draw time and draw calls. It **never** records the characters you type or what is in a field, and a password field is only ever called `[password]`. Nothing leaves your computer.

Five tools use it:

| Tool | Needs Debug mode | What it gives the assistant |
|---|---|---|
| `debug_status` | No | Whether it is on, how many events are held, the log file, and the window's focus state now. |
| `debug_events` | Empty when off | The timeline, filtered by time, category (`input`, `focus`, `window`, `dialog`, `health`, `error`, `probe`, `perf`) and count. |
| `debug_snapshot` | Yes | Where keyboard focus is right now, whether that field can take text, anything inert, hidden or covering it, and the open dialogs. |
| `debug_type` | Yes | Types a few characters into whatever has focus and reports whether the field changed, with the events that produced. |
| `screenshot` | No | A picture of the window, optionally cropped to an element or a rectangle. |

`screenshot` works with Debug mode off, so an assistant can look at the result of a change.

### Example: the keyboard stopped working

Switch Debug mode on and carry on until the fault shows. Then ask the assistant to look. It reads `debug_events` for `orphan-key` and `before-input`, runs `debug_snapshot`, tries `debug_type`, and takes a `screenshot`. How to read what it finds:

- The main process saw the keys (`before-input`) but the page did not (no `keydown`): the window lost the keyboard to the system or another window.
- The page saw the keys and recorded an `orphan-key` with `defaultPrevented: true`: something on the page cancelled them.
- The snapshot lists a `blockedBy` or `coveredBy` entry: something disables the field or sits over it.
- `debug_type` changes the field: the field itself accepts text, so the question is why your own keys were not reaching it.

### Example: it is slow in one place

With Debug mode on, stand in the slow place in the 3D view for a few seconds, then somewhere that runs well, and ask the assistant to compare the `perf` events from `debug_events`. Each holds `fps`, `updateMs` (everything before drawing), `renderMs` (drawing), `calls`, `triangles`, `geometries`, `textures`, `programs` and where the camera was:

- Many `calls` or `triangles` there: too much is being drawn at once.
- A high `renderMs` with few calls: the drawing itself is costly, for example lights, fog or overdraw.
- A high `updateMs`: the per-frame work before drawing is the cost.

## Things to try

- *"Build a quest chain in Elwynn Forest for level 10, and make it lore accurate."*
- *"I have an idea for a legendary weapon and a quest chain to get it. Help me brainstorm and fit it in with the rest of the world."*
- *"Find every quest between levels 8 and 12 near Goldshire and tell me what's missing."*
