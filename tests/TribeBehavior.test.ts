import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { DeleteUnitExecution } from "@openfront/engine/execution/DeleteUnitExecution";
import { TribeAttackBehavior } from "@openfront/engine/execution/TribeAttackBehavior";
import { TribeExecution } from "@openfront/engine/execution/TribeExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { MockInstance } from "vitest";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

let game: Game;
let tribe: Player;

// Full-height stripes, left to right, so nobody borders free land. "tribe" is the tribe.
async function setupStripes(stripes: [string, PlayerType][]) {
  game = await setup(
    "big_plains",
    {},
    stripes.map(([id, type]) => new PlayerInfo(id, type, null, id)),
  );
  const owners = stripes.map(([id]) => game.player(id));
  game.map().forEachTile((tile) => {
    owners[Math.floor((game.x(tile) * owners.length) / game.width())].conquer(
      tile,
    );
  });
  tribe = game.player("tribe");
  tribe.setTroops(game.config().maxTroops(tribe));
}

function attackTargets(
  spy: MockInstance<Game["addExecution"]>,
): (string | null)[] {
  return spy.mock.calls
    .map((c) => c[0])
    .filter((e): e is AttackExecution => e instanceof AttackExecution)
    .map((e) => e.targetID());
}

// The first round only sends the opening attack on free land
function playTwoRounds(exec: TribeExecution) {
  exec.tick(exec["attackTick"]);
  exec.tick(exec["attackTick"] + exec["attackRate"]);
}

function tribeExecution(): TribeExecution {
  const exec = new TribeExecution(tribe);
  exec.init(game);
  return exec;
}

describe("Tribe attacks", () => {
  it("retaliates against the biggest incoming attack", async () => {
    await setupStripes([
      ["small", PlayerType.Human],
      ["tribe", PlayerType.Bot],
      ["big", PlayerType.Human],
    ]);
    game.player("small").createAttack(tribe, 1_000, null, new Set());
    game.player("big").createAttack(tribe, 5_000, null, new Set());
    const behavior = new TribeAttackBehavior(
      new PseudoRandom(42),
      game,
      tribe,
      0.5, // triggerRatio
      0.3, // reserveRatio
      0.2, // expandRatio
    );
    const spy = vi.spyOn(game, "addExecution");

    behavior.attackRandomTarget();

    expect(attackTargets(spy)).toEqual(["big"]);
  });

  it("attacks a neighboring bot when it spares the humans", async () => {
    await setupStripes([
      ["human", PlayerType.Human],
      ["tribe", PlayerType.Bot],
      ["bot", PlayerType.Bot],
    ]);
    const random = new PseudoRandom(42);
    vi.spyOn(random, "chance").mockReturnValue(true);
    const behavior = new TribeAttackBehavior(
      random,
      game,
      tribe,
      0.5,
      0.3,
      0.2,
    );
    const spy = vi.spyOn(game, "addExecution");

    behavior.attackRandomTarget();

    expect(attackTargets(spy)).toEqual(["bot"]);
  });
});

describe("Tribe upkeep", () => {
  it("deletes the structures it holds, one per round", async () => {
    await setupStripes([
      ["tribe", PlayerType.Bot],
      ["human", PlayerType.Human],
    ]);
    tribe.buildUnit(UnitType.City, game.ref(10, 10), {});
    tribe.buildUnit(UnitType.Factory, game.ref(10, 60), {});
    executeTicks(game, game.config().deleteUnitCooldown());
    const exec = tribeExecution();
    const spy = vi.spyOn(game, "addExecution");

    playTwoRounds(exec);

    const deletions = spy.mock.calls.filter(
      (c) => c[0] instanceof DeleteUnitExecution,
    );
    expect(deletions).toHaveLength(1);
  });
});
