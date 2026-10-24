import { AllPlayers, MessageType } from "@openfront/engine-api/game/GameTypes";
import {
  DisplayChatMessageUpdate,
  DisplayMessageUpdate,
  DonateEventUpdate,
  EmojiUpdate,
  GameUpdateType,
  TargetPlayerUpdate,
  UnitIncomingUpdate,
} from "@openfront/engine-api/game/GameUpdates";
import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { DirectiveResult } from "lit/directive.js";
import { unsafeHTML, UnsafeHTMLDirective } from "lit/directives/unsafe-html.js";
import { Controller } from "../../Controller";
import { UserSettings } from "../../UserSettings";

import { GoToPlayerEvent, GoToUnitEvent } from "../../TransformHandler";
import { GameView, PlayerView, UnitView } from "../../view";
import { onlyImages } from "./OnlyImages";

import { renderNumber, renderTroops } from "@openfront/engine-lib/Format";
import { PlaySoundEffectEvent } from "../../sound/Sounds";
import { UIState } from "../../UIState";
import { getMessageTypeClasses, translateText } from "../../Utils";

interface GameEvent {
  description: string;
  unsafeDescription?: boolean;
  type: MessageType;
  highlight?: boolean;
  /** Show in the small feed even if the type is normally tier 1. */
  minor?: boolean;
  createdAt: number;
  onDelete?: () => void;
  focusID?: number;
  unitView?: UnitView;
}

const TIER_1_TYPES: ReadonlySet<MessageType> = new Set([
  MessageType.NUKE_INBOUND,
  MessageType.HYDROGEN_BOMB_INBOUND,
  MessageType.MIRV_INBOUND,
  MessageType.NUKE_DETONATED,
  MessageType.NAVAL_INVASION_INBOUND,
  MessageType.ATTACK_REQUEST,
  MessageType.CONQUERED_PLAYER,
  MessageType.CHAT,
  MessageType.DONATION_RECEIVED,
]);

const isTier1 = (type: MessageType): boolean => TIER_1_TYPES.has(type);

@customElement("events-display")
export class EventsDisplay extends LitElement implements Controller {
  public eventBus: EventBus;
  public game: GameView;
  public uiState: UIState;

  private active: boolean = false;
  private events: GameEvent[] = [];
  private userSettings = new UserSettings();

  @state() private _isVisible: boolean = false;

  @query(".events-container")
  private _eventsContainer?: HTMLDivElement;
  private _shouldScrollToBottom = true;

  @query(".important-events-container")
  private _importantEventsContainer?: HTMLDivElement;
  private _shouldScrollImportantToBottom = true;

  updated(changed: Map<string, unknown>) {
    super.updated(changed);
    if (this._eventsContainer && this._shouldScrollToBottom) {
      this._eventsContainer.scrollTop = this._eventsContainer.scrollHeight;
    }
    if (this._importantEventsContainer && this._shouldScrollImportantToBottom) {
      this._importantEventsContainer.scrollTop =
        this._importantEventsContainer.scrollHeight;
    }
  }

  private renderButton(options: {
    content: unknown;
    onClick?: () => void;
    className?: string;
    disabled?: boolean;
    translate?: boolean;
    hidden?: boolean;
  }) {
    const {
      content,
      onClick,
      className = "",
      disabled = false,
      translate = true,
      hidden = false,
    } = options;
    if (hidden) {
      return html``;
    }
    return html`
      <button
        class="${className}"
        @click=${onClick}
        ?disabled=${disabled}
        ?translate=${translate}
      >
        ${content}
      </button>
    `;
  }

  private updateMap = [
    [GameUpdateType.DisplayEvent, this.onDisplayMessageEvent.bind(this)],
    [GameUpdateType.DisplayChatEvent, this.onDisplayChatEvent.bind(this)],
    [GameUpdateType.TargetPlayer, this.onTargetPlayerEvent.bind(this)],
    [GameUpdateType.Emoji, this.onEmojiMessageEvent.bind(this)],
    [GameUpdateType.UnitIncoming, this.onUnitIncomingEvent.bind(this)],
    [GameUpdateType.DonateEvent, this.onDonateEvent.bind(this)],
  ] as const;

  constructor() {
    super();
    this.events = [];
  }

  tick() {
    this.active = true;

    if (this._eventsContainer) {
      const el = this._eventsContainer;
      this._shouldScrollToBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < 5;
    } else {
      this._shouldScrollToBottom = true;
    }

    if (this._importantEventsContainer) {
      const el = this._importantEventsContainer;
      this._shouldScrollImportantToBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < 5;
    } else {
      this._shouldScrollImportantToBottom = true;
    }

    if (!this._isVisible && !this.game.inSpawnPhase()) {
      this._isVisible = true;
      this.requestUpdate();
    }

    const myPlayer = this.game.myPlayer();
    if (!myPlayer || !myPlayer.isAlive()) {
      if (this._isVisible) {
        this._isVisible = false;
        this.requestUpdate();
      }
      return;
    }

    const updates = this.game.updatesSinceLastTick();
    if (updates) {
      for (const [ut, fn] of this.updateMap) {
        updates[ut]?.forEach(fn as (event: unknown) => void);
      }
    }

    let remainingEvents = this.events.filter((event) => {
      const age = this.game.ticks() - event.createdAt;
      // A negative age is an event from later in the game: the replay
      // viewer seeked back past it.
      const expired = age >= 80 || age < 0;
      const isInboundWarning =
        event.type === MessageType.NUKE_INBOUND ||
        event.type === MessageType.HYDROGEN_BOMB_INBOUND ||
        event.type === MessageType.MIRV_INBOUND ||
        event.type === MessageType.NAVAL_INVASION_INBOUND;
      const unitGone =
        isInboundWarning &&
        event.unitView !== undefined &&
        !event.unitView.isActive();
      const shouldKeep = !expired && !unitGone;
      if (!shouldKeep && event.onDelete) {
        event.onDelete();
      }
      return shouldKeep;
    });

    if (remainingEvents.length > 30) {
      remainingEvents = remainingEvents.slice(-30);
    }

    if (this.events.length !== remainingEvents.length) {
      this.events = remainingEvents;
      this.requestUpdate();
    }

    this.requestUpdate();
  }

  private addEvent(event: GameEvent) {
    this.events = [...this.events, event];
    this.requestUpdate();
  }

  // The core simulation runs identically for every client and has no notion
  // of Anonymous Names, so a params.name value it bakes into a DisplayEvent
  // is always the subject's real name. When the message identifies that
  // subject via focusPlayerID, re-resolve the name through this viewer's own
  // PlayerView instead, which already respects the local Anonymous Names
  // setting - otherwise a message like "X conquered you" leaks X's real name
  // even when this viewer has Anonymous Names turned on.
  private resolveParams(
    event: DisplayMessageUpdate,
  ): Record<string, string | number> {
    let params = event.params ?? {};
    if (
      (event.message === "events_display.missile_intercepted" ||
        event.message === "events_display.unit_destroyed") &&
      typeof params.unit === "string" &&
      params.unit.startsWith("unit_type.")
    ) {
      params = { ...params, unit: translateText(params.unit) };
    }

    if (params.name === undefined || event.focusPlayerID === undefined) {
      return params;
    }
    const subject = this.game.playerBySmallID(event.focusPlayerID);
    if (!subject.isPlayer()) {
      return params;
    }
    return { ...params, name: subject.displayName() };
  }

  onDisplayMessageEvent(event: DisplayMessageUpdate) {
    const myPlayer = this.game.myPlayer();
    if (
      event.playerID !== null &&
      (!myPlayer || myPlayer.smallID() !== event.playerID)
    ) {
      return;
    }

    // Captured trade-ship gold is surfaced as a transient +gold pip in
    // control-panel rather than as a scroll-list entry.
    if (event.message === "events_display.received_gold_from_captured_ship") {
      return;
    }

    let description: string = event.message;
    if (event.message.startsWith("events_display.")) {
      description = translateText(event.message, this.resolveParams(event));
    }

    const unitView =
      event.unitID !== undefined ? this.game.unit(event.unitID) : undefined;
    this.addEvent({
      description: description,
      createdAt: this.game.ticks(),
      highlight: true,
      type: event.messageType,
      unsafeDescription: true,
      unitView: unitView,
      focusID: event.focusPlayerID,
    });
  }

  onDisplayChatEvent(event: DisplayChatMessageUpdate) {
    const myPlayer = this.game.myPlayer();
    if (
      event.playerID === null ||
      !myPlayer ||
      myPlayer.smallID() !== event.playerID
    ) {
      return;
    }

    const baseMessage = translateText(`chat.${event.category}.${event.key}`);
    let translatedMessage = baseMessage;
    if (event.target) {
      try {
        const targetPlayer = this.game.player(event.target);
        const targetName = targetPlayer?.displayName() ?? event.target;
        translatedMessage = baseMessage.replace("[P1]", targetName);
      } catch (e) {
        console.warn(
          `Failed to resolve player for target ID '${event.target}'`,
          e,
        );
        return;
      }
    }

    let otherPlayerDiplayName: string = "";
    let otherPlayerSmallID: number | undefined;
    if (event.recipient !== null) {
      //'recipient' parameter contains sender ID or recipient ID
      const player = this.game.player(event.recipient);
      otherPlayerDiplayName = player ? player.displayName() : "";
      otherPlayerSmallID = player?.smallID();
    }

    // A message I sent is only a confirmation, like a sent emoji: it goes to
    // the small feed, quietly.
    const sent = !event.isFrom;
    this.addEvent({
      description: translateText(sent ? "chat.to" : "chat.from", {
        user: otherPlayerDiplayName,
        msg: translatedMessage,
      }),
      createdAt: this.game.ticks(),
      highlight: !sent,
      minor: sent,
      type: MessageType.CHAT,
      unsafeDescription: false,
      focusID: otherPlayerSmallID,
    });
    if (!sent) {
      this.eventBus.emit(new PlaySoundEffectEvent("message"));
    }
  }

  onDonateEvent(update: DonateEventUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;

    const isRecipient = update.recipientId === myPlayer.id();
    const isSender = update.senderId === myPlayer.id();
    if (!isRecipient && !isSender) return;

    const other = isRecipient
      ? (this.game.player(update.senderId) as PlayerView)
      : (this.game.player(update.recipientId) as PlayerView);

    const isGold = update.donationType === "gold";
    const messageKey = isRecipient
      ? isGold
        ? "events_display.received_gold_from_player"
        : "events_display.received_troops_from_player"
      : isGold
        ? "events_display.sent_gold_to_player"
        : "events_display.sent_troops_to_player";
    const params: Record<string, string | number> = {
      name: other.displayName(),
      [isGold ? "gold" : "troops"]: isGold
        ? renderNumber(update.amount)
        : renderTroops(Number(update.amount)),
    };

    this.addEvent({
      description: translateText(messageKey, params),
      type: isRecipient
        ? MessageType.DONATION_RECEIVED
        : MessageType.DONATION_SENT,
      highlight: true,
      createdAt: this.game.ticks(),
      focusID: other.smallID(),
    });
  }

  onTargetPlayerEvent(event: TargetPlayerUpdate) {
    const other = this.game.playerBySmallID(event.playerID) as PlayerView;
    const myPlayer = this.game.myPlayer() as PlayerView;
    if (!myPlayer || !myPlayer.isFriendly(other)) return;

    const target = this.game.playerBySmallID(event.targetID) as PlayerView;

    this.addEvent({
      description: translateText("events_display.attack_request", {
        name: other.displayName(),
        target: target.displayName(),
      }),
      type: MessageType.ATTACK_REQUEST,
      highlight: true,
      createdAt: this.game.ticks(),
      focusID: event.targetID,
    });
  }

  emitGoToPlayerEvent(attackerID: number) {
    const attacker = this.game.playerBySmallID(attackerID) as PlayerView;
    if (!attacker) return;
    this.eventBus.emit(new GoToPlayerEvent(attacker));
  }

  emitGoToUnitEvent(unit: UnitView) {
    this.eventBus.emit(new GoToUnitEvent(unit));
  }

  onEmojiMessageEvent(update: EmojiUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;

    const recipient =
      update.emoji.recipientID === AllPlayers
        ? AllPlayers
        : this.game.playerBySmallID(update.emoji.recipientID);
    const sender = this.game.playerBySmallID(
      update.emoji.senderID,
    ) as PlayerView;

    if (recipient === myPlayer) {
      // Honor the "Disable emojis" setting: don't surface received emojis in
      // the events feed either (#4430). Confirmations of emojis you sent
      // still show, since the setting doesn't stop you sending them.
      if (!this.userSettings.emojis()) return;
      this.addEvent({
        description: `${sender.displayName()}: ${update.emoji.message}`,
        unsafeDescription: true,
        type: MessageType.CHAT,
        highlight: true,
        createdAt: this.game.ticks(),
        focusID: update.emoji.senderID,
      });
    } else if (sender === myPlayer && recipient !== AllPlayers) {
      this.addEvent({
        description: translateText("events_display.sent_emoji", {
          name: (recipient as PlayerView).displayName(),
          emoji: update.emoji.message,
        }),
        unsafeDescription: true,
        type: MessageType.CHAT,
        minor: true,
        createdAt: this.game.ticks(),
        focusID: recipient.smallID(),
      });
    } else if (sender === myPlayer) {
      this.addEvent({
        description: translateText("events_display.sent_emoji_all", {
          emoji: update.emoji.message,
        }),
        unsafeDescription: true,
        type: MessageType.CHAT,
        minor: true,
        createdAt: this.game.ticks(),
      });
    }
  }

  onUnitIncomingEvent(event: UnitIncomingUpdate) {
    const myPlayer = this.game.myPlayer();

    if (!myPlayer || myPlayer.smallID() !== event.playerID) {
      return;
    }

    const unitView = this.game.unit(event.unitID);
    let description = event.message;
    if (event.message.startsWith("events_display.") && unitView) {
      const params: Record<string, string | number> = {
        name: unitView.owner().displayName(),
      };
      if (event.messageType === MessageType.NAVAL_INVASION_INBOUND) {
        params.troops = renderTroops(unitView.troops());
      }
      description = translateText(event.message, params);
    }

    this.addEvent({
      description: description,
      type: event.messageType,
      unsafeDescription: false,
      highlight: true,
      createdAt: this.game.ticks(),
      unitView: unitView,
    });
  }

  private getEventDescription(
    event: GameEvent,
  ): string | DirectiveResult<typeof UnsafeHTMLDirective> {
    return event.unsafeDescription
      ? unsafeHTML(onlyImages(event.description))
      : event.description;
  }

  private renderEventRow(event: GameEvent) {
    return html`
      <tr>
        <td
          class="lg:px-2 lg:py-1 p-1 text-left ${getMessageTypeClasses(
            event.type,
          )}"
        >
          ${
            event.focusID
              ? this.renderButton({
                  content: this.getEventDescription(event),
                  onClick: () => {
                    if (event.focusID) this.emitGoToPlayerEvent(event.focusID);
                  },
                  className: "text-left",
                })
              : event.unitView
                ? this.renderButton({
                    content: this.getEventDescription(event),
                    onClick: () => {
                      if (event.unitView)
                        this.emitGoToUnitEvent(event.unitView);
                    },
                    className: "text-left",
                  })
                : this.getEventDescription(event)
          }
        </td>
      </tr>
    `;
  }

  render() {
    if (!this.active || !this._isVisible) {
      return html``;
    }

    const tier1Events: GameEvent[] = [];
    let tier2Events: GameEvent[] = [];
    for (const event of this.events) {
      (isTier1(event.type) && !event.minor ? tier1Events : tier2Events).push(
        event,
      );
    }
    tier1Events.sort((a, b) => a.createdAt - b.createdAt);
    tier2Events.sort((a, b) => a.createdAt - b.createdAt);
    tier2Events = tier2Events.slice(-4);

    if (tier1Events.length === 0 && tier2Events.length === 0) {
      return html``;
    }

    return html`
      <div class="flex flex-col gap-1 w-full min-[1200px]:w-96">
        ${
          tier2Events.length > 0
            ? html`
                <div
                  class="bg-gray-800/92 backdrop-blur-sm max-h-[12vh] lg:max-h-[22vh] overflow-y-auto rounded-lg opacity-90 events-container"
                >
                  <table
                    class="w-full border-collapse text-white text-xs lg:text-sm pointer-events-auto"
                  >
                    <tbody>
                      ${tier2Events.map((event) => this.renderEventRow(event))}
                    </tbody>
                  </table>
                </div>
              `
            : ""
        }
        ${
          tier1Events.length > 0
            ? html`
                <div
                  class="bg-gray-800 backdrop-blur-sm max-h-[30vh] lg:max-h-[40vh] overflow-y-auto rounded-lg shadow-lg border-l-4 border-red-500 important-events-container"
                >
                  <table
                    class="w-full border-collapse text-white text-base lg:text-lg font-medium pointer-events-auto"
                  >
                    <tbody>
                      ${tier1Events.map((event) => this.renderEventRow(event))}
                    </tbody>
                  </table>
                </div>
              `
            : ""
        }
      </div>
    `;
  }

  createRenderRoot() {
    return this;
  }
}
