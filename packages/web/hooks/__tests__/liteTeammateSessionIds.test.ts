import { describe, expect, test } from "bun:test";
import type { InboxSession } from "../../store/inboxStore";
import { liteTeammateSessionIds } from "../useLiteFeeders";

// Lite's teammates are read at read time: the active team's rows the server's
// team list holds now (teamInboxIds, the board's own set), not the viewer's
// own, top level, newest first. Lite keeps no id set of its own beside them.

const ME = "u".repeat(32);
const ANA = "a".repeat(31) + "n";
const TEAM = "t".repeat(32);
const OTHER_TEAM = "o".repeat(32);
const id = (n: number) => `s${String(n).padStart(31, "0")}`;

function row(n: number, fields: Partial<InboxSession>): InboxSession {
  return { _id: id(n), session_id: `cc-${n}`, updated_at: n, team_id: TEAM, user_id: ANA, ...fields } as InboxSession;
}

function state(rows: InboxSession[]) {
  return { sessions: Object.fromEntries(rows.map((r) => [r._id, r])) };
}

describe("liteTeammateSessionIds", () => {
  test("a teammate's top-level session in the active team, newest first", () => {
    const s = state([row(1, {}), row(3, {}), row(2, {})]);
    expect(liteTeammateSessionIds(s, TEAM, ME)).toEqual([id(3), id(2), id(1)]);
  });

  test("leaves out the viewer's own, other teams', and children that nest under a parent", () => {
    const s = state([
      row(1, {}),
      row(2, { user_id: ME }),
      row(3, { owned_by_me: true }),
      row(4, { team_id: OTHER_TEAM }),
      row(5, { team_id: null }),
      row(6, { is_subagent: true }),
      row(7, { parent_conversation_id: id(1) }),
    ]);
    expect(liteTeammateSessionIds(s, TEAM, ME)).toEqual([id(1)]);
  });

  test("a session of mine handed to a teammate is theirs; one handed to me is mine", () => {
    const s = state([
      row(1, { user_id: ME, owner_user_id: ANA }),
      row(2, { user_id: ANA, owner_user_id: ME, owned_by_me: true }),
    ]);
    expect(liteTeammateSessionIds(s, TEAM, ME)).toEqual([id(1)]);
  });

  test("no team or no viewer: no teammates", () => {
    const s = state([row(1, {})]);
    expect(liteTeammateSessionIds(s, null, ME)).toEqual([]);
    expect(liteTeammateSessionIds(s, TEAM, null)).toEqual([]);
  });

  test("once the team's list has landed, a row it no longer holds leaves, though its cached team_id stays", () => {
    // A teammate made 2 private: the server stops sending it, the never-prune
    // cache keeps the row with its old team_id and last state.
    const rows = state([row(1, {}), row(2, {}), row(3, {})]);
    const s = { ...rows, teamInboxIds: new Set([id(1), id(3)]), teamInboxIdSnapshot: { team_id: TEAM } };
    expect(liteTeammateSessionIds(s, TEAM, ME)).toEqual([id(3), id(1)]);
  });

  test("another team's set, or an empty one, gates nothing: the rows' team_id stands in until the list lands", () => {
    const rows = state([row(1, {}), row(2, {})]);
    expect(liteTeammateSessionIds({ ...rows, teamInboxIds: new Set([id(1)]), teamInboxIdSnapshot: { team_id: OTHER_TEAM } }, TEAM, ME)).toEqual([id(2), id(1)]);
    expect(liteTeammateSessionIds({ ...rows, teamInboxIds: new Set<string>(), teamInboxIdSnapshot: { team_id: TEAM } }, TEAM, ME)).toEqual([id(2), id(1)]);
  });

  test("the same array while the rows, team and viewer are unchanged", () => {
    const s = state([row(1, {}), row(2, {})]);
    const first = liteTeammateSessionIds(s, TEAM, ME);
    expect(liteTeammateSessionIds(s, TEAM, ME)).toBe(first);
    expect(liteTeammateSessionIds({ sessions: { ...s.sessions } }, TEAM, ME)).toEqual(first);
    expect(liteTeammateSessionIds(s, OTHER_TEAM, ME)).toEqual([]);
  });
});
