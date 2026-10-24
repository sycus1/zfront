import {
  ColoredTeams,
  GameMode,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import { WinCheckExecution } from "@openfront/engine/execution/WinCheckExecution";
import { setup } from "../../util/Setup";

describe("WinCheckExecution", () => {
  let mg: any;
  let winCheck: WinCheckExecution;

  beforeEach(async () => {
    mg = await setup("big_plains", {
      infiniteGold: true,
      gameMode: GameMode.FFA,
      maxTimerValue: 5,
      instantBuild: true,
    });
    mg.setWinner = vi.fn();
    winCheck = new WinCheckExecution();
    winCheck.init(mg, 0);
  });

  it("should call checkWinnerFFA in FFA mode", () => {
    const spy = vi.spyOn(winCheck as any, "checkWinnerFFA");
    winCheck.tick(10);
    expect(spy).toHaveBeenCalled();
  });

  it("should call checkWinnerTeam in non-FFA mode", () => {
    mg.config = vi.fn(() => ({
      gameConfig: vi.fn(() => ({
        maxTimerValue: 5,
        gameMode: GameMode.Team,
      })),
      percentageTilesOwnedToWin: vi.fn(() => 50),
    }));
    winCheck.init(mg, 0);
    const spy = vi.spyOn(winCheck as any, "checkWinnerTeam");
    winCheck.tick(10);
    expect(spy).toHaveBeenCalled();
  });

  it("should set winner in FFA if percentage is reached", () => {
    const player = {
      numTilesOwned: vi.fn(() => 81),
      name: vi.fn(() => "P1"),
    };
    mg.players = vi.fn(() => [player]);
    mg.numLandTiles = vi.fn(() => 100);
    mg.numTilesWithFallout = vi.fn(() => 0);
    winCheck.checkWinnerFFA();
    expect(mg.setWinner).toHaveBeenCalledWith(player, expect.anything());
  });

  it("should set winner in FFA if timer is 0", () => {
    const player = {
      numTilesOwned: vi.fn(() => 10),
      name: vi.fn(() => "P1"),
    };
    mg.players = vi.fn(() => [player]);
    mg.numLandTiles = vi.fn(() => 100);
    mg.numTilesWithFallout = vi.fn(() => 0);
    mg.stats = vi.fn(() => ({ stats: () => ({ mocked: true }) }));
    mg.endSpawnPhase();
    const threshold = (mg.config().gameConfig().maxTimerValue ?? 0) * 600;
    while (mg.ticks() < threshold) {
      mg.executeNextTick();
    }
    winCheck.checkWinnerFFA();
    expect(mg.setWinner).toHaveBeenCalledWith(player, expect.any(Object));
  });

  it("should not set winner if no players", () => {
    mg.players = vi.fn(() => []);
    winCheck.checkWinnerFFA();
    expect(mg.setWinner).not.toHaveBeenCalled();
  });

  it("should return false for activeDuringSpawnPhase", () => {
    expect(winCheck.activeDuringSpawnPhase()).toBe(false);
  });
});

describe("WinCheckExecution - Nation Winners", () => {
  test("should set Nation as winner when reaching 80% territory", async () => {
    // Setup game
    const game = await setup("big_plains", {
      infiniteGold: true,
      gameMode: GameMode.FFA,
      instantBuild: true,
    });

    // Create Nation player
    const nationInfo = new PlayerInfo(
      "TestNation",
      PlayerType.Nation,
      null,
      "nation_id",
    );
    game.addPlayer(nationInfo);
    const nation = game.player("nation_id");

    // Skip spawn phase

    // Assign 81% of land to Nation
    const totalLand = game.numLandTiles();
    const targetTiles = Math.ceil(totalLand * 0.81);
    let assigned = 0;

    game.map().forEachTile((tile) => {
      if (assigned >= targetTiles) return;
      if (!game.map().isLand(tile)) return;
      nation.conquer(tile);
      assigned++;
    });

    // Verify territory ownership
    expect(nation.numTilesOwned()).toBeGreaterThanOrEqual(targetTiles);

    // Mock setWinner to capture calls
    const setWinnerSpy = vi.fn();
    game.setWinner = setWinnerSpy;

    // Initialize and run win check
    const winCheck = new WinCheckExecution();
    winCheck.init(game, 0);
    winCheck.checkWinnerFFA();

    // Verify Nation declared winner
    expect(setWinnerSpy).toHaveBeenCalledWith(nation, expect.anything());
    expect(winCheck.isActive()).toBe(false);
  });

  test("should set Nation as winner when timer expires with most territory", async () => {
    // Setup game with timer
    const game = await setup("big_plains", {
      infiniteGold: true,
      gameMode: GameMode.FFA,
      instantBuild: true,
      maxTimerValue: 5,
    });

    // Create human player
    const humanInfo = new PlayerInfo(
      "HumanPlayer",
      PlayerType.Human,
      null,
      "human_id",
    );
    game.addPlayer(humanInfo);
    const human = game.player("human_id");

    // Create Nation player
    const nationInfo = new PlayerInfo(
      "TestNation",
      PlayerType.Nation,
      null,
      "nation_id",
    );
    game.addPlayer(nationInfo);
    const nation = game.player("nation_id");

    game.endSpawnPhase();

    // Give Nation 60% territory (below 80% threshold)
    // Give human 30% territory
    const totalLand = game.numLandTiles();
    const nationTiles = Math.ceil(totalLand * 0.6);
    const humanTiles = Math.ceil(totalLand * 0.3);
    let nationAssigned = 0;
    let humanAssigned = 0;

    game.map().forEachTile((tile) => {
      if (!game.map().isLand(tile)) return;

      if (nationAssigned < nationTiles) {
        nation.conquer(tile);
        nationAssigned++;
      } else if (humanAssigned < humanTiles) {
        human.conquer(tile);
        humanAssigned++;
      }
    });

    // Verify territory distribution
    expect(nation.numTilesOwned()).toBeGreaterThan(human.numTilesOwned());

    // Fast-forward game ticks past timer expiration
    const threshold = (game.config().gameConfig().maxTimerValue ?? 0) * 600;
    while (game.ticks() < threshold) {
      game.executeNextTick();
    }

    // Mock setWinner to capture calls
    const setWinnerSpy = vi.fn();
    game.setWinner = setWinnerSpy;

    // Initialize and run win check
    const winCheck = new WinCheckExecution();
    winCheck.init(game, game.ticks());
    winCheck.checkWinnerFFA();

    // Verify Nation declared winner (has most territory when timer expires)
    expect(setWinnerSpy).toHaveBeenCalledWith(nation, expect.anything());
    expect(winCheck.isActive()).toBe(false);
  });

  test("should set correct Nation as winner among multiple Nations", async () => {
    // Setup game
    const game = await setup("big_plains", {
      infiniteGold: true,
      gameMode: GameMode.FFA,
      instantBuild: true,
    });

    // Create 3 Nation players
    const nation1Info = new PlayerInfo(
      "Nation1",
      PlayerType.Nation,
      null,
      "nation1_id",
    );
    game.addPlayer(nation1Info);
    const nation1 = game.player("nation1_id");

    const nation2Info = new PlayerInfo(
      "Nation2",
      PlayerType.Nation,
      null,
      "nation2_id",
    );
    game.addPlayer(nation2Info);
    const nation2 = game.player("nation2_id");

    const nation3Info = new PlayerInfo(
      "Nation3",
      PlayerType.Nation,
      null,
      "nation3_id",
    );
    game.addPlayer(nation3Info);
    const nation3 = game.player("nation3_id");

    // Skip spawn phase

    // Assign territories: Nation1 (85%), Nation2 (10%), Nation3 (5%)
    const totalLand = game.numLandTiles();
    const nation1Tiles = Math.ceil(totalLand * 0.85);
    const nation2Tiles = Math.ceil(totalLand * 0.1);
    let nation1Assigned = 0;
    let nation2Assigned = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let nation3Assigned = 0;

    game.map().forEachTile((tile) => {
      if (!game.map().isLand(tile)) return;

      if (nation1Assigned < nation1Tiles) {
        nation1.conquer(tile);
        nation1Assigned++;
      } else if (nation2Assigned < nation2Tiles) {
        nation2.conquer(tile);
        nation2Assigned++;
      } else {
        nation3.conquer(tile);
        nation3Assigned++;
      }
    });

    // Verify territory distribution
    expect(nation1.numTilesOwned()).toBeGreaterThan(nation2.numTilesOwned());
    expect(nation2.numTilesOwned()).toBeGreaterThan(nation3.numTilesOwned());

    // Mock setWinner to capture calls
    const setWinnerSpy = vi.fn();
    game.setWinner = setWinnerSpy;

    // Initialize and run win check
    const winCheck = new WinCheckExecution();
    winCheck.init(game, 0);
    winCheck.checkWinnerFFA();

    // Verify Nation1 (highest territory) declared winner
    expect(setWinnerSpy).toHaveBeenCalledWith(nation1, expect.anything());
    expect(winCheck.isActive()).toBe(false);
  });

  test("should not set winner for bot team in Team mode", async () => {
    // Setup Team mode game
    const game = await setup("big_plains", {
      infiniteGold: true,
      gameMode: GameMode.Team,
      instantBuild: true,
      playerTeams: 2,
    });

    // Create 2 bot players (auto-assigned to Bot team)
    const bot1Info = new PlayerInfo("Bot1", PlayerType.Bot, null, "bot1_id");
    game.addPlayer(bot1Info);
    const bot1 = game.player("bot1_id");

    const bot2Info = new PlayerInfo("Bot2", PlayerType.Bot, null, "bot2_id");
    game.addPlayer(bot2Info);
    const bot2 = game.player("bot2_id");

    // Verify bots are on Bot team
    expect(bot1.team()).toBe(ColoredTeams.Bot);
    expect(bot2.team()).toBe(ColoredTeams.Bot);

    // Skip spawn phase

    // Assign 96% of land to bot team (above the 80% win threshold)
    const totalLand = game.numLandTiles();
    const botTeamTiles = Math.ceil(totalLand * 0.96);
    let bot1Assigned = 0;
    let bot2Assigned = 0;

    game.map().forEachTile((tile) => {
      if (!game.map().isLand(tile)) return;
      const totalAssigned = bot1Assigned + bot2Assigned;
      if (totalAssigned >= botTeamTiles) return;

      // Alternate between bots
      if (bot1Assigned <= bot2Assigned) {
        bot1.conquer(tile);
        bot1Assigned++;
      } else {
        bot2.conquer(tile);
        bot2Assigned++;
      }
    });

    // Verify territory ownership (bot team is above the 80% win threshold)
    const botTeamTotal = bot1.numTilesOwned() + bot2.numTilesOwned();
    expect(botTeamTotal / totalLand).toBeGreaterThan(0.8);

    // Mock setWinner to capture calls
    const setWinnerSpy = vi.fn();
    game.setWinner = setWinnerSpy;

    // Initialize and run win check
    const winCheck = new WinCheckExecution();
    winCheck.init(game, 0);
    winCheck.checkWinnerTeam();

    // Verify no winner declared (bot teams excluded)
    expect(setWinnerSpy).not.toHaveBeenCalled();
    expect(winCheck.isActive()).toBe(true);
  });
});

describe("WinCheckExecution - Overtime", () => {
  test("win threshold decays after the start minute", async () => {
    const game = await setup("big_plains", {
      gameMode: GameMode.FFA,
      overtime: { enabled: true, startMinutes: 1 },
    });
    const config = game.config();
    expect(config.percentageTilesOwnedToWin(0)).toBe(80);
    // Unchanged up to and including the start minute.
    expect(config.percentageTilesOwnedToWin(60)).toBe(80);
    // Whole percentage points only: 2%/min -> one 1% step every 30 seconds.
    expect(config.percentageTilesOwnedToWin(89)).toBe(80);
    expect(config.percentageTilesOwnedToWin(90)).toBe(79);
    expect(config.percentageTilesOwnedToWin(119)).toBe(79);
    expect(config.percentageTilesOwnedToWin(60 + 5 * 60)).toBe(70);
    // No floor: clamps at 0 so the leader always qualifies eventually.
    expect(config.percentageTilesOwnedToWin(60 + 41 * 60)).toBe(0);
  });

  test("threshold never decays when the mode is off", async () => {
    const game = await setup("big_plains", { gameMode: GameMode.FFA });
    expect(game.config().percentageTilesOwnedToWin(10_000)).toBe(80);
  });

  test("team games use the same base and decay as FFA", async () => {
    const game = await setup("big_plains", {
      gameMode: GameMode.Team,
      playerTeams: 2,
      overtime: { enabled: true, startMinutes: 1 },
    });
    expect(game.config().percentageTilesOwnedToWin(0)).toBe(80);
    expect(game.config().percentageTilesOwnedToWin(60 + 5 * 60)).toBe(70);
  });

  test("a null maxTimerValue is no timer, not a zero-minute one", async () => {
    // Host lobbies send null when the max-timer toggle is off.
    const game = await setup("big_plains", {
      gameMode: GameMode.FFA,
      maxTimerValue: null,
    });
    const nationInfo = new PlayerInfo(
      "TestNation",
      PlayerType.Nation,
      null,
      "nation_id",
    );
    game.addPlayer(nationInfo);
    const nation = game.player("nation_id");
    let assigned = 0;
    game.map().forEachTile((tile) => {
      if (assigned >= 10) return;
      if (!game.map().isLand(tile)) return;
      nation.conquer(tile);
      assigned++;
    });

    const winCheck = new WinCheckExecution();
    winCheck.init(game, 0);
    winCheck.checkWinnerFFA();
    expect(game.getWinner()).toBeNull();
    expect(winCheck.isActive()).toBe(true);
  });

  test("leader wins once the shrinking bar drops below their share", async () => {
    const game = await setup("big_plains", {
      gameMode: GameMode.FFA,
      overtime: { enabled: true, startMinutes: 1 },
    });

    // 79% of the land: under the 80% base, so no win until the bar shrinks.
    const nationInfo = new PlayerInfo(
      "TestNation",
      PlayerType.Nation,
      null,
      "nation_id",
    );
    game.addPlayer(nationInfo);
    const nation = game.player("nation_id");
    const totalLand = game.numLandTiles();
    const targetTiles = Math.floor(totalLand * 0.79);
    let assigned = 0;
    game.map().forEachTile((tile) => {
      if (assigned >= targetTiles) return;
      if (!game.map().isLand(tile)) return;
      nation.conquer(tile);
      assigned++;
    });

    const setWinnerSpy = vi.fn();
    game.setWinner = setWinnerSpy;
    const winCheck = new WinCheckExecution();
    winCheck.init(game, 0);

    winCheck.checkWinnerFFA();
    expect(setWinnerSpy).not.toHaveBeenCalled();
    expect(winCheck.isActive()).toBe(true);

    // Two game-minutes in, the bar is 78% — below the nation's 79%.
    while (game.elapsedGameSeconds() < 120) {
      game.executeNextTick();
    }
    winCheck.checkWinnerFFA();
    expect(setWinnerSpy).toHaveBeenCalledWith(nation, expect.anything());
    expect(winCheck.isActive()).toBe(false);
  });
});
