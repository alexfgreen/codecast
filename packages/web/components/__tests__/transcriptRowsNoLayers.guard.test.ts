// The transcript's virtual rows are placed by `top`, never by a 3D transform.
// @tanstack/react-virtual's direct DOM mode defaults to translate3d, which makes
// every visible row its own compositor layer; the browser then re-layers the
// page on each frame that moves the caret, so every keystroke in the composer
// paid for every visible message.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("ConversationView's virtualizer writes row positions as top, not translate3d", () => {
  const src = readFileSync(new URL("../ConversationView.tsx", import.meta.url), "utf8");
  const call = src.slice(src.indexOf("useVirtualizer({"), src.indexOf("useVirtualizer({") + 600);
  expect(call).toContain("directDomUpdates: true");
  expect(call).toContain('directDomUpdatesMode: "position"');
});

// Codecast Lite's thread (components/lite/thread) uses the bottom-anchored list,
// whose own row style places rows with a transform; Lite drops it and places
// every row by `top`. Nothing in its row code or stylesheet may make a row a
// layer (a 3D transform, will-change) or run forever on a row.
const LITE = (p: string) => readFileSync(new URL(`../lite/thread/${p}`, import.meta.url), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("Lite's thread places its rows by top and drops the list's transform", () => {
  const src = stripComments(LITE("LiteThread.tsx"));
  expect(src).toContain("style: _transform");
  expect(src).toMatch(/style=\{\{ position: "absolute", top: item\.start/);
  for (const file of ["LiteThread.tsx", "LiteThreadRows.tsx"]) {
    const code = stripComments(LITE(file));
    expect({ file, layer: /translate3d|willChange|will-change|transform\s*:/.test(code) }).toEqual({ file, layer: false });
  }
});

test("Lite's thread stylesheet makes no row a layer and runs nothing forever", () => {
  const css = stripComments(LITE("thread.css"));
  expect(css).not.toMatch(/will-change|translate3d|infinite/);
  // The only transform is the open chevron's turn, on an icon.
  for (const rule of css.split("}")) {
    if (/(^|[\s;{])(transform|translate)\s*:/.test(rule)) expect(rule.split("{")[0]).toContain("lt-th-chev");
  }
});
