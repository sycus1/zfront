# Technical spike: horde simulation on the OpenFront engine

_Status: planned, 2026-10-24. Timebox: 3 days plus 1 day of buffer. Branch: `spike/horde`. Throwaway-quality code is fine. The output is the findings table below and a go/no-go decision._

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

Days 0–2 were done on 2026-10-24 on branch `spike/horde`. Day 3 (elite tuning, flow shape and the go/no-go) is still to do.

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

- [ ] **Remove** alliances, embargoes, trade and transport ships, warships, trains and rail, clans, ranked play, Steam, Stripe and payments, Poki and CrazyGames SDKs, ads, the cosmetics store, and the closed-API calls (`api.openfront.io`).
- [ ] **Remove maps** other than the zfront ones, plus their entries in `Maps.gen.ts` and `en.json`. That cuts about 600 MB from the deploy.
- [ ] **Rebrand** the UI with the zfront name, logo, favicon and font, and add an AGPL "Source" link to the footer. Keep "© OpenFront and Contributors".
- [ ] **Static deploy to Cloudflare Workers** (`staging.zfront.app`). Build the client with Vite, render the app shell with `src/server/RenderStaticIndex.ts --environment-only` (which OpenFront already uses for its static Worker), and serve `out/` plus `resources/` as Workers Static Assets.
- [ ] **England map:** a heightmap script from OS Terrain 50 to PNG, then `npm run gen-maps` (needs Go).
- [ ] **Docs:** rewrite `CONTRIBUTING.md` for zfront and enable GitHub Actions on the fork, which has them off by default. Keep only `ci.yml`.

## Prerequisites

- npm 12.1 or later. Run `npm install --global --ignore-scripts npm@12.1.0`, or prefix commands with `npx -y npm@12.1.0`. The machine currently has npm 11.19.
- Go, only for the England map in Phase 0. It isn't needed for the spike.
- A browser with WebGL2.
