import { describe, expect, test } from "bun:test";
import { liteSessionAccess } from "../threadAccess";

const ME = "u".repeat(32);
const MAYA = "m".repeat(32);
const ID = "jx7" + "a".repeat(29);
const TEAM = "t".repeat(32);

describe("liteSessionAccess: the server's send rule, read off what the client holds", () => {
  test("the owner sends, and a stub is always the viewer's own", () => {
    expect(liteSessionAccess({ user_id: ME }, undefined, ME, ID)).toEqual({ known: true, isOwner: true, canSend: true, shared: false });
    expect(liteSessionAccess(undefined, undefined, ME, "localstub123")).toEqual({ known: true, isOwner: true, canSend: true, shared: false });
  });
  test("a teammate sends into a team-visible session; a share-link reader goes through the owner's grant", () => {
    expect(liteSessionAccess({ user_id: MAYA }, { access_level: "team" }, ME, ID)).toEqual({ known: true, isOwner: false, canSend: true, shared: false });
    expect(liteSessionAccess({ user_id: MAYA }, { access_level: "shared" }, ME, ID)).toEqual({ known: true, isOwner: false, canSend: false, shared: true });
  });
  test("until the access level loads, someone else's session is not known, and team_id (routing) grants nothing", () => {
    expect(liteSessionAccess({ user_id: MAYA, team_id: TEAM } as never, undefined, ME, ID)).toEqual({ known: false, isOwner: false, canSend: false, shared: false });
  });
  test("a session with no row and no meta (a stale or denied link) is not the viewer's", () => {
    expect(liteSessionAccess(undefined, undefined, ME, ID)).toEqual({ known: false, isOwner: false, canSend: false, shared: false });
  });
  test("a hosted conversation takes input from its owner only", () => {
    expect(liteSessionAccess({ user_id: MAYA, agent_type: "codecast" }, { access_level: "team", agent_type: "codecast" }, ME, ID).canSend).toBe(false);
  });
});
