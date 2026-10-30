import { describe, expect, test } from "bun:test";
import { liteChannelOption, liteMainChannelId, liteTeamChannels } from "../collabTeam";

const rail = [
  { id: "c1", name: "ship", kind: "public", joined: true, unreadCount: 3 },
  { id: "d1", name: "Maya Kim", kind: "dm", joined: true },
  { id: "c2", name: "general", joined: true },
  { id: "c3", name: "agents", kind: "agents", joined: true, mentionCount: 1 },
  { id: "x1", name: "open-source", kind: "community", joined: true },
  { id: "c4", name: "design", kind: "public", joined: false },
];

describe("liteTeamChannels", () => {
  test("the team's rooms the viewer is in, by name: no DMs, no community rooms", () => {
    expect(liteTeamChannels(rail).map((c) => c.id)).toEqual(["c3", "c2", "c1"]);
  });
});

describe("liteMainChannelId", () => {
  const channels = liteTeamChannels(rail);
  test("the remembered room while it is still the team's, else #general, else the busiest", () => {
    expect(liteMainChannelId(channels, rail, "c1")).toBe("c1");
    expect(liteMainChannelId(channels, rail, "d1")).toBe("c2");
    expect(liteMainChannelId(channels, rail, null)).toBe("c2");
    const noGeneral = channels.filter((c) => c.id !== "c2");
    expect(liteMainChannelId(noGeneral, rail, null)).toBe("c1");
    expect(liteMainChannelId([], rail, null)).toBeNull();
  });
});

describe("liteChannelOption", () => {
  test("the name, then mentions before unread", () => {
    expect(liteChannelOption({ id: "a", name: "ship", unreadCount: 3 })).toBe("#ship · 3");
    expect(liteChannelOption({ id: "a", name: "agents", unreadCount: 9, mentionCount: 1 })).toBe("#agents · @1");
    expect(liteChannelOption({ id: "a", name: "general" })).toBe("#general");
    expect(liteChannelOption({ id: "a", name: "busy", unreadCount: 120 })).toBe("#busy · 99+");
  });
});
