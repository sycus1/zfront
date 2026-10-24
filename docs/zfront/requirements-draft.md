# zfront: draft requirements (v0.1)

_Status: draft for discussion, 2026-10-24. Nothing has been built yet. The background and sources are in [research.md](research.md)._

## Vision

zfront plays on real maps, in the browser, like OpenFront. Instead of fighting other players for territory, you build a base and defend it against waves of zombie hordes. Real terrain shapes where the hordes can go, so you can use it to steer them into kill boxes. Big enough weapons can also change the terrain.

## Core loop

1. **Spawn.** Pick where to start on the map of England. You get an HQ and a small claimed zone around it.
2. **Build.** During the calm, build economy and defences inside your zone, and expand the zone with cash.
3. **Warning.** The next wave is announced: where it comes from, how big it is, and a countdown.
4. **Wave.** The horde follows the terrain toward your noise and structures. Turrets, mines, squads and missiles fight it off.
5. **Earn.** Kills, clearing the wave and calling a wave early all pay cash. Spend it to expand, upgrade and unlock higher tiers, then go back to step 2.
6. **End.** You **win** by surviving N waves (default 15, configurable). You **lose** if your HQ is destroyed.

## MVP scope ("Hold the Line"): single-player with no AI players, browser, zfront.app

### Must have

- **Map.** England, with water, plains, highland, mountain and impassable terrain (see the map decision below).
- **Terrain movement cost.** Zombies move more slowly up higher ground. Mountains above a threshold block normal zombies, and water blocks them completely.
- **HQ and build zone.** The HQ is the lose condition. Its zone grows as you spend cash.
- **Cash economy.**
  - Income: an HQ trickle, scavenger depots, kill bounties and a bonus for clearing a wave.
  - Spending: building, upgrading and repairing.
- **Horde simulation.** Density-field flow toward targets, weighted by terrain cost and noise. Spawns at the map edges, the coast and infestation nests.
- **Buildings:**
  - Walls in three tiers: barricade, stone, reinforced
  - Gun turret
  - Mine
  - Noise beacon (bait)
  - Scavenger depot (economy)
- **Wave director.** A seeded points budget that grows each wave. Spawn directions are announced ahead of time, and the final wave comes from every side.
- **Waves HUD.** Current and next wave, countdown and direction arrows, with a "call wave early" button.
- **Deployment.** Hosted on Cloudflare Workers Static Assets at `zfront.app`, with `staging.zfront.app` as well.

### Should have

- **Unlockable tiers.** For example, Tier 2 at wave 5 and Tier 3 at wave 10. They add heavy turrets, artillery and a missile silo.
- **Defence squads.** Mobile groups you can move, which fight within a radius.
- **Elite zombies.** Discrete agents: Runner, Brute, Spitter and Screamer.
- **Tactical nuke.** It wipes the horde in a radius and permanently irradiates the ground.

### Could have (post-MVP)

- Terrain mutation: craters, collapsing mountains into passes, demolishing bridges, flooding
- Co-op for 2–4 players through a Durable Object relay
- A versus mode where you send hordes to your rivals
- More maps, and a map editor or import
- Accounts, leaderboards and saved replays
- Ammo logistics
- A day/night cycle
- Mobile support

## Mechanics catalogue (starting point; expect it to change)

### Enemies

| Type               | Model    | Role                                                                     |
| ------------------ | -------- | ------------------------------------------------------------------------ |
| Shambler           | Density  | The mass horde. Slow, cheap, mostly blocked by terrain.                  |
| Runner             | Discrete | Fast and fragile. Punishes gaps.                                         |
| Climber            | Discrete | Crosses highland and mountain slowly, so mountains aren't perfect walls. |
| Brute              | Discrete | High HP and extra damage against walls.                                  |
| Spitter            | Discrete | Ranged. Attacks turrets over walls.                                      |
| Bloater            | Discrete | Explodes on walls and leaves a toxic tile.                               |
| Screamer           | Discrete | Makes noise, which pulls the horde toward it.                            |
| Irradiated variant | Either   | Spawns on fallout tiles. Tougher, and resists radiation.                 |
| Titan (boss)       | Discrete | Every 5th wave. Can break terrain.                                       |

### Defences and weapons

| Item                                | Tier | Notes                                                              |
| ----------------------------------- | ---- | ------------------------------------------------------------------ |
| Barricade → Stone → Reinforced wall | 1–3  | Absorbs pressure from the horde. Can be repaired.                  |
| Gate                                | 1    | Lets squads through. A weak point.                                 |
| Gun turret                          | 1    | Direct fire. Needs line of sight. Gets extra range on high ground. |
| Mine field                          | 1    | Single use. Clears density on its tiles.                           |
| Noise beacon                        | 1    | Bait that draws the horde into a kill box. Has a cooldown.         |
| Flamethrower                        | 2    | Short range, high damage to dense crowds.                          |
| Artillery or mortar                 | 2    | Indirect fire over terrain. Has a minimum range.                   |
| Defence squad                       | 2    | A movable unit group. Pays upkeep.                                 |
| Missile silo and missile            | 2    | Targeted strike anywhere on the map. Expensive.                    |
| Tactical nuke                       | 3    | A huge clear, plus permanent irradiation.                          |
| Demolition charge                   | 3    | Mutates terrain: collapses a pass or blows a bridge.               |

### Economy

- **Currency:** cash.
- **Income sources:** the HQ trickle, depots (more income when placed on special tiles such as towns and ruins), kill bounties, a wave-clear bonus, and a bonus for calling a wave early.
- **Optional interest.** You earn a percentage of unspent cash between waves. It's a classic tower-defence risk/reward choice.
- **Noise.** A bigger economy makes more noise, and more noise draws bigger attacks (as in Factorio and They Are Billions).

### Terrain rules

- **Movement cost** comes from the magnitude value (0–30), with a threshold above which tiles are impassable.
- **Line of sight** uses heights: higher tiles in between block direct fire.
- **Fallout** (the existing bit 13) blocks building and damages zombies, but it also spawns irradiated variants.
- **Mutable terrain** (post-MVP) can change a tile's type and magnitude at runtime.

## Technical requirements

- **Deterministic simulation.** Seeded PRNG, integer or fixed-point maths, and intents turned into executions, running in a Web Worker. This is OpenFront's model. It enables replays, headless tests and lockstep co-op later.
- **Performance targets** on a mid-range laptop with integrated graphics:
  - The full England map, a density horde of at least 100k zombies, and at least 500 discrete elites
  - A simulation tick under 30 ms at 10 Hz
  - 60 fps rendering
- **Pathing.** Flow fields computed on the coarse grid. Only the affected areas are recomputed after a building is placed or terrain changes.
- **Rendering.** WebGL. Horde density is drawn as a tile texture, and discrete units are drawn as instanced sprites.
- **Map pipeline.** PNG or heightmap converted to `.bin` with the Go generator. An England heightmap script built from OS Terrain 50.
- **Hosting.** Cloudflare Workers Static Assets. R2 for large map files. A Durable Object relay later. Git-based CI deploys to staging and production.
- **Browsers.** Latest desktop Chrome, Edge, Firefox and Safari. Mobile comes later.
- **Licence compliance if we fork:**
  - An in-game "Source" link (AGPL §13)
  - "© OpenFront and Contributors" shown in the footer and loading screen
  - CC BY-SA attributions in `CREDITS.md`
  - No `/proprietary` assets
  - OS data attribution if we use OS Terrain 50

## Open decisions

1. **Base.** ✅ _Decided 2026-10-24:_ fork OpenFront, accepting AGPL. The repo is [sycus1/zfront](https://github.com/sycus1/zfront).
2. **Multiplayer timing.** ✅ _Decided 2026-10-24:_ the MVP is **single-player only, with no AI players**: no bots, no nations and no AI teammates. That keeps it close to classic tower defence. Co-op stays post-MVP, and the deterministic engine keeps it cheap to add.
3. **England map.** Crop Britannia (quick, stylised) or generate from OS Terrain 50 (real elevation, better funnels). _Recommendation:_ crop Britannia for the spike, then OS Terrain 50 for the MVP.
4. **Pacing.** Continuous real-time with countdowns, or separate build and wave phases. _Recommendation:_ real-time with countdowns, plus "call the next wave early".
5. **Horde model.** Density field, discrete agents, or a hybrid. _Recommendation:_ hybrid, confirmed by the spike.
6. **Art direction.** Pixel art, top-down, in keeping with OpenFront's tile look.

## Proposed next steps

1. ✅ Fork set up and licence-compliance baseline done.
2. **Technical spike, which is the go/no-go check.** See [spike-plan.md](spike-plan.md).
3. Phase 0: strip and rebrand, then deploy a static build to Cloudflare at `staging.zfront.app`. The checklist is in the spike plan.
4. Build the MVP vertical slice.
