import { describe, expect, test } from "bun:test";
import {
  liteAgentMessagePrompt,
  liteSessionByRef,
  liteTalkPeersSig,
  liteTalkRefs,
  liteTalkSig,
  parseLiteTalkPeersSig,
  parseLiteTalkSig,
  resolveLiteTalkPeers,
  type LiteTalkMessage,
} from "../collabTalk";

const ME = "u".repeat(32);
const MAYA = "m".repeat(32);
const SELF = "jx1self" + "a".repeat(25);
const SHIP = "jx7c6zk" + "b".repeat(25);
const DOCS = "jx9docs" + "c".repeat(25);

const inbound = (from: string, body = "hello", name?: string): LiteTalkMessage => ({
  role: "user",
  content: `<session-message from="${from}"${name ? ` name="${name}"` : ""}>\n${body}\n</session-message>`,
});
const send = (command: string, asObject = false): LiteTalkMessage => ({
  role: "assistant",
  content: "",
  tool_calls: [{ name: "Bash", input: asObject ? { command } : JSON.stringify({ command }) }],
});

describe("liteTalkRefs: the sessions a transcript exchanged messages with", () => {
  test("an inbound session-message names its sender; an outbound cast send names its target", () => {
    const refs = liteTalkRefs([inbound("jx7c6zk", "yes, 2.3.1", "Maya"), send(`cast send jx9docs "can you check the docs?"`)]);
    expect(refs).toEqual([
      { ref: "jx9docs", inbound: false, outbound: true },
      { ref: "jx7c6zk", inbound: true, outbound: false },
    ]);
  });

  test("most recent exchange first, each session once, both directions merged", () => {
    const refs = liteTalkRefs([
      send(`cast send jx7c6zk "does mobile pin auth?"`),
      send(`cd /repo && cast send jx9docs "ping"`, true),
      inbound("jx7c6zk", "yes"),
    ]);
    expect(refs.map((r) => r.ref)).toEqual(["jx7c6zk", "jx9docs"]);
    expect(refs[0]).toEqual({ ref: "jx7c6zk", inbound: true, outbound: true });
  });

  test("a role handle, another cast command, a plain shell call and a human's message are not sessions", () => {
    expect(liteTalkRefs([
      send(`cast send @maya "hi"`),
      send(`cast task ls`),
      send(`ls -la`),
      { role: "user", content: `<user-message from="Maya Kim">\nhi\n</user-message>` },
      { role: "assistant", content: "I will run cast send jx7c6zk later" },
    ])).toEqual([]);
  });

  test("memoized by the array, so a selector can call it on every store change", () => {
    const msgs = [inbound("jx7c6zk")];
    expect(liteTalkRefs(msgs)).toBe(liteTalkRefs(msgs));
    expect(liteTalkRefs(undefined)).toEqual([]);
  });

  test("the signature round-trips and ignores ordinary messages", () => {
    const a = [inbound("jx7c6zk"), send(`cast send jx9docs "x"`)];
    const b = [...a, { role: "assistant", content: "done" }];
    expect(liteTalkSig(a)).toBe(liteTalkSig(b));
    expect(parseLiteTalkSig(liteTalkSig(a))).toEqual(liteTalkRefs(a));
    expect(parseLiteTalkSig("")).toEqual([]);
  });
});

describe("resolveLiteTalkPeers: through the store, to a title and an owner", () => {
  const state = {
    sessions: {
      [SHIP]: { _id: SHIP, title: "Ship mobile", user_id: MAYA, author_name: "Maya Kim" },
      [DOCS]: { _id: DOCS, title: "Docs pass", user_id: ME },
      [SELF]: { _id: SELF, title: "Fix auth race", user_id: ME },
    },
    conversations: {},
    teamMembers: [{ _id: MAYA, name: "Maya Kim" }],
  };

  test("a short id resolves to the row; a teammate's names its owner, the viewer's own names nobody", () => {
    expect(liteSessionByRef(state, "jx7c6zk")?._id).toBe(SHIP);
    expect(liteSessionByRef(state, SHIP)?._id).toBe(SHIP);
    const peers = resolveLiteTalkPeers(state, [
      { ref: "jx7c6zk", inbound: true, outbound: false },
      { ref: "jx9docs", inbound: false, outbound: true },
    ], SELF, ME);
    expect(peers).toEqual([
      { ref: "jx7c6zk", inbound: true, outbound: false, id: SHIP, title: "Ship mobile", owner: "Maya" },
      { ref: "jx9docs", inbound: false, outbound: true, id: DOCS, title: "Docs pass", owner: null },
    ]);
  });

  test("the session itself and a session the store has never seen stay out", () => {
    expect(resolveLiteTalkPeers(state, [
      { ref: "jx1self", inbound: true, outbound: false },
      { ref: "jxzzzzz", inbound: true, outbound: false },
      { ref: "codecast", inbound: true, outbound: false },
    ], SELF, ME)).toEqual([]);
  });

  test("the peers signature round-trips", () => {
    const peers = resolveLiteTalkPeers(state, [{ ref: "jx7c6zk", inbound: true, outbound: true }], SELF, ME);
    expect(parseLiteTalkPeersSig(liteTalkPeersSig(peers))).toEqual(peers);
    expect(parseLiteTalkPeersSig("")).toEqual([]);
  });
});

describe("liteAgentMessagePrompt: what the composer gets", () => {
  test("names the session the way a person would, ready for their words", () => {
    expect(liteAgentMessagePrompt({ shortId: "jx7c6zk", title: "Ship mobile", owner: "Maya" })).toBe(`Message session jx7c6zk (Maya's "Ship mobile"): `);
    expect(liteAgentMessagePrompt({ shortId: "jx9docs", title: `The "docs" pass`, owner: null })).toBe(`Message session jx9docs (my "The 'docs' pass"): `);
  });
});
