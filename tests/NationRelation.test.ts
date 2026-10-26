import {
  Difficulty,
  PlayerInfo,
  PlayerType,
  Relation,
} from "@openfront/engine-api/game/GameTypes";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";

let game: Game;
let nation: Player;
let human: Player;

// Two equally strong neighbors: the nation west of x=10, the human east of it
async function setupNeighbors(difficulty: Difficulty) {
  game = await setup("big_plains", { difficulty });
  nation = game.addPlayer(
    new PlayerInfo("nation", PlayerType.Nation, null, "nation_id"),
  );
  human = game.addPlayer(
    new PlayerInfo("human", PlayerType.Human, null, "human_id"),
  );
  for (let x = 0; x < 20; x++) {
    for (let y = 0; y < 20; y++) {
      (x < 10 ? nation : human).conquer(game.ref(x, y));
    }
  }
  nation.addTroops(50_000);
  human.addTroops(50_000);
}

function attack(attacker: Player, target: Player, troops: number) {
  game.addExecution(new AttackExecution(troops, attacker, target.id()));
  game.executeNextTick();
}

describe("Nation relations", () => {
  test("a counterattack doesn't make the attacking nation hate its victim", async () => {
    await setupNeighbors(Difficulty.Medium);

    attack(nation, human, 5_000);
    attack(human, nation, 10_000);
    attack(human, nation, 10_000);

    expect(human.relation(nation)).toBe(Relation.Hostile);
    expect(nation.relation(human)).toBe(Relation.Neutral);
  });

  test("the aggressor stays hated when the victim hits back", async () => {
    await setupNeighbors(Difficulty.Medium);

    attack(human, nation, 5_000);
    attack(nation, human, 10_000);
    attack(human, nation, 5_000);

    expect(nation.relation(human)).toBe(Relation.Hostile);
    expect(human.relation(nation)).toBe(Relation.Neutral);
  });

  test("easy nations hate whoever hits back", async () => {
    await setupNeighbors(Difficulty.Easy);

    attack(nation, human, 5_000);
    attack(human, nation, 10_000);

    expect(nation.relation(human)).toBe(Relation.Hostile);
  });
});
