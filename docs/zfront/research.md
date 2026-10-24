# zfront: research findings

_2026-10-24. OpenFront was inspected at commit `817c129` (2026-10-23)._

## TL;DR

- **OpenFront ([openfrontio/OpenFrontIO](https://github.com/openfrontio/OpenFrontIO)) is the open-source project in this genre.** territorial.io, by David Tschacher, is closed source. OpenFront started as a fork and rewrite of WarFront.io, which is MIT-licensed.
- **Forking OpenFront saves a lot of work.** It already has:
  - a deterministic engine
  - a WebGL tile-map renderer
  - a PNG-to-terrain map pipeline that encodes elevation (plains, highland, mountain) and impassable tiles
  - nukes that leave fallout
  - a gold economy, defence posts, SAMs and missile silos
  - a **Britannia** map
  - single-player that runs entirely in the browser
- **The cost of forking is the licence.** OpenFront is AGPL-3.0 with extra Section 7 terms:
  - All of zfront's source, client and server, would have to be public under AGPL.
  - "© OpenFront and Contributors" must be visible in the game.
  - You can still make money (OpenFront sells cosmetics), but the code can't be closed.
- **Most of OpenFront's gameplay code won't fit tower defence.** Territory flooding, alliances, boats, trade and nation AI don't carry over. Plan a **hard fork**: keep the engine skeleton, map pipeline, renderer and netcode, and replace the gameplay layer. Merging upstream changes will stop being practical within weeks.
- **Cloudflare works:**
  - The client and single-player can run entirely on **Workers Static Assets**.
  - For co-op, OpenFront's server only relays player inputs and doesn't run the simulation. That maps cleanly onto **one Durable Object per game**.
  - OpenFront's own Node server won't run on Workers as it is. It would run on Cloudflare Containers or a VPS.
- **Key design insight:** OpenFront already simulates territory as per-tile state on a grid. A zombie horde could be simulated the same way, as **horde density per tile** that flows downhill through a flow field, in the style of Creeper World. That scales to hundreds of thousands of zombies far more cheaply than individual agents, and it makes valleys and choke points work naturally (see §5.3).

---

## 1. The landscape

| Project                                                   | Status                                                                                   | Licence                                                         | Relevance                                                                                                  |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| territorial.io                                            | Live; browser and mobile; by David Tschacher                                             | Closed                                                          | Genre origin. Can't fork.                                                                                  |
| WarFront.io ([WarFrontIO](https://github.com/WarFrontIO)) | Repos for the client, server, API, protocol and map codec; last updated Jul 2025         | **MIT**                                                         | OpenFront's ancestor. Permissive but small and early-stage.                                                |
| **OpenFront.io**                                          | Very active (daily commits; new modes such as the Doomsday Clock zone mode in July 2026) | **AGPL-3.0** code, CC BY-SA 4.0 assets, some proprietary assets | Best base to fork                                                                                          |
| OpenBack                                                  | Unofficial renamed build of OpenFront                                                    | AGPL (inherited)                                                | Shows that rebranded forks are an accepted pattern                                                         |
| Mindustry                                                 | Mature                                                                                   | GPL-3.0                                                         | Tower defence and factory game where walls reshape enemy paths. Useful for design reference, not for code. |

## 2. OpenFront technical teardown

### 2.1 Stack and size

- Monorepo using TypeScript 7, Vite 8 and Node 24. The UI uses Lit and Tailwind. Rendering is a custom WebGL renderer. The map generator is written in Go.
- About 215k lines of TypeScript:

  | Area                                         | Lines  | Notes                                                    |
  | -------------------------------------------- | ------ | -------------------------------------------------------- |
  | `packages/engine`                            | ~38k   | The simulation                                           |
  | `engine-api`, `engine-lib`, `shared`, `zbin` | ~13.5k | Shared contracts, map grid, wire format                  |
  | `src/client`                                 | ~150k  | Mostly UI, store, accounts, Steam, ads and platform SDKs |
  | `src/server`                                 | ~13k   | Lobby, matchmaking, ranked play, relay                   |

- Some features depend on a **closed-source "api" Cloudflare Worker**: auth, stats, cosmetics and payments. A fork has to stub these out or replace them.

### 2.2 Simulation model: deterministic lockstep

- Every client runs the whole simulation in a Web Worker.
- The server collects player **intents** and relays them as a **turn** every **100 ms**. It never simulates the game.
- Intents become **Executions**, which are the only thing allowed to change game state.
- Determinism comes from a seeded PRNG and deterministic maths, and the server includes a desync detector.
- The engine is hermetic: it does no I/O, and tests enforce that. So it can run headless for tests, bots and replays.
- **Single-player runs with no game server at all.** The client's `LocalServer` stands in for it.

### 2.3 Maps and terrain (most relevant to zfront)

**Pipeline.** The Go generator turns a PNG into `map.bin` (full size), `map4x.bin` (half width and height), `map16x.bin` and a thumbnail.

**How pixels become terrain.** Only the blue channel matters:

| Pixel                     | Terrain         | Magnitude        |
| ------------------------- | --------------- | ---------------- |
| alpha < 20, or blue = 106 | Water           | Distance to land |
| `#000000`                 | Impassable void | Fixed 31         |
| blue 140–158              | Plains          | 0–9              |
| blue 159–178              | Highland        | 10–19            |
| blue 179–200              | Mountain        | 20–30            |

**The engine already uses terrain.**

| Terrain  | Attack cost per tile | Defence multiplier |
| -------- | -------------------- | ------------------ |
| Plains   | 16.5                 | ×1                 |
| Highland | 20                   | ×1.5               |
| Mountain | 25                   | ×2                 |

Impassable tiles can't be owned, attacked or nuked, and nukes can't fly over them.

**Per-tile state** is a `Uint16`:

- bits 0–11: owner
- bit 13: fallout (nukes already irradiate ground)
- bit 14: defence bonus

**Terrain can already change, in one way.** `GameMap` has `setWater` and `setMagnitude`, and `WaterManager` uses them for water-nuke craters: it turns land into water, recomputes the magnitude values nearby, and rebuilds the water pathfinding graph every 20 ticks. Other changes, such as collapsing a mountain into highland or digging land craters, can follow the same pattern. They still need the renderer to re-upload changed areas and paths to be invalidated.

**Map layers** are decorative overlays, such as roads, and can be flagged `nukeable`.

**Existing maps.** `britannia` (1600×2090, about 3.3M tiles, a 3.3 MB `.bin` file), `britanniaclassic`, `irishsea` and about 70 others. All are CC BY-SA 4.0.

### 2.4 Reusable, adaptable and missing pieces

| Category   | Items                                                                                                                                                                                                                                                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Keep**   | Engine skeleton (`GameRunner`, `ExecutionManager`, intents and executions, PRNG, snapshots, replays); tile grid (`GameMapImpl`); Go map generator; WebGL terrain and territory passes; worker protocol; `LocalServer` single-player path; Lit UI shell                                                                      |
| **Adapt**  | Territory (becomes the build zone); gold (becomes cash); `DefensePost` (becomes a turret); `MissileSilo`, `AtomBomb`, `HydrogenBomb`, `MIRV` and fallout (become missiles, nukes and irradiation); SAM (becomes anti-air against flying threats); tribes and nation AI (becomes the wave director); `ConstructionExecution` |
| **Remove** | Alliances, embargoes, trade and transport ships, warships, trains and rail, clans, ranked play, Steam, Stripe, Poki and CrazyGames SDKs, ads, the cosmetics store, closed-API calls, `/proprietary` assets, unused maps                                                                                                     |
| **New**    | Horde simulation; structure HP and combat; turret targeting; wave director; noise and attraction field; mutable terrain; mobile squads                                                                                                                                                                                      |

### 2.5 How OpenFront is hosted

- Docker on Hetzner, behind a Cloudflare load balancer and Argo.
- Matchmaking runs in a Durable Object inside their closed API.
- Their multi-server plan explicitly rules out running the game relay in a Durable Object. That choice reflects their scale and operations setup; it isn't a technical blocker for us.

## 3. Licensing implications of a fork

**Code: AGPL-3.0 (since 2025-09-04).**

- Serving the game over a network counts as distributing it.
- zfront.app must give every player a link to the exact source that is running, **including the server and Durable Object code**.

**Additional Section 7 terms (since 2025-12-16).**

- Keep **"© OpenFront and Contributors"** visible: in the footer, loading screen or main menu.
- Don't misrepresent the project's origin, use "OpenFront" as the main title, or imply that OpenFront endorses zfront.
- "zfront" is fine as a name. Avoid OpenFront's logo and visual identity.

**Assets.**

- `/resources` is CC BY-SA 4.0. It needs attribution ("OpenFront"), and anything derived from it must also be shared under CC BY-SA. That includes the Britannia map and any crop of it.
- `/proprietary` (about 15 MB of fonts, images and sounds) is **All Rights Reserved** and must be deleted from the fork.
- zfront's **own** new art and audio can stay proprietary, as long as none of it is derived from CC BY-SA assets. OpenFront uses this same model.

**Permissive alternatives.**

- OpenFront code from before **2025-03-25** (commit `25d5cc37`) is MIT.
- The WarFront.io repos are MIT.
- Both are much older: no WebGL renderer, no package split and fewer features.

_This is not legal advice. If you're planning a commercial model, get a short licence review._

## 4. Hosting on Cloudflare

| Component                                     | Fit                                           | Notes                                                                                                                                                                   |
| --------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static client (JS, sprites, map `.bin` files) | ✅ Workers Static Assets                      | Paid plan allows 100k files of up to 25 MiB each. OpenFront's `/resources` is 674 MB, almost all of it maps (616 MB), so ship only the maps you use, or put them in R2. |
| Single-player and solo PvE                    | ✅ Browser only                               | The simulation runs in a Web Worker, so there's no server cost.                                                                                                         |
| Co-op and PvP lockstep relay                  | ✅ Durable Objects with WebSocket Hibernation | One DO per lobby or game. The 100 ms turn timer keeps the DO awake for the length of a match.                                                                           |
| Accounts, leaderboards, saves                 | ✅ D1, KV, or DO SQLite                       |                                                                                                                                                                         |
| Replays and user maps                         | ✅ R2                                         |                                                                                                                                                                         |
| OpenFront's Node server unchanged             | ❌ Workers. ✅ Containers or a VPS.           | Express, `ws`, Node cluster and child processes don't run on Workers. Containers can run them, but an always-on Container costs more than a small VPS.                  |
| Server-authoritative simulation               | ⚠️ Avoid                                      | DOs have 128 MB of memory per isolate and a single thread. A 3.3M-tile map with a big horde at 10 Hz is a poor fit, so keep lockstep.                                   |

**Rough costs (Workers Paid plan, $5/month base):**

- **Durable Object relay.** Each object is billed at 128 MB.
  - A 30-minute game is about 230 GB-s.
  - The included 400k GB-s per month covers about **1,700 half-hour games**. After that, each game costs about **$0.003**.
  - Incoming WebSocket messages are billed at 20:1, and outgoing turn broadcasts are free. For four players sending one intent per second for 30 minutes, that's about 360 billable requests, which is negligible.
- **Containers.** A `basic` instance (¼ vCPU, 1 GiB) kept always on costs about $10–15 per month on memory and active CPU. A small VPS is cheaper for that.

**`.app` domain.** The whole `.app` TLD is on the HSTS preload list, so it's HTTPS-only. Cloudflare issues the certificates automatically.

**Recommendation:**

1. **Phase 1:** host entirely on Cloudflare. The client and single-player go on Workers Static Assets at `zfront.app`, with a `staging.zfront.app` environment.
2. **Phase 2 (co-op):** write a thin relay Durable Object, a few hundred lines that implement the turn protocol. If we fork, it falls under AGPL too, so it ships with the source link.

## 5. Gameplay mechanics research

### 5.1 Reference games and what to borrow

| Game                       | Mechanic                                                                                                                                                                          | zfront use                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| They Are Billions          | **Noise** draws zombies. Buildings, units and gunfire all make noise. One breach cascades because infected buildings spawn more zombies. A final wave comes from every direction. | Noise field, bait buildings, infection, final wave             |
| Diplomacy is Not an Option | Waves come every few days from announced directions, with a 3-minute warning. Walls **slow** enemies rather than stop them, and choke points matter.                              | Wave announcement UI; walls as delay; kill boxes               |
| Mindustry                  | Enemies follow a flow field to your core, and walls reshape their path. Turrets need an ammo supply.                                                                              | Flow-field pathing; ammo logistics (later)                     |
| Creeper World 3/4          | The enemy is a **fluid** that floods 3D terrain. High ground matters. Direct fire needs line of sight, but mortars can shoot over terrain. Terrain decays or can be terraformed.  | Horde as density field; LOS vs indirect fire; terrain mutation |
| Factorio                   | Pollution triggers biter attacks, so the threat grows with your economy.                                                                                                          | Bigger economy means more noise and bigger waves               |
| Kingdom Rush, Bloons       | Tower tiers and specialisations. A build phase between waves. "Call the next wave early" for bonus cash.                                                                          | Upgrade trees; early-call bonus                                |

### 5.2 Pathing thousands of zombies

**Flow fields** are the standard technique:

1. Run Dijkstra outward from the goals, such as player structures.
2. Store a direction (or a cost to move downhill) in every cell.
3. Each agent just reads the cell it's standing on.

Cost is per map rather than per agent, so it scales to thousands or tens of thousands of agents. Blocked cells only need their cost changed, not every path recomputed.

Things to watch for zfront:

- Run Dijkstra on the coarse `map4x` grid. For Britannia that's 800×1045, about 836k cells.
- Recompute only the affected area when walls are built or terrain changes. Chunking or a hierarchical scheme helps.
- Use integer costs so the result stays deterministic.

### 5.3 Two ways to model a horde

| Model                                                       | How it works                                                       | Scale                                                   | Pros                                                                                                                                                            | Cons                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **A. Discrete agents** (They Are Billions)                  | A struct-of-arrays of zombies, each following a flow field         | About 5k–20k in JS at 10 Hz                             | Readable individual zombies, special types, satisfying to watch                                                                                                 | Memory and CPU grow with zombie count. Needs instanced sprite rendering. |
| **B. Density field** (Creeper World or OpenFront territory) | Zombies per tile, held in typed arrays, flowing downhill each tick | 100k+ zombies; cost depends on map size, not horde size | Fits OpenFront's tile engine and renderer (draw density as a texture). Deterministic integer maths. Funnels, mines and nukes become simple per-tile operations. | Less individual character                                                |

**Recommendation: a hybrid.** Simulate the mass horde as a density field, and add discrete agents for elites and bosses (Brute, Spitter, Screamer, Titan).

In this model:

- A turret removes density from the tiles within its range each tick.
- A mine clears its own tile.
- A wall absorbs damage from the density pressing against it.
- A nuke zeroes density inside its radius.

The technical spike should benchmark both models.

### 5.4 Terrain as gameplay

These mechanics fit the existing magnitude encoding:

- **Movement cost from magnitude.** For example, `cost = 1 + magnitude/10`. Mountain becomes impassable to normal zombies above some threshold. Hordes then avoid high ground, so **valleys become natural funnels**.
- **High ground for defenders.** Turrets on highland or mountain get extra range. Direct fire is blocked by higher terrain in between. Artillery ignores that.
- **Water.** Normal zombies can't swim, so bridges and fords become choke points, and demolishing a bridge reshapes the map.
- **Mutation.**
  - Craters lower the magnitude.
  - A collapse turns mountain into highland, which opens a pass.
  - Irradiation uses the fallout bit to block building and damage zombies over time, but it can mutate them into irradiated variants. That's double-edged.
  - Flooding a breached levee turns land into water.
  - Napalm creates temporary scorched earth.

### 5.5 England map source

| Option                          | Effort    | Elevation                                                                                                                                          | Licence                                                                                                                             |
| ------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Crop Britannia**              | Quickest  | Stylised elevation                                                                                                                                 | CC BY-SA 4.0, attribute OpenFront                                                                                                   |
| **Generate from OS Terrain 50** | More work | Real 50 m elevation grid. The Pennines, Peak District, Lake District, Dartmoor and the river valleys all come out right, which gives real funnels. | Free under the Open Government Licence for commercial use; attribution "Contains OS data © Crown copyright and database right 2026" |

To use OS Terrain 50, convert it with a small script into the blue-channel PNG format the generator expects.

## Sources

- OpenFront repo and licensing: [github.com/openfrontio/OpenFrontIO](https://github.com/openfrontio/OpenFrontIO). Local inspection covered `LICENSE`, `LICENSING.md`, `LICENSE-ASSETS`, `docs/Architecture.md`, `docs/MultiServer.md`, `map-generator/README.md` and `map_generator.go`.
- OpenFront release history: [newreleases.io](https://newreleases.io/project/github/openfrontio/OpenFrontIO/release/v0.34.6)
- WarFront.io: [github.com/WarFrontIO](https://github.com/WarFrontIO)
- OpenBack fork: [openback.dedyn.io terms](https://openback.dedyn.io/terms-of-service.html)
- territorial.io publisher: [App Store listing via AppFollow](https://apps.appfollow.io/ios/territorial-io/1581110913?country=de)
- Mindustry: [Wikipedia](https://en.wikipedia.org/wiki/Mindustry), [GamingOnLinux](https://gamingonlinux.com/2018/12/mindustry-an-open-source-sandbox-tower-defense-game-thats-a-little-like-factorio)
- They Are Billions noise: [Steam discussion](https://steamcommunity.com/app/644930/discussions/0/1697174779845532460), [Steam discussion](https://steamcommunity.com/app/644930/discussions/0/1694922526915031822)
- Diplomacy is Not an Option: [PC Gamer preview](https://www.pcgamer.com/uk/diplomacy-is-not-an-option-preview), [Steam discussion](https://steamcommunity.com/app/1272320/discussions/0/4703539342753252100)
- Creeper World: [Steam store page](https://store.steampowered.com/app/2918980), [Knuckle Cracker forum](https://knucklecracker.com/forums/index.php?msg=170929)
- Flow fields: [vonwolfehaus/flow-field](https://github.com/vonwolfehaus/flow-field), [overview](https://web.kartcsainz.com/flow-field-pathfinding.html)
- Cloudflare: [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Containers](https://developers.cloudflare.com/containers/), [Containers pricing](https://developers.cloudflare.com/containers/pricing/)
- OS Terrain 50: [OS docs](https://docs.os.uk/os-downloads/products/land-and-terrain-portfolio/os-terrain-50), [OS product page](https://ordnancesurvey.co.uk/business-government/products/terrain-50)
