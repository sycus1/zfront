/**
 * Coverage for the EventsDisplay update handlers: the tick() dispatch loop
 * over updateMap, and the target/unit handlers' myPlayer guards.
 */

vi.mock("lit", () => ({
  html: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
  LitElement: class extends EventTarget {
    requestUpdate() {}
  },
}));

vi.mock("lit/decorators.js", () => ({
  customElement: () => (clazz: unknown) => clazz,
  state: () => () => {},
  property: () => () => {},
  query: () => () => {},
}));

vi.mock("lit/directive.js", () => ({}));
vi.mock("lit/directives/unsafe-html.js", () => ({
  unsafeHTML: (s: string) => s,
}));

vi.mock("../../../../src/client/Utils", () => ({
  // Include params in the output so descriptions are assertable.
  translateText: vi.fn((key: string, params?: Record<string, unknown>) => {
    const translations: Record<string, string> = {
      "unit_type.atom_bomb": "Atom Bomb",
      "unit_type.boat": "Boat",
    };
    const text = translations[key] ?? key;
    return params ? `${text} ${JSON.stringify(params)}` : text;
  }),
  getMessageTypeClasses: vi.fn(() => ""),
}));
vi.mock("@openfront/engine-lib/Format", () => ({
  renderNumber: vi.fn(),
  renderTroops: vi.fn((troops: number) => String(troops)),
}));

import { MessageType } from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventsDisplay } from "../../../../src/client/hud/layers/EventsDisplay";

interface Ed {
  events: { description: string; type: MessageType; focusID?: number }[];
  game: unknown;
  eventBus: unknown;
}

describe("EventsDisplay handlers", () => {
  let ed: EventsDisplay;
  let emit: ReturnType<typeof vi.fn>;
  const myPlayer = {
    smallID: () => 1,
    displayName: () => "Me",
    isAlive: () => true,
    isFriendly: (p: { smallID: () => number }) => p.smallID() === 2,
  };
  const friend = {
    smallID: () => 2,
    displayName: () => "Friend",
    isAlive: () => true,
    isDisconnected: () => false,
  };
  const stranger = {
    smallID: () => 3,
    displayName: () => "Stranger",
    isAlive: () => true,
    isDisconnected: () => false,
  };
  const byID: Record<number, unknown> = { 1: myPlayer, 2: friend, 3: stranger };

  const events = () => (ed as unknown as Ed).events;
  let game: Record<string, unknown>;

  beforeEach(() => {
    ed = new EventsDisplay();
    emit = vi.fn();
    (ed as unknown as Ed).eventBus = { emit };
    game = {
      myPlayer: () => myPlayer,
      playerBySmallID: (id: number) => byID[id],
      unit: (id: number) => ({
        id,
        isActive: () => true,
        owner: () => stranger,
        troops: () => 5000,
      }),
      ticks: () => 0,
      inSpawnPhase: () => false,
      config: () => ({}),
      updatesSinceLastTick: () => null,
    };
    (ed as unknown as Ed).game = game;
  });

  describe("tick", () => {
    it("dispatches queued updates through updateMap", () => {
      game.updatesSinceLastTick = () => ({
        [GameUpdateType.DisplayEvent]: [
          {
            type: GameUpdateType.DisplayEvent,
            message: "hello world",
            messageType: MessageType.ATTACK_FAILED,
            playerID: 1,
          },
        ],
        [GameUpdateType.UnitIncoming]: [
          {
            type: GameUpdateType.UnitIncoming,
            unitID: 7,
            message: "incoming!",
            messageType: MessageType.NUKE_INBOUND,
            playerID: 1,
          },
        ],
      });

      ed.tick();

      expect(events().map((e) => e.description)).toEqual([
        "hello world",
        "incoming!",
      ]);
    });

    it("adds nothing when there are no updates", () => {
      ed.tick();
      expect(events()).toHaveLength(0);
    });

    it("shows the panel after spawn and hides it when the player dies", () => {
      ed.tick();
      expect((ed as unknown as { _isVisible: boolean })._isVisible).toBe(true);

      game.myPlayer = () => ({ ...myPlayer, isAlive: () => false });
      ed.tick();
      expect((ed as unknown as { _isVisible: boolean })._isVisible).toBe(false);
      // render() must short-circuit to an empty template while hidden.
      const rendered = (
        ed as unknown as { render: () => { values: unknown[] } }
      ).render();
      expect(rendered.values).toHaveLength(0);
    });
  });

  describe("renderButton", () => {
    const renderButton = (options: Record<string, unknown>) =>
      (
        ed as unknown as {
          renderButton: (o: unknown) => {
            strings: string[];
            values: unknown[];
          };
        }
      ).renderButton(options);

    it("renders a button wired to the given click handler", () => {
      const onClick = vi.fn();
      const button = renderButton({
        content: "jump to player",
        onClick,
        className: "text-left",
        disabled: true,
      });

      expect(button.strings.join("")).toContain("<button");
      expect(button.values).toContain("jump to player");
      expect(button.values).toContain("text-left");
      const handler = button.values.find((v) => typeof v === "function") as
        | (() => void)
        | undefined;
      expect(handler).toBe(onClick);
    });

    it("renders nothing when hidden", () => {
      const button = renderButton({ content: "invisible", hidden: true });
      expect(button.values).toHaveLength(0);
      expect(button.strings.join("")).toBe("");
    });
  });

  describe("onTargetPlayerEvent", () => {
    it("shows a teammate's attack request", () => {
      ed.onTargetPlayerEvent({
        type: GameUpdateType.TargetPlayer,
        playerID: 2,
        targetID: 3,
      } as never);

      expect(events()).toHaveLength(1);
      expect(events()[0].type).toBe(MessageType.ATTACK_REQUEST);
      expect(events()[0].focusID).toBe(3);
      expect(events()[0].description).toContain("Friend");
      expect(events()[0].description).toContain("Stranger");
    });

    it("ignores requests from non-friendly players", () => {
      ed.onTargetPlayerEvent({
        type: GameUpdateType.TargetPlayer,
        playerID: 3,
        targetID: 2,
      } as never);
      expect(events()).toHaveLength(0);
    });
  });

  describe("onUnitIncomingEvent", () => {
    const incoming = (
      playerID: number,
      message = "nuke inbound",
      messageType = MessageType.NUKE_INBOUND,
    ) => ({
      type: GameUpdateType.UnitIncoming,
      unitID: 7,
      message,
      messageType,
      playerID,
    });

    it("shows incoming-unit warnings addressed to me", () => {
      ed.onUnitIncomingEvent(incoming(1) as never);
      expect(events()).toHaveLength(1);
      expect(events()[0].description).toBe("nuke inbound");
      expect(events()[0].type).toBe(MessageType.NUKE_INBOUND);
    });

    it("ignores warnings addressed to other players", () => {
      ed.onUnitIncomingEvent(incoming(2) as never);
      expect(events()).toHaveLength(0);
    });

    it("translates incoming-unit keys with the owner's display name and troops", () => {
      ed.onUnitIncomingEvent(
        incoming(1, "events_display.atom_bomb_inbound") as never,
      );
      ed.onUnitIncomingEvent(
        incoming(
          1,
          "events_display.hydrogen_bomb_inbound",
          MessageType.HYDROGEN_BOMB_INBOUND,
        ) as never,
      );
      ed.onUnitIncomingEvent(
        incoming(
          1,
          "events_display.mirv_inbound",
          MessageType.MIRV_INBOUND,
        ) as never,
      );
      ed.onUnitIncomingEvent(
        incoming(
          1,
          "events_display.naval_invasion_inbound",
          MessageType.NAVAL_INVASION_INBOUND,
        ) as never,
      );

      expect(events().map((event) => event.description)).toEqual([
        'events_display.atom_bomb_inbound {"name":"Stranger"}',
        'events_display.hydrogen_bomb_inbound {"name":"Stranger"}',
        'events_display.mirv_inbound {"name":"Stranger"}',
        'events_display.naval_invasion_inbound {"name":"Stranger","troops":"5000"}',
      ]);
    });
  });

  describe("onDisplayMessageEvent", () => {
    it("translates unit names in event parameters", () => {
      ed.onDisplayMessageEvent({
        type: GameUpdateType.DisplayEvent,
        message: "events_display.unit_destroyed",
        messageType: MessageType.UNIT_DESTROYED,
        playerID: 1,
        params: { unit: "unit_type.boat" },
      });
      ed.onDisplayMessageEvent({
        type: GameUpdateType.DisplayEvent,
        message: "events_display.missile_intercepted",
        messageType: MessageType.SAM_HIT,
        playerID: 1,
        params: { unit: "unit_type.atom_bomb" },
      });

      expect(events().map((event) => event.description)).toEqual([
        'events_display.unit_destroyed {"unit":"Boat"}',
        'events_display.missile_intercepted {"unit":"Atom Bomb"}',
      ]);
    });
  });
});
