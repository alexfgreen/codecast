import { describe, expect, test } from "bun:test";
import { liteFacepile, liteHandoffPeople, liteNamesLabel, liteOnlineTeammates, liteTypingLabel } from "../collabPeople";

const ME = "u".repeat(32);

describe("liteFacepile", () => {
  test("three faces, the rest folded into +N", () => {
    expect(liteFacepile([1, 2])).toEqual({ shown: [1, 2], more: 0 });
    expect(liteFacepile([1, 2, 3, 4, 5])).toEqual({ shown: [1, 2, 3], more: 2 });
  });
});

describe("liteTypingLabel and liteNamesLabel", () => {
  test("first names, then a count", () => {
    expect(liteTypingLabel([])).toBe("");
    expect(liteTypingLabel(["Maya Kim"])).toBe("Maya is typing");
    expect(liteTypingLabel(["Maya Kim", "Jon Sato"])).toBe("Maya and Jon are typing");
    expect(liteTypingLabel(["Maya Kim", "Jon Sato", "Ann"])).toBe("Maya, Jon and 1 other are typing");
    expect(liteTypingLabel(["Maya Kim", "Jon Sato", "Ann", "Bo"])).toBe("Maya, Jon and 2 others are typing");
    expect(liteNamesLabel(["Maya Kim"])).toBe("Maya Kim");
    expect(liteNamesLabel(["Maya Kim", "Jon Sato"])).toBe("Maya and Jon");
  });
});

describe("liteOnlineTeammates", () => {
  test("online people only, the viewer and bots left out, the most present first", () => {
    const members = [
      { _id: "a", name: "Zed", presence_state: "active" },
      { _id: "b", name: "Ann", presence_state: "idle" },
      { _id: "c", name: "Bo", presence_state: "offline" },
      { _id: ME, name: "Me", presence_state: "active" },
      { _id: "d", name: "Bot", presence_state: "active", is_bot: true },
      { _id: "e", name: "Amy", presence_state: "active" },
      // A live room is itself a report, whatever the keyboard did.
      { _id: "f", name: "Cal", presence_state: "offline", in_huddle: true },
    ];
    expect(liteOnlineTeammates(members, ME).map((m) => m.name)).toEqual(["Amy", "Cal", "Zed", "Ann"]);
  });
});

describe("liteHandoffPeople", () => {
  test("people on the roster but never the viewer or a bot; online first; owners marked", () => {
    const roster = [
      { _id: "a", name: "Zed", presence_state: "offline" },
      { _id: "b", name: "Maya Kim", presence_state: "active", image: "https://x/m.png" },
      { _id: ME, name: "Me" },
      { _id: "d", name: "Bot", is_bot: true },
      { _id: "b", name: "Maya Kim (dup)" },
    ];
    const people = liteHandoffPeople(roster, ME, new Set(["a"]));
    expect(people.map((p) => [p.name, p.owner, p.presence])).toEqual([
      ["Maya Kim", false, "active"],
      ["Zed", true, "offline"],
    ]);
    expect(people[0]!.image).toBe("https://x/m.png");
  });
});
