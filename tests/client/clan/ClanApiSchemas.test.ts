import { ClanInfoSchema } from "@openfront/shared/ClanApiSchemas";
import { describe, expect, it } from "vitest";

describe("ClanInfoSchema", () => {
  const base = {
    name: "Test Clan",
    tag: "TEST",
    description: "A clan",
    isOpen: true,
  };

  it("accepts valid data with ISO datetime createdAt", () => {
    const result = ClanInfoSchema.safeParse({
      ...base,
      createdAt: "2024-01-15T12:00:00.000Z",
      memberCount: 5,
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-ISO strings for createdAt", () => {
    const result = ClanInfoSchema.safeParse({
      ...base,
      createdAt: "January 15, 2024",
    });
    expect(result.success).toBe(false);
  });

  it("accepts data without optional createdAt", () => {
    const result = ClanInfoSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("accepts data without optional memberCount", () => {
    const result = ClanInfoSchema.safeParse({
      ...base,
      createdAt: "2024-01-15T12:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts data with neither createdAt nor memberCount", () => {
    const result = ClanInfoSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.createdAt).toBeUndefined();
      expect(result.data.memberCount).toBeUndefined();
    }
  });

  it("accepts a string discordUrl", () => {
    const result = ClanInfoSchema.safeParse({
      ...base,
      discordUrl: "https://discord.gg/abc123",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a null discordUrl (link unset)", () => {
    const result = ClanInfoSchema.safeParse({ ...base, discordUrl: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.discordUrl).toBeNull();
  });

  it("accepts data without discordUrl (omitted by browse results)", () => {
    const result = ClanInfoSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.discordUrl).toBeUndefined();
  });

  it("rejects a discordUrl longer than 255 characters", () => {
    const result = ClanInfoSchema.safeParse({
      ...base,
      discordUrl: "https://discord.gg/" + "a".repeat(255),
    });
    expect(result.success).toBe(false);
  });
});
