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

const INPUT_ID = "username-field";

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
      <div class="flex flex-col gap-1.5 w-full">
        <label for=${INPUT_ID} class="zf-tile-title"
          >${translateText("main.your_name")}</label
        >
        <div class="zf-ring">
          <input
            id=${INPUT_ID}
            type="text"
            .value=${this.baseUsername}
            @input=${this.handleUsernameChange}
            placeholder="${translateText("username.enter_username")}"
            minlength="${MIN_USERNAME_LENGTH}"
            maxlength="${MAX_USERNAME_LENGTH}"
            aria-invalid=${this.validationError ? "true" : "false"}
            aria-describedby=${
              this.validationError ? "username-validation-error" : ""
            }
            class="zf-frame zf-field text-ellipsis"
          />
        </div>
        ${
          this.validationError
            ? html`<div
                id="username-validation-error"
                role="alert"
                class="zf-frame zf-field-error"
              >
                ${this.validationError}
              </div>`
            : null
        }
      </div>
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
