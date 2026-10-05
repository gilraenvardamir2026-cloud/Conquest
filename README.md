# Conquest Tabletop

A virtual tabletop for *Conquest: The Last Argument of Kings*: a shared,
top-down 2D battlefield in inches. It represents the table, moves pieces and
measures. It is **not** a rules engine: players apply the rules themselves,
exactly as with miniatures and a tape measure.

## Status

The project is built in five milestones. **Milestones 1–3 are complete**:
single-player, local only.

| # | Milestone | State |
|---|-----------|-------|
| 1 | Foundations: shared types, reducer, geometry + tests, board, scenarios, terrain, regiments, characters, wounds, objective markers | done |
| 2 | Movement and measuring (move sessions, handles, ruler, distances, range rings, contact, Align to target) | done |
| 3 | Facing arcs and line of sight | done |
| 4 | Multiplayer (server, rooms, seats, presence, persistence) and RANDOM.ORG dice | next |
| 5 | Polish, roster import/export, accessibility pass, Dockerfile, deploy guide | — |

## Run locally

Requires Node 20+.

```sh
npm install
npm run dev        # client on http://localhost:5173
npm test           # Vitest (shared geometry, layout, wounds, reducer, scenarios)
npm run typecheck  # tsc for shared and client
npm run build      # production build of the client into client/dist
```

In milestone 1 the battle autosaves to the browser's localStorage; **Save** and
**Load** in the toolbar export/import it as JSON. The **Acting as** switch in
the toolbar stands in for real player seats until multiplayer arrives.

## Repository layout

```
shared/   Pure TypeScript, no DOM. Used by the client now and the server later.
  src/types.ts      Battle document model
  src/geometry.ts   2D geometry engine (inches, degrees)
  src/presets.ts    Stand presets, terrain presets, the 12 scenarios, 3 sample layouts
  src/regiment.ts   Formation layout, derived stand geometry, wound allocation
  src/board.ts      Terrain/marker footprints, zone occupancy, board check, createBattle
  src/movement.ts   Move segments (forward, sideways, wheel, rotate, free, align), contact
  src/measure.ts    Closest distance between things, board contacts, move warnings, align targets
  src/los.ts        Effective sizes, arc report, line-of-sight checker (Sight and Volley)
  src/ops.ts        Typed operations
  src/reducer.ts    Pure reducer: applyOp(battle, op) → new battle + inverse + log line
  src/*.test.ts     Vitest suites
client/   Vite + React + TypeScript, Zustand store, SVG board
server/   (milestone 4)
```

## Architecture

- **One JSON document per battle.** Every change is a small typed operation
  (`moveRegiment`, `applyWounds`, `attachCharacter`, …). The pure reducer in
  `shared/src/reducer.ts` applies it. It never reads clocks or randomness
  (ids it creates are derived from the operation id), so two copies fed the same
  operations produce identical JSON; a test checks this.
- **Undo.** Each successful operation also returns its inverse: a `restore`
  operation holding the previous value of every entity it changed, plus the ids
  it touched. Ctrl+Z sends the inverse of your own last operation and is refused
  if a later operation touched the same object.
- **Log.** The reducer writes one readable line per operation with time and
  author, e.g. `Player 1: Militia: 5 wounds → rear-left removed, rear-right 1/4`.
- **Locks.** Scenario zones and markers are locked: the reducer rejects any
  move, resize or delete of them. Only marker damage and "destroyed" are allowed.

### Geometry conventions

- Inches everywhere, stored as floats, shown to 0.1". Millimetres are accepted
  only when typing a stand size (unit button), converted at once (1" = 25.4 mm).
- Origin is the board's top-left corner; x runs across the 72" side, y down the
  48" side. Player 1's edge is the bottom, Player 2's the top.
- Angles are degrees, clockwise on screen, 0 = facing up the board.
- A regiment's pose is its **front-left corner** plus angle. Stand geometry is
  always derived from the pose, the stand footprint and each stand's slot
  (`rank` 0 = front, `file` 0 = leftmost). Stands keep their slot until the
  user reforms, so a removed stand leaves a gap.
- Epsilon is 0.001". Polygon overlap uses the separating-axis test for convex
  shapes and ear-clipping into triangles for concave ones. Ellipses are
  64-sided polygons.

## Readings and defaults chosen where the source is ambiguous

Where the rulebook or pack leaves a geometric detail open, the simplest
reading was picked. Ones that are a matter of rules interpretation are
settings (⚙ = in the Settings dialog).

1. **Incomplete rear rank** is centred with half-stand offsets, so a stand's
   `file` can be fractional (e.g. 0.5).
2. **Wound allocation** applies wounds one at a time, in this order
   (characters are ignored):
   1. wounded non-command stands first (the most wounded);
   2. a stand is destroyed before an unwounded stand takes a wound;
   3. then alternating ends of the rearmost rank, starting with the end
      farthest from the command stand, so the centremost stand goes last. The
      alternation is read from the rank itself: whichever side of the rank has
      lost fewer stands gives the next one; when both sides have lost the same
      number, the end farther from the command stand (its slot is used even
      after it is removed). If both ends are **equally far** from the command
      stand, the player chooses: allocation pauses, the two stands pulse in the
      stand grid, and you pick one (button or click). Your picks travel with the
      operation so every copy of the battle resolves the tie the same way.
      ⚙ "Two stands equally far from the command stand" can instead always
      take the left one.
      When the rearmost rank empties, the next rank becomes the rearmost;
   4. stands engaged with an enemy (touching an enemy stand, corners included,
      within 0.02") are kept until every unengaged stand is gone, so as few
      unengaged stands as possible are left. They show ⚔ in the stand grid;
   5. the command stand is always last.
3. **Destroyed stands** are removed at once; ⚙ "Ask before removing a destroyed
   stand" leaves them at full damage with a *Remove now* button instead.
4. **Attaching a character reflows** the regiment, keeping the current stand
   order (front to back, left to right) and putting the character next to the
   command stand (⚙ right by default, or left). Wounded stands can therefore
   change slot on attach. **Detaching** places the character's stand 1" in front
   of where it stood, and the regiment immediately makes a free reform that
   loses as few ranks as possible (⚙ "Close ranks when a character leaves",
   on by default):
   - gap ahead of the rearmost rank: the rearmost-rank stand nearest the gap
     steps into it and the rest of that rank is re-centred (a rank is lost
     only if it empties);
   - gap in the rearmost rank: that rank is re-centred;
   - single-rank regiment: the rank closes up (one file fewer) and stays
     centred where it was.
   Every other stand keeps its slot.
5. **Facing-arc frame** (used by the wheel width now and arcs in milestone 3)
   is the bounding box of occupied slots: most complete rank × number of ranks.
6. **Keyword initials** on terrain tags are two letters; Obstructing is `Os` so
   it differs from Obscuring `Ob`. The legend is in the help overlay (`?`).
7. **Sample layout footprints** (centres are approximate, from the diagrams):
   Forest and Rock formation are 3×2-stand irregular polygons, Building a 3×2
   rectangle turned 90°, Hill a 3×2 ellipse, Field 2×2. Building / Rock
   formation get Size 3 (the pack gives none; editable). Every piece stays
   movable and editable.
8. **Objective markers** are axis-aligned 54 mm squares centred on their point.
9. **Zone highlight**: a zone highlights when any stand on the board touches or
   overlaps its circle.
10. **Restoring a casualty** returns it with no damage to its old slot, or to the
    first free slot if that one has been taken since.
11. **Leaving a garrison** puts the regiment just to the right of the piece, at
    its previous facing, for the player to position.
12. **Board check** follows the pack's terrain guidance and only warns. The
    official sample layouts can trip the 9" spacing and "on an objective zone"
    checks on some scenarios; the pack itself says to move the offending piece.
13. **Wheel direction.** "Wheel L" turns anticlockwise about the left front
    corner (the right corner swings forward); "Wheel R" the mirror image. Its
    distance is the arc of the moving corner, |angle in radians| × front width.
    Turning the other way round the same pivot is flagged *(backward)*.
14. **Free drag distance** is the straight-line displacement of the frame
    corner that moved farthest. **Align** segments count the distance the front
    centre travels. **Rotate about the centre** counts 0" towards the total and
    reports the angle (it uses no movement); each rotate segment is limited
    to ±180°.
15. **Align to target** puts the front edge flush against a side of an enemy
    regiment (its front, a flank or its rear, taken from its full bounding
    rectangle) or of an objective marker (top, bottom, left or right side of
    its 54 mm square). Characters are never targets, since they always sit in
    a regiment. Default *Max contact*: the smaller of the two edges sits fully
    against the larger, at the lateral position nearest to where the front
    centre was. *Centred* is the alternative. The side picked is the edge
    nearest the click.
16. **Sideways limit** adds up every sideways segment of the move and compares
    the sum with half of March.
17. **Contact** is any two stands of different pieces within 0.02", corners
    included. Touching stretches are drawn in orange, corner touches as dots.
18. **"Within 1" of an enemy"** is measured stand to stand. Enemy pieces that
    are touching are reported as "in contact" rather than hidden.
19. **Crossing Impassable terrain** is checked along the path of every segment
    (sampled every 0.25"), plus the end position.
20. **Range rings** grow every stand's rectangle by the range with rounded
    corners and merge them, which is exactly the set of points within that
    range of the footprint. A regiment with gaps gets the exact merged shape.

21. **Facing arcs** use the regiment's full bounding rectangle; each corner
    sends a 45° line outward. A point on a dividing line is in both arcs, and a
    stand is in an arc if any part of it is inside the wedge.
22. **Effective size** = stand-type size, plus the Size of an Elevated piece
    when *every* stand centre is inside it. A manual override replaces both. A
    regiment in garrison uses the terrain's Size. Objective markers are Size 2.
    Traversable terrain adds nothing.
23. **Line of sight is restricted to the acting front arc**: a line whose
    target point is outside the acting piece's front arc is reported as "not in
    front arc" (dotted grey) and does not count. A regiment in garrison sees
    360°, and the per-regiment setting *All arcs are front* (regiment
    inspector) lifts the restriction for that regiment, also reporting its arcs
    as front when it is the target.
24. **"On" an Obstructing piece** (so it is ignored for that line) means the
    acting or target stand's centre is inside it.
25. **Obstacle size test**: other stands and objective markers block when their
    effective size is ≥ the acting size and ≥ the target size (⚙ or ≥ the acting
    size only). Obstructing / Garrison terrain blocks every line in tournament
    mode (⚙ default) or, in core mode, only with Size ≥ those sizes.
26. **Corridor**: each line is a 0.04" (1 mm) wide strip; it is obstructed when
    the strip reaches more than 0.001" into an obstacle's interior, so a line
    grazing a corner does not count.
27. **Sight mode** tests lines from the centre of each front-rank stand's front
    edge to the centre of each edge of every target stand. **Volley mode** tests
    the same origins against every target corner, points every 0.25" (⚙) along
    each edge, and the closest point of each edge, keeping the shortest clear
    line; *effective range* is the closest stand-to-target distance under half
    the Barrage range. A garrison draws lines from points every 0.5" around the
    terrain's edge and gives one row.
28. **Cover and Obscuring** crossed are flagged without changing the result, as
    is a target whose every stand centre is inside one such piece. Other
    keywords of crossed terrain are listed in the report.

## Using the app

- **Board**: scroll to zoom around the cursor; drag empty space (or hold Space,
  or use the middle button) to pan. *Fit* (F) zooms to the board. *Flip view*
  puts Player 2's edge at the bottom. Grid: off / 1" / 6" / 12" (default).
- **Scenario and terrain**: with nothing selected, the right panel offers the
  12 scenarios plus *Custom board*, the three sample layouts (optionally with
  garrison buildings), terrain presets, *Draw polygon*, lock/clear, the board
  check, pinned measurements and free tokens.
- **Terrain editing**: select a piece to edit its name, Size, keywords, footprint
  and garrison fields. Drag it to move; drag the round knob to rotate (Shift:
  15° steps); for polygons drag vertices, click the small squares to add one
  and Alt-click (or right-click) a vertex to delete it.
- **Regiments**: *+ Regiment* in a player's roster adds one to reserve. Deploy
  it with *Deploy to edge* or by dragging its roster row onto the board. The
  inspector edits name, owner, stand type, stand count, files, wounds per stand,
  March, Barrage range, LoS size override, tags and shared notes.
- **Wounds**: *Apply wounds* allocates N wounds by the rules above and logs the
  result. Click a stand in the mini-grid for per-stand +/−, remove, command and
  label. *Reform…* lets you change files, auto-layout, or move/swap stands.
- **Characters**: *+ Character*, then join a regiment from either inspector or
  drag the character onto a friendly regiment. *Rider* characters show as a
  badge on their regiment with their own wound tracker.
- **Objective markers**: select one to add damage per player; at 3 from either
  player, *Remove marker* takes it off the board (undo or *Restore* in the
  board panel brings it back).

### Moving

1. Select a regiment (or a lone character) and press **M**, or simply start
   dragging it. A faded ghost stays at the start position and the right panel
   lists each segment ("Wheel R 2.4"", "Forward 6.0"") with the running total
   against March, if set.
2. Use the handles: the **front arrow** moves forward/back along the facing,
   the **side arrows** move sideways, a **front corner** wheels about the other
   front corner, the **dashed ring** rotates about the centre (reports the
   angle), and the **body** free-drags (hold Shift to stay on the facing axis).
3. Or type exact values in *Precise entry* (forward 6", sideways −2", wheel 30°
   or 2.5" left/right, rotate), or nudge with the **arrow keys** (0.1", Shift
   1") and **Q / E** (1°, Shift 15°).
4. Warnings appear as red chips and outlines while you move: total over March,
   sideways over half March, within 1" of an enemy or garrison terrain,
   overlapping another piece or objective marker, off the board, crossing
   Impassable terrain. They never block anything.
5. **Enter** commits the whole move as one log line, e.g.
   `Militia forward 6.0", wheel R 1.2" (total 7.2")`. **Esc** puts it back,
   **Backspace** drops the last segment. Ctrl+Z undoes a committed move.
6. **Align to target**: during a move, *Pick a target…*, then click near an
   enemy regiment's front, flank or rear, or near a side of an objective
   marker. The proposed pose and the distance the
   front centre travels are previewed; *Apply* (Enter) adds it as a segment.

### Facing arcs and line of sight

- Selecting a regiment or character shows its four arcs as faint wedges up to
  the board edge; hold **A** to see every piece's arcs.
- **LoS (L)**: click the acting regiment (or press L with it selected), then a
  target regiment, character or objective marker. Shift-click picks a new
  acting regiment. Choose **Sight** (charges and general LoS) or **Volley**.
- Every tested line is drawn: green clear, red obstructed (the blocker is
  outlined), grey out of range, dotted grey outside the front arc. The panel
  shows the headline (e.g. "Line of sight: YES — 2 of 3 front stands clear"),
  both effective sizes and why, the arc counts ("Front: 2 · Left flank: 1"),
  whether the target is in the acting front arc, and a row per acting stand:
  arcs, clear or blocked by what, distance, Barrage range, effective range and
  terrain crossed. **Post to log** records it.
- The checker never enforces anything; LoS settings are in ⚙ Settings.

### Measuring

- **Ruler (R)**: drag from point to point. It snaps to stand corners and edge
  midpoints (hold Alt to place freely). **P** pins it for both players.
- **Distance (D)**: click two things (regiments, characters, terrain, objective
  markers, zones). A dashed line joins their closest points, stand to stand.
  For a zone it also says whether any stand is inside. With the Select tool,
  Ctrl-click a second thing does the same.
- **Range rings (G)**: click a regiment or character (Alt-click one stand), then
  tick March, Barrage, half Barrage or type a custom range. **P** pins them.
- Pinned measurements stay live (they follow the pieces) until removed from
  the list in the right panel.
- Touching stands are always highlighted in orange.

- **Shortcuts**: V select, M move, R ruler, D distance, G range rings, L line
  of sight, A (hold) all arcs, T draw terrain, P pin, F fit, Enter commit, Esc cancel, Backspace drop segment,
  arrows / Q / E nudge, Delete send to reserve (asks), Ctrl+Z undo, ? help.
