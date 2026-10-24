import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import {
  clampUsername,
  genAnonUsername,
  type ResolvedPlayerName,
} from "./PlayerName";
import {
  MAX_USERNAME_LENGTH,
  MIN_USERNAME_LENGTH,
  validateUsername,
} from "./validations/username";

const usernameKey: string = "username";

// `line-height: normal` because that is what an <input> uses for its editor
// box.
const NAME_BOX =
  "min-w-0 flex-1 h-full max-h-[44px] rounded-lg bg-transparent px-2 sm:px-3";
const NAME_TEXT =
  "text-xl/[normal] sm:text-2xl/[normal] font-medium tracking-wider " +
  "[text-shadow:0_1px_2px_rgba(0,0,0,0.9)]";

/**
 * The local player's name. Stored in localStorage; a generated placeholder is
 * minted the first time round.
 */
@customElement("username-input")
export class UsernameInput extends LitElement {
  @state() private baseUsername: string = "";
  @property({ type: String }) validationError: string = "";

  private _isValid: boolean = true;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.baseUsername = clampUsername(
      localStorage.getItem(usernameKey) ?? genAnonUsername(),
    );
    this.validateAndStore();
  }

  render() {
    return html`
      <div class="flex items-center w-full h-full gap-1.5 sm:gap-2">
        <input
          type="text"
          .value=${this.baseUsername}
          @input=${this.handleUsernameChange}
          placeholder="${translateText("username.enter_username")}"
          minlength="${MIN_USERNAME_LENGTH}"
          maxlength="${MAX_USERNAME_LENGTH}"
          aria-label=${translateText("username.enter_username")}
          class="text-left text-white placeholder-white/50 transition-colors text-ellipsis hover:bg-white/5 focus:bg-white/5 focus:outline-none focus:ring-2 focus:ring-malibu-blue/60 ${NAME_BOX} ${NAME_TEXT}"
        />
      </div>
      ${
        this.validationError
          ? html`<div class="absolute top-full left-0 z-50 w-full mt-1">
              <div
                id="username-validation-error"
                class="w-full px-3 py-2 text-sm font-medium border border-red-500/50 rounded-lg bg-red-900/90 text-red-200 backdrop-blur-md shadow-lg"
              >
                ${this.validationError}
              </div>
            </div>`
          : null
      }
    `;
  }

  private handleUsernameChange(e: Event) {
    this.baseUsername = (e.target as HTMLInputElement).value;
    this.validateAndStore();
  }

  private validateAndStore() {
    const trimmed = this.baseUsername.trim();
    const result = validateUsername(trimmed);
    this._isValid = result.isValid;
    if (result.isValid) {
      localStorage.setItem(usernameKey, trimmed);
      this.validationError = "";
    } else {
      this.validationError = result.error ?? "";
    }
    this.emitValidity();
  }

  /** The player's name. Never verified: there are no accounts. */
  public resolvedName(): ResolvedPlayerName {
    const name = clampUsername(this.baseUsername.trim());
    return name.length > 0
      ? { name, source: "stored", verified: false }
      : { name: genAnonUsername(), source: "generated", verified: false };
  }

  public getUsername(): string {
    return this.resolvedName().name;
  }

  public getClanTag(): string | null {
    return null;
  }

  public getClanCheck(): Promise<string | null> | undefined {
    return undefined;
  }

  /** Resolves once the name is ready; always immediate with local names. */
  public whenSeeded(): Promise<void> {
    return Promise.resolve();
  }

  private emitValidity() {
    window.dispatchEvent(
      new CustomEvent("username-validity-change", {
        detail: { isValid: this.canPlay() },
      }),
    );
  }

  public canPlay(): boolean {
    return this._isValid;
  }
}
