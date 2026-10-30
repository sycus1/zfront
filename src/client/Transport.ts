import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  AllPlayers,
  Gold,
  PlayerID,
  Tick,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  AllPlayersStats,
  ClientID,
  Intent,
  Winner,
} from "@openfront/engine-api/Schemas";
import {
  EventBus,
  EventConstructor,
  GameEvent,
} from "@openfront/shared/EventBus";
import {
  ClientHashMessage,
  ClientIntentMessage,
  ClientJoinMessage,
  ClientMessage,
  ClientRejoinMessage,
  ClientSendLiveStatsMessage,
  ClientSendWinnerMessage,
  LiveStats,
  ReportReason,
  ServerMessage,
} from "@openfront/shared/WireSchemas";
import { ClientEnv } from "src/client/ClientEnv";
import { LobbyConfig } from "./ClientGameRunner";
import { LocalServer } from "./LocalServer";
import { PlayerView } from "./view";

/** zfront: call the announced horde wave now. */
export class SendCallWaveIntentEvent implements GameEvent {}

/** zfront: start looting a horde supply crate. */
export class SendLootCrateIntentEvent implements GameEvent {
  constructor(public readonly crate: number) {}
}

export class PauseGameIntentEvent implements GameEvent {
  constructor(public readonly paused: boolean) {}
}

export class SendUpgradeStructureIntentEvent implements GameEvent {
  constructor(
    public readonly unitId: number,
    public readonly unitType: UnitType,
    public readonly amount: number = 1,
  ) {}
}

export class SendSpawnIntentEvent implements GameEvent {
  constructor(public readonly tile: TileRef) {}
}

export class SendAttackIntentEvent implements GameEvent {
  constructor(
    public readonly targetID: PlayerID | null,
    public readonly troops: number,
  ) {}
}

/**
 * Troops for a counter-attack: the incoming attack's size, capped at what the
 * player would send. An attack whose count is not a finite number is ignored
 * rather than turning the whole intent into NaN.
 */
export function counterAttackTroops(
  incomingTroops: number,
  available: number,
): number {
  if (!Number.isFinite(incomingTroops)) return available;
  return Math.min(incomingTroops, available);
}

export class SendBoatAttackIntentEvent implements GameEvent {
  constructor(
    public readonly dst: TileRef,
    public readonly troops: number,
  ) {}
}

export class BuildUnitIntentEvent implements GameEvent {
  constructor(
    public readonly unit: UnitType,
    public readonly tile: TileRef,
    public readonly rocketDirectionUp?: boolean,
    public readonly amount?: number,
  ) {}
}

export class SendTargetPlayerIntentEvent implements GameEvent {
  constructor(public readonly targetID: PlayerID) {}
}

export class SendEmojiIntentEvent implements GameEvent {
  constructor(
    public readonly recipient: PlayerView | typeof AllPlayers,
    public readonly emoji: number,
  ) {}
}

export class SendDonateGoldIntentEvent implements GameEvent {
  constructor(
    public readonly recipient: PlayerView,
    public readonly gold: Gold | null,
  ) {}
}

export class SendDonateTroopsIntentEvent implements GameEvent {
  constructor(
    public readonly recipient: PlayerView,
    public readonly troops: number | null,
  ) {}
}

export class SendQuickChatEvent implements GameEvent {
  constructor(
    public readonly recipient: PlayerView,
    public readonly quickChatKey: string,
    public readonly target?: PlayerID,
  ) {}
}

export class SendDeleteUnitIntentEvent implements GameEvent {
  constructor(public readonly unitId: number) {}
}

export class CancelAttackIntentEvent implements GameEvent {
  constructor(public readonly attackID: string) {}
}

export class CancelBoatIntentEvent implements GameEvent {
  constructor(public readonly unitID: number) {}
}

export class SendWinnerEvent implements GameEvent {
  constructor(
    public readonly winner: Winner,
    public readonly allPlayersStats: AllPlayersStats,
  ) {}
}
export class SendLiveStatsEvent implements GameEvent {
  constructor(public readonly stats: LiveStats) {}
}
export class SendPlayerReportEvent implements GameEvent {
  constructor(
    public readonly reported: ClientID,
    public readonly reason: ReportReason,
  ) {}
}
// Emitted once a report has actually gone to the server, so the UI only
// marks a player as reported when it has been.
export class PlayerReportedEvent implements GameEvent {
  constructor(public readonly reported: ClientID) {}
}
export class SendHashEvent implements GameEvent {
  constructor(
    public readonly tick: Tick,
    public readonly hash: number,
  ) {}
}

// Emitted when the server tells us the host started a successor lobby, carrying
// the new game id to move the group to.
export class NewLobbyEvent implements GameEvent {
  constructor(public readonly gameID: string) {}
}

export class MoveWarshipIntentEvent implements GameEvent {
  constructor(
    public readonly unitIds: number[],
    public readonly tile: number,
  ) {}
}

export class Transport {
  private localServer: LocalServer;

  private onconnect: () => void;
  private onmessage: (msg: ServerMessage) => void;

  // Every game is local: the engine runs in this tab and LocalServer stands in
  // for the server.
  public readonly isLocal = true;

  // The bus outlives the transport (one per page, one transport per join),
  // so every subscription must be undone in leaveGame or a superseded
  // transport keeps answering the live game's events.
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    private lobbyConfig: LobbyConfig,
    private eventBus: EventBus,
  ) {
    this.subscribe(SendSpawnIntentEvent, (e) => this.onSendSpawnIntentEvent(e));
    this.subscribe(SendAttackIntentEvent, (e) => this.onSendAttackIntent(e));
    this.subscribe(SendUpgradeStructureIntentEvent, (e) =>
      this.onSendUpgradeStructureIntent(e),
    );
    this.subscribe(SendBoatAttackIntentEvent, (e) =>
      this.onSendBoatAttackIntent(e),
    );
    this.subscribe(SendTargetPlayerIntentEvent, (e) =>
      this.onSendTargetPlayerIntent(e),
    );
    this.subscribe(SendEmojiIntentEvent, (e) => this.onSendEmojiIntent(e));
    this.subscribe(SendDonateGoldIntentEvent, (e) =>
      this.onSendDonateGoldIntent(e),
    );
    this.subscribe(SendDonateTroopsIntentEvent, (e) =>
      this.onSendDonateTroopIntent(e),
    );
    this.subscribe(SendQuickChatEvent, (e) => this.onSendQuickChatIntent(e));
    this.subscribe(BuildUnitIntentEvent, (e) => this.onBuildUnitIntent(e));

    this.subscribe(PauseGameIntentEvent, (e) => this.onPauseGameIntent(e));
    this.subscribe(SendCallWaveIntentEvent, () =>
      this.sendIntent({ type: "call_wave" }),
    );
    this.subscribe(SendLootCrateIntentEvent, (e) =>
      this.sendIntent({ type: "loot_crate", crate: e.crate }),
    );
    this.subscribe(SendWinnerEvent, (e) => this.onSendWinnerEvent(e));
    this.subscribe(SendLiveStatsEvent, (e) => this.onSendLiveStatsEvent(e));
    this.subscribe(SendHashEvent, (e) => this.onSendHashEvent(e));
    this.subscribe(CancelAttackIntentEvent, (e) =>
      this.onCancelAttackIntentEvent(e),
    );
    this.subscribe(CancelBoatIntentEvent, (e) =>
      this.onCancelBoatIntentEvent(e),
    );

    this.subscribe(MoveWarshipIntentEvent, (e) => {
      this.onMoveWarshipEvent(e);
    });

    this.subscribe(SendDeleteUnitIntentEvent, (e) =>
      this.onSendDeleteUnitIntent(e),
    );
  }

  private subscribe<T extends GameEvent>(
    eventType: EventConstructor<T>,
    handler: (event: T) => void,
  ) {
    this.eventBus.on(eventType, handler);
    this.unsubscribers.push(() => this.eventBus.off(eventType, handler));
  }

  public connect(
    onconnect: () => void,
    onmessage: (message: ServerMessage) => void,
  ) {
    this.onconnect = onconnect;
    this.onmessage = onmessage;
    this.localServer = new LocalServer(
      this.lobbyConfig,
      this.lobbyConfig.gameRecord !== undefined,
      this.eventBus,
    );
    this.localServer.updateCallback(onconnect, onmessage);
    this.localServer.start();
  }

  public updateCallback(
    onconnect: () => void,
    onmessage: (message: ServerMessage) => void,
  ) {
    this.onconnect = onconnect;
    this.onmessage = onmessage;
    this.localServer.updateCallback(onconnect, onmessage);
  }

  public reconnect() {
    this.connect(this.onconnect, this.onmessage);
  }

  public turnComplete() {
    this.localServer.turnComplete();
  }

  async joinGame() {
    this.sendMsg({
      type: "join",
      gameID: this.lobbyConfig.gameID,
      username: this.lobbyConfig.playerName,
      cosmetics: this.lobbyConfig.cosmetics,
      turnstileToken: null,
      token: "",
      spectator: this.lobbyConfig.spectator,
      gitCommit: ClientEnv.gitCommit(),
    } satisfies ClientJoinMessage);
  }

  async rejoinGame(lastTurn: number) {
    this.sendMsg({
      type: "rejoin",
      gameID: this.lobbyConfig.gameID,
      lastTurn: lastTurn,
      token: "",
      gitCommit: ClientEnv.gitCommit(),
    } satisfies ClientRejoinMessage);
  }

  leaveGame() {
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe();
    }
    this.localServer.endGame();
  }

  private onSendSpawnIntentEvent(event: SendSpawnIntentEvent) {
    this.sendIntent({
      type: "spawn",
      tile: event.tile,
    });
  }

  private onSendAttackIntent(event: SendAttackIntentEvent) {
    if (!this.isSendableTroops("attack", event.troops)) return;
    this.sendIntent({
      type: "attack",
      targetID: event.targetID,
      troops: event.troops,
    });
  }

  private onSendBoatAttackIntent(event: SendBoatAttackIntentEvent) {
    if (!this.isSendableTroops("boat", event.troops)) return;
    this.sendIntent({
      type: "boat",
      troops: event.troops,
      dst: event.dst,
    });
  }

  private onSendUpgradeStructureIntent(event: SendUpgradeStructureIntentEvent) {
    this.sendIntent({
      type: "upgrade_structure",
      unit: event.unitType,
      unitId: event.unitId,
      amount: event.amount,
    });
  }

  private onSendTargetPlayerIntent(event: SendTargetPlayerIntentEvent) {
    this.sendIntent({
      type: "targetPlayer",
      target: event.targetID,
    });
  }

  private onSendEmojiIntent(event: SendEmojiIntentEvent) {
    this.sendIntent({
      type: "emoji",
      recipient:
        event.recipient === AllPlayers ? AllPlayers : event.recipient.id(),
      emoji: event.emoji,
    });
  }

  private onSendDonateGoldIntent(event: SendDonateGoldIntentEvent) {
    this.sendIntent({
      type: "donate_gold",
      recipient: event.recipient.id(),
      gold: event.gold ? Number(event.gold) : null,
    });
  }

  private onSendDonateTroopIntent(event: SendDonateTroopsIntentEvent) {
    this.sendIntent({
      type: "donate_troops",
      recipient: event.recipient.id(),
      troops: event.troops,
    });
  }

  private onSendQuickChatIntent(event: SendQuickChatEvent) {
    this.sendIntent({
      type: "quick_chat",
      recipient: event.recipient.id(),
      quickChatKey: event.quickChatKey,
      target: event.target,
    });
  }

  private onBuildUnitIntent(event: BuildUnitIntentEvent) {
    this.sendIntent({
      type: "build_unit",
      unit: event.unit,
      tile: event.tile,
      rocketDirectionUp: event.rocketDirectionUp,
      amount: event.amount,
    });
  }

  private onPauseGameIntent(event: PauseGameIntentEvent) {
    this.sendIntent({
      type: "toggle_pause",
      paused: event.paused,
    });
  }

  private onSendWinnerEvent(event: SendWinnerEvent) {
    this.sendMsg({
      type: "winner",
      winner: event.winner,
      allPlayersStats: event.allPlayersStats,
    } satisfies ClientSendWinnerMessage);
  }

  private onSendLiveStatsEvent(event: SendLiveStatsEvent) {
    this.sendMsg({
      type: "live_stats",
      stats: event.stats,
    } satisfies ClientSendLiveStatsMessage);
  }

  private onSendHashEvent(event: SendHashEvent) {
    this.sendMsg({
      type: "hash",
      turnNumber: event.tick,
      hash: event.hash,
    } satisfies ClientHashMessage);
  }

  private onCancelAttackIntentEvent(event: CancelAttackIntentEvent) {
    this.sendIntent({
      type: "cancel_attack",
      attackID: event.attackID,
    });
  }

  private onCancelBoatIntentEvent(event: CancelBoatIntentEvent) {
    this.sendIntent({
      type: "cancel_boat",
      unitID: event.unitID,
    });
  }

  private onMoveWarshipEvent(event: MoveWarshipIntentEvent) {
    this.sendIntent({
      type: "move_warship",
      unitIds: event.unitIds,
      tile: event.tile,
    });
  }

  private onSendDeleteUnitIntent(event: SendDeleteUnitIntentEvent) {
    this.sendIntent({
      type: "delete_unit",
      unitId: event.unitId,
    });
  }

  // The intent schemas take troops as a finite float >= 0, and the server
  // kicks a client whose message fails to parse. Drop the one intent instead,
  // and log it with a stack (console.error reaches telemetry) so the caller
  // that produced the bad count shows up.
  private isSendableTroops(type: Intent["type"], troops: number): boolean {
    if (Number.isFinite(troops) && troops >= 0) return true;
    console.error(
      new Error(`Dropped ${type} intent with invalid troops: ${troops}`),
    );
    return false;
  }

  private sendIntent(intent: Intent) {
    const msg = {
      type: "intent",
      intent: intent,
    } satisfies ClientIntentMessage;
    this.sendMsg(msg);
  }

  private sendMsg(msg: ClientMessage): void {
    // Routed to the in-process server; nothing goes over the wire.
    this.localServer.onMessage(msg);
  }
}
