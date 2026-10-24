import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  AllPlayers,
  GameType,
  PlayerActions,
  PlayerProfile,
  PlayerType,
  Relation,
} from "@openfront/engine-api/game/GameTypes";
import { Emoji, flattenedEmojiTable } from "@openfront/engine-api/Schemas";
import { renderNumber, renderTroops } from "@openfront/engine-lib/Format";
import { assetUrl } from "@openfront/shared/AssetUrls";
import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import Countries from "resources/countries.json" with { type: "json" };
import { actionButton } from "../../components/ui/ActionButton";
import "../../components/ui/Divider";
import { Controller } from "../../Controller";
import {
  CloseViewEvent,
  MouseUpEvent,
  SwapRocketDirectionEvent,
} from "../../InputHandler";
import {
  PlayerReportedEvent,
  SendEmojiIntentEvent,
  SendTargetPlayerIntentEvent,
} from "../../Transport";
import { UIState } from "../../UIState";
import { UserSettings } from "../../UserSettings";
import { showToast, translateText } from "../../Utils";
import { GameView, PlayerView } from "../../view";
import { ChatModal } from "./ChatModal";
import { EmojiTable } from "./EmojiTable";
import "./PlayerModerationModal";
import "./PlayerReportModal";
import "./SendResourceModal";
const chatIcon = assetUrl("images/ChatIconWhite.svg");
const donateGoldIcon = assetUrl("images/DonateGoldIconWhite.svg");
const donateTroopIcon = assetUrl("images/DonateTroopIconWhite.svg");
const emojiIcon = assetUrl("images/EmojiIconWhite.svg");
const reportIcon = assetUrl("images/SirenIconWhite.svg");
const shieldIcon = assetUrl("images/ShieldIconWhite.svg");
const targetIcon = assetUrl("images/TargetIconWhite.svg");

@customElement("player-panel")
export class PlayerPanel extends LitElement implements Controller {
  public g: GameView;
  public eventBus: EventBus;
  public emojiTable: EmojiTable;
  public uiState: UIState;

  private actions: PlayerActions | null = null;
  private tile: TileRef | null = null;
  private _profileForPlayerId: number | null = null;
  private kickedPlayerIDs = new Set<string>();
  private userSettings = new UserSettings();

  @state() private sendTarget: PlayerView | null = null;
  @state() private sendMode: "troops" | "gold" | "none" = "none";
  @state() public isVisible: boolean = false;
  @state() private otherProfile: PlayerProfile | null = null;
  @state() private suppressNextHide: boolean = false;
  @state() private moderationTarget: PlayerView | null = null;
  @state() private reportTarget: PlayerView | null = null;
  // clientIDs this client has reported this game (confirmed sent by
  // Transport); the button locks after one.
  private reportedClientIDs = new Set<string>();
  @state() private playerRole: string | null = null;
  // Whether this game is a publicly listed lobby. Kept out of
  // GameStartInfo (never touches records), so it's fetched from the worker.
  @state() private gameListed = false;
  // Fallback for the viewer's own badge when this tab never saw the lobby
  // roster (a refresh or late join goes straight into the game).

  setRole(role: string | null): void {
    this.playerRole = role;
  }

  private get isAdminRole(): boolean {
    return this.playerRole === "admin" || this.playerRole === "root";
  }

  private ctModal: ChatModal;

  createRenderRoot() {
    return this;
  }

  initEventBus(eventBus: EventBus) {
    this.eventBus = eventBus;
    eventBus.on(CloseViewEvent, (e) => {
      if (this.isVisible) {
        this.hide();
      }
    });
    eventBus.on(SwapRocketDirectionEvent, (event) => {
      this.uiState.rocketDirectionUp = event.rocketDirectionUp;
      this.requestUpdate();
    });
    eventBus.on(PlayerReportedEvent, (event) => {
      this.reportedClientIDs.add(event.reported);
      this.requestUpdate();
      showToast(translateText("player_panel.report_sent"), "green");
    });
  }
  init() {
    this.eventBus.on(MouseUpEvent, () => {
      if (this.suppressNextHide) {
        this.suppressNextHide = false;
        return;
      }
      this.hide();
    });

    this.ctModal = document.querySelector("chat-modal") as ChatModal;
    if (!this.ctModal) {
      console.warn("ChatModal element not found in DOM");
    }
  }

  async tick() {
    if (this.isVisible && this.tile) {
      const owner = this.g.owner(this.tile);
      if (owner && owner.isPlayer()) {
        const pv = owner as PlayerView;
        const id = pv.id();
        // fetch only if we don't have it or the player changed
        if (this._profileForPlayerId !== Number(id)) {
          this.otherProfile = await pv.profile();
          this._profileForPlayerId = Number(id);
        }
      }

      // Refresh actions
      const myPlayer = this.g.myPlayer();
      if (myPlayer !== null && myPlayer.isAlive()) {
        try {
          this.actions = await myPlayer.actions(this.tile, null);
        } catch (error) {
          console.warn("Failed to refresh player panel actions:", error);
        }
      }
      // Keep repainting while the panel is visible so live values keep
      // updating even after the local player dies.
      this.requestUpdate();
    }
  }

  public show(actions: PlayerActions, tile: TileRef) {
    this.actions = actions;
    this.tile = tile;
    this.moderationTarget = null;
    this.reportTarget = null;
    this.isVisible = true;
    this.requestUpdate();
  }

  public openSendGoldModal(
    actions: PlayerActions,
    tile: TileRef,
    target: PlayerView,
  ) {
    this.suppressNextHide = true;
    this.actions = actions;
    this.tile = tile;
    this.sendTarget = target;
    this.sendMode = "gold";
    this.moderationTarget = null;
    this.reportTarget = null;
    this.isVisible = true;
    this.requestUpdate();
  }

  public hide() {
    this.isVisible = false;
    this.sendMode = "none";
    this.sendTarget = null;
    this.moderationTarget = null;
    this.reportTarget = null;
    this.requestUpdate();
  }

  private handleClose(e: Event) {
    e.stopPropagation();
    this.hide();
  }

  private openSendTroops(target: PlayerView) {
    this.suppressNextHide = true;
    this.sendTarget = target;
    this.sendMode = "troops";
  }

  private openSendGold(target: PlayerView) {
    this.suppressNextHide = true;
    this.sendTarget = target;
    this.sendMode = "gold";
  }

  private handleDonateTroopClick(
    e: Event,
    myPlayer: PlayerView,
    other: PlayerView,
  ) {
    e.stopPropagation();
    this.openSendTroops(other);
  }

  private handleDonateGoldClick(
    e: Event,
    myPlayer: PlayerView,
    other: PlayerView,
  ) {
    e.stopPropagation();
    this.openSendGold(other);
  }

  private closeSend = () => {
    this.sendTarget = null;
    this.sendMode = "none";
  };

  private confirmSend = (
    e: CustomEvent<{ amount: number; closePanel?: boolean }>,
  ) => {
    this.closeSend();
    if (e.detail?.closePanel) this.hide();
  };

  private handleEmojiClick(e: Event, myPlayer: PlayerView, other: PlayerView) {
    e.stopPropagation();
    this.emojiTable.showTable((emoji: string) => {
      if (myPlayer === other) {
        this.eventBus.emit(
          new SendEmojiIntentEvent(
            AllPlayers,
            flattenedEmojiTable.indexOf(emoji as Emoji),
          ),
        );
      } else {
        this.eventBus.emit(
          new SendEmojiIntentEvent(
            other,
            flattenedEmojiTable.indexOf(emoji as Emoji),
          ),
        );
      }
      this.emojiTable.hideTable();
      this.hide();
    });
  }

  private handleChat(e: Event, sender: PlayerView, other: PlayerView) {
    e.stopPropagation();

    if (!this.ctModal) {
      console.warn("ChatModal element not found in DOM");
      return;
    }

    this.ctModal.open(sender, other);
    this.hide();
  }

  private handleTargetClick(e: Event, other: PlayerView) {
    e.stopPropagation();
    this.eventBus.emit(new SendTargetPlayerIntentEvent(other.id()));
    this.hide();
  }

  private openModeration(e: MouseEvent, other: PlayerView) {
    e.stopPropagation();
    this.suppressNextHide = true;
    this.moderationTarget = other;
  }

  private closeModeration = () => {
    this.moderationTarget = null;
  };

  private handleModerationKicked = (e: CustomEvent<{ playerId?: string }>) => {
    const playerId = e.detail?.playerId;
    if (playerId) this.kickedPlayerIDs.add(String(playerId));
    this.closeModeration();
    this.hide();
  };

  private openReport(e: MouseEvent, other: PlayerView) {
    e.stopPropagation();
    this.suppressNextHide = true;
    this.reportTarget = other;
  }

  private closeReport = () => {
    this.reportTarget = null;
  };

  // Anyone may report another human of a multiplayer game. Singleplayer
  // records are client-authored and the API ignores their reports; once the
  // game is decided the record has been archived and the server refuses.
  private canReport(my: PlayerView, other: PlayerView): boolean {
    return (
      this.g.config().gameConfig().gameType !== GameType.Singleplayer &&
      !this.g.config().isReplay() &&
      !this.g.gameOver() &&
      other !== my &&
      other.type() === PlayerType.Human &&
      !!other.clientID()
    );
  }

  private handleToggleRocketDirection(e: Event) {
    e.stopPropagation();
    const next = !this.uiState.rocketDirectionUp;
    this.eventBus.emit(new SwapRocketDirectionEvent(next));
  }

  private identityChipProps(type: PlayerType) {
    switch (type) {
      case PlayerType.Nation:
        return {
          labelKey: "player_type.nation",
          classes: "border-indigo-400/25 bg-indigo-500/10 text-indigo-200",
          icon: "🏛️",
        };
      case PlayerType.Bot:
        return {
          labelKey: "player_type.bot",
          classes: "border-purple-400/25 bg-purple-500/10 text-purple-200",
          icon: "⚔️",
        };
      case PlayerType.Human:
      default:
        return {
          labelKey: "player_type.player",
          classes: "border-zinc-400/20 bg-zinc-500/5 text-zinc-300",
          icon: "👤",
        };
    }
  }

  private getRelationClass(relation: Relation): string {
    const base =
      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 " +
      "shadow-[inset_0_0_8px_rgba(255,255,255,0.04)]";

    switch (relation) {
      case Relation.Hostile:
        return `${base} border-red-400/30 bg-red-500/10 text-red-200`;
      case Relation.Distrustful:
        return `${base} border-red-300/40 bg-red-300/10 text-red-300`;
      case Relation.Friendly:
        return `${base} border-emerald-400/30 bg-emerald-500/10 text-emerald-200`;
      case Relation.Neutral:
      default:
        return `${base} border-zinc-400/30 bg-zinc-500/10 text-zinc-200`;
    }
  }

  private getRelationName(relation: Relation): string {
    switch (relation) {
      case Relation.Hostile:
        return translateText("relation.hostile");
      case Relation.Distrustful:
        return translateText("relation.distrustful");
      case Relation.Friendly:
        return translateText("relation.friendly");
      case Relation.Neutral:
      default:
        return translateText("relation.neutral");
    }
  }

  private renderModeration(
    my: PlayerView,
    other: PlayerView,
    isAdmin: boolean,
  ) {
    const canReport = this.canReport(my, other);
    // The host of a publicly listed game cannot kick (server-enforced), so
    // don't offer the panel; admins keep it for moderation.
    const canModerate =
      (my.isLobbyCreator() || isAdmin) && (!this.gameListed || isAdmin);
    if (!canReport && !canModerate) return html``;
    const reported = this.reportedClientIDs.has(other.clientID() ?? "");
    const reportTitle = reported
      ? translateText("player_panel.reported")
      : translateText("player_panel.report");
    const moderationTitle = translateText("player_panel.moderation");

    return html`
      <ui-divider></ui-divider>
      <div class="grid auto-cols-fr grid-flow-col gap-1">
        ${
          canReport
            ? actionButton({
                onClick: (e: MouseEvent) => this.openReport(e, other),
                icon: reportIcon,
                iconAlt: "Report",
                title: reportTitle,
                label: reportTitle,
                type: "red",
                disabled: reported,
              })
            : ""
        }
        ${
          canModerate
            ? actionButton({
                onClick: (e: MouseEvent) => this.openModeration(e, other),
                icon: shieldIcon,
                iconAlt: "Moderation",
                title: moderationTitle,
                label: moderationTitle,
                type: "red",
              })
            : ""
        }
      </div>
    `;
  }

  private renderRelationPillIfNation(other: PlayerView, my: PlayerView) {
    if (other.type() !== PlayerType.Nation) return html``;
    if (!this.otherProfile || !my) return html``;

    const relation =
      this.otherProfile.relations?.[my.smallID()] ?? Relation.Neutral;
    const cls = this.getRelationClass(relation);
    const name = this.getRelationName(relation);

    return html`
      <div class="mt-1">
        <span class="text-sm font-semibold ${cls}">${name}</span>
      </div>
    `;
  }

  private renderIdentityRow(other: PlayerView, my: PlayerView) {
    const flagPath = other.cosmetics.flag;
    const flagCode = flagPath?.match(/\/flags\/(.+)\.svg$/)?.[1];
    const country =
      typeof flagCode === "string"
        ? Countries.find((c) => c.code === flagCode)
        : undefined;

    const chip =
      other.type() === PlayerType.Human
        ? null
        : this.identityChipProps(other.type());

    return html`
      <div class="flex items-center gap-2.5 flex-wrap">
        ${
          flagPath
            ? html`<img
                src=${assetUrl(flagPath)}
                alt=${country?.name ?? translateText("cosmetics.type_flag")}
                title=${country?.name ?? translateText("cosmetics.type_flag")}
                class="h-10 w-10 rounded-full object-cover"
                @error=${(e: Event) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />`
            : ""
        }

        <div class="flex-1 min-w-0 flex items-center gap-2">
          <h2
            class="min-w-0 text-xl font-bold tracking-[-0.01em] text-zinc-50 truncate"
            title=${other.displayName()}
          >
            ${other.displayName()}
          </h2>
        </div>
        ${
          chip
            ? html`<span
                class=${`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold ${chip.classes}`}
                role="status"
                aria-label=${translateText(chip.labelKey)}
                title=${translateText(chip.labelKey)}
              >
                <span aria-hidden="true" class="leading-none"
                  >${chip.icon}</span
                >
                <span class="tracking-tight"
                  >${translateText(chip.labelKey)}</span
                >
              </span>`
            : html``
        }
      </div>
      ${this.renderRelationPillIfNation(other, my)}
    `;
  }

  private renderResources(other: PlayerView) {
    return html`
      <div class="mb-1 flex justify-between gap-2">
        <div
          class="inline-flex items-center gap-1.5 rounded-lg bg-white/4 px-3 py-1.5 shrink-0
                    text-white w-35"
        >
          <span class="mr-0.5">💰</span>
          <span translate="no" class="tabular-nums w-[5ch] font-semibold">
            ${renderNumber(other.gold() || 0)}
          </span>
          <span class="text-zinc-200 whitespace-nowrap">
            ${translateText("player_panel.gold")}</span
          >
        </div>

        <div
          class="inline-flex items-center gap-1.5 rounded-lg bg-white/4 px-3 py-1.5
                    text-white w-35 shrink-0"
        >
          <span class="mr-0.5">🛡️</span>
          <span translate="no" class="tabular-nums w-[5ch] font-semibold">
            ${renderTroops(other.troops() || 0)}
          </span>
          <span class="text-zinc-200 whitespace-nowrap">
            ${translateText("player_panel.troops")}</span
          >
        </div>
      </div>
    `;
  }

  private renderRocketDirectionToggle() {
    return html`
      <ui-divider></ui-divider>
      <button
        class="flex w-full items-center justify-between rounded-xl bg-white/5 px-3 py-2 text-left text-white hover:bg-white/8 active:scale-[0.995] transition"
        @click=${(e: Event) => this.handleToggleRocketDirection(e)}
      >
        <div class="flex flex-col">
          <span class="text-sm font-semibold tracking-tight">
            ${translateText("player_panel.flip_rocket_trajectory")}
          </span>
          <span class="text-xs text-zinc-300" translate="no">
            ${
              this.uiState.rocketDirectionUp
                ? translateText("player_panel.arc_up")
                : translateText("player_panel.arc_down")
            }
          </span>
        </div>
        <span class="text-lg" aria-hidden="true">🔀</span>
      </button>
    `;
  }

  private renderActions(my: PlayerView, other: PlayerView) {
    const myPlayer = this.g.myPlayer();
    const canDonateGold = this.actions?.interaction?.canDonateGold;
    const canDonateTroops = this.actions?.interaction?.canDonateTroops;
    const canSendEmoji =
      other === myPlayer
        ? this.actions?.canSendEmojiAllPlayers
        : this.actions?.interaction?.canSendEmoji;
    const canTarget = this.actions?.interaction?.canTarget;

    return html`
      <div class="flex flex-col gap-2.5">
        <div class="grid auto-cols-fr grid-flow-col gap-1">
          ${actionButton({
            onClick: (e: MouseEvent) => this.handleChat(e, my, other),
            icon: chatIcon,
            iconAlt: "Chat",
            title: translateText("player_panel.chat"),
            label: translateText("player_panel.chat"),
          })}
          ${
            canSendEmoji
              ? actionButton({
                  onClick: (e: MouseEvent) =>
                    this.handleEmojiClick(e, my, other),
                  icon: emojiIcon,
                  iconAlt: "Emoji",
                  title: translateText("player_panel.emotes"),
                  label: translateText("player_panel.emotes"),
                  type: "normal",
                })
              : ""
          }
          ${
            canTarget
              ? actionButton({
                  onClick: (e: MouseEvent) => this.handleTargetClick(e, other),
                  icon: targetIcon,
                  iconAlt: "Target",
                  title: translateText("player_panel.target"),
                  label: translateText("player_panel.target"),
                  type: "normal",
                })
              : ""
          }
          ${
            canDonateTroops
              ? actionButton({
                  onClick: (e: MouseEvent) =>
                    this.handleDonateTroopClick(e, my, other),
                  icon: donateTroopIcon,
                  iconAlt: "Troops",
                  title: translateText("player_panel.send_troops"),
                  label: translateText("player_panel.troops"),
                  type: "normal",
                })
              : ""
          }
          ${
            canDonateGold
              ? actionButton({
                  onClick: (e: MouseEvent) =>
                    this.handleDonateGoldClick(e, my, other),
                  icon: donateGoldIcon,
                  iconAlt: "Gold",
                  title: translateText("player_panel.send_gold"),
                  label: translateText("player_panel.gold"),
                  type: "normal",
                })
              : ""
          }
        </div>
        ${this.renderModeration(my, other, this.isAdminRole)}
      </div>
    `;
  }

  render() {
    if (!this.isVisible) return html``;

    const my = this.g.myPlayer();
    const isSpectator = this.g.isSpectator();
    if (!my && !isSpectator) return html``;
    if (!this.tile) return html``;

    const owner = this.g.owner(this.tile);
    if (!owner || !owner.isPlayer()) {
      this.hide();
      console.warn("Tile is not owned by a player");
      return html``;
    }
    const other = owner as PlayerView;
    // Spectators (replay viewers, dead, or pre-spawn) have no live player; use other as a read-only stand-in
    const viewer = my ?? other;
    const myGoldNum = viewer.gold();
    const myTroopsNum = Number(viewer.troops());

    return html`
      <div
        class="fixed inset-0 z-10001 flex items-center justify-center overflow-auto
               bg-black/15 backdrop-brightness-110 pointer-events-auto"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
        @wheel=${(e: MouseEvent) => e.stopPropagation()}
        @click=${() => this.hide()}
      >
        <div
          class="pointer-events-auto max-h-[90vh] min-w-75 max-w-100 px-4 py-2"
          @click=${(e: MouseEvent) => e.stopPropagation()}
        >
          <div class="relative">
            <div
              class="absolute inset-2 -z-10 rounded-2xl bg-black/25 backdrop-blur-[2px]"
            ></div>
            <div
              class=${`relative w-full bg-zinc-900/95 rounded-2xl text-zinc-100 shadow-2xl shadow-black/50
                 ring-1 ring-white/5`}
            >
              <div class="overflow-visible">
                <div
                  class="overflow-auto [-webkit-overflow-scrolling:touch] resize-y max-h-[calc(100vh-120px-env(safe-area-inset-bottom))]"
                >
                  <div class="sticky top-0 z-20 flex justify-end p-2">
                    <button
                      @click=${this.handleClose}
                      class="absolute right-3 top-3 z-20 flex h-7 w-7 items-center justify-center rounded-full bg-zinc-700 text-white shadow-sm hover:bg-red-500 transition-colors"
                      aria-label=${translateText("common.close") || "Close"}
                      title=${translateText("common.close") || "Close"}
                    >
                      ✕
                    </button>
                  </div>

                  <div
                    class="p-6 flex flex-col gap-2 font-sans antialiased text-[14.5px] leading-relaxed"
                  >
                    <!-- Identity (flag, name, type, relation) -->
                    <div class="mb-1">
                      ${this.renderIdentityRow(other, viewer)}
                    </div>

                    ${
                      this.sendTarget && !isSpectator
                        ? html`
                            <send-resource-modal
                              .open=${this.sendMode !== "none"}
                              .mode=${this.sendMode}
                              .total=${
                                this.sendMode === "troops"
                                  ? myTroopsNum
                                  : myGoldNum
                              }
                              .uiState=${this.uiState}
                              .myPlayer=${viewer}
                              .target=${this.sendTarget}
                              .gameView=${this.g}
                              .eventBus=${this.eventBus}
                              .format=${
                                this.sendMode === "troops"
                                  ? renderTroops
                                  : renderNumber
                              }
                              @confirm=${this.confirmSend}
                              @close=${this.closeSend}
                            ></send-resource-modal>
                          `
                        : ""
                    }
                    ${
                      this.moderationTarget
                        ? html`
                            <player-moderation-modal
                              .open=${true}
                              .myPlayer=${viewer}
                              .target=${this.moderationTarget}
                              .eventBus=${this.eventBus}
                              .isAdmin=${this.isAdminRole}
                              .alreadyKicked=${this.kickedPlayerIDs.has(
                                String(this.moderationTarget.id()),
                              )}
                              @close=${this.closeModeration}
                              @kicked=${this.handleModerationKicked}
                            ></player-moderation-modal>
                          `
                        : ""
                    }
                    ${
                      this.reportTarget
                        ? html`
                            <player-report-modal
                              .open=${true}
                              .target=${this.reportTarget}
                              .eventBus=${this.eventBus}
                              @close=${this.closeReport}
                            ></player-report-modal>
                          `
                        : ""
                    }

                    <ui-divider></ui-divider>

                    <!-- Resources -->
                    ${this.renderResources(other)}

                    <!-- Rocket direction toggle -->
                    ${
                      other === viewer && !isSpectator
                        ? this.renderRocketDirectionToggle()
                        : ""
                    }
                    ${
                      !isSpectator
                        ? html`
                            <ui-divider></ui-divider>
                            <!-- Actions -->
                            ${this.renderActions(viewer, other)}
                          `
                        : my
                          ? // Dead (or not yet spawned) players still get to
                            // report and, as host/admin, moderate.
                            this.renderModeration(my, other, this.isAdminRole)
                          : ""
                    }
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
