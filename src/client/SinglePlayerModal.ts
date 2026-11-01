import {
  Difficulty,
  Duos,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  Quads,
  Trios,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { TeamCountConfig } from "@openfront/engine-api/Schemas";
import {
  DOOMSDAY_CLOCK_SPEEDS,
  DoomsdayClockSpeed,
} from "@openfront/engine-lib/game/DoomsdayClock";
import { assetUrl } from "@openfront/shared/AssetUrls";
import { generateID } from "@openfront/shared/SharedUtil";
import { PlayerCosmetics } from "@openfront/shared/WireSchemas";
import { html, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import { BaseModal } from "./components/BaseModal";
import type { IconName } from "./components/nightshift/Icon";
import {
  MAP_FACTS,
  type MapFacts,
  mapFacts,
} from "./components/nightshift/MapFacts";
import {
  zfActionStrip,
  zfBackButton,
  zfMapBackdrop,
  zfMapCard,
  zfOptionGroup,
  zfPageHeader,
  zfPageTitle,
  zfPrimaryButton,
  zfSteps,
  zfSwitchChip,
  zfTerrainBars,
  zfTextField,
  zfTile,
  zfToggleChip,
} from "./components/nightshift/Primitives";
import { GameStartingModal } from "./GameStartingModal";
import { JoinLobbyEvent } from "./Main";
import { fallbackPlayerName, ResolvedPlayerName } from "./PlayerName";
import { UsernameInput } from "./UsernameInput";
import { UserSettings } from "./UserSettings";
import {
  parseBoundedFloatFromInput,
  parseBoundedIntegerFromInput,
  preventDisallowedKeys,
} from "./utilities/GameConfigHelpers";

/** What a start has to wait for before it can dispatch join-lobby. */
type StartPreparation = {
  resolvedName: ResolvedPlayerName;
  cosmetics: PlayerCosmetics;
};

type Step = "map" | "setup";

const DEFAULT_OPTIONS = {
  selectedMap: GameMapType.Bath,
  selectedDifficulty: Difficulty.Easy,
  infiniteGold: false,
  infiniteTroops: false,
  compactMap: false,
  maxTimerValue: undefined as number | undefined,
  instantBuild: false,
  randomSpawn: false,
  gameMode: GameMode.FFA,
  teamCount: 2 as TeamCountConfig,
  goldMultiplierValue: undefined as number | undefined,
  startingGoldValue: undefined as number | undefined,
  disabledUnits: [] as UnitType[],
  waterNukes: false,
  doomsdayClock: false,
  doomsdayClockSpeed: "normal" as DoomsdayClockSpeed,
  overtimeStartMinutes: undefined as number | undefined,
} as const;

/** The buildings a game can allow or leave out, in build-menu order. */
export const RULE_BUILDINGS: {
  unit: UnitType;
  labelKey: string;
  icon: IconName;
}[] = [
  { unit: UnitType.Wall, labelKey: "unit_type.wall", icon: "walls" },
  {
    unit: UnitType.DefensePost,
    labelKey: "unit_type.defense_post",
    icon: "turret",
  },
  { unit: UnitType.Mine, labelKey: "unit_type.mine", icon: "mine" },
  {
    unit: UnitType.NoiseBeacon,
    labelKey: "unit_type.noise_beacon",
    icon: "beacon",
  },
  { unit: UnitType.Depot, labelKey: "unit_type.depot", icon: "depot" },
  {
    unit: UnitType.MissileSilo,
    labelKey: "unit_type.missile_silo",
    icon: "mortar",
  },
  { unit: UnitType.Outpost, labelKey: "unit_type.outpost", icon: "outpost" },
];

/**
 * Shown, per the design, but disabled: the engine has no setting for them in
 * solo zombie games yet (waves are set per map; difficulty only tunes AI
 * players, and solo games have none).
 */
const DIFFICULTIES = [
  Difficulty.Easy,
  Difficulty.Medium,
  Difficulty.Hard,
  Difficulty.Impossible,
] as const;
const WAVE_OPTIONS = [5, 10, 15, 20, 30] as const;

const TEAM_COUNTS: TeamCountConfig[] = [2, 3, 4, 5, 6, 7, Quads, Trios, Duos];

/**
 * The solo game flow (Night Shift): 01 MAP, the map picker, then 02 SETUP,
 * the game rules, ending in START GAME. An inline page; the main menu's PLAY
 * SOLO opens it.
 */
@customElement("single-player-modal")
export class SinglePlayerModal extends BaseModal {
  protected routerName = "single-player";

  @state() private step: Step = "map";
  @state() private selectedMap: GameMapType = DEFAULT_OPTIONS.selectedMap;
  @state() private selectedDifficulty: Difficulty =
    DEFAULT_OPTIONS.selectedDifficulty;
  @state() private infiniteGold: boolean = DEFAULT_OPTIONS.infiniteGold;
  @state() private infiniteTroops: boolean = DEFAULT_OPTIONS.infiniteTroops;
  @state() private compactMap: boolean = DEFAULT_OPTIONS.compactMap;
  @state() private maxTimerValue: number | undefined =
    DEFAULT_OPTIONS.maxTimerValue;
  @state() private instantBuild: boolean = DEFAULT_OPTIONS.instantBuild;
  @state() private randomSpawn: boolean = DEFAULT_OPTIONS.randomSpawn;
  @state() private gameMode: GameMode = DEFAULT_OPTIONS.gameMode;
  @state() private teamCount: TeamCountConfig = DEFAULT_OPTIONS.teamCount;
  @state() private goldMultiplierValue: number | undefined =
    DEFAULT_OPTIONS.goldMultiplierValue;
  @state() private startingGoldValue: number | undefined =
    DEFAULT_OPTIONS.startingGoldValue;
  @state() private disabledUnits: UnitType[] = [
    ...DEFAULT_OPTIONS.disabledUnits,
  ];
  @state() private waterNukes: boolean = DEFAULT_OPTIONS.waterNukes;
  @state() private doomsdayClock: boolean = DEFAULT_OPTIONS.doomsdayClock;
  @state() private doomsdayClockSpeed: DoomsdayClockSpeed =
    DEFAULT_OPTIONS.doomsdayClockSpeed;
  @state() private overtimeStartMinutes: number | undefined =
    DEFAULT_OPTIONS.overtimeStartMinutes;
  // Drives the Start Game button's busy state. Without it the click produces
  // nothing visible until every await in startGame() settles, which reads as
  // a hang rather than as loading whenever the network is slow or absent.
  @state() private starting: boolean = false;
  // Identifies the current start attempt. Bumped on every start and on every
  // close, so an attempt that outlives its modal can tell it has been retired.
  private startAttempt: number = 0;
  // Which attempt the starting overlay is up for, so a retired attempt's
  // cleanup cannot hide the overlay a newer attempt has shown.
  private overlayAttempt: number = 0;

  /**
   * The page is drawn here rather than in BaseModal's <o-modal>: Night Shift
   * pages are full-width with their own backdrop. BaseModal still owns
   * open/close, Escape and the router.
   */
  render(): TemplateResult {
    const facts = mapFacts(this.selectedMap);
    return html`<section
      class="zf-page"
      aria-labelledby=${this.step === "map" ? "zf-map-title" : "zf-setup-title"}
    >
      ${zfMapBackdrop(assetUrl(facts.preview))}
      <div class="zf-page-inner">
        ${this.step === "map" ? this.renderMapStep(facts) : this.renderSetupStep(facts)}
      </div>
    </section>`;
  }

  private steps(): TemplateResult {
    const onMap = this.step === "map";
    return zfSteps(translateText("zf_play.steps"), [
      {
        label: translateText("zf_play.step_map"),
        state: onMap ? "current" : "done",
      },
      {
        label: translateText("zf_play.step_setup"),
        state: onMap ? "upcoming" : "current",
      },
    ]);
  }

  private mapName(facts: MapFacts): string {
    return translateText(`map.${facts.map.toLowerCase()}`);
  }

  private mapTag(facts: MapFacts): string {
    const kind = translateText(`zf_play.kind_${facts.kind}`);
    return facts.km !== undefined
      ? translateText("zf_play.tag_km", { kind, km: facts.km })
      : translateText("zf_play.tag_region", { kind });
  }

  private mapScale(facts: MapFacts): string {
    return facts.km !== undefined && facts.metresPerTile !== undefined
      ? translateText("zf_play.scale_town", {
          km: facts.km,
          w: facts.tilesWide,
          h: facts.tilesHigh,
          m: facts.metresPerTile,
        })
      : translateText("zf_play.scale_tiles", {
          w: facts.tilesWide,
          h: facts.tilesHigh,
        });
  }

  private terrain(facts: MapFacts): TemplateResult {
    return zfTerrainBars([
      {
        label: translateText("zf_play.terrain_open"),
        pct: facts.open,
        kind: "open",
      },
      {
        label: translateText("zf_play.terrain_solid"),
        pct: facts.solid,
        kind: "solid",
      },
      {
        label: translateText("zf_play.terrain_water"),
        pct: facts.water,
        kind: "water",
      },
    ]);
  }

  private renderMapStep(facts: MapFacts): TemplateResult {
    const name = this.mapName(facts);
    return html`
      ${zfPageHeader(
        zfBackButton({
          label: translateText("zf_play.back_menu"),
          onClick: () => this.close(),
        }),
        this.steps(),
      )}
      ${zfPageTitle("zf-map-title", translateText("zf_play.map_title"))}
      <div
        class="zf-maps"
        role="radiogroup"
        aria-label=${translateText("zf_play.maps")}
      >
        ${MAP_FACTS.map((f) =>
          zfMapCard({
            name: this.mapName(f),
            tag: this.mapTag(f),
            image: assetUrl(f.preview),
            imagePosition: f.previewPosition,
            selected: f.map === this.selectedMap,
            onSelect: () => (this.selectedMap = f.map),
          }),
        )}
      </div>
      <section
        class="zf-selected-map zf-frame zf-frame-lg"
        aria-label=${translateText("zf_play.selected_ground")}
      >
        <img
          src=${assetUrl(facts.preview)}
          alt=""
          draggable="false"
          style="object-position: ${facts.previewPosition}"
        />
        <div class="zf-selected-map-body">
          <div class="zf-selected-map-head">
            <span class="zf-ground-title">${name}</span>
            <span class="zf-selected-map-scale">${this.mapScale(facts)}</span>
          </div>
          <span class="zf-strip-label zf-selected-map-rule"
            >${translateText("zf_play.terrain")}</span
          >
          ${this.terrain(facts)}
        </div>
      </section>
      ${zfActionStrip({
        label: translateText("zf_play.selected_ground"),
        content: html`
          <div class="zf-ground">
            <div class="zf-ground-name">
              <span class="zf-strip-label"
                >${translateText("zf_play.selected_ground")}</span
              >
              <h2 class="zf-ground-title">${name}</h2>
              <span class="zf-ground-scale">${this.mapScale(facts)}</span>
            </div>
            <div class="zf-ground-terrain">
              <span class="zf-strip-label"
                >${translateText("zf_play.terrain")}</span
              >
              ${this.terrain(facts)}
            </div>
          </div>
        `,
        action: zfPrimaryButton({
          label: translateText("zf_play.continue"),
          onClick: () => this.goTo("setup"),
        }),
        compact: true,
      })}
    `;
  }

  private renderSetupStep(facts: MapFacts): TemplateResult {
    const allowed = RULE_BUILDINGS.filter(
      (b) => !this.disabledUnits.includes(b.unit),
    ).length;
    const comingSoon = translateText("zf_play.coming_soon");
    return html`
      ${zfPageHeader(
        zfBackButton({
          label: translateText("zf_play.back_change_map"),
          onClick: () => this.goTo("map"),
        }),
        this.steps(),
      )}
      ${zfPageTitle("zf-setup-title", translateText("zf_play.setup_title"))}
      <div class="zf-tiles">
        ${zfTile({
          title: translateText("zf_play.difficulty"),
          note: comingSoon,
          disabled: true,
          body: zfOptionGroup({
            label: translateText("zf_play.difficulty"),
            options: DIFFICULTIES.map((d) => ({
              value: d,
              label: translateText(`difficulty.${d.toLowerCase()}`),
            })),
            value: undefined as Difficulty | undefined,
            onSelect: () => {},
            columns: 2,
            disabled: true,
          }),
        })}
        ${zfTile({
          title: translateText("zf_play.waves"),
          note: comingSoon,
          disabled: true,
          body: zfOptionGroup({
            label: translateText("zf_play.waves"),
            options: WAVE_OPTIONS.map((n) => ({ value: n, label: String(n) })),
            value: undefined as number | undefined,
            onSelect: () => {},
            fontSize: "34px",
            disabled: true,
          }),
        })}
        ${zfTile({
          title: translateText("zf_play.economy"),
          body: html`<div class="zf-field-pair">
            ${zfTextField({
              id: "zf-starting-cash",
              label: translateText("zf_play.starting_cash"),
              type: "number",
              inputmode: "numeric",
              placeholder: "0",
              min: 0,
              max: 10_000_000,
              step: 1,
              value: this.startingGoldValue?.toString() ?? "",
              onInput: this.handleStartingCashInput,
              onKeyDown: (e) =>
                preventDisallowedKeys(e, ["-", "+", "e", "E", "."]),
            })}
            ${zfTextField({
              id: "zf-cash-multiplier",
              label: translateText("zf_play.cash_multiplier"),
              type: "number",
              inputmode: "decimal",
              placeholder: "1",
              min: 0.1,
              max: 1000,
              step: "any",
              value: this.goldMultiplierValue?.toString() ?? "",
              onInput: this.handleCashMultiplierInput,
              onKeyDown: (e) => preventDisallowedKeys(e, ["-", "+", "e", "E"]),
            })}
          </div>`,
        })}
      </div>
      ${zfTile({
        title: translateText("zf_play.rules"),
        body: html`<div class="zf-chips">
          ${zfSwitchChip({
            label: translateText("zf_play.rule_interest"),
            checked: false,
            onToggle: () => {},
            disabled: true,
          })}
          ${zfSwitchChip({
            label: translateText("zf_play.rule_instant_build"),
            checked: this.instantBuild,
            onToggle: (v) => (this.instantBuild = v),
          })}
          ${zfSwitchChip({
            label: translateText("zf_play.rule_infinite_cash"),
            checked: this.infiniteGold,
            onToggle: (v) => (this.infiniteGold = v),
          })}
          ${zfSwitchChip({
            label: translateText("zf_play.rule_random_spawn"),
            checked: this.randomSpawn,
            onToggle: (v) => (this.randomSpawn = v),
          })}
        </div>`,
      })}
      ${zfTile({
        title: translateText("zf_play.buildings"),
        body: html`<div class="zf-chips">
          ${RULE_BUILDINGS.map((b) =>
            zfToggleChip({
              label: translateText(b.labelKey),
              icon: b.icon,
              pressed: !this.disabledUnits.includes(b.unit),
              onToggle: (on) => this.setUnitAllowed(b.unit, on),
            }),
          )}
        </div>`,
      })}
      ${this.renderAdvanced()}
      ${zfActionStrip({
        label: translateText("zf_play.briefing"),
        items: [
          {
            label: translateText("zf_play.summary_map"),
            value: this.mapName(facts),
          },
          {
            label: translateText("zf_play.summary_buildings"),
            value: translateText("zf_play.summary_buildings_value", {
              n: allowed,
              total: RULE_BUILDINGS.length,
            }),
          },
        ],
        action: zfPrimaryButton({
          label: translateText(
            this.starting ? "zf_play.starting" : "zf_play.start",
          ),
          busy: this.starting,
          disabled: this.starting,
          onClick: () => void this.startGame(),
        }),
      })}
    `;
  }

  /** OpenFront's options that aren't on the Night Shift board, kept here. */
  private renderAdvanced(): TemplateResult {
    return html`<details class="zf-advanced zf-frame zf-frame-lg">
      <summary class="zf-advanced-summary">
        <span class="zf-tile-title">${translateText("zf_play.advanced")}</span>
      </summary>
      <div class="zf-advanced-body">
        <div class="zf-chips">
          ${zfSwitchChip({
            label: translateText("game_settings.infinite_troops"),
            checked: this.infiniteTroops,
            onToggle: (v) => (this.infiniteTroops = v),
          })}
          ${zfSwitchChip({
            label: translateText("game_settings.compact_map"),
            checked: this.compactMap,
            onToggle: (v) => (this.compactMap = v),
          })}
          ${zfSwitchChip({
            label: translateText("game_settings.water_nukes"),
            checked: this.waterNukes,
            onToggle: (v) => (this.waterNukes = v),
          })}
          ${zfSwitchChip({
            label: translateText("game_settings.doomsday_clock"),
            checked: this.doomsdayClock,
            onToggle: (v) => (this.doomsdayClock = v),
          })}
        </div>
        ${
          this.doomsdayClock
            ? zfOptionGroup({
                label: translateText("game_settings.doomsday_clock"),
                options: DOOMSDAY_CLOCK_SPEEDS.map((s) => ({
                  value: s,
                  label: translateText(`doomsday_clock_speed.${s}`),
                })),
                value: this.doomsdayClockSpeed,
                onSelect: (s) => (this.doomsdayClockSpeed = s),
                fontSize: "20px",
              })
            : nothing
        }
        <div class="zf-field-pair">
          ${zfTextField({
            id: "zf-max-timer",
            label: translateText("game_settings.max_timer"),
            type: "number",
            inputmode: "numeric",
            placeholder: translateText("game_settings.mins_placeholder"),
            min: 1,
            max: 120,
            step: 1,
            value: this.maxTimerValue?.toString() ?? "",
            onInput: this.handleMaxTimerInput,
            onKeyDown: (e) =>
              preventDisallowedKeys(e, ["-", "+", "e", "E", "."]),
          })}
          ${zfTextField({
            id: "zf-overtime",
            label: translateText("game_settings.overtime"),
            type: "number",
            inputmode: "numeric",
            placeholder: translateText("game_settings.mins_placeholder"),
            min: 1,
            max: 120,
            step: 1,
            value: this.overtimeStartMinutes?.toString() ?? "",
            onInput: this.handleOvertimeInput,
            onKeyDown: (e) =>
              preventDisallowedKeys(e, ["-", "+", "e", "E", "."]),
          })}
        </div>
        ${zfOptionGroup({
          label: translateText("host_modal.mode"),
          options: [
            { value: GameMode.FFA, label: translateText("game_mode.ffa") },
            { value: GameMode.Team, label: translateText("game_mode.teams") },
          ],
          value: this.gameMode,
          onSelect: (m) => (this.gameMode = m),
          fontSize: "22px",
        })}
        ${
          this.gameMode === GameMode.Team
            ? zfOptionGroup({
                label: translateText("host_modal.team_count"),
                options: TEAM_COUNTS.map((c) => ({
                  value: c,
                  label:
                    typeof c === "number"
                      ? String(c)
                      : translateText(`host_modal.teams_${c}`),
                })),
                value: this.teamCount,
                onSelect: (c) => (this.teamCount = c),
                columns: 3,
                fontSize: "20px",
              })
            : nothing
        }
      </div>
    </details>`;
  }

  /** Moves between the two steps and back to the top of the page. */
  private goTo(step: Step) {
    this.step = step;
    this.updateComplete.then(() => {
      this.querySelector(".zf-page")?.scrollTo?.({ top: 0 });
      this.querySelector<HTMLElement>(".zf-page-title")?.focus?.();
    });
  }

  private setUnitAllowed(unit: UnitType, allowed: boolean) {
    const without = this.disabledUnits.filter((u) => u !== unit);
    this.disabledUnits = allowed ? without : [...without, unit];
  }

  private handleStartingCashInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    this.startingGoldValue =
      input.value === ""
        ? undefined
        : parseBoundedIntegerFromInput(input, {
            min: 0,
            max: 10_000_000,
            stripPattern: /[e+.-]/gi,
          });
  };

  private handleCashMultiplierInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    this.goldMultiplierValue =
      input.value === ""
        ? undefined
        : parseBoundedFloatFromInput(input, { min: 0.1, max: 1000 });
  };

  private handleMaxTimerInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    this.maxTimerValue =
      input.value === ""
        ? undefined
        : parseBoundedIntegerFromInput(input, {
            min: 1,
            max: 120,
            stripPattern: /[e+.-]/gi,
          });
  };

  private handleOvertimeInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    this.overtimeStartMinutes =
      input.value === ""
        ? undefined
        : parseBoundedIntegerFromInput(input, {
            min: 1,
            max: 120,
            stripPattern: /[e+.-]/gi,
          });
  };

  protected onOpen(): void {
    this.step = "map";
  }

  protected onClose(): void {
    // Retires whatever start is still in flight. resetOptions() below hands
    // back a live button, so the player can close, reopen and start again
    // while the previous attempt is still resolving — and that attempt is
    // now describing settings the modal no longer holds. Without this, both
    // attempts dispatch join-lobby with different gameIDs and whichever
    // resolves last wins, which can be the one the player abandoned.
    this.startAttempt++;
    // If the retired attempt still owned the starting overlay it never
    // dispatched join-lobby, so nothing downstream will hide it: without
    // this, dismissing the modal mid-preparation leaves a full-screen
    // overlay blocking the menu until the preparation deadline settles.
    if (this.overlayAttempt !== 0) {
      this.overlayAttempt = 0;
      const startingModal = document.querySelector("game-starting-modal");
      if (startingModal instanceof GameStartingModal) {
        startingModal.hide();
      }
    }
    this.resetOptions();
  }

  /**
   * Starts a solo game on the default settings without opening the modal,
   * with the in-game tutorial switched back on (the main menu's Tutorial
   * link).
   */
  public async startTutorial(): Promise<void> {
    this.resetOptions();
    new UserSettings().setTutorialDismissed(false);
    await this.startGame();
  }

  // Reset all transient form state to ensure clean slate
  private resetOptions(): void {
    // Belt and braces with the finally in startGame(): closing and reopening
    // the modal must always give the player a live Start button back, whatever
    // left the previous attempt in flight.
    this.starting = false;
    this.step = "map";
    this.selectedMap = DEFAULT_OPTIONS.selectedMap;
    this.selectedDifficulty = DEFAULT_OPTIONS.selectedDifficulty;
    this.gameMode = DEFAULT_OPTIONS.gameMode;
    this.infiniteGold = DEFAULT_OPTIONS.infiniteGold;
    this.infiniteTroops = DEFAULT_OPTIONS.infiniteTroops;
    this.compactMap = DEFAULT_OPTIONS.compactMap;
    this.maxTimerValue = DEFAULT_OPTIONS.maxTimerValue;
    this.instantBuild = DEFAULT_OPTIONS.instantBuild;
    this.randomSpawn = DEFAULT_OPTIONS.randomSpawn;
    this.teamCount = DEFAULT_OPTIONS.teamCount;
    this.disabledUnits = [...DEFAULT_OPTIONS.disabledUnits];
    this.goldMultiplierValue = DEFAULT_OPTIONS.goldMultiplierValue;
    this.startingGoldValue = DEFAULT_OPTIONS.startingGoldValue;
    this.waterNukes = DEFAULT_OPTIONS.waterNukes;
    this.doomsdayClock = DEFAULT_OPTIONS.doomsdayClock;
    this.doomsdayClockSpeed = DEFAULT_OPTIONS.doomsdayClockSpeed;
    this.overtimeStartMinutes = DEFAULT_OPTIONS.overtimeStartMinutes;
  }

  /** The player's name, once the one-shot name seed has settled. */
  private async resolveName(
    usernameInput: UsernameInput | null,
  ): Promise<StartPreparation> {
    await usernameInput?.whenSeeded();
    const resolvedName = usernameInput?.resolvedName() ?? fallbackPlayerName();
    return {
      resolvedName,
      cosmetics: resolvedName.verified ? { verified: true } : {},
    };
  }

  private async startGame() {
    // A second click while the first is still resolving would dispatch a
    // second join-lobby for a different gameID.
    if (this.starting) return;
    const finalMaxTimerValue =
      this.maxTimerValue === undefined
        ? undefined
        : Math.max(1, Math.min(120, this.maxTimerValue));

    await this.launch(async ({ resolvedName, cosmetics }, usernameInput) => {
      console.log(`Starting single player game with map: ${this.selectedMap}`);
      const clientID = generateID();
      const gameID = generateID();
      return {
        gameID: gameID,
        gameStartInfo: {
          gameID: gameID,
          players: [
            {
              clientID,
              username: resolvedName.name,
              cosmetics,
            },
          ],
          config: {
            gameMap: this.selectedMap,
            gameMapSize: this.compactMap
              ? GameMapSize.Compact
              : GameMapSize.Normal,
            gameType: GameType.Singleplayer,
            gameMode: this.gameMode,
            playerTeams: this.teamCount,
            difficulty: this.selectedDifficulty,
            maxTimerValue: finalMaxTimerValue,
            // zfront: solo games have no AI players (requirements-draft.md).
            bots: 0,
            infiniteGold: this.infiniteGold,
            donateGold: this.gameMode === GameMode.Team,
            donateTroops: this.gameMode === GameMode.Team,
            infiniteTroops: this.infiniteTroops,
            instantBuild: this.instantBuild,
            randomSpawn: this.randomSpawn,
            disabledUnits: this.disabledUnits.filter((unit): unit is UnitType =>
              Object.values(UnitType).includes(unit),
            ),
            nations: "disabled",
            ...(this.goldMultiplierValue !== undefined
              ? { goldMultiplier: this.goldMultiplierValue }
              : {}),
            // Gold on top of the horde's own starting gold.
            ...(this.startingGoldValue !== undefined
              ? { startingGold: Math.round(this.startingGoldValue) }
              : {}),
            ...(this.waterNukes ? { waterNukes: true } : {}),
            // zfront spike: every solo game has zombie waves.
            horde: true,
            ...(this.doomsdayClock
              ? {
                  doomsdayClock: {
                    enabled: true,
                    speed: this.doomsdayClockSpeed,
                  },
                }
              : {}),
            ...(this.overtimeStartMinutes !== undefined
              ? {
                  overtime: {
                    enabled: true,
                    startMinutes: this.overtimeStartMinutes,
                  },
                }
              : {}),
          },
          lobbyCreatedAt: Date.now(), // ms; server should be authoritative in MP
        },
        source: "singleplayer",
      };
    });
  }

  /**
   * What every solo start shares: the busy button, the starting overlay, the
   * player's name and cosmetics, the midgame ad and the join-lobby dispatch.
   * `build` makes the event once the name and cosmetics are known, before
   * the ad; throwing from it abandons the start (and reaches the caller).
   */
  private async launch(
    build: (
      prepared: StartPreparation,
      usernameInput: UsernameInput | null,
    ) => Promise<JoinLobbyEvent>,
  ): Promise<void> {
    // Everything past this point awaits something, some of it network-bound.
    // Hold the button in its busy state until join-lobby is away so the wait
    // reads as loading rather than as a dead click.
    this.starting = true;
    const attempt = ++this.startAttempt;
    // The full-screen starting overlay, up from the click rather than at
    // prestart: it also covers Main's own awaits after the dispatch. On
    // success GameRenderer hides it (a canPlay() refusal hides it in
    // handleJoinLobby); an attempt that never dispatches reaches neither, so
    // onClose (or the finally below, for exits without a close) releases it.
    const startingModal = document.querySelector("game-starting-modal");
    const overlay =
      startingModal instanceof GameStartingModal ? startingModal : null;
    this.overlayAttempt = attempt;
    overlay?.show();
    try {
      const usernameInput = document.querySelector(
        "username-input",
      ) as UsernameInput | null;

      // Resolved before the dispatch rather than inside it, so every wait is
      // attributable to the busy button above, and bounded so none of them
      // can outlive it.
      const prepared = await this.resolveName(usernameInput);

      // Retired while this was resolving — the modal was closed, and possibly
      // reopened and started again. The live attempt owns the start; this one
      // would otherwise race it into join-lobby with stale settings.
      //
      // A start has exactly two side effects that leave this component, and
      // BOTH must sit behind this check. Anything added here that escapes the
      // component needs the same gate:
      //   1. awaitMidgameAd() — shows the player a real ad, so an abandoned
      //      attempt reaching it advertises a game that never starts, and a
      //      reopened modal can put a second request in flight beside it.
      //   2. the join-lobby dispatch — and everything downstream of it,
      //      including Main's gameplayStart() and incrementGamesPlayed().
      // resolveNameAndCosmetics() above is deliberately NOT gated: its only
      // writes are validating stored cosmetic selections against the catalog
      // and profile, which happens on any cosmetics resolution (menu
      // background, store, inventory) rather than as a consequence of this
      // start.
      if (attempt !== this.startAttempt) return;

      const detail = await build(prepared, usernameInput);

      // Building can wait on the network (a saved game's download).
      if (attempt !== this.startAttempt) return;

      this.dispatchEvent(
        new CustomEvent("join-lobby", {
          detail,
          bubbles: true,
          composed: true,
        }),
      );
      // The overlay is the join pipeline's now — GameRenderer or Main's
      // canPlay() refusal hides it. Disowning it keeps the close below (and
      // any later onClose) from taking it down mid game-load.
      this.overlayAttempt = 0;
      this.close();
    } finally {
      // Only if this attempt is still the live one: a retired attempt
      // settling later must not clear the busy state of the one that
      // replaced it.
      if (attempt === this.startAttempt) this.starting = false;
      // An attempt that still owns the overlay dispatched nothing, so no
      // downstream hide point will ever fire for it. onClose normally
      // releases it the moment the modal is dismissed; this catches exits
      // without a close, like resolveNameAndCosmetics() throwing.
      if (this.overlayAttempt === attempt) {
        this.overlayAttempt = 0;
        overlay?.hide();
      }
    }
  }
}
