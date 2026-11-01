import { assetUrl } from "@openfront/shared/AssetUrls";
import { html, nothing, type TemplateResult } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import {
  DESKTOP_TUTORIAL_VIDEO_URL,
  keyCapLabel,
  textDirection,
  translateText,
  TUTORIAL_VIDEO_URL,
} from "../client/Utils";
import { BaseModal } from "./components/BaseModal";
import "./components/Difficulties";
import { zfButton, zfKeyCap, zfTile } from "./components/nightshift/Primitives";
import { KeyboardLayoutController } from "./KeyboardLayout";
import { Platform } from "./Platform";
import { TroubleshootingModal } from "./TroubleshootingModal";
import { UserSettings } from "./UserSettings";

@customElement("help-modal")
export class HelpModal extends BaseModal {
  protected routerName = "help";

  @state() private keybinds: Record<string, string> = this.getKeybinds();
  @query("#tutorial-video-iframe") private videoIframe?: HTMLIFrameElement;
  @query("#tutorial-video-player") private videoPlayer?: HTMLVideoElement;
  private keyboardLayout = new KeyboardLayoutController(this);

  private getKeybinds(): Record<string, string> {
    return new UserSettings().keybinds(Platform.isMac);
  }

  private getKeyLabel(code: string): string {
    if (!code) return "";
    const layoutMap = this.keyboardLayout.map;

    // The layout's own character for letter and punctuation keys (so AZERTY
    // reads A, not Q); everything else, and the number row, by its code.
    if (
      layoutMap?.has(code) &&
      /^(Key[A-Z]|Period|Comma|Minus|Equal|Slash|Semicolon|Quote|Bracket(Left|Right)|Backslash|Backquote)$/.test(
        code,
      )
    ) {
      return keyCapLabel(layoutMap.get(code)!, Platform.isMac);
    }
    return keyCapLabel(code, Platform.isMac);
  }

  /** One key as a KeyCap, named for the player's keyboard layout. */
  private key(code: string) {
    return zfKeyCap(this.getKeyLabel(code));
  }

  /** A mouse action, in words (Click, Scroll…). */
  private mouse(labelKey: string) {
    return html`<span class="zf-keys-word">${translateText(labelKey)}</span>`;
  }

  private plus() {
    return html`<span class="zf-keycap-plus" aria-hidden="true">+</span>`;
  }

  private hotkeyRow(keys: TemplateResult, actionKey: string) {
    return html`<div class="zf-row">
      <span class="zf-row-label">${translateText(actionKey)}</span>
      <span class="zf-keys" dir="ltr">${keys}</span>
    </div>`;
  }

  private renderHotkeys() {
    const k = this.keybinds;
    const rows: [TemplateResult, string][] = [
      [this.key("Escape"), "help_modal.action_esc"],
      [this.key("Enter"), "help_modal.action_enter"],
      [this.key(k.toggleView), "user_setting.toggle_view_desc"],
      [this.key(k.coordinateGrid), "help_modal.action_coordinate_grid"],
      [this.key(k.swapDirection), "help_modal.bomb_direction"],
      [
        html`${this.key(k.shiftKey)}${this.plus()}${this.mouse("zf_help.click")}`,
        "help_modal.action_attack_altclick",
      ],
      [
        html`${this.key(k.buildMenuModifier)}${this.plus()}${this.mouse("zf_help.click")}`,
        "help_modal.action_build",
      ],
      [
        html`${this.key(k.emojiMenuModifier)}${this.plus()}${this.mouse("zf_help.click")}`,
        "help_modal.action_emote",
      ],
      [this.key(k.quickChat), "help_modal.action_quick_chat"],
      [this.key(k.emojiMenu), "help_modal.action_emote"],
      [this.key(k.centerCamera), "user_setting.center_camera_desc"],
      [this.key(k.pauseGame), "help_modal.action_pause_game"],
      [
        html`${this.key(k.gameSpeedDown)}${this.key(k.gameSpeedUp)}`,
        "help_modal.action_game_speed",
      ],
      [
        html`${this.key(k.zoomOut)}${this.key(k.zoomIn)}`,
        "help_modal.action_zoom",
      ],
      [
        html`${this.key(k.moveUp)}${this.key(k.moveLeft)}${this.key(
          k.moveDown,
        )}${this.key(k.moveRight)}`,
        "help_modal.action_move_camera",
      ],
      [
        html`${this.key(k.attackRatioDown)}${this.key(k.attackRatioUp)}`,
        "help_modal.action_ratio_change",
      ],
      [
        html`${this.key(k.shiftKey)}${this.plus()}${this.mouse("zf_help.scroll")}`,
        "help_modal.action_ratio_change",
      ],
      [
        html`${this.key(k.altKey)}${this.plus()}${this.key(k.resetGfx)}`,
        "help_modal.action_reset_gfx",
      ],
      [this.mouse("zf_help.middle_click"), "help_modal.action_auto_upgrade"],
      [
        html`${this.key(k.boxSelectWarships)}${this.plus()}${this.mouse("help_modal.drag")}`,
        "help_modal.action_warship_multiselect",
      ],
      [this.key(k.selectAllWarships), "help_modal.action_warship_selectall"],
    ];
    return zfTile({
      title: translateText("help_modal.hotkeys"),
      className: "zf-tile-rows",
      body: html`<div class="zf-hotkeys">
        ${rows.map(([keys, action]) => this.hotkeyRow(keys, action))}
      </div>`,
    });
  }

  /** A screenshot of a piece of the HUD, its description and its points. */
  private feature(opts: {
    title: string;
    images: { src: string; alt: string }[];
    text: string;
    points?: string[];
  }) {
    return zfTile({
      title: translateText(opts.title),
      body: html`<div class="zf-help-feature">
        <div class="zf-help-figures">
          ${opts.images.map(
            (img) =>
              html`<img
                class="zf-figure"
                src=${assetUrl(img.src)}
                alt=${img.alt}
                loading="lazy"
              />`,
          )}
        </div>
        <div class="zf-help-text">
          <p class="zf-prose">${translateText(opts.text)}</p>
          ${
            opts.points
              ? html`<ul class="zf-list zf-list-bullets">
                  ${opts.points.map((p) => html`<li>${translateText(p)}</li>`)}
                </ul>`
              : nothing
          }
        </div>
      </div>`,
    });
  }

  /** A list of HUD icons and what each does. */
  private iconList(items: [string, string][]) {
    return html`<ul class="zf-list">
      ${items.map(
        ([icon, text]) =>
          html`<li>
            <img src=${assetUrl(icon)} alt="" />
            <span>${translateText(text)}</span>
          </li>`,
      )}
    </ul>`;
  }

  private renderBuildList() {
    const builds: [string, string, string][] = [
      [
        "unit_type.city",
        "images/CityIconWhite.svg",
        "help_modal.build_city_desc",
      ],
      [
        "unit_type.defense_post",
        "images/TurretIconWhite.svg",
        "help_modal.build_defense_desc",
      ],
      ["unit_type.port", "images/PortIcon.svg", "help_modal.build_port_desc"],
      [
        "unit_type.factory",
        "images/FactoryIconWhite.svg",
        "help_modal.build_factory_desc",
      ],
      [
        "unit_type.warship",
        "images/BattleshipIconWhite.svg",
        "help_modal.build_warship_desc",
      ],
      [
        "unit_type.missile_silo",
        "images/MortarIconWhite.svg",
        "help_modal.build_silo_desc",
      ],
      [
        "unit_type.sam_launcher",
        "images/SamLauncherIconWhite.svg",
        "help_modal.build_sam_desc",
      ],
      [
        "unit_type.atom_bomb",
        "images/NukeIconWhite.svg",
        "help_modal.build_atom_desc",
      ],
      [
        "unit_type.hydrogen_bomb",
        "images/MushroomCloudIconWhite.svg",
        "help_modal.build_hydrogen_desc",
      ],
      ["unit_type.mirv", "images/MIRVIcon.svg", "help_modal.build_mirv_desc"],
    ];
    return zfTile({
      title: translateText("help_modal.build_menu_title"),
      body: html`<p class="zf-prose zf-prose-muted">
          ${translateText("help_modal.build_menu_desc")}
        </p>
        <div>
          ${builds.map(
            ([name, icon, desc]) =>
              html`<div class="zf-build-row">
                <img src=${assetUrl(icon)} alt="" />
                <div>
                  <div class="zf-row-label">${translateText(name)}</div>
                  <p class="zf-prose zf-prose-muted">${translateText(desc)}</p>
                </div>
              </div>`,
          )}
        </div>`,
    });
  }

  protected pageTitle(): string {
    return translateText("main.help");
  }

  protected renderBody() {
    return html`
      <div dir=${textDirection()} class="zf-panel">
        <div class="zf-panel-grid">
          ${zfTile({
            title: translateText("help_modal.in_game_tutorial"),
            body: html`<p class="zf-prose">
                ${translateText("help_modal.in_game_tutorial_desc")}
              </p>
              <div style="display: flex">
                ${zfButton({
                  label: translateText("help_modal.in_game_tutorial_start"),
                  variant: "signal",
                  icon: "play",
                  onClick: () =>
                    document.dispatchEvent(new CustomEvent("start-tutorial")),
                })}
              </div>`,
          })}
          ${zfTile({
            title: translateText("main.troubleshooting"),
            body: html`<p class="zf-prose">
                ${translateText("help_modal.troubleshooting_desc")}
              </p>
              <div style="display: flex">
                ${zfButton({
                  id: "troubleshooting-button",
                  label: translateText("main.go_to_troubleshooting"),
                  variant: "outline-signal",
                  icon: "warning",
                  onClick: () => this.openTroubleshooting(),
                })}
              </div>`,
          })}
        </div>

        ${zfTile({
          title: translateText("help_modal.video_tutorial"),
          body: html`<div class="zf-media">
            ${
              Platform.isElectron
                ? html`<video
                    id="tutorial-video-player"
                    src="${DESKTOP_TUTORIAL_VIDEO_URL}"
                    title="${translateText("help_modal.video_tutorial_title")}"
                    controls
                    preload="metadata"
                  ></video>`
                : html`<iframe
                    id="tutorial-video-iframe"
                    src="${this.isModalOpen ? TUTORIAL_VIDEO_URL : ""}"
                    title="${translateText("help_modal.video_tutorial_title")}"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowfullscreen
                  ></iframe>`
            }
          </div>`,
        })}
        ${this.renderHotkeys()}

        <h2 class="zf-section-title">
          ${translateText("help_modal.ui_section")}
        </h2>
        <div class="zf-panel-grid">
          ${this.feature({
            title: "help_modal.ui_leaderboard",
            images: [
              { src: "images/helpModal/leaderboard2.webp", alt: "Leaderboard" },
            ],
            text: "help_modal.ui_leaderboard_desc",
          })}
          ${this.feature({
            title: "help_modal.ui_control",
            images: [
              {
                src: "images/helpModal/controlPanel.webp",
                alt: "Control Panel",
              },
            ],
            text: "help_modal.ui_control_desc",
            points: ["help_modal.ui_gold", "help_modal.ui_attack_ratio"],
          })}
          ${this.feature({
            title: "help_modal.ui_events",
            images: [
              { src: "images/helpModal/eventsPanel.webp", alt: "Events" },
              {
                src: "images/helpModal/eventsPanelAttack.webp",
                alt: "Events Attack",
              },
            ],
            text: "help_modal.ui_events_desc",
            points: [
              "help_modal.ui_events_attack",
              "help_modal.ui_events_quickchat",
            ],
          })}
          ${this.feature({
            title: "help_modal.ui_options",
            images: [{ src: "images/helpModal/options2.webp", alt: "Options" }],
            text: "help_modal.ui_options_desc",
            points: [
              "help_modal.option_timer",
              "help_modal.option_speed",
              "help_modal.option_pause",
              "help_modal.option_settings",
              "help_modal.option_exit",
            ],
          })}
          ${this.feature({
            title: "help_modal.ui_playeroverlay",
            images: [
              {
                src: "images/helpModal/playerInfoOverlay.webp",
                alt: "Player Info",
              },
            ],
            text: "help_modal.ui_playeroverlay_desc",
          })}
        </div>

        <div class="zf-panel-grid">
          ${zfTile({
            title: translateText("help_modal.radial_title"),
            body: html`<div class="zf-help-feature">
              <div class="zf-help-figures">
                <img
                  class="zf-figure"
                  src=${assetUrl("images/helpModal/radialMenu2.webp")}
                  alt="Radial Menu"
                  loading="lazy"
                />
                <img
                  class="zf-figure"
                  src=${assetUrl("images/helpModal/radialMenuAlly.webp")}
                  alt="Radial Menu Ally"
                  loading="lazy"
                />
              </div>
              <div class="zf-help-text">
                <p class="zf-prose">
                  ${translateText("help_modal.radial_desc")}
                </p>
                ${this.iconList([
                  ["images/BuildIconWhite.svg", "help_modal.radial_build"],
                  ["images/InfoIcon.svg", "help_modal.radial_info"],
                  ["images/BoatIconWhite.svg", "help_modal.radial_boat"],
                  [
                    "images/DonateTroopIconWhite.svg",
                    "help_modal.radial_donate_troops",
                  ],
                  [
                    "images/DonateGoldIconWhite.svg",
                    "help_modal.radial_donate_gold",
                  ],
                ])}
              </div>
            </div>`,
          })}
          ${zfTile({
            title: translateText("help_modal.info_title"),
            note: translateText("help_modal.info_enemy_panel"),
            body: html`<div class="zf-help-feature">
              <div class="zf-help-figures">
                <img
                  class="zf-figure"
                  src=${assetUrl("images/helpModal/infoMenu2.webp")}
                  alt="Enemy Info"
                  loading="lazy"
                />
              </div>
              <div class="zf-help-text">
                <p class="zf-prose">
                  ${translateText("help_modal.info_enemy_desc")}
                </p>
                ${this.iconList([
                  ["images/ChatIconWhite.svg", "help_modal.info_chat"],
                  ["images/TargetIconWhite.svg", "help_modal.info_target"],
                  ["images/EmojiIconWhite.svg", "help_modal.info_emoji"],
                ])}
              </div>
            </div>`,
          })}
        </div>

        <div class="zf-panel-grid">
          ${this.renderBuildList()}
          ${zfTile({
            title: translateText("help_modal.player_icons"),
            body: html`<p class="zf-prose zf-prose-muted">
                ${translateText("help_modal.icon_desc")}
              </p>
              <div class="zf-icon-grid">
                <div class="zf-icon-card">
                  <img
                    class="zf-figure"
                    src=${assetUrl("images/helpModal/crown.webp")}
                    alt="Rank 1"
                    loading="lazy"
                  />
                  <span class="zf-tile-title">
                    ${translateText("help_modal.icon_crown")}
                  </span>
                </div>
              </div>`,
          })}
        </div>
      </div>
    `;
  }

  openTroubleshooting() {
    const troubleshootingModal = document.querySelector(
      "troubleshooting-modal",
    ) as TroubleshootingModal;
    if (
      !troubleshootingModal ||
      !(troubleshootingModal instanceof TroubleshootingModal)
    ) {
      console.warn("Troubleshooting modal element not found");
      return;
    }
    troubleshootingModal.open();
  }

  protected onOpen(): void {
    this.keybinds = this.getKeybinds();
    // Restore the video src when modal opens
    if (this.videoIframe) {
      this.videoIframe.src = TUTORIAL_VIDEO_URL;
    }
  }

  protected onClose(): void {
    // Clear the iframe src to stop video playback
    if (this.videoIframe) {
      this.videoIframe.src = "";
    }
    // The desktop <video> keeps its src -- the file is local, so unlike the
    // YouTube iframe there is nothing to unload; pausing is enough.
    this.videoPlayer?.pause();
  }
}
