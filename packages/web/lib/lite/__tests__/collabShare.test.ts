import { describe, expect, test } from "bun:test";
import { liteSessionLinks, liteShareLinkLedger, liteShareWidens, liteTeamShareLedger, liteTeamShareOf } from "../collabShare";

describe("liteTeamShareOf: the level a session sits at", () => {
  test("no privacy flag is private; shared without a level shows its summary", () => {
    expect(liteTeamShareOf(undefined)).toBe("private");
    expect(liteTeamShareOf({})).toBe("private");
    expect(liteTeamShareOf({ is_private: true, team_visibility: "full" })).toBe("private");
    expect(liteTeamShareOf({ is_private: false })).toBe("summary");
    expect(liteTeamShareOf({ is_private: false, team_visibility: "full" })).toBe("full");
    expect(liteTeamShareOf({ is_private: false, effective_team_visibility: "full" })).toBe("full");
  });
});

describe("liteShareWidens: which presses go through the review", () => {
  test("only a change that lets more people read more", () => {
    expect(liteShareWidens("private", "summary")).toBe(true);
    expect(liteShareWidens("summary", "full")).toBe(true);
    expect(liteShareWidens("private", "full")).toBe(true);
    expect(liteShareWidens("full", "summary")).toBe(false);
    expect(liteShareWidens("summary", "private")).toBe(false);
    expect(liteShareWidens("full", "full")).toBe(false);
  });
});

describe("the share reviews", () => {
  test("widening to the team names the team, how many read and what they see", () => {
    const l = liteTeamShareLedger({ title: "Fix auth race", team: "Acme", others: 4, from: "private", to: "full" });
    expect(l.name).toBe("Share with Acme");
    expect(l.subject).toBe("Fix auth race");
    expect(l.shift).toEqual(["Hidden", "Full"]);
    expect(l.figures[0]).toEqual({ value: "4", label: "teammates read", tone: "warn" });
    expect(l.rows.find((r) => r.k === "They see")?.v).toBe("The whole transcript");
    expect(l.confirm).toBe("Share in full");
    const summary = liteTeamShareLedger({ title: "x", team: "Acme", others: 1, from: "private", to: "summary" });
    expect(summary.figures[0]?.label).toBe("teammate reads");
    expect(summary.confirm).toBe("Share summary");
  });

  test("opening the link says anyone, no sign in; a policy blocks the confirm", () => {
    const l = liteShareLinkLedger({ title: "Fix auth race" });
    expect(l.shift).toEqual(["Restricted", "Anyone"]);
    expect(l.rows.find((r) => r.k === "Sign in")?.v).toBe("Not needed");
    expect(l.blocked).toBeUndefined();
    expect(liteShareLinkLedger({ title: "x", refusal: "Your workspace turned public links off" }).blocked).toBe("Your workspace turned public links off");
  });
});

describe("liteSessionLinks", () => {
  test("Lite's address, the classic page, and the token link only once there is a token", () => {
    expect(liteSessionLinks({ appOrigin: "https://app.test", shareOrigin: "https://codecast.test", id: "jx7abc" })).toEqual({
      lite: "https://app.test/lite/jx7abc",
      page: "https://codecast.test/conversation/jx7abc",
      share: null,
    });
    expect(liteSessionLinks({ appOrigin: "https://app.test", shareOrigin: "https://codecast.test", id: "jx7abc", token: "t 1" }).share).toBe("https://codecast.test/conversation/jx7abc?share=t%201");
  });
});
