import { describe, expect, test } from "bun:test";
import { liteSessionAccess } from "../threadAccess";

const ME = "u".repeat(32);
const MAYA = "m".repeat(32);
const ID = "jx7" + "a".repeat(29);

describe("liteSessionAccess: the server's send rule, read off what the client holds", () => {
  test("the owner sends, and a stub is always the viewer's own", () => {
    expect(liteSessionAccess({ user_id: ME }, undefined, ME, ID)).toEqual({ isOwner: true, canSend: true });
    expect(liteSessionAccess(undefined, undefined, ME, "localstub123")).toEqual({ isOwner: true, canSend: true });
  });
  test("a teammate sends into a team-visible session, not into one shared by link", () => {
    expect(liteSessionAccess({ user_id: MAYA }, { access_level: "team" }, ME, ID)).toEqual({ isOwner: false, canSend: true });
    expect(liteSessionAccess({ user_id: MAYA }, { access_level: "shared" }, ME, ID)).toEqual({ isOwner: false, canSend: false });
  });
  test("before the access level loads, a teammate's row from the team feed can take a message", () => {
    expect(liteSessionAccess({ user_id: MAYA, team_id: "t".repeat(32) }, undefined, ME, ID).canSend).toBe(true);
    expect(liteSessionAccess({ user_id: MAYA }, undefined, ME, ID).canSend).toBe(false);
  });
  test("a hosted conversation takes input from its owner only", () => {
    expect(liteSessionAccess({ user_id: MAYA, agent_type: "codecast" }, { access_level: "team", agent_type: "codecast" }, ME, ID).canSend).toBe(false);
  });
});
