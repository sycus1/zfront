# Technical spike: horde simulation on the OpenFront engine

_Status: **done, 2026-10-24. Decision: GO** (see "Decision: GO" below). Timebox: 3 days plus 1 day of buffer. Branch: `spike/horde`. Throwaway-quality code is fine. The output is the findings table below and a go/no-go decision._

## The question

Can the forked OpenFront engine simulate a zombie horde on the Britannia map that:

1. follows the terrain, taking valleys and plains and being blocked by mountains and water,
2. re-routes around walls the player builds and puts pressure on them,
3. stays inside the tick budget at 10 ticks per second, and
4. renders smoothly in the browser,

without invasive changes to OpenFront's core?

If it can, we build zfront on this fork. If it can't, we switch to one of the fallback options below.

## Hypotheses and pass criteria

| #   | Hypothesis             | Pass if                                                                                                                                                                                       | How we measure                                                                                                                             |
| --- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| H1  | Simulation performance | A density horde of 100k zombies, a flow field on the coarse grid (about 800×1045), and 500 discrete elites give a **p95 tick time ≤ 30 ms**. A full flow-field recompute takes **≤ 50 ms**.   | `npm run perf:game -- --map britannia` with a new `--horde` flag. The harness already reports per-tick percentiles and time per Execution. |
| H2  | Terrain steering       | The horde visibly funnels through valleys, such as the Aire Gap through the Pennines. Mountains and water block it.                                                                           | Play-test, plus a unit test on a synthetic valley map                                                                                      |
| H3  | Walls                  | A wall line re-routes the flow within **1 s of game time**. A fully sealed base makes the horde attack the wall.                                                                              | Unit test, plus a play-test                                                                                                                |
| H4  | Rendering              | A density texture pass runs at **≥ 60 fps** on integrated graphics (45 fps is acceptable). Transferring the density buffer from the worker takes **≤ 2 ms per tick**.                         | Chrome performance panel, plus timing around `postMessage`                                                                                 |
| H5  | Determinism            | Two runs with the same seed end with the same state hash. Horde state contains no floats.                                                                                                     | The perf harness prints the final hash. Oxlint and the `LayerBoundaries` test enforce the engine rules.                                    |
| H6  | Integration cost       | Changes to OpenFront files are limited to wiring: `GameRunner.init`, `ExecutionRegistry`, `GameUpdates`, the worker transfer list, and one render pass. Everything else lives in new modules. | `git diff --stat` against `main`                                                                                                           |

## Out of scope

UI polish, the economy, wave director tuning, art, multiplayer, deploying to Cloudflare, and cropping the map to England. The spike uses Britannia as it is and spawns the horde in its English part.

## Design for the spike

### Engine: new module `packages/engine/src/horde/`

- **`HordeGrid.ts`** holds the grid state:
  - Coarse grid taken from `game.miniMap()` (the `map4x` grid).
  - Density: one `Uint16Array` value per coarse cell.
  - Cost field built from terrain:
    - water and impassable tiles: blocked
    - magnitude ≥ 20 (mountain): blocked for Shamblers
    - everything else: cost `1 + (magnitude >> 2)`
  - Cells occupied by structures are marked as obstacles.
- **`FlowField.ts`** computes a distance field (`Uint32Array`) outward from the target cells, which are the cells holding player structures. Costs are small integers, so it uses Dial's bucket-queue version of Dijkstra. Changes to structures are batched and trigger a full recompute every N ticks. The spike records how long that takes. Incremental or chunked recompute is plan B.
- **Density step** (once per tick, integers only):
  - Each occupied cell moves `density >> 2` toward its downhill neighbour, capped at a maximum density per cell.
  - Ties are broken by a fixed neighbour order, so the result is deterministic.
  - Density that can't move into a structure cell turns into **pressure damage** on that structure.
- **Elites** are a struct of arrays (`Int32Array` x, y and hp) for up to 500 agents. Each agent reads the same distance field.
- **`HordeExecution.ts`** follows the pattern of `DoomsdayClockExecution`:
  - It starts from `GameRunner.init` when a horde flag in the game config is set.
  - Every N ticks it spawns a wave at configured edge and coastal cells.
  - Each tick it steps the field, applies pressure damage, and removes density inside the range of each `DefensePost`, which stands in for a turret.
  - It needs a stub entry in `snapshot/ExecutionRegistry.ts`.
- **Tests** go in `tests/horde/`:
  - routing around blocked cells
  - mountains blocking the flow
  - re-routing after a structure is placed
  - determinism, by comparing hashes of two runs

### Client

- **Update channel.** Add `hordeDensity: Uint8Array` to `GameUpdates`. Use one byte per coarse cell, clamped. Transfer it with zero copies, the way `packedTileUpdates` already is (`Worker.worker.ts`). The engine alternates between two buffers so it isn't allocating a new one every tick.
- **Rendering.** Add `src/client/render/gl/passes/HordePass.ts`, modelled on `FalloutBloomPass` and `TerritoryPass`. It uploads the density as an R8 texture at coarse resolution and draws an overlay whose opacity follows density. Elites are drawn as points, in the style of `UnitPass`.
- **Interaction.** Use the existing build menu. A Defence Post acts as a turret and a City acts as a target and wall stand-in. The spike adds no new unit types.

## Schedule

| Day              | Work                                                                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 (about 1 hour) | Confirm `npm run dev` starts single-player on Britannia with no network or API. Record a baseline with `npm run perf:game -- --map britannia --ticks 1800`. |
| 1                | Engine work: `HordeGrid`, `FlowField`, `HordeExecution`, the tests, and the perf-harness flag. Collect the H1 and H5 numbers.                               |
| 2                | Client work: the density channel and `HordePass`. Play-test the Pennines funnels and walls (H2, H3, H4).                                                    |
| 3                | Elites. Re-measure everything. Write up the findings below and make the go/no-go call.                                                                      |
| +1               | Buffer, or plan B for whichever hypothesis failed                                                                                                           |

## Decision rules

- **Go:** H1, H3 and H5 pass, and H4 reaches at least 45 fps. Merge what's worth keeping, then start Phase 0 (see the next section).
- **Pivot within the fork:**
  - If the flow-field recompute is too slow, switch to chunked or hierarchical flow fields.
  - If elites are expensive, cap their number and lean on density.
  - If the density transfer is heavy, send only the cells that changed, or send every second tick.
- **Reconsider the fork** only if the engine can't host the horde within budget even with plan B, or if H6 shows the integration has to cut deep into OpenFront's core. Fallback: a standalone horde worker that shares the map buffers.

## Findings

Days 0–3 were all done on 2026-10-24 on branch `spike/horde`. The table holds the Day 1 and Day 2 numbers; Day 3 re-measured with the wider flow (see below).

| Metric                                                   | Target               | Result                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline p95 tick, Britannia, no horde                   | n/a                  | **5.6 ms** (mean 3.2 ms), peak heap 135 MB                                                                                                                                                                                                                                                                                                                              |
| p95 tick with 100k density, 500 elites                   | ≤ 30 ms              | ✅ **9.3–9.9 ms** (mean 4.8–5.0 ms). The horde itself adds about 1.4 ms per tick.                                                                                                                                                                                                                                                                                       |
| Full flow-field recompute                                | ≤ 50 ms              | ✅ mean **4.9–5.1 ms**, max **8.8–10.1 ms** (151 recomputes in 1,800 ticks)                                                                                                                                                                                                                                                                                             |
| Density transfer per tick                                | ≤ 2 ms               | ✅ worker encode **0.4–0.56 ms**, worker→main latency **0.2 ms** mean (max 1.2 ms), texture upload **0.1 ms** mean (max 1 ms). These costs are the same at 17k and at 160k zombies.                                                                                                                                                                                     |
| Frame rate on integrated graphics                        | ≥ 60 (45 acceptable) | ✅ in effect. The horde draw costs **0.009 ms of GPU time** per frame (timer query, RTX 3080). Frame rate in the app's browser pane was the same with the horde hidden as with it shown (about 15 fps either way), so the horde costs no measurable frame time. Not yet checked on integrated graphics, and the pane's own frame rate isn't representative (see below). |
| Same-seed hash matches                                   | yes                  | ✅ Two perf runs gave the same game hash and the same horde hash. Unit tests confirm two-game determinism and a snapshot restore mid-wave.                                                                                                                                                                                                                              |
| Lines changed in OpenFront files (excluding new modules) | small                | ✅ **11 engine lines in 4 files** (`Schemas.ts`, `EngineConfig.ts`, `GameRunner.ts`, `ExecutionRegistry.ts`), plus test infrastructure: the perf flag, the snapshot cache list, and one coverage exemption                                                                                                                                                              |

### Setup

- **Command:** `npm run perf:game -- --map britannia --ticks 1800 --horde --no-cpu-profile --no-gc-profile --no-alloc-profile`
- **Players:** 400 bots and 20 nations, the same as the baseline.
- **Waves:** a 100k wave every 600 ticks from 16 coastal emitters, with all 500 elites in the first wave.
- **Grid:** the coarse grid is 800×1044, about 835k cells.
- **Machine:** Node on the dev desktop. Expect a browser Web Worker on a laptop to be roughly 1.5–2× slower, which still leaves headroom.

### What happened

- **Pressure works.** Peak alive was **266k** zombies, which is more than the 100k target, because waves stack up when nothing kills them. The horde destroyed 60 AI structures, and recomputing the routes after each loss stayed cheap.
- **Turrets weren't part of the performance run,** because the AI nations built no Defence Posts. Unit tests cover turret behaviour. Each turret's cost is bounded at about 200 cells plus a scan of the elites per tick.
- **Some zombies never left their emitters.** About 34k from the last wave were still waiting, because emitters stall when the cell they spawn into is full and the zombies there can't move (for example, coast with no reachable target). That's a gameplay tuning question, not a performance one.
- **Design note.** Structures are re-scanned every tick, which is a cheap signature check, and the flow field is only rebuilt when the set of structures changes. Scanning every tick, rather than on an interval, is what keeps snapshot restore exact, because a restored game rebuilds these caches on its first tick.

### Day 2: client

- **Pipeline.**
  - The worker attaches one `HordeFrame` to the last update of each batch: one byte per coarse cell (density / 8, with 255 marking an elite). Its buffer is transferred, not copied, as `packedTileUpdates` already is.
  - It flows through `GameView` → `FrameData.hordeFrame` → `uploadFrameData` → `MapRenderer.updateHorde` → `HordePass`.
  - `HordePass` draws an R8 texture on a map-sized quad. Linear filtering softens the density into blobs, and `texelFetch` picks out elites so they show as pulsing markers.
- **Solo play-test.** Britannia, no bots and no nations, spawn in the Pennines. Waves came ashore and **funnelled along real valleys** toward the HQ: down from the Solway coast, through Morecambe Bay and the Lune valley, and up from the Mersey. Mountains kept them out.
- **Frame-rate caveat.** The app's built-in browser pane draws no frames at all while it's hidden, and when shown it ran at 15–93 fps depending on zoom and focus, whether or not the horde was drawn. A real frame-rate check on integrated graphics should use a normal Chrome window. The GPU timer number above is the reliable measure.
- **Design findings for Day 3:**
  - **Single-file streams.** Every zombie steps to the same downhill neighbour on a 4-connected grid, so hordes form one-cell-wide lines with right-angled turns. Fixes: an 8-connected flow field with diagonal costs, splitting the outflow across neighbours with equal distance, and a congestion cost.
  - **The HQ is a spawn-tile obstacle and is indestructible.** It needs real HP and a lose condition.
  - Elite markers are hard to see when zoomed out.
- **Not done:** `HordePass` constants aren't in `render-settings.json` yet, and replays don't record horde frames (they're routed as dropped).

### Day 3: wider streams, HQ health, lose condition

- **8-connected flow field.** Straight steps cost 5× the cell's terrain cost and diagonal steps 7× (about 1 : √2). A diagonal step can't cut between two blocked cells, so the horde can't squeeze between mountain corners.
- **Split outflow.** A cell's movers (half its zombies, rounded up) are shared across every downhill neighbour, weighted by how far downhill it is × how much room it has left. Room-weighting doubles as congestion control. When every downhill neighbour is full, a quarter spills sideways into neighbours at the same distance. Everything is still integer-deterministic: one IEEE division and a floor per share.
- **The live cost field** is the terrain cost with structure and HQ cells forced to be enterable. Without that, a city or HQ standing on mountain terrain couldn't be reached or attacked.
- **HQ health and the lose condition.**
  - Each human player's HQ (their spawn tile) has `hqHp` (50,000 by default), and pressure damages it the same way it damages structures.
  - At 0 HP the player loses all their units and tiles.
  - Once no human is left, the game ends with `setWinner(null)`.
  - HQ health is saved in snapshots and sent in `HordeFrame` (`hqHp` and `hqMaxHp`).

| Metric (Britannia, 420 AI players, 100k waves, 500 elites) | Day 1      | Day 3                                    |
| ---------------------------------------------------------- | ---------- | ---------------------------------------- |
| p95 tick                                                   | 9.3–9.9 ms | **16.5–21.4 ms** (target ≤ 30 ms) ✅     |
| Mean tick                                                  | 4.8–5.0 ms | 6.3–8.0 ms                               |
| Horde cost per tick                                        | ~1.4 ms    | ~2.4–2.9 ms                              |
| Flow-field recompute, mean / max                           | 5 / 10 ms  | **11–14 / 17–37 ms** (target ≤ 50 ms) ✅ |
| Same-seed hashes                                           | match      | match ✅                                 |

- **Play-test** (solo, no AI players, HQ in the Pennines):
  - Streams are now several cells wide and turn smoothly, where Day 2 had single-file right angles.
  - Waves 1–3 reached the HQ. It went from 50,000 to 0 in about 45 seconds of siege, roughly 1,000 HP per second, and the player was eliminated. The client then showed OpenFront's end screen ("Match cancelled — not all players spawned" plus a Steam promo).
- **Tests:** 20 horde tests, covering diagonal corner-cutting, widening, congestion diversion and the HQ falling, plus the existing snapshot suites, all pass.

## Decision: GO

Build zfront on the forked OpenFront engine.

| Hypothesis                | Verdict                                                                                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1 Simulation performance | ✅ p95 ≤ 21 ms even alongside 420 AI players. The solo MVP drops `AttackExecution`, nations and tribes, about 60% of baseline tick time, so it will be lighter still.      |
| H2 Terrain steering       | ✅ Hordes follow real valleys (Lune, Solway, Mersey), and mountains and water block them.                                                                                  |
| H3 Walls                  | ✅ for structures as obstacles: the flow re-routes on the next tick, and blocked zombies press on and destroy structures. A dedicated Wall unit type still needs building. |
| H4 Rendering              | ✅ Transfer is under 1 ms and the horde draw costs 0.009 ms of GPU time. Real frame rate on integrated graphics in Chrome is still unmeasured but low risk.                |
| H5 Determinism            | ✅ Two runs give identical hashes, and a snapshot restored mid-wave carries on identically.                                                                                |
| H6 Integration cost       | ✅ about 15 lines in OpenFront engine files, plus about 40 lines of client wiring. Everything else lives in `packages/engine/src/horde/` and `HordePass`.                  |

**Risks and follow-ups going into the MVP:**

1. **Flow-field recompute** is now 11–37 ms per structure change. That's fine for occasional building, but fast wall placement needs a debounce, or an incremental or chunked recompute.
2. **End-of-game UI.** Replace OpenFront's cancelled-match and Steam screen with a zfront result ("HQ overrun on wave N" or "Survived N waves"). Add a win condition after N waves.
3. **An HQ health HUD**, more visible elites, and moving the `HordePass` constants into `render-settings.json`.
4. **Game content:** Wall, Turret, Mine and Bait unit types, plus economy tuning (see the requirements).
5. **A frame-rate check** in a normal Chrome window on integrated graphics.

### Code

- **New code** is in `packages/engine/src/horde/`:
  - `FlowField.ts`: Dial's bucket-queue Dijkstra on a 4-connected grid
  - `HordeField.ts`: the density double buffer, pressure on structures, and the terrain cost field
  - `Elites.ts`: discrete elites as a struct of arrays
  - `HordeExecution.ts`: waves, coastal emitters, turrets, structure HP and snapshots
- **Tests** are in `tests/horde/`: 16 of them, covering the valley funnel, mountains blocking the flow, the cell cap, pressure, determinism and snapshot round-trips.
- **Mode flag:** `GameConfig.horde` turns the mode on through `GameRunner.init`. Every solo game sets it during the spike (`SinglePlayerModal`).
- **Client** (Day 2): `src/client/render/gl/passes/HordePass.ts` and `shaders/horde/`, wired through `Renderer`, `MapRenderer`, `frame/Upload.ts`, `FrameData` and `GameView`. Replay codecs mark the new field as dropped.
- **Spike instrumentation:** `globalThis.__zfrontHorde` (from the browser console) holds transfer, upload and GPU timings. Set `.hidden = true` to skip the draw and compare frame rates.

## After the spike: Phase 0 (strip and rebrand) checklist

- [x] **Remove** alliances, embargoes and traitors, clans, ranked play and the paid lobby queue, the Steam desktop release and Steam joins, Stripe and Apple Pay, and paid bot tribe names. Poki, CrazyGames, ads and the cosmetics store went in the first UI cleanup (PR #1). **Kept on purpose:** trade and transport ships, warships, trains and rail, which zfront may reuse.
- [ ] **Closed-API calls** (`api.openfront.io`): still wired into auth, join verification, lobby coordination and archiving. Kept for now along with the multiplayer server (see "Multiplayer server: kept for now" below).
- [x] **Remove maps** other than Britannia, plus their entries in `Maps.gen.ts` and `en.json`. `resources/maps` went from 616 MB to 4 MB.
- [ ] **Rebrand** the UI with the zfront name, logo, favicon and font, and add an AGPL "Source" link to the footer. Keep "© OpenFront and Contributors".
- [ ] **Static deploy to Cloudflare Workers** (`staging.zfront.app`). Build the client with Vite, render the app shell with `src/server/RenderStaticIndex.ts --environment-only` (which OpenFront already uses for its static Worker), and serve `out/` plus `resources/` as Workers Static Assets.
- [ ] **England map:** a heightmap script from OS Terrain 50 to PNG, then `npm run gen-maps` (needs Go).
- [x] **Docs:** rewrite `CONTRIBUTING.md` for zfront.
- [ ] **CI:** enable GitHub Actions on the fork, which has them off by default. Keep only `ci.yml`. (Handled with the staging deploy.)

## Multiplayer server: kept for now

_Decided 2026-10-26._ The MVP is single-player, but we are **keeping OpenFront's multiplayer server** (`src/server/`: lobbies, intent relay, WebSocket game loop) and the OpenFront API plumbing that goes with it (auth, join verification, lobby coordination, archiving). Don't strip them. The idea is a possible **co-op mode** later (2–4 players defending together, see "Could have" in the [requirements](requirements-draft.md)). The engine is already deterministic and lockstep, so co-op mostly needs the server and lobby flow that is already here. Whether it ends up on this Node server or a Cloudflare Durable Object relay is still open. Until then, solo games don't depend on it.

## MVP: Wall unit and wave director

_Started 2026-10-26._

- **Wall** (`UnitType.Wall`, 10,000 gold, 1 s to build, 10,000 HP). Built on your own land, at least two tiles from any other wall or structure, which is exactly one wall per 2×2 horde cell, so walls placed two tiles apart make a solid line. The build ghost stays selected after each wall (hotkey V).
  - Walls are horde **obstacles but not targets**. In the flow field a wall cell costs `WALL_COST` (255, against 1–4 for terrain), so the horde takes any reasonable way round and only presses on a wall when the base is sealed or the detour is very long. Zombies can't slip diagonally between two walls.
  - Pressure damages walls like other structures. A fallen wall reopens the cell at once; the flow field catches up after the usual debounce.
  - The renderer draws walls from the horde frame (cell value 254) as stone blocks in `HordePass`, not as structure icons.
- **Wave director** (`packages/engine/src/horde/WaveDirector.ts`):
  - Each wave has a points budget (`firstWaveSize`, growing by `waveGrowthPercent`). Elites cost `elitePoints` each and scale with the budget; the rest are shamblers.
  - Waves come from compass directions around the HQ: one direction for waves 1–3, two for 4–6, three for 7–9, and every direction for the final wave. Directions are picked with the seeded PRNG from those that have reachable coast or map edge at least `minSpawnDistance` cells from the HQ.
  - The next wave is planned as soon as the current one starts, so the HUD shows its countdown, size and directions during the calm.
- **Still to do for the MVP:** wall tiers (barricade, stone, reinforced) and repair, a real turret and the other buildings, the cash economy, "call wave early" and direction arrows on the map. Wave balance is done (next section).

## MVP: balance

_Done 2026-10-28._ A play-test had the HQ fall in under a minute: the first wave of 20,000 came 10 seconds after spawning, waves were 30 seconds apart, and shamblers covered a coarse cell every tick (20 tiles a second).

**Balance harness.** `npm run balance:horde` plays solo games on Britannia with the real engine and a scripted player, from five HQ positions (Yorkshire, Lincolnshire, Hampshire, Powys, Cumbria), and prints each wave's size, the HQ's health, kills and losses. Strategies: `none` builds nothing, `turrets` rings the HQ with Defense Posts as gold allows, and `fort` builds one turret, a ring of walls 10 tiles out, then more turrets. The scripted player holds land 20 tiles round the HQ, standing in for expanding with troops. Try other numbers with `--set waveInterval=900,turretKillsPerTick=10`.

**Targets.** Ten waves in about 11 minutes. An undefended HQ survives the first few waves and falls around wave 4 or 5. A player who spends on defence wins, and the last waves still hurt.

**New defaults** (`DEFAULT_HORDE_OPTIONS`):

| Option               | Before | After | Why                                                                                                                             |
| -------------------- | ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------- |
| `firstWaveDelay`     | 100    | 600   | A minute to build before the first wave.                                                                                        |
| `waveInterval`       | 300    | 600   | A minute between waves: ten waves take 11 minutes.                                                                              |
| `firstWaveSize`      | 20,000 | 2,500 | Wave 1 is a gentle start.                                                                                                       |
| `waveGrowthPercent`  | 50     | 35    | Wave 10 is about 37,000, 15 times wave 1.                                                                                       |
| `elitesPerWave`      | 50     | 2     | 50 elites pressing on the HQ did most of the damage on their own.                                                               |
| `shamblerSpeed`      | (new)  | 3     | Shamblers step every 3 ticks, about 7 tiles a second. They also attack as they step, so this cuts their damage rate to a third. |
| `eliteSpeed`         | 1      | 2     | Elites stay faster than shamblers.                                                                                              |
| `pressureShift`      | 6      | 5     | Doubles damage per attack, to make up some of the slower attacks.                                                               |
| `turretKillsPerTick` | 30     | 12    | Four Defense Posts cleared even the last wave without a scratch.                                                                |

**Results** with the new defaults (HQ health is out of 50,000):

| Strategy  | Yorkshire      | Lincolnshire   | Hampshire      | Powys          | Cumbria        |
| --------- | -------------- | -------------- | -------------- | -------------- | -------------- |
| `none`    | lost, wave 5   | lost, wave 5   | lost, wave 5   | lost, wave 4   | lost, wave 4   |
| `turrets` | won, HQ 29,229 | won, HQ 40,324 | won, HQ 40,719 | won, HQ 50,000 | won, HQ 26,239 |
| `fort`    | won, HQ 4,319  | won, HQ 16,910 | won, HQ 1,427  | won, HQ 40,557 | won, HQ 48,638 |

**Findings for the next MVP items:**

- **Walls are poor value.** At 10,000 gold each, the 40-wall ring isn't closed until wave 7 and the fort only just survives. Cheaper barricades (the first wall tier) should make walling a real choice.
- **Defense Posts get dearer each time** (50,000, then 100,000, up to 250,000), so the turret player ends with four. A real turret with a flat cost belongs with the defences work.
- **Gold is still OpenFront's 100 per tick.** The cash economy will change every number above, so rerun the harness after it lands.

## MVP: defences

_Started 2026-10-28._ Wall tiers, repair and a real turret. Mines and bait come in a separate PR.

- **Wall tiers.** A wall is built as a barricade and upgraded (the usual upgrade action, on the wall itself or a tile touching it) to stone and then reinforced. Each step costs 5,000 gold (a wall used to cost 10,000), and health goes 4,000, 12,000, 30,000, so the higher tiers are the better deal for the money. Clicking two tiles along still builds the next wall in the line. The renderer draws each tier in its own colour: timber, stone, steel.
- **Turret.** In horde mode the Defense Post is the turret, shown as "Turret". It costs a flat 50,000 for each turret and each upgrade (OpenFront's price rose with every post), and has 3 levels. Each level above 1 adds `turretLevelPercent` (50%) of the base kill rate and elite damage, so level 3 has twice the firepower. Range is `turretRange` (8 coarse cells) plus `turretHighGroundBonus` (2) cells for every 10 points of terrain height, so a turret on a hill reaches further. Line of sight is not modelled yet. Outside horde mode the Defense Post keeps OpenFront's rules.
- **Repair.** A structure that hasn't been attacked for `repairDelay` ticks (5 s) gets `repairHp` (100) health back every `repairInterval` ticks (1 s), at `repairGoldPerHp` (1) gold per point, paid by its owner. Repair stops when the owner can't pay. The HQ doesn't repair. Damage is now kept by unit id, so a new wall on the tile of a fallen one starts at full health.
- **Rebalance.** With a flat turret price the turret player had five turrets by wave 3 and the HQ was never touched, whatever the kill rate. Turret health stays the same at every level; when it grew with level, turrets soaked up the whole horde. New numbers: `turretKillsPerTick` 12 → 8, `waveGrowthPercent` 35 → 40 (wave 10 is about 52,000), turrets at 50,000.

| Strategy  | Yorkshire      | Lincolnshire   | Hampshire      | Powys          | Cumbria        |
| --------- | -------------- | -------------- | -------------- | -------------- | -------------- |
| `none`    | lost, wave 5   | lost, wave 5   | lost, wave 5   | lost, wave 4   | lost, wave 4   |
| `turrets` | won, HQ 34,775 | won, HQ 33,523 | won, HQ 42,362 | won, HQ 35,931 | won, HQ 48,357 |
| `fort`    | won, HQ 47,379 | lost, wave 9   | won, HQ 50,000 | won, HQ 41,742 | won, HQ 50,000 |

These are with population growth (#9) merged in: with `--zone 0` the settlers fill the 1,500-tile base zone before wave 1, so the results match the default `--zone 20` exactly. The `turrets` strategy now upgrades its turrets to level 3, and `fort` upgrades walls and turrets in turn. The Lincolnshire fort loses because its turrets keep falling and being rebuilt, so the walls are never upgraded.

## MVP: economy

_Started 2026-10-28._ Gold now comes from fighting the horde rather than a flat rate.

- **Income.** In horde mode humans no longer get OpenFront's flat gold per tick. Instead each human still standing gets `hqIncome` (100) gold a tick from their HQ, the owner of a turret gets `killBounty` (4) for each shambler it kills and `eliteBounty` (100) for each elite it finishes, and every survivor gets `clearBonusPerWave` × N (5,000 × N) for clearing wave N, with a "Wave N cleared" message.
- **Clearing a wave.** A wave is cleared once all of it has spawned and at most `clearedPercent` (2%) of it is still alive, so a few stragglers on a far shore don't hold it open. The same moment counts the wave as survived for population growth, so refugees can arrive before the next wave instead of only when it starts.
- **Spawn band.** Waves used to come ashore at the furthest coast in their direction, sometimes 90 coarse cells away, and were still walking when the next wave started, so no wave was ever cleared. They now land 30 to 60 cells (`minSpawnDistance`, `maxSpawnDistance`) from the HQ where there is coast in that band, and fall back to the old choice where there isn't.
- **Rebalance.** Closer landings make every wave hit harder, so waves are now 75 seconds apart (`waveInterval` 600 → 750) and grow by 35% (`waveGrowthPercent` 40 → 35, wave 10 is about 37,000).

| Strategy  | Yorkshire      | Lincolnshire   | Hampshire      | Powys          | Cumbria        |
| --------- | -------------- | -------------- | -------------- | -------------- | -------------- |
| `none`    | lost, wave 2   | lost, wave 3   | lost, wave 3   | lost, wave 3   | lost, wave 3   |
| `turrets` | won, HQ 48,727 | won, HQ 49,492 | won, HQ 49,797 | won, HQ 49,710 | won, HQ 50,000 |
| `fort`    | won, HQ 46,736 | won, HQ 8,708  | won, HQ 48,820 | won, HQ 49,778 | won, HQ 50,000 |

Every wave up to 10 is now cleared, so the clear bonus pays each time. With `hqIncome` 80 and `killBounty` 4 the fort lost three of five, and with 100 and 3 it barely held Lincolnshire, so the economy is the main lever: lower `hqIncome` or `killBounty` to make the late waves bite again. The undefended HQ now falls earlier (wave 2 or 3, was 4 or 5) because the waves land closer.

## MVP: wave controls

_Started 2026-10-28._ Calling a wave early, and arrows on the map showing where the next wave lands.

- **Call wave early.** Once the wave under way is cleared (or before the first wave), the HUD offers "Send it now (+gold)". Pressing it sends a `call_wave` intent and the announced wave starts on the next tick. Every survivor gets `callEarlyGoldPerTick` (100, the same as the HQ income) for each tick of the break skipped, so calling early gives the same money in less time. It can't be called while the last wave is still alive, so a player can't stack waves. Any human still standing can call it, which will matter for co-op.
- **Refugees aren't affected.** A cleared wave already counts as survived (see "MVP: economy"), so calling the next one early doesn't bring extra refugees or raise the zone cap.
- **Landing arrows.** The landings of each wave are now picked when it is announced rather than when it starts, and the horde frame carries them along with the HQ's cell. The horde pass draws a pulsing arrow at each landing pointing at the HQ: amber, or red for the final wave. The PRNG draws come in the same order as before, so the balance runs are unchanged.

With `npm run balance:horde -- --call-early`, the bot calls each wave from 2 on as soon as it can. Every result is the same as without it (the Yorkshire fort ends on HQ 41,599 instead of 46,736), and the games end sooner: the turret games in 511 to 810 seconds instead of 810.

## MVP: new buildings

_Started 2026-10-29._ Mines, noise beacons and scavenger depots, as listed in the requirements. All three are horde-mode only (disabled in other modes) and are placed exactly where clicked, like walls: on your own land, two tiles from any other wall, building or structure.

- **Mine** (10,000 gold). It waits until `mineTrigger` (40) zombies are within `mineRadius` (2 coarse cells), then kills up to `mineKills` (600) of them, nearest first, and deals `mineEliteDamage` (300, a whole elite) to every elite in range. It pays the usual bounties and then it's gone. It is neither a target nor an obstacle, so the horde walks straight onto it. The build ghost stays selected, so you can lay a field.
- **Noise beacon** (25,000). It sounds for `baitActive` ticks (30 s) from when it is built, then rests for `baitCooldown` ticks (60 s), over and over. While it sounds it is a horde target with a `baitPull` (30 cell) head start in the flow field, so the horde heads for it ahead of anything up to 30 cells nearer, and presses on it like any building. While it rests the horde ignores it. `FlowField.compute` now takes a start distance for each source.
- **Scavenger depot** (30,000). It pays its owner `depotIncome` (20) gold a tick once built, a fifth of the HQ's income, so it pays for itself in 2.5 minutes. The horde attacks it like any building. The extra income for depots on towns or ruins from the requirements is left for later: the maps don't mark such tiles yet.
- The horde frame draws them: a mine as a dark disc with a red light, a beacon as a blue post that pulses while it sounds, a depot as a crate. Density bytes now stop at 247 to make room (see `HordeFrame.cells`). Horde snapshot version 9.

`balance:horde` has a new `scavenge` strategy: two depots first, then turrets, with a ring of mines (rebuilt as they go off) before the outer ring of turrets. It wins from all five starts (Yorkshire HQ 37,172, the rest above 49,000). The other strategies' results are unchanged.

## Balance: starting turret

_Started 2026-10-29._ Dan found there was no way to fight the first wave: the turret costs 50,000 and the HQ pays 100 a tick from nothing, so the first one is affordable only about 50 seconds in, ten seconds before the wave lands.

- **A free turret at the start** (`startingTurrets`, 1). On the first horde tick after the spawn phase each human gets a finished level-1 turret a few tiles from their HQ, at no cost. It goes off the HQ's own coarse cell, so the horde still presses on the HQ rather than the turret. A free build credit was the other option; the turret wins because it works without any new UI or the player knowing to use it, and it can still be upgraded like any other. Horde snapshot version 10 (older games: none).
- **Turret icon.** The Defense Post's shield is now a gun turret in the build bar, the build menu, the help screen and on the map (`TurretIconWhite.svg`, icon atlas column 3).
- **Turret fire is drawn.** The horde frame carries a turret cell and target cell for each turret that hit something on the last tick (`HordeFrame.turretShots`, cosmetic only), and the horde pass draws a faint beam with rounds running down it, a muzzle flash and a burst where it lands.

`balance:horde -- --zone 0`: doing nothing now lasts to wave 4 to 6 (was 2 or 3). `turrets` and `scavenge` win from all five starts with the HQ at or near full health. `fort` loses on Lincolnshire on wave 10 at 783 s; it won there with 8,708 HQ left before, so it was already marginal there.

## Walls: build grid and spans

_Started 2026-10-29._ Dan asked for wall posts that join up to block the gap between them, a square grid for them to line up on, and mountains to count as walls so a pass can be closed. Proposal agreed with Dan: https://claude.ai/artifact/3xcf9fCSUxcD8LYBsLXCE8.

- **Build grid.** Walls, mines, beacons, depots and (in horde mode) turrets snap to the top-left tile of their 2x2-tile cell, the cell the horde moves on, so a wall blocks exactly what it covers. The build ghost sits on the snapped cell and the horde pass draws the grid round it.
- **Links.** A new post links to the nearest of its owner's posts, or mountain cells, within `wallSnapRadius` (8) cells, then to the nearest one roughly opposite that (at least 135 degrees away), at most two links (`horde/WallLinks.ts`). The proposal said 90 degrees; 135 keeps a post added to the end of a line from also cutting across the base. Every cell on the straight line must be the owner's own land or mountain, with no building, HQ or other span on it. Links are made once, when the post appears, and never rewired.
- **Spans.** The cells between become wall cells (WALL_COST, obstacles). They cost `spanCostPerCell` (1,000) each. A span has its own health at the tier of its weaker post (4k, 12k, 30k), so a breach opens one stretch. A broken span is rebuilt automatically at its build price once the horde has moved off, after the usual `repairDelay`, and damaged spans repair like structures. A span the owner can't afford yet starts unbuilt and goes up once they can. Spans fall with either post. The frame draws them as wall cells; the build preview draws the links as dashed gold lines and adds their price to the cost label.
- **Not in the face of the horde.** Dan, 2026-10-29: builders can't get through an incoming push. No wall post can be placed, and no span built or rebuilt, within `wallClearRadius` (3) cells of any zombie or elite. Mines, beacons and depots still can.
- **Mountains** (terrain the horde can't climb) are anchors and cost nothing to span over. Water edges are not anchors.
- Horde snapshot version 11 (older games: no snapping, so no spans).

`balance:horde` has a new `spans` strategy: `fort` with a post every 10 tiles round the ring instead of a barricade every 2. It wins from all five starts with the HQ at full health; `fort` still wins everywhere, at 15,838 HQ left on Lincolnshire. Upgrading two posts lifts a whole span, so a spanned ring is far cheaper to bring to stone or reinforced than a solid one; watch that in play.

## Supply drops

_Started 2026-10-29._ Dan found the income passive and "solved": the HQ trickle was most of the early income and a depot paid for itself in two waves with no downside. He picked supply drops plus a cut to the passive income from the options page (https://claude.ai/artifact/56Zx1HGPbYtU5DxFXvvG6c).

- **Drops.** Every `crateInterval` ticks (200, 20 s) each human gets a supply crate, `crateMinDistance` to `crateMaxDistance` (8 to 25) tiles past a random border tile, away from their HQ, on open land the horde can walk. At most `crateMax` (3) wait for each player. Drops use their own PRNG (`zfront-crates`), so the waves' draws and landings are unchanged.
- **Looting.** Clicking within 4 tiles of a crate sends a `loot_crate` intent. Looting takes `crateLootTicks` (50, 5 s), then the looter gets the gold and a "Supply crate looted" message. Any human can loot any crate, first come first served, which will matter for co-op.
- **Risk.** Any zombie within `crateDangerRadius` (2 coarse cells) destroys a crate, mid-loot or not ("The horde got to your supply crate first"). A crate nobody starts looting is gone after `crateLife` (300 ticks, 30 s).
- **Value.** `crateBaseGold` + `crateGoldPerWave` × wave (2,000 + 1,500 × N, wave 1 before the first), doubled (`crateLandingBonusPercent` 100) within `crateLandingRadius` (15 coarse cells) of an announced landing arrow.
- **Passive cut.** `hqIncome` 100 → 50. Depots no longer pay gold (`depotIncome` 20 → 0); each finished depot makes drops come `depotCratePercent` (25%) faster, counting at most `depotCrateMax` (4), so up to twice as often.
- **Client.** The horde pass draws each crate as a gold box with straps inside a ring: white and running down with its life (blinking in the last quarter), or green and filling while it is looted. Its gold is written above it. Horde snapshot version 13 (older games keep their economy and get no crates); `HordeFrame.crates`.

`balance:horde -- --zone 0` has a new `--loot <percent>` flag: the bot loots that share of its crates 3 seconds after each drops. On main with wall spans and Outposts, the old economy (`--set hqIncome=100,depotIncome=20,crateInterval=0`) won every start with `turrets`, `fort`, `scavenge` and `spans` (`fort` on Lincolnshire with 15,838 HQ left). Now (every other start won):

| Bot loots   | `turrets`                | `fort`                                           | `scavenge`              | `spans`                           |
| ----------- | ------------------------ | ------------------------------------------------ | ----------------------- | --------------------------------- |
| no crates   | won, Lincolnshire 11,848 | lost Lincolnshire; Yorkshire 4,431, Powys 29,758 | won, Lincolnshire 7,144 | lost Lincolnshire; Cumbria 25,873 |
| half        | won, all above 47,000    | lost Lincolnshire                                | won, all above 41,000   | won, Lincolnshire 707             |
| every crate | won, all above 49,000    | lost Lincolnshire                                | won, all above 45,000   | won, all above 48,000             |

So ignoring the crates now costs HQ health and games, and looting all of them gives about what the old trickle did. The exception is `fort` on Lincolnshire, which now loses on wave 10 even looting every crate: it was the closest win before and the bot spends on walls, not turrets, so a lower trickle tips it. `none` is unchanged (lost on waves 4 to 6).

## Neighbourhood scale

_Started 2026-10-30._ Dan found the scale off: on the 4 km Sheffield map the base was a 40 m disc, the fight used about 3% of the map, and a wave was thousands of zombies in a few blobs moving at a sprint. He picked a "neighbourhood scale" reset from the options doc (https://claude.ai/artifact/JtoVzvHo6sYNJrtMLzyNYe). This is step 1, the rescale; step 2 (start big and fall back into enclaves) and step 3 (street barricades, fog) come later.

- **Maps.** Bath, Sheffield and Whitby are regenerated at 1.2 km square (400 × 400 tiles, still 3 m a tile). `info.json` has a new `metres_per_tile`, which the map generator writes into `Maps.gen.ts` as `metresPerTile`. `engine-lib/game/MapScale.ts` reads it: maps at 10 m a tile or less are town scale.
- **Horde numbers.** On town maps `GameRunner` lays `TOWN_HORDE_OPTIONS` (`horde/TownScale.ts`) over the defaults; continent maps are unchanged. Waves start at 300 and grow 35% (about 4,500 on wave 10). A coarse cell holds at most 12. Shamblers step every 5 ticks. Waves rise out of the streets 40 to 70 cells away (`inlandSpawns`, since a town has no shore). A crowd of 12 presses far less than one of 2,000, so `pressureShift` is 0 and HQ, building and wall health are cut by about ten. Bounties, mines and repair costs are scaled to match.
- **Turrets.** The range is 20 cells (40 tiles, about 120 m) on town maps, up from 8 (48 m), after Dan said turrets felt short-ranged. Turrets fire volleys of 2 every 6 ticks (`turretFireInterval`, new). The placement circle now shows the horde turret range (`Config.hordeTurretRange`); before, it drew OpenFront's 30 tiles while turrets reached 16.
- **Land.** The settled disc starts at 40 tiles (120 m) and grows 4 a wave, and costs 20 population a tile instead of 200. Outposts claim 20 tiles (60 m).
- **Camera.** Once the HQ is placed on a town map, the camera moves in on it with about 160 tiles (500 m) across the shorter side of the screen. You can't zoom out further than the whole map.
- Horde snapshot version 14 (older games fire every tick and spawn from the shore).

`balance:horde -- --map <town> --zone 0` uses the town numbers:

| Map       | `none`       | `turrets` | `fort`       | `spans` | `scavenge`   |
| --------- | ------------ | --------- | ------------ | ------- | ------------ |
| Sheffield | lost, wave 3 | won       | lost, wave 5 | won     | won          |
| Bath      | lost, wave 3 | won       | won          | won     | won          |
| Whitby    | lost, wave 3 | won       | won          | won     | lost, wave 3 |

## Prerequisites

- npm 12.1 or later. Run `npm install --global --ignore-scripts npm@12.1.0`, or prefix commands with `npx -y npm@12.1.0`. The machine currently has npm 11.19.
- Go, only for the England map in Phase 0. It isn't needed for the spike.
- A browser with WebGL2.
