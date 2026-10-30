import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ClientGameRunner's server-message handling, driven through captured
// callbacks: the lobby-phase onmessage joinLobby installs on the transport,
// the in-game onmessage ClientGameRunner.start installs, and the worker
// update callback. Heavy renderer/audio/worker modules are mocked at import.

const captured = vi.hoisted(() => ({
  lobbyOnConnect: undefined as (() => void) | undefined,
  lobbyOnMessage: undefined as ((msg: unknown) => void) | undefined,
}));

const envMocks = vi.hoisted(() => ({
  resolveGame: vi.fn((): unknown => ({ kind: "own" })),
  // A label naming no commit matches any server (versionMatches), so the
  // versioned-page branch never fires: what most of this file wants. The
  // versioned-page tests set a real sha.
  gitCommit: vi.fn(() => "test-commit"),
  gameVersion: vi.fn((_gameID: string): string | undefined => undefined),
}));

vi.mock("../../src/client/ClientEnv", () => ({
  ClientEnv: {
    gitCommit: envMocks.gitCommit,
    resolveGame: envMocks.resolveGame,
    gameVersion: envMocks.gameVersion,
    gamePath: (gameID: string) => `/w0/game/${gameID}`,
  },
}));
vi.mock("../../src/client/Auth", () => ({
  getPlayToken: async () => "8f1d2c3e-4b5a-4c6d-8e7f-90a1b2c3d4e5",
}));
vi.mock("../../src/client/LocalServer", () => ({
  LocalServer: class {},
}));
vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn(async () => {}),
  showInGameConfirm: vi.fn(async () => false),
}));
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
  reloadForUpdate: vi.fn(),
  createCanvas: () => document.createElement("canvas"),
  homeHref: () => "/",
}));
vi.mock("../../src/client/TerrainMapFileLoader", () => ({
  terrainMapFileLoader: {},
  loadCachedTerrainMap: vi.fn(async () => ({}) as never),
}));
vi.mock("../../src/client/hud/GameRenderer", () => ({
  createRenderer: vi.fn(),
}));
vi.mock("../../src/client/hud/layers/lib/GoldRateTracker", () => ({
  goldRateTracker: { resetAll: vi.fn() },
}));
vi.mock("../../src/client/theme/ThemeProvider", () => ({
  themeProvider: { reset: vi.fn() },
}));
vi.mock("../../src/client/sound/SoundManager", () => ({
  SoundManager: class {},
}));
vi.mock("../../src/client/render/gl", () => ({
  GLUnavailableError: class extends Error {},
  MapRenderer: class {},
  applyGraphicsOverrides: vi.fn(),
  createRenderSettings: vi.fn(() => ({})),
  deepAssign: vi.fn(),
  preloadAtlasData: vi.fn(async () => {}),
  renderDpr: () => 1,
  showGLGate: vi.fn(),
  trackGLInit: vi.fn(),
}));
vi.mock("../../src/client/WebGLFrameBuilder", () => ({
  WebGLFrameBuilder: class {},
}));
vi.mock("../../src/client/controllers/MapLayerController", () => ({
  MapLayerController: class {},
}));
vi.mock("../../src/client/view", () => ({
  GameView: class {},
  PlayerView: class {},
}));
vi.mock("../../src/client/WorkerClient", () => ({
  WorkerClient: class {},
}));
vi.mock("../../src/client/Transport", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/client/Transport")>();
  class MockTransport {
    constructor(..._args: unknown[]) {}
    connect(onconnect: () => void, onmessage: (msg: unknown) => void) {
      captured.lobbyOnConnect = onconnect;
      captured.lobbyOnMessage = onmessage;
    }
    joinGame() {}
    leaveGame() {}
  }
  return { ...actual, Transport: MockTransport };
});

import {
  ClientGameRunner,
  joinLobby,
  LobbyConfig,
} from "../../src/client/ClientGameRunner";
import { loadCachedTerrainMap } from "../../src/client/TerrainMapFileLoader";
import { SendHashEvent } from "../../src/client/Transport";

function makeLobbyConfig(withStartInfo: boolean): LobbyConfig {
  return {
    gameID: "game1234",
    playerName: "tester",
    playerClanTag: null,
    playerRole: null,
    turnstileToken: null,
    cosmetics: {},
    ...(withStartInfo
      ? { gameStartInfo: { gameID: "game1234", config: {} } }
      : {}),
  } as unknown as LobbyConfig;
}

// Builds a runner around fully mocked collaborators, starts it, and returns
// the callbacks start() handed to the transport and the worker.
function makeStartedRunner(
  withStartInfo: boolean,
  opts: { isLocal?: boolean; metrics?: object } = {},
) {
  const eventBus = new EventBus();
  const emitSpy = vi.spyOn(eventBus, "emit");
  const worker = { start: vi.fn(), sendTurn: vi.fn(), cleanup: vi.fn() };
  const transport = {
    updateCallback: vi.fn(),
    rejoinGame: vi.fn(),
    turnComplete: vi.fn(),
    leaveGame: vi.fn(),
    isLocal: opts.isLocal ?? true,
  };
  const renderer = {
    initialize: vi.fn(),
    tick: vi.fn(),
    uiState: { attackRatio: 0.5, ghostStructure: null },
    transformHandler: { screenToWorldCoordinates: vi.fn() },
  };
  const gameView = {
    config: () => ({
      isRandomSpawn: () => false,
      isReplay: () => false,
      horde: () => false,
    }),
    inSpawnPhase: () => false,
    myPlayer: () => null,
    update: vi.fn(),
  };
  const soundManager = { playBackgroundMusic: vi.fn(), dispose: vi.fn() };
  const userSettings = { goToPlayer: () => false };

  const runner = new ClientGameRunner(
    makeLobbyConfig(withStartInfo),
    "c0000001",
    eventBus,
    renderer as never,
    { initialize: vi.fn(), destroy: vi.fn() } as never,
    transport as never,
    worker as never,
    gameView as never,
    soundManager as never,
    userSettings as never,
    null,
    null,
    null,
  );
  runner.start();

  const workerCallback = worker.start.mock.calls[0][0] as (gu: unknown) => void;
  const onmessage = transport.updateCallback.mock.calls[0][1] as (
    msg: unknown,
  ) => void;
  return {
    runner,
    worker,
    transport,
    gameView,
    emitSpy,
    workerCallback,
    onmessage,
  };
}

const errorModalText = () =>
  document.querySelector("#error-modal pre")?.textContent ?? "";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  captured.lobbyOnConnect = undefined;
  captured.lobbyOnMessage = undefined;
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("joinLobby lobby-phase messages", () => {
  it("preloads the terrain and resolves prestart on a prestart message", async () => {
    const result = joinLobby(new EventBus(), makeLobbyConfig(false));

    captured.lobbyOnMessage!({
      type: "prestart",
      gameMap: "world",
      gameMapSize: "medium",
    });

    await expect(result.prestart).resolves.toBeUndefined();
    expect(loadCachedTerrainMap).toHaveBeenCalledWith("world", "medium");
  });

  it("shows the connection-error modal when start carries no gameStartInfo", async () => {
    const result = joinLobby(new EventBus(), makeLobbyConfig(false));

    captured.lobbyOnMessage!({
      type: "start",
      myClientID: "c0000001",
      turns: [],
      gameStartInfo: undefined,
    });

    await expect(result.join).resolves.toBeUndefined();
    await vi.waitFor(() =>
      expect(document.querySelector("#error-modal")).not.toBeNull(),
    );
    expect(errorModalText()).toContain("error_modal.connection_error");
    expect(errorModalText()).toContain("game id: game1234");
    expect(errorModalText()).toContain("Error: missing gameStartInfo");
  });
});

describe("ClientGameRunner in-game messages", () => {
  it("forwards buffered turns to the worker on a start message", () => {
    const { worker, onmessage } = makeStartedRunner(true);
    const turns = [
      { turnNumber: 0, intents: [] },
      { turnNumber: 1, intents: [] },
    ];

    onmessage({ type: "start", turns });

    expect(worker.sendTurn).toHaveBeenCalledTimes(2);
    expect(worker.sendTurn).toHaveBeenNthCalledWith(1, turns[0]);
    expect(worker.sendTurn).toHaveBeenNthCalledWith(2, turns[1]);
  });

  it("shows the desync modal on a desync message", () => {
    const { onmessage } = makeStartedRunner(true);

    onmessage({ type: "desync" });

    expect(errorModalText()).toContain("error_modal.desync_notice");
    expect(errorModalText()).toContain("game id: game1234");
    expect(errorModalText()).toContain("client id: c0000001");
  });

  it("throws on a desync message when gameStartInfo is missing", () => {
    const { onmessage } = makeStartedRunner(false);

    expect(() => onmessage({ type: "desync" })).toThrow(
      "missing gameStartInfo",
    );
  });

  it("forwards a matching turn and rejects a wrong turn number", () => {
    const { worker, onmessage } = makeStartedRunner(true);
    const turn = { turnNumber: 0, intents: [] };

    onmessage({ type: "start", turns: [] });
    onmessage({ type: "turn", turn });
    expect(worker.sendTurn).toHaveBeenCalledWith(turn);

    onmessage({ type: "turn", turn: { turnNumber: 5, intents: [] } });
    expect(worker.sendTurn).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      "got wrong turn have turns 1, received turn 5",
    );
  });

  // The (re)join's start message replays every turn so far, so live turns
  // that beat it there are expected to be dropped: debug, not an error.
  it("only logs a wrong turn at debug while a start message is awaited", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const { worker, transport, onmessage } = makeStartedRunner(true);
    const onconnect = transport.updateCallback.mock.calls[0][0] as () => void;

    onmessage({ type: "turn", turn: { turnNumber: 3, intents: [] } });
    expect(debug).toHaveBeenCalledWith(
      "got wrong turn have turns 0, received turn 3",
    );

    const turns = [0, 1, 2, 3].map((turnNumber) => ({
      turnNumber,
      intents: [],
    }));
    onmessage({ type: "start", turns });
    expect(worker.sendTurn).toHaveBeenCalledTimes(4);

    onconnect();
    onmessage({ type: "turn", turn: { turnNumber: 6, intents: [] } });
    expect(debug).toHaveBeenCalledWith(
      "got wrong turn have turns 4, received turn 6",
    );
    expect(console.error).not.toHaveBeenCalled();
  });

  it("processes a worker game update: turnComplete, hash events, render tick", () => {
    const { worker, transport, gameView, emitSpy, workerCallback } =
      makeStartedRunner(true);
    void worker;

    workerCallback({
      updates: { [GameUpdateType.Hash]: [{ tick: 3, hash: 42 }] },
      tickExecutionDuration: 1,
    });

    expect(transport.turnComplete).toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith(new SendHashEvent(3, 42));
    expect(gameView.update).toHaveBeenCalled();
  });

  it("does not measure the tick interval of a local game", () => {
    const metrics = {
      start: vi.fn(),
      stop: vi.fn(),
      recordTickExecution: vi.fn(),
      recordTickInterval: vi.fn(),
    };
    const { onmessage } = makeStartedRunner(true, { isLocal: true, metrics });
    onmessage({ type: "turn", turn: { turnNumber: 0, intents: [] } });
    onmessage({ type: "turn", turn: { turnNumber: 1, intents: [] } });
    expect(metrics.recordTickInterval).not.toHaveBeenCalled();
  });

  it("shows the crash modal and stops on a worker error update", () => {
    const { worker, transport, workerCallback } = makeStartedRunner(true);

    workerCallback({ errMsg: "boom", stack: "trace" });

    expect(errorModalText()).toContain("Error: boom");
    expect(worker.cleanup).toHaveBeenCalled();
    expect(transport.leaveGame).toHaveBeenCalled();
  });

  it("throws on a worker update when gameStartInfo is missing", () => {
    const { workerCallback } = makeStartedRunner(false);

    expect(() => workerCallback({ errMsg: "boom" })).toThrow(
      "missing gameStartInfo",
    );
  });
});

// A version mismatch on a page pinned under /v/<commit>/ (multi-server v2).
// Reloading is the one thing that must not happen there: reloadForUpdate
// strips the pin, landing on `latest`, whose handleUrl sees the same game on
// the same older server and pins the page straight back -- one lap per click.

// The first choice on a web mismatch: this host serves every version under
// `/v/<commit>/`, one same-origin navigation away, where the cross-host
// fallback costs a full shell boot (OPE-471).
