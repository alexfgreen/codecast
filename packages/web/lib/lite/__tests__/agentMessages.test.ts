import { describe, expect, test } from "bun:test";
import {
  agentHeadline, agentIdentity, findAgentSession, firstName, isSessionShortId, parseOutboundSend, rosterName, sendDeliveredTo, sendDelivery,
} from "../agentMessages";
import { getLiteComposerHandle, registerLiteComposerHandle } from "../composerHandle";
import type { ToolCall } from "../../../components/conversation/types";

const ME = "u".repeat(32);
const MAYA = "m".repeat(32);
const MAYAS = "jx7" + "y".repeat(29);
const MINE = "jx7" + "l".repeat(29);
const bash = (command: string): ToolCall => ({ id: `t-${command.length}`, name: "Bash", input: JSON.stringify({ command }) });

describe("parseOutboundSend: an agent's `cast send`, either target", () => {
  test("a session by short id, the body as typed", () => {
    expect(parseOutboundSend(bash('cast send jx7c6zk "Does mobile pin the **old** client?"'))).toEqual({
      target: { kind: "session", ref: "jx7c6zk" }, body: "Does mobile pin the **old** client?", dynamic: false,
    });
  });
  test("a role by handle: the parser leaves the subcommand empty and the handle leads the args", () => {
    expect(parseOutboundSend(bash('cast send @eng "Take the auth half"'))).toEqual({
      target: { kind: "role", handle: "@eng" }, body: "Take the auth half", dynamic: false,
    });
    expect(parseOutboundSend(bash("cd /repo && cast send @eng-lead 'ship it'"))?.target).toEqual({ kind: "role", handle: "@eng-lead" });
  });
  test("flags before the target are skipped; a heredoc body is read whole", () => {
    expect(parseOutboundSend(bash('cast send --from jx7aaaa jx7c6zk "hi"'))?.target).toEqual({ kind: "session", ref: "jx7c6zk" });
    expect(parseOutboundSend(bash(`cast send ${MAYAS} "hi"`))?.target).toEqual({ kind: "session", ref: MAYAS });
    expect(parseOutboundSend(bash("cast send --wake @ops hello"))).toMatchObject({ target: { kind: "role", handle: "@ops" }, body: "hello" });
    expect(parseOutboundSend(bash("cast send jx7c6zk - <<'EOF'\nline one\nline two\nEOF"))).toMatchObject({ body: "line one\nline two", dynamic: false });
  });
  test("a body the shell computed is marked as typed, not as what arrived", () => {
    expect(parseOutboundSend(bash('cast send jx7c6zk "$(cat /tmp/brief.md)"'))?.dynamic).toBe(true);
  });
  test("anything else is not a send", () => {
    expect(parseOutboundSend(bash("cast read jx7c6zk 1:20"))).toBeNull();
    expect(parseOutboundSend(bash("cast send"))).toBeNull();
    expect(parseOutboundSend(bash("echo cast send jx7c6zk hi"))).toBeNull();
    expect(parseOutboundSend({ id: "x", name: "Read", input: "{}" })).toBeNull();
  });
});

describe("how a send came out, from what the CLI printed", () => {
  test("running, sent, queued, refused", () => {
    expect(sendDelivery(undefined)).toBe("sending");
    expect(sendDelivery({ tool_use_id: "t", content: "\x1b[32m✓\x1b[0m sent to \x1b[36mjx7c6zk\x1b[0m from jx7aaaa" })).toBe("sent");
    expect(sendDelivery({ tool_use_id: "t", content: "… queued for jx7c6zk: it has no live daemon right now" })).toBe("queued");
    expect(sendDelivery({ tool_use_id: "t", content: "No session found", is_error: true })).toBe("failed");
  });
  test("the session a role's send reached", () => {
    expect(sendDeliveredTo({ tool_use_id: "t", content: "\x1b[32m✓\x1b[0m sent to \x1b[36mjx7c6zk\x1b[0m from jx7aaaa" })).toBe("jx7c6zk");
    expect(sendDeliveredTo({ tool_use_id: "t", content: "… queued for jx7abcd from jx7aaaa" })).toBe("jx7abcd");
    expect(sendDeliveredTo({ tool_use_id: "t", content: "done" })).toBeNull();
  });
});

describe("whose agent, which session", () => {
  const state = {
    sessions: { [MAYAS]: { _id: MAYAS, short_id: "jx7mmmm", title: "Ship mobile", user_id: MAYA } },
    conversations: { [MINE]: { _id: MINE, short_id: "jx7llll", title: "Fix auth race", user_id: ME } },
    teamMembers: [{ _id: MAYA, name: "Maya Kim" }],
  };
  test("the store resolves a short id or a Convex id", () => {
    expect(findAgentSession(state, "jx7mmmm")?._id).toBe(MAYAS);
    expect(findAgentSession(state, MINE)?.title).toBe("Fix auth race");
    expect(findAgentSession(state, "jx7zzzz")).toBeNull();
    expect(findAgentSession(state, null)).toBeNull();
  });
  test("a teammate's agent by first name, the viewer's as theirs", () => {
    const maya = agentIdentity(findAgentSession(state, "jx7mmmm"), { meId: ME, rosterName: rosterName(state.teamMembers, MAYA) });
    expect(maya).toEqual({ id: MAYAS, title: "Ship mobile", owner: "Maya", mine: false });
    expect(agentHeadline("from", maya)).toBe("From Maya's agent");
    const mine = agentIdentity(findAgentSession(state, "jx7llll"), { meId: ME });
    expect(mine.mine).toBe(true);
    expect(agentHeadline("to", mine)).toBe("To your agent");
  });
  test("the reference query's author and own flag count; the wire's name is the last resort", () => {
    expect(agentIdentity({ _id: MAYAS, title: "x", is_own: false, author_name: "Ann Lee" }, { meId: ME }).owner).toBe("Ann");
    expect(agentIdentity({ _id: MINE, title: "x", is_own: true }, { meId: ME }).mine).toBe(true);
    const unseen = agentIdentity(null, { meId: ME, wireName: "Maya Kim" });
    expect(unseen).toEqual({ id: null, title: null, owner: "Maya", mine: false });
    expect(agentHeadline("from", unseen)).toBe("From Maya's agent");
  });
  test("nobody known: the bare verb, and the card shows the reference", () => {
    const none = agentIdentity(null, { meId: ME });
    expect(agentHeadline("from", none)).toBe("From");
    expect(agentHeadline("to", { id: null, title: "Ship mobile", owner: null, mine: false })).toBe("To an agent");
  });
  test("helpers", () => {
    expect(isSessionShortId("jx7c6zk")).toBe(true);
    expect(isSessionShortId("@eng")).toBe(false);
    expect(firstName("  Maya   Kim ")).toBe("Maya");
    expect(firstName("")).toBeNull();
    expect(rosterName(undefined, MAYA)).toBeNull();
  });
});

describe("the composer handle", () => {
  test("held while mounted; a stale release leaves a newer handle in place", () => {
    const a = { populate() {}, focus() {} };
    const b = { populate() {}, focus() {} };
    const releaseA = registerLiteComposerHandle(MAYAS, a);
    expect(getLiteComposerHandle(MAYAS)).toBe(a);
    const releaseB = registerLiteComposerHandle(MAYAS, b);
    releaseA();
    expect(getLiteComposerHandle(MAYAS)).toBe(b);
    releaseB();
    expect(getLiteComposerHandle(MAYAS)).toBeNull();
    expect(getLiteComposerHandle(MINE)).toBeNull();
  });
});
