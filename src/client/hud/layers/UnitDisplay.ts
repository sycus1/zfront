import {
  BuildableUnit,
  BuildMenus,
  Gold,
  PlayerBuildableUnitType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { renderNumber } from "@openfront/engine-lib/Format";
import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { type IconName, zfIcon } from "../../components/nightshift/Icon";
import { Controller } from "../../Controller";
import { ToggleStructureEvent } from "../../InputHandler";
import { KeyboardLayoutController } from "../../KeyboardLayout";
import { Platform } from "../../Platform";
import { UIState } from "../../UIState";
import { UserSettings } from "../../UserSettings";
import { keyCapLabel, resolveKeybindLabel, translateText } from "../../Utils";
import { GameView } from "../../view";
import {
  atomBombIcon,
  cityIcon,
  factoryIcon,
  hydrogenBombIcon,
  mirvIcon,
  portIcon,
  samLauncherIcon,
  warshipIcon,
} from "../HotbarIcons";
import { TutorialHighlight, TutorialHighlightEvent } from "../Tutorial";

/** One button in the build strip. */
export interface BuildItem {
  type: PlayerBuildableUnitType;
  /** The `unit_type.*` / `build_menu.desc.*` key. */
  key: string;
  /** A Night Shift line icon, or an image URL for OpenFront's own units. */
  icon: IconName | string;
  /** The keybind action, and its default key code. */
  action: string;
  defaultCode: string;
}

const WALL: BuildItem = {
  type: UnitType.Wall,
  key: "wall",
  icon: "walls",
  action: "buildWall",
  defaultCode: "KeyV",
};
const TURRET: BuildItem = {
  type: UnitType.DefensePost,
  key: "defense_post",
  icon: "turret",
  action: "buildDefensePost",
  defaultCode: "Digit4",
};
const MORTAR: BuildItem = {
  type: UnitType.MissileSilo,
  key: "missile_silo",
  icon: "mortar",
  action: "buildMissileSilo",
  defaultCode: "Digit5",
};
const MINE: BuildItem = {
  type: UnitType.Mine,
  key: "mine",
  icon: "mine",
  action: "buildMine",
  defaultCode: "KeyK",
};
const BEACON: BuildItem = {
  type: UnitType.NoiseBeacon,
  key: "noise_beacon",
  icon: "beacon",
  action: "buildNoiseBeacon",
  defaultCode: "KeyL",
};
const DEPOT: BuildItem = {
  type: UnitType.Depot,
  key: "depot",
  icon: "depot",
  action: "buildDepot",
  defaultCode: "KeyH",
};
const OUTPOST: BuildItem = {
  type: UnitType.Outpost,
  key: "outpost",
  icon: "outpost",
  action: "buildOutpost",
  defaultCode: "KeyO",
};

/**
 * zfront: the horde game's build strip, in the HUD board's order. City,
 * Factory, Port and Warship can still be built from the radial build menu
 * and their keys, but they stay off the strip.
 */
export const HORDE_BUILD_ITEMS: readonly BuildItem[] = [
  WALL,
  TURRET,
  MORTAR,
  MINE,
  BEACON,
  DEPOT,
  OUTPOST,
];

/** Every unit OpenFront's hotbar offers, for games without the horde. */
export const CLASSIC_BUILD_ITEMS: readonly BuildItem[] = [
  {
    type: UnitType.City,
    key: "city",
    icon: cityIcon,
    action: "buildCity",
    defaultCode: "Digit1",
  },
  {
    type: UnitType.Factory,
    key: "factory",
    icon: factoryIcon,
    action: "buildFactory",
    defaultCode: "Digit2",
  },
  {
    type: UnitType.Port,
    key: "port",
    icon: portIcon,
    action: "buildPort",
    defaultCode: "Digit3",
  },
  TURRET,
  WALL,
  MORTAR,
  OUTPOST,
  DEPOT,
  MINE,
  BEACON,
  {
    type: UnitType.SAMLauncher,
    key: "sam_launcher",
    icon: samLauncherIcon,
    action: "buildSamLauncher",
    defaultCode: "Digit6",
  },
  {
    type: UnitType.Warship,
    key: "warship",
    icon: warshipIcon,
    action: "buildWarship",
    defaultCode: "Digit7",
  },
  {
    type: UnitType.AtomBomb,
    key: "atom_bomb",
    icon: atomBombIcon,
    action: "buildAtomBomb",
    defaultCode: "Digit8",
  },
  {
    type: UnitType.HydrogenBomb,
    key: "hydrogen_bomb",
    icon: hydrogenBombIcon,
    action: "buildHydrogenBomb",
    defaultCode: "Digit9",
  },
  {
    type: UnitType.MIRV,
    key: "mirv",
    icon: mirvIcon,
    action: "buildMIRV",
    defaultCode: "Digit0",
  },
];

/** A unit's translated name, or its type when it has no `unit_type` key. */
export function unitTypeName(type: UnitType): string {
  const item = CLASSIC_BUILD_ITEMS.find((i) => i.type === type);
  return item ? translateText(`unit_type.${item.key}`) : type;
}

/** Levels shown as "Level 1 of N" in the tag (walls, turrets, mortars). */
const MAX_SHOWN_LEVEL = 10;

/**
 * The build strip, bottom centre (the Night Shift "A2 compact bar"): one
 * framed row of icon buttons with their key and cost. Above it, a yellow tag
 * names the building being placed (or hovered), its cost, how far it
 * upgrades and, on hover, what it does. Under 1024px the strip spans the
 * screen in equal columns, as on the phone board.
 */
@customElement("unit-display")
export class UnitDisplay extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public uiState: UIState;
  private playerBuildables: BuildableUnit[] | null = null;
  private keybinds: Record<string, { value: string; key: string }> = {};
  private keyboardLayout = new KeyboardLayoutController(this);
  private items: readonly BuildItem[] = [];
  private _hoveredUnit: PlayerBuildableUnitType | null = null;
  private tutorialHighlight: PlayerBuildableUnitType | null = null;

  createRenderRoot() {
    return this;
  }

  init() {
    const config = this.game.config();
    this.keybinds = new UserSettings().parsedUserKeybinds();
    this.items = (
      config.horde() ? HORDE_BUILD_ITEMS : CLASSIC_BUILD_ITEMS
    ).filter((item) => !config.isUnitDisabled(item.type));

    const highlightUnits: Partial<
      Record<TutorialHighlight, PlayerBuildableUnitType>
    > = {
      city: UnitType.City,
      port: UnitType.Port,
      defense_post: UnitType.DefensePost,
      factory: UnitType.Factory,
      warship: UnitType.Warship,
      silo: UnitType.MissileSilo,
      atom: UnitType.AtomBomb,
      hydrogen: UnitType.HydrogenBomb,
      mirv: UnitType.MIRV,
      sam: UnitType.SAMLauncher,
    };
    this.eventBus.on(TutorialHighlightEvent, (e) => {
      this.tutorialHighlight = (e.target && highlightUnits[e.target]) ?? null;
      this.requestUpdate();
    });
    this.requestUpdate();
  }

  private cost(item: UnitType): Gold {
    for (const bu of this.playerBuildables ?? []) {
      if (bu.type === item) {
        return bu.cost;
      }
    }
    return 0n;
  }

  private canBuild(item: UnitType): boolean {
    if (this.game?.config().isUnitDisabled(item)) return false;
    const player = this.game?.myPlayer();
    switch (item) {
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
      case UnitType.MIRV:
        return (
          this.cost(item) <= (player?.gold() ?? 0n) &&
          (player?.units(UnitType.MissileSilo).length ?? 0) > 0
        );
      case UnitType.Warship:
        return (
          this.cost(item) <= (player?.gold() ?? 0n) &&
          (player?.units(UnitType.Port).length ?? 0) > 0
        );
      default:
        return this.cost(item) <= (player?.gold() ?? 0n);
    }
  }

  tick() {
    const player = this.game?.myPlayer();
    if (!player) return;
    player.buildables(undefined, BuildMenus.types).then((buildables) => {
      this.playerBuildables = buildables;
    });
    this.requestUpdate();
  }

  render() {
    const myPlayer = this.game?.myPlayer();
    if (
      !this.game ||
      !myPlayer ||
      this.game.inSpawnPhase() ||
      !myPlayer.isAlive() ||
      this.items.length === 0
    ) {
      return null;
    }
    const tagItem =
      this.items.find((i) => i.type === this._hoveredUnit) ??
      this.items.find((i) => i.type === this.uiState.ghostStructure);

    return html`
      <div class="zf-build">
        ${tagItem ? this.renderTag(tagItem) : nothing}
        <nav
          class="zf-build-strip zf-hud zf-frame"
          style="--zf-build-count: ${this.items.length}"
          aria-label=${translateText("unit_display.build")}
          @contextmenu=${(e: MouseEvent) => e.preventDefault()}
        >
          ${this.items.map((item) => this.renderItem(item))}
        </nav>
      </div>
    `;
  }

  private costLabel(type: UnitType): string {
    const cost = this.cost(type);
    return cost === 0n ? translateText("build_menu.free") : renderNumber(cost);
  }

  /** The building being placed or hovered: name, cost, levels, use. */
  private renderTag(item: BuildItem) {
    const maxLevel = this.game.config().maxUnitLevel(item.type);
    const hovered = this._hoveredUnit === item.type;
    return html`
      <div class="zf-build-tag zf-frame" aria-live="polite">
        <span class="zf-build-tag-head">
          <span class="zf-stencil"
            >${translateText(`unit_type.${item.key}`)}</span
          >
          <span class="zf-num" style="font-size: 13px" translate="no"
            >${this.costLabel(item.type)}</span
          >
          ${
            maxLevel <= MAX_SHOWN_LEVEL
              ? html`<span class="zf-build-tag-level"
                  >${translateText("unit_display.level", { max: maxLevel })}</span
                >`
              : nothing
          }
        </span>
        ${
          hovered
            ? html`<span class="zf-build-tag-desc"
                >${translateText(`build_menu.desc.${item.key}`)}${
                  item.type === UnitType.Warship
                    ? ` ${translateText("build_menu.warship_shift_hint")}`
                    : ""
                }</span
              >`
            : nothing
        }
      </div>
    `;
  }

  private renderItem(item: BuildItem) {
    const selected = this.uiState.ghostStructure === item.type;
    const hotkey = keyCapLabel(
      resolveKeybindLabel(
        this.keybinds[item.action],
        item.defaultCode,
        this.keyboardLayout.map,
      ),
      Platform.isMac,
    );
    const name = translateText(`unit_type.${item.key}`);
    const cost = this.costLabel(item.type);
    const label = hotkey
      ? translateText("unit_display.item_key", { name, cost, key: hotkey })
      : translateText("unit_display.item", { name, cost });
    const icon = item.icon.includes("/")
      ? html`<img src=${item.icon} alt="" aria-hidden="true" />`
      : zfIcon(item.icon as IconName, 26, 2.8);

    return html`
      <span
        class="zf-ring ${
          this.tutorialHighlight === item.type ? "tutorial-highlight" : ""
        }"
        @mouseenter=${() => this.hover(item.type)}
        @mouseleave=${() => this.hover(null)}
      >
        <button
          type="button"
          class="zf-frame zf-sweep zf-build-btn ${
            this.canBuild(item.type) ? "" : "zf-cannot-afford"
          }"
          aria-pressed=${selected ? "true" : "false"}
          aria-label=${label}
          @click=${() => this.toggle(item.type, selected)}
        >
          ${
            hotkey
              ? html`<span class="zf-num zf-build-key" aria-hidden="true"
                  >${hotkey}</span
                >`
              : nothing
          }
          ${icon}
          <span class="zf-num zf-build-cost" aria-hidden="true">${cost}</span>
        </button>
      </span>
    `;
  }

  private toggle(type: PlayerBuildableUnitType, selected: boolean) {
    if (selected) {
      this.uiState.ghostStructure = null;
    } else if (this.canBuild(type)) {
      this.uiState.ghostStructure = type;
    }
    this.requestUpdate();
  }

  /** Hovering a button shows its tag and highlights where it can go. */
  private hover(type: PlayerBuildableUnitType | null) {
    this._hoveredUnit = type;
    this.requestUpdate();
    if (type === null) {
      this.eventBus?.emit(new ToggleStructureEvent(null));
      return;
    }
    switch (type) {
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
        this.eventBus?.emit(
          new ToggleStructureEvent([
            UnitType.MissileSilo,
            UnitType.SAMLauncher,
          ]),
        );
        break;
      case UnitType.Warship:
        this.eventBus?.emit(new ToggleStructureEvent([UnitType.Port]));
        break;
      default:
        this.eventBus?.emit(new ToggleStructureEvent([type]));
    }
  }
}
