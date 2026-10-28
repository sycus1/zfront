/**
 * Horde balance harness (zfront).
 *
 * Plays solo games on Britannia headlessly with the real engine and the
 * default horde options, and a scripted player that spends its gold the
 * same way every time. Prints, for each strategy and HQ position, how each
 * wave went and how the game ended, so a change to the wave or damage
 * numbers can be checked against the targets in docs/zfront/spike-plan.md
 * ("MVP: balance") without a play-test.
 *
 * Strategies:
 *   none     builds nothing: the HQ should fall within the first few waves.
 *   turrets  builds turrets (Defense Posts) in a ring round the HQ, then
 *            upgrades them to level 2 and 3.
 *   fort     builds one turret, seals the HQ in a ring of barricades, adds
 *            more turrets inside, then upgrades walls and turrets in turn.
 *
 * Usage:
 *   npm run balance:horde -- [--strategy none,turrets,fort]
 *                            [--spawn yorkshire,lincolnshire,...]
 *                            [--seed balance] [--set waveInterval=600,...]
 *                            [--zone 20]
 *
 * --zone gives the player land within that many tiles of the HQ at the
 * start, standing in for expanding by hand. --zone 0 gives none, so the
 * zone grows only by the engine's own rules (settlers, in horde mode).
 */
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameConfig } from "@openfront/engine-api/Schemas";
import { loadTerrainMap } from "@openfront/engine-lib/game/TerrainMapLoader";
import { EngineConfig } from "@openfront/engine/configuration/EngineConfig";
import { ConstructionExecution } from "@openfront/engine/execution/ConstructionExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { UpgradeStructureExecution } from "@openfront/engine/execution/UpgradeStructureExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { createGame } from "@openfront/engine/game/GameImpl";
import {
  DEFAULT_HORDE_OPTIONS,
  HordeExecution,
  HordeOptions,
} from "@openfront/engine/horde/HordeExecution";
import { loadMapFiles } from "@openfront/shared/GameMapLoader";
import path from "path";
import { fileURLToPath } from "url";
import { NodeGameMapLoader } from "./fullgame/NodeGameMapLoader";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** HQ positions in tiles: a spread of inland and coastal starts. */
const SPAWNS: Record<string, [number, number]> = {
  yorkshire: [1118, 1202],
  lincolnshire: [1271, 1403],
  hampshire: [1148, 1820],
  powys: [902, 1569],
  cumbria: [951, 1088],
};

const STRATEGIES = ["none", "turrets", "fort"] as const;
type Strategy = (typeof STRATEGIES)[number];

interface Options {
  /** Horde options to try instead of the defaults. */
  horde: Partial<HordeOptions>;
  strategies: Strategy[];
  spawns: string[];
  seed: string;
  /** Radius in tiles of the land handed to the player at the start. */
  zone: number;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    horde: {},
    strategies: [...STRATEGIES],
    spawns: Object.keys(SPAWNS),
    seed: "balance",
    zone: 20,
  };
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i];
    switch (argv[i]) {
      case "--strategy":
        opts.strategies = next().split(",") as Strategy[];
        for (const s of opts.strategies) {
          if (!STRATEGIES.includes(s)) throw new Error(`unknown strategy ${s}`);
        }
        break;
      case "--spawn":
        opts.spawns = next().split(",");
        for (const s of opts.spawns) {
          if (!(s in SPAWNS)) throw new Error(`unknown spawn ${s}`);
        }
        break;
      case "--set":
        for (const kv of next().split(",")) {
          const [k, v] = kv.split("=");
          if (!(k in DEFAULT_HORDE_OPTIONS))
            throw new Error(`unknown option ${k}`);
          opts.horde[k as keyof HordeOptions] = parseInt(v, 10);
        }
        break;
      case "--zone":
        opts.zone = parseInt(next(), 10);
        break;
      case "--seed":
        opts.seed = next();
        break;
      default:
        throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  return opts;
}

/** Ring of tile offsets at `radius`, `step` tiles apart, clockwise from north. */
function ring(radius: number, step: number): [number, number][] {
  const out: [number, number][] = [];
  for (let x = -radius; x < radius; x += step) out.push([x, -radius]);
  for (let y = -radius; y < radius; y += step) out.push([radius, y]);
  for (let x = radius; x > -radius; x -= step) out.push([x, radius]);
  for (let y = radius; y > -radius; y -= step) out.push([-radius, y]);
  return out;
}

const TURRET_RING = ring(6, 6);
const WALL_RING = ring(10, 2);
/** Ticks before an order that came to nothing is tried again. */
const RETRY = 50;

interface Order {
  tick: number;
  /** Where the unit was ordered, after canBuild moved it. */
  at: number;
}

/** Spends the player's gold according to `strategy`; called every tick. */
function spend(
  game: Game,
  me: Player,
  hq: [number, number],
  s: Strategy,
  /** Orders by planned tile; one that came to nothing is tried again. */
  ordered: Map<number, Order>,
) {
  if (s === "none") return;
  // Steps run in order: each builds at its offsets (level 1), or upgrades
  // what was built there to its level, before the next step starts.
  const T = UnitType.DefensePost;
  const W = UnitType.Wall;
  const plan: [UnitType, [number, number][], number][] =
    s === "turrets"
      ? [
          [T, TURRET_RING, 1],
          [T, TURRET_RING, 2],
          [T, TURRET_RING, 3],
        ]
      : [
          [T, TURRET_RING.slice(0, 1), 1],
          [W, WALL_RING, 1],
          [T, TURRET_RING, 1],
          [W, WALL_RING, 2],
          [T, TURRET_RING, 2],
          [W, WALL_RING, 3],
          [T, TURRET_RING, 3],
        ];
  for (const [type, offsets, level] of plan) {
    for (const [dx, dy] of offsets) {
      const x = hq[0] + dx;
      const y = hq[1] + dy;
      if (!game.isValidCoord(x, y)) continue;
      const tile = game.ref(x, y);
      const order = ordered.get(tile);
      const unit =
        order === undefined
          ? undefined
          : me.units(type).find((u) => u.tile() === order.at);
      if (level > 1) {
        if (unit === undefined || unit.level() >= level) continue;
        if (!me.canUpgradeUnit(unit)) return;
        game.addExecution(new UpgradeStructureExecution(me, unit.id()));
        return;
      }
      if (unit !== undefined) continue;
      if (order !== undefined && game.ticks() - order.tick < RETRY) continue;
      if (me.gold() < game.unitInfo(type).cost(game, me)) return;
      // Structures may be moved to the nearest free spot; walls never are.
      const at = me.canBuild(type, tile);
      if (at === false) continue;
      game.addExecution(new ConstructionExecution(me, type, at));
      ordered.set(tile, { tick: game.ticks(), at });
      return;
    }
  }
}

function levels(me: Player, type: UnitType): string {
  const units = me.units(type);
  return `${units.length}/${units.reduce((n, u) => n + u.level(), 0)}`;
}

interface WaveRow {
  wave: number;
  size: number;
  hqStart: number;
  hqEnd: number;
  killed: number;
  lost: number;
  /** Count and total levels, as "count/levels". */
  turrets: string;
  walls: string;
  /** Tiles the player holds at the end of the wave. */
  tiles: number;
}

interface Result {
  rows: WaveRow[];
  outcome: string;
  /** Seconds from the end of the spawn phase to the end of the game. */
  seconds: number;
}

async function play(
  horde: Partial<HordeOptions>,
  zone: number,
  seed: string,
  spawn: [number, number],
  strategy: Strategy,
): Promise<Result> {
  const gameConfig: GameConfig = {
    gameMap: GameMapType.Britannia,
    gameMapSize: GameMapSize.Normal,
    gameMode: GameMode.FFA,
    gameType: GameType.Singleplayer,
    difficulty: Difficulty.Medium,
    nations: "disabled",
    donateGold: false,
    donateTroops: false,
    bots: 0,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
    horde: true,
  };
  const config = new EngineConfig(gameConfig, false);
  const loader = new NodeGameMapLoader(
    path.join(PROJECT_ROOT, "resources/maps"),
  );
  const terrain = await loadTerrainMap(
    await loadMapFiles(loader, gameConfig.gameMap, gameConfig.gameMapSize),
  );
  const game = createGame([], [], terrain.gameMap, terrain.miniGameMap, config);
  const info = new PlayerInfo("survivor", PlayerType.Human, null, "survivor");
  game.addExecution(
    new SpawnExecution(seed, info, game.ref(spawn[0], spawn[1])),
  );
  while (game.inSpawnPhase()) game.executeNextTick();
  const exec = new HordeExecution(horde);
  game.addExecution(exec);
  const me = game.player("survivor");
  const hq = me.spawnTile()!;
  const hqXY: [number, number] = [game.x(hq), game.y(hq)];
  // Stands in for expanding by hand in the first seconds. The default 20
  // is big enough for the fort's wall ring.
  for (let dy = -zone; dy <= zone; dy++) {
    for (let dx = -zone; dx <= zone; dx++) {
      const x = hqXY[0] + dx;
      const y = hqXY[1] + dy;
      if (dx * dx + dy * dy > zone * zone || !game.isValidCoord(x, y)) continue;
      const t = game.ref(x, y);
      if (game.isLand(t) && !game.hasOwner(t)) me.conquer(t);
    }
  }

  const ordered = new Map<number, Order>();
  const start = game.ticks();
  const rows: WaveRow[] = [];
  let row: WaveRow | null = null;
  let lastKilled = 0;
  let lastLost = 0;
  // Ten waves at the default timings take well under an hour.
  const limit = start + 36_000;
  while (game.ticks() < limit) {
    // An order is paid for when its construction starts, a tick later.
    if (game.ticks() % 2 === 0) spend(game, me, hqXY, strategy, ordered);
    game.executeNextTick();
    const s = exec.stats();
    if (row === null || s.wave !== row.wave) {
      if (row !== null) rows.push(row);
      row = {
        wave: s.wave,
        size: exec.currentWaveBudget(),
        hqStart: s.hqHp,
        hqEnd: s.hqHp,
        killed: 0,
        lost: 0,
        turrets: "",
        walls: "",
        tiles: 0,
      };
    }
    row.hqEnd = s.hqHp;
    row.killed += s.killed - lastKilled;
    row.lost += s.structuresDestroyed - lastLost;
    row.turrets = levels(me, UnitType.DefensePost);
    row.walls = levels(me, UnitType.Wall);
    row.tiles = me.numTilesOwned();
    lastKilled = s.killed;
    lastLost = s.structuresDestroyed;
    if (s.outcome !== "playing") break;
  }
  if (row !== null) rows.push(row);
  return {
    rows: rows.filter((r) => r.wave > 0),
    outcome: exec.stats().outcome,
    seconds: Math.round((game.ticks() - start) / 10),
  };
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, c) =>
    Math.max(h.length, ...rows.map((r) => r[c].length)),
  );
  const line = (cells: string[]) =>
    cells.map((cell, c) => cell.padStart(widths[c])).join("  ");
  return [line(headers), line(widths.map((w) => "-".repeat(w)))]
    .concat(rows.map(line))
    .join("\n");
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.debug = () => {};
  const summary: string[][] = [];
  for (const strategy of opts.strategies) {
    for (const name of opts.spawns) {
      const r = await play(
        opts.horde,
        opts.zone,
        opts.seed,
        SPAWNS[name],
        strategy,
      );
      console.log(`\n${strategy} @ ${name}: ${r.outcome} after ${r.seconds}s`);
      console.log(
        table(
          [
            "wave",
            "size",
            "hq start",
            "hq end",
            "killed",
            "lost",
            "turrets",
            "walls",
            "tiles",
          ],
          r.rows.map((w) => [
            String(w.wave),
            String(w.size),
            String(w.hqStart),
            String(w.hqEnd),
            String(w.killed),
            String(w.lost),
            w.turrets,
            w.walls,
            String(w.tiles),
          ]),
        ),
      );
      const last = r.rows[r.rows.length - 1];
      summary.push([
        strategy,
        name,
        r.outcome,
        String(last?.wave ?? 0),
        `${r.seconds}s`,
        String(last?.hqEnd ?? 0),
      ]);
    }
  }
  console.log("\nSummary");
  console.log(
    table(["strategy", "spawn", "outcome", "wave", "time", "hq"], summary),
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
