import { TileRef } from "@openfront/engine-api/game/GameMap";
import { EventBus } from "@openfront/shared/EventBus";
import {
  SendAttackIntentEvent,
  SendBoatAttackIntentEvent,
  SendDeleteUnitIntentEvent,
  SendDonateGoldIntentEvent,
  SendDonateTroopsIntentEvent,
  SendEmojiIntentEvent,
  SendSpawnIntentEvent,
  SendTargetPlayerIntentEvent,
} from "../../Transport";
import { UIState } from "../../UIState";
import { PlayerView } from "../../view";

export class PlayerActionHandler {
  constructor(
    private eventBus: EventBus,
    private uiState: UIState,
  ) {}

  handleAttack(player: PlayerView, targetId: string | null) {
    this.eventBus.emit(
      new SendAttackIntentEvent(
        targetId,
        this.uiState.attackRatio * player.troops(),
      ),
    );
  }

  handleBoatAttack(player: PlayerView, targetTile: TileRef) {
    this.eventBus.emit(
      new SendBoatAttackIntentEvent(
        targetTile,
        this.uiState.attackRatio * player.troops(),
      ),
    );
  }

  async findBestTransportShipSpawn(
    player: PlayerView,
    tile: TileRef,
  ): Promise<TileRef | false> {
    return await player.bestTransportShipSpawn(tile);
  }

  handleSpawn(tile: TileRef) {
    this.eventBus.emit(new SendSpawnIntentEvent(tile));
  }

  handleTargetPlayer(targetId: string | null) {
    if (!targetId) return;

    this.eventBus.emit(new SendTargetPlayerIntentEvent(targetId));
  }

  handleDonateGold(recipient: PlayerView) {
    this.eventBus.emit(new SendDonateGoldIntentEvent(recipient, null));
  }

  handleDonateTroops(recipient: PlayerView, troops?: number) {
    const amount = troops ?? null;
    if (amount !== null && amount <= 0) {
      return;
    }
    this.eventBus.emit(new SendDonateTroopsIntentEvent(recipient, amount));
  }

  handleEmoji(targetPlayer: PlayerView | "AllPlayers", emojiIndex: number) {
    this.eventBus.emit(new SendEmojiIntentEvent(targetPlayer, emojiIndex));
  }

  handleDeleteUnit(unitId: number) {
    this.eventBus.emit(new SendDeleteUnitIntentEvent(unitId));
  }
}
