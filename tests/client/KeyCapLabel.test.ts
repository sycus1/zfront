import { keyCapLabel } from "../../src/client/Utils";

describe("keyCapLabel", () => {
  it("names modifiers and whitespace keys in short capitals", () => {
    expect(keyCapLabel("ControlLeft")).toBe("CTRL");
    expect(keyCapLabel("ControlRight")).toBe("CTRL");
    expect(keyCapLabel("ShiftLeft")).toBe("SHIFT");
    expect(keyCapLabel("Space")).toBe("SPACE");
    expect(keyCapLabel(" ")).toBe("SPACE");
    expect(keyCapLabel("Escape")).toBe("ESC");
    expect(keyCapLabel("Enter")).toBe("ENTER");
  });

  it("follows the platform for Alt and Meta", () => {
    expect(keyCapLabel("AltLeft")).toBe("ALT");
    expect(keyCapLabel("AltLeft", true)).toBe("OPT");
    expect(keyCapLabel("MetaLeft")).toBe("WIN");
    expect(keyCapLabel("MetaLeft", true)).toBe("CMD");
  });

  it("draws arrows, punctuation and the numpad as their symbols", () => {
    expect(keyCapLabel("ArrowUp")).toBe("↑");
    expect(keyCapLabel("ArrowLeft")).toBe("←");
    expect(keyCapLabel("Minus")).toBe("-");
    expect(keyCapLabel("Equal")).toBe("=");
    expect(keyCapLabel("Period")).toBe(".");
    expect(keyCapLabel("Comma")).toBe(",");
    expect(keyCapLabel("NumpadSubtract")).toBe("NUM -");
    expect(keyCapLabel("NumpadAdd")).toBe("NUM +");
    expect(keyCapLabel("Numpad7")).toBe("NUM 7");
  });

  it("reduces letter and digit codes to their character", () => {
    expect(keyCapLabel("KeyA")).toBe("A");
    expect(keyCapLabel("Digit1")).toBe("1");
  });

  it("capitalises labels already resolved for the layout", () => {
    // resolveKeybindLabel can return the layout's character or the key the
    // player pressed when they rebound it.
    expect(keyCapLabel("a")).toBe("A");
    expect(keyCapLabel("é")).toBe("É");
    expect(keyCapLabel("F5")).toBe("F5");
  });

  it("spells out a Shift combination", () => {
    expect(keyCapLabel("Shift+KeyA")).toBe("SHIFT + A");
    expect(keyCapLabel("Shift+A")).toBe("SHIFT + A");
    expect(keyCapLabel("Shift+ArrowUp")).toBe("SHIFT + ↑");
  });

  it("shows nothing for an unbound key", () => {
    expect(keyCapLabel("")).toBe("");
    expect(keyCapLabel("Null")).toBe("");
  });
});
