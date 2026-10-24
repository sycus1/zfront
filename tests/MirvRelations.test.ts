import {
  PlayerInfo,
  PlayerType,
  Relation,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { MirvExecution } from "@openfront/engine/execution/MIRVExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

let game: Game;
let player1: Player;
let player2: Player;

describe("MIRV launch side effects", () => {
  beforeEach(async () => {
    game = await setup("plains", { instantBuild: true }, [
      new PlayerInfo("player1", PlayerType.Human, "c1", "p1"),
      new PlayerInfo("player2", PlayerType.Human, "c2", "p2"),
    ]);

    player1 = game.player("p1");
    player2 = game.player("p2");

    player1.conquer(game.ref(0, 0));
    player2.conquer(game.ref(10, 10));

    player1.addGold(1_000_000_000n);
    player2.addGold(1_000_000_000n);
  });

  test("a successful launch makes the target hostile to the launcher", () => {
    player1.buildUnit(UnitType.MissileSilo, game.ref(0, 0), {});

    game.addExecution(new MirvExecution(player1, game.ref(10, 10)));
    executeTicks(game, 2); // init + spawn

    expect(player1.units(UnitType.MIRV)).toHaveLength(1);
    expect(player2.relation(player1)).toBe(Relation.Hostile);
  });

  test("a fizzled launch leaves relations alone", () => {
    // player1 has no silo, so canBuild fails and the execution fizzles.
    game.addExecution(new MirvExecution(player1, game.ref(10, 10)));
    executeTicks(game, 2);

    expect(player1.units(UnitType.MIRV)).toHaveLength(0);
    expect(player2.relation(player1)).toBe(Relation.Neutral);
  });
});
