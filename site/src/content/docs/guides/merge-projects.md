---
title: Merging projects
description: Bring the work from another project file into the one you have open, see what the result holds and what it drops, and settle what changed on both sides.
sidebar:
  order: 1.5
---

Two people (or one person on two computers) can each work on a copy of the same project and bring the work together afterwards. **Merge project…** takes another project file and merges it into the project you have open. The open project is **mine**; the other file is **theirs**.

A merge never changes a file. The result opens as a **new unsaved project**, under your project's name; save it with **Save As…** when you are happy with it. Mine, theirs and the base stay exactly as they were.

## Merge another project

1. Open your project, then choose **Project** in the top bar and **Merge project…**.
2. Under **Their project**, press **Choose…** and pick the other `.awe` file.
3. Under **Base project**, press **Choose…** and pick the file both projects started from, if you have it (see [The base file](#the-base-file)).
4. Read the preview, and settle everything under **Needs a decision**.
5. Press **Merge**. The button says how many changes the merge drops, for example **Merge (drops 1)**, and stays disabled until every conflict has an answer.

If the open project has unsaved changes, the app asks whether to save them before the result replaces it. Choosing **Cancel** keeps your project open and the merge dialog with it, so nothing you chose is lost.

## The base file

The base is the project file both copies started from: the file you sent, or the last version you both had. With it, the merge can tell **who changed what**:

- An item only one side changed takes that side's version.
- An item only one side removed is removed.
- An item both sides changed in the same way is kept once.
- An item both sides changed differently is a **conflict**: you choose.

Without a base, press **No base (two-way merge)** or leave it unchosen. The merge then cannot tell which side changed an item, so every item that differs between mine and theirs is asked about. The preview says so at the top.

If the base shares little with either project, the preview warns that it may be the wrong file.

Only what an item **is** counts. Where a quest card sits on the canvas, its last export path, its import snapshot and its fidelity report are never compared, so moving cards around is never a conflict. They come from whichever side's quest is kept.

## Conflicts and collisions

**Needs a decision** lists two kinds of question, grouped by what they are about (quests, NPCs, placed spawns and so on). Each shows the base, mine and theirs, and a table of the fields that differ.

- **Conflict:** *Changed differently in each project.* The same item was changed one way in your project and another way in theirs, or removed on one side and changed on the other. Choose **Keep mine** or **Keep theirs**. A conflict has no default: **Merge** waits for an answer.
- **Collision:** *Both projects use this id for different things.* Each of you made something new and both got the same id, such as two different new quests numbered 60002. Choose **Keep mine**, **Keep theirs** or **Keep both**.

**Keep both** is the default for a collision. Their item is renumbered to a free id (the option names it, for example *Keep both (theirs gets 60003)*), and everything in their project that pointed at the old id is rewritten to the new one. The decision lists those rewrites. Only ids your projects allocated can collide: new quests, new NPCs, objects and items, spawn groups and placed spawns. A change to something that already exists in the database, such as a moved spawn, can only conflict.

Renumbering one item can bring up another collision: when both of you placed the same spawn of a new NPC and the NPCs collide, their spawn now belongs to their renumbered NPC, so it differs from yours. That collision is listed too, and **Keep both** renumbers it as well.

Ids made inside an NPC or object are checked as well. A spawn of theirs that the result keeps, at a spawn guid your project uses for something else, moves to a free guid, and the warnings say so. Trainer ids, gossip menu and text ids, page ids and path ids are not renumbered: when two things in the result use one of them, the warnings name the id and both of its users, so you can change one before you export.

When one side deleted a spawn and the other changed it (moved it, or changed its movement, respawn time or game events), the deletion and the changes become one conflict under **Spawns**, decided together, so you never keep a change to a spawn the result has deleted.

## Reading the preview

The preview updates after every choice.

- **Result:** for each kind of item, how many are in both projects, how many come only from mine and only from theirs, how many were renumbered, and the total the result holds.
- **Will be dropped:** every change the result does not keep, and which file it came from, such as your edit of a quest when you kept theirs, or *the removal of* an item when the other side's edit wins. This is what the count on the **Merge** button counts.
- **Not carried over:** project settings and history the result does not take from theirs or the base (see below).
- **Needs a decision:** the conflicts and collisions above.
- **Warnings:** anything worth checking before you merge: no base chosen, a base that may be the wrong file, something in the result that points at an item the merge left out (for example a quest whose giver was an NPC you chose not to keep), a settled collision that leaves the other side's references on a different item, a spawn of theirs moved to a free guid, or an id two things in the result use.

## What is not carried over

- **Project settings:** the result keeps your project's name, id range and output folder. Theirs, if different, are listed and not used; so is the base file's name.
- **Ids outside your range:** if renumbering or their items put ids outside your id range, the preview counts them.
- **Canvas view:** where the canvas is panned and how far it is zoomed come from your project, not from theirs or the base.
- **Undo history:** the result starts with an empty history. Every file's own history stays with that file.
- **Layout and export details:** canvas positions, last export paths, import snapshots and fidelity reports come from the side whose quest is kept.

## With an AI assistant (MCP)

An assistant connected over [MCP](/azeroth-world-editor/guides/ai-mcp/) can merge too, with two tools. Like the dialog, the open project is mine, with any edit the window has not sent yet, and neither tool changes any input file.

| Tool | What it does |
| --- | --- |
| `merge_preview` | Takes `theirsPath`, an optional `basePath` (leave it out for a two-way merge) and `choices` (decision id to `mine`, `theirs` or `both`). Returns the summary, what is dropped, the decisions with their options and defaults, what is not carried over, the warnings, whether the merge is settled, and a `fingerprint`. |
| `merge_write` | Takes the same files and choices, the `fingerprint` from `merge_preview`, and an `outputPath`, and writes the merged project there. The output path must not exist yet and must not be one of the merged files. It opens nothing and leaves the open project as it is. |

`merge_write` is refused when a file, or the open project, changed since the preview that gave the fingerprint: preview again and pass the new one. It is also refused while a conflict has no choice.
