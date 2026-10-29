import { describe, expect, it } from "bun:test";
import { bestNameTier, liteNameTier, orderLiteGroups, rankByName } from "../paletteModel";

describe("liteNameTier", () => {
  it("ranks a prefix, then word starts, then anywhere inside", () => {
    expect(liteNameTier("New session", "new")).toBe(0);
    expect(liteNameTier("Toggle right panel", "right pan")).toBe(1);
    expect(liteNameTier("Keyboard shortcuts", "board")).toBe(2);
    expect(liteNameTier("Settings", "zzz")).toBeNull();
  });
  it("an empty query names everything", () => {
    expect(liteNameTier("anything", "  ")).toBe(0);
  });
  it("every typed word must be there", () => {
    expect(liteNameTier("Open the classic app", "classic open")).toBe(1);
    expect(liteNameTier("Open the classic app", "classic close")).toBeNull();
  });
  it("splits a repository or path into words", () => {
    expect(liteNameTier("acme/codecast", "code")).toBe(1);
  });
});

describe("rankByName", () => {
  it("keeps the matches, best first, stable within a tier", () => {
    const items = [{ n: "Team" }, { n: "Toggle theme" }, { n: "Needs you" }, { n: "Theme" }];
    expect(rankByName(items, "the", (i) => [i.n]).map((i) => i.n)).toEqual(["Theme", "Toggle theme"]);
    expect(rankByName(items, "t", (i) => [i.n], 2).map((i) => i.n)).toEqual(["Team", "Toggle theme"]);
  });
  it("matches an item by any of its names", () => {
    expect(bestNameTier(["Needs you", "inbox"], "inb")).toBe(0);
  });
});

describe("orderLiteGroups", () => {
  it("leads with the group holding the strongest match", () => {
    expect(orderLiteGroups({ actions: 1, sessions: 0, projects: null })).toEqual(["sessions", "actions"]);
  });
  it("keeps the resting order on a tie and drops empty groups", () => {
    expect(orderLiteGroups({ people: 0, actions: 0, sessions: 0 })).toEqual(["actions", "sessions", "people"]);
    expect(orderLiteGroups({})).toEqual([]);
  });
});
