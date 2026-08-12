/**
 * commands.test.ts — unit tests for the v1.1 *human-facing* checkpoint slash-command factories
 * (src/commands.ts: `makeCheckpointCommand`, `makeCheckpointRevokeCommand`) and the exported
 * `clearCheckpointByName` helper.
 *
 * Mirrors the house test idiom from test/tools/checkpoint.test.ts: vitest, hand-rolled
 * `makePi()`/`makeCtx()` fakes (NO vi.fn for Pi objects), `.js` import paths, `clearAll()` +
 * `setConfig(undefined)` reset, verbatim-string assertions. The fake `ctx` is RICHER than the
 * tool-test sibling's because command handlers touch `ctx.hasUI` + `ctx.ui` + `clearCheckpointByName`
 * scans `ctx.sessionManager.getEntries`/`getLabel` (GOTCHA #2).
 *
 * Coverage — the PRP's 6 contract cases + 4 bonuses:
 *   a) set VALID → setLabel + verbatim warning notify (spec/13 §2 step 5) + reconcileBanner.
 *   b) set INVALID name → verbatim "invalid" warning notify (spec/13 §2 step 1); no setLabel.
 *   c) set DISABLED → "Mulligan is disabled" (no "Mulligan: " prefix; spec/08 E14); no setLabel.
 *   d) revoke EXISTING → setLabel(id, undefined) + verbatim info notify (spec/13 §3 step 5) + reconcileBanner.
 *   e) revoke MISSING → verbatim "no active checkpoint" info notify (spec/13 §3 step 2); no setLabel.
 *   f) clearCheckpointByName: false+no-setLabel (non-existent) / true+setLabel(id,undefined) (existing) /
 *      stale two-phase confirm (entries has the label but getLabel→undefined → false, no setLabel).
 *   bonus) hasUI=false guard; disabled-before-validation; never-throws.
 *
 * GOTCHA #1 (THE #1 trap): `reconcileBanner` in src/banner.ts is a STUB no-op (P2.M3.T1.S2 implements
 * it). It NEVER calls setWidget. So we vi.mock("../src/banner.js") and assert the
 * `vi.mocked(reconcileBanner)` SPY — we NEVER assert on `widgets`. This is robust to P2.M3.T1.S2.
 */
import { describe, it, expect, expectTypeOf, beforeEach, afterEach, vi } from "vitest";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

// vi.mock is HOISTED to the top of the file (before the imports below) and is FILE-SCOPED — it replaces
// banner.js for every test in this file. This mirrors the settings.js/log.js module-mock idiom in
// test/index.test.ts. The spy is module-level → we mockClear() it in beforeEach (GOTCHA #9) so call
// counts don't leak across tests.
vi.mock("../src/banner.js", () => ({ reconcileBanner: vi.fn() }));

import { makeCheckpointCommand, makeCheckpointRevokeCommand, clearCheckpointByName } from "../src/commands.js";
import { reconcileBanner } from "../src/banner.js"; // the MOCKED binding (the spy target)
import { setConfig } from "../src/config.js"; // disabled-gate control
import { clearAll } from "../src/runtime.js"; // module-scoped runtime reset

// ── reset (mirror checkpoint.test.ts) ───────────────────────────────────────
// clearAll() + setConfig(undefined) → DEFAULT_CONFIG (enabled:true) so a prior disabled test never
// bleeds. mockClear on the reconcileBanner spy so call counts don't leak (GOTCHA #9).
beforeEach(() => {
  clearAll();
  setConfig(undefined);
  vi.mocked(reconcileBanner).mockClear();
});
afterEach(() => {
  clearAll();
  setConfig(undefined);
});

// ── fakes (hand-rolled; NO vi.fn for Pi objects — GOTCHA #3) ─────────────────

/**
 * A minimal fake ExtensionAPI capturing setLabel calls. `label` is `string | undefined` because the
 * revoke path passes `undefined` (a CLEAR). Set `throwOnSetLabel` to exercise the never-throw guard.
 */
function makePi(opts: { throwOnSetLabel?: boolean } = {}) {
  const labels: { entryId: string; label: string | undefined }[] = [];
  const pi = {
    setLabel(entryId: string, label: string | undefined) {
      if (opts.throwOnSetLabel) throw new Error("setLabel boom");
      labels.push({ entryId, label });
    },
  };
  return { labels, pi: pi as unknown as ExtensionAPI };
}

/**
 * A minimal fake ExtensionCommandContext (GOTCHA #2 — RICHER than checkpoint.test.ts's makeCtx). Command
 * handlers touch `hasUI` + `ui.{notify,setWidget}`, setCheckpoint reads `sessionManager.getBranch`, and
 * clearCheckpointByName scans `sessionManager.getEntries`/`getLabel`. `getLeafId` is defensive
 * (forward-compat) — unused by the paths under test today.
 *
 * `widgets` is captured (defensive) but NEVER asserted — GOTCHA #1 (reconcileBanner is a stub).
 */
function makeCtx(opts: {
  hasUI?: boolean;
  branch?: unknown[];
  entries?: unknown[];
  labelMap?: Record<string, string | undefined>;
  throwOnGetBranch?: boolean;
  throwOnGetEntries?: boolean;
} = {}) {
  const notifies: { msg: string; type: string }[] = [];
  const widgets: { key: string; content: unknown; options?: unknown }[] = [];
  const branch = opts.branch ?? [
    { type: "message", id: "u1", parentId: null, message: { role: "user", content: [] } },
    { type: "message", id: "leaf-1", parentId: "u1", message: { role: "assistant", content: [] } },
  ];
  const entries = opts.entries ?? [];
  const labelMap = opts.labelMap ?? {};
  const ctx = {
    hasUI: opts.hasUI ?? true,
    ui: {
      notify(msg: string, type: string) {
        notifies.push({ msg, type });
      },
      setWidget(key: string, content: unknown, options?: unknown) {
        widgets.push({ key, content, options });
      },
    },
    sessionManager: {
      getBranch() {
        if (opts.throwOnGetBranch) throw new Error("getBranch boom");
        return branch;
      },
      getEntries() {
        if (opts.throwOnGetEntries) throw new Error("getEntries boom");
        return entries;
      },
      getLabel(id: string) {
        return labelMap[id];
      },
      getLeafId() {
        return "leaf-1";
      },
    },
  };
  return { notifies, widgets, ctx: ctx as unknown as ExtensionCommandContext };
}

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * A ROOT→LEAF branch ending in a `message` entry whose id == leafMsgId (and a real role), so setCheckpoint
 * anchors on leafMsgId (it walks getBranch BACKWARDS to the last real message — markers.ts ~455).
 */
function branchEndingInMsg(leafMsgId: string): unknown[] {
  return [
    { type: "message", id: "u1", parentId: null, message: { role: "user", content: [] } },
    { type: "message", id: leafMsgId, parentId: "u1", message: { role: "assistant", content: [] } },
  ];
}

/** The testable seam: call the factory's handler directly (no real Pi). */
async function runSet(pi: ExtensionAPI, ctx: ExtensionCommandContext, name: string) {
  await makeCheckpointCommand(pi).handler(name, ctx);
}
async function runRevoke(pi: ExtensionAPI, ctx: ExtensionCommandContext, name: string) {
  await makeCheckpointRevokeCommand(pi).handler(name, ctx);
}

const FORTY = "a".repeat(40); // boundary-valid (exactly 40 chars)
const FORTY_ONE = "a".repeat(41); // boundary-invalid (41 chars)

// ════════════════════════════════════════════════════════════════════════════
// /mulligan_checkpoint (SET) — case (a) VALID
// ════════════════════════════════════════════════════════════════════════════

describe("/mulligan_checkpoint (set) — VALID (spec/13 §2 step 5)", () => {
  it("labels the leaf once with 'mulligan:checkpoint:<name>', warns verbatim, and calls reconcileBanner", async () => {
    const { labels, pi } = makePi();
    const { notifies, ctx } = makeCtx({ branch: branchEndingInMsg("leaf-9") });
    await runSet(pi, ctx, "before-refactor");
    expect(labels).toEqual([{ entryId: "leaf-9", label: "mulligan:checkpoint:before-refactor" }]);
    expect(notifies).toHaveLength(1);
    expect(notifies[0].type).toBe("warning");
    // spec/13 §2 step 5 verbatim (the "(your prompts after here can be hidden)" parenthetical + the
    // "Revoke with /mulligan_checkpoint_revoke <name>." suffix are load-bearing — copy byte-for-byte).
    expect(notifies[0].msg).toBe(
      "Mulligan: checkpoint 'before-refactor' set. Until you revoke it, the agent may rewind across " +
        "your subsequent prompts back to this point (your prompts after here can be hidden). " +
        "Revoke with /mulligan_checkpoint_revoke before-refactor.",
    );
    // GOTCHA #1 — assert the reconcileBanner SPY, NOT setWidget (the banner is a stub no-op).
    expect(vi.mocked(reconcileBanner)).toHaveBeenCalledWith(ctx);
  });

  it("echoes the correct entry id for a different leaf + name", async () => {
    const { labels, pi } = makePi();
    const { notifies, ctx } = makeCtx({ branch: branchEndingInMsg("leaf-42") });
    await runSet(pi, ctx, "pre-experiment");
    expect(labels[0]).toEqual({ entryId: "leaf-42", label: "mulligan:checkpoint:pre-experiment" });
    expect(notifies[0].msg).toContain("'pre-experiment'");
    expect(vi.mocked(reconcileBanner)).toHaveBeenCalledWith(ctx);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// /mulligan_checkpoint (SET) — case (b) INVALID name
// ════════════════════════════════════════════════════════════════════════════

describe("/mulligan_checkpoint (set) — INVALID name (spec/13 §2 step 1)", () => {
  it.each([
    ["empty string", ""],
    ["contains a space", "With Space"],
    ["uppercase letters", "UPPER"],
    ["contains a dot", "dot.dot"],
    ["contains '!' special char", "name!"],
    ["41-char name (boundary-invalid)", FORTY_ONE],
  ])("rejects %s → verbatim 'invalid' warning notify; no setLabel; no reconcileBanner", async (_label, name) => {
    const { labels, pi } = makePi();
    const { notifies, ctx } = makeCtx({ branch: branchEndingInMsg("leaf-9") });
    await runSet(pi, ctx, name);
    expect(labels).toHaveLength(0);
    expect(vi.mocked(reconcileBanner)).not.toHaveBeenCalled();
    expect(notifies).toHaveLength(1);
    expect(notifies[0].type).toBe("warning");
    // spec/13 §2 step 1 verbatim (echoes the offending name + the regex constraint).
    expect(notifies[0].msg).toBe(
      `Mulligan: invalid checkpoint name '${name}' (lowercase, digits, hyphen, underscore; max 40)`,
    );
  });

  // ACCEPT parity with the tool's validCheckpointName (proves the command shares the regex).
  it.each([
    ["single char 'a'", "a"],
    ["mixed 'a-b_c1'", "a-b_c1"],
    ["40-char name (boundary-valid)", FORTY],
    ["hyphen-only '---'", "---"],
    ["digits '123'", "123"],
  ])("accepts %s → setLabel once + verbatim warning notify + reconcileBanner", async (_label, name) => {
    const { labels, pi } = makePi();
    const { notifies, ctx } = makeCtx({ branch: branchEndingInMsg("leaf-1") });
    await runSet(pi, ctx, name);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toEqual({ entryId: "leaf-1", label: `mulligan:checkpoint:${name}` });
    expect(notifies[0].type).toBe("warning");
    expect(notifies[0].msg).toContain(`'${name}' set.`);
    expect(vi.mocked(reconcileBanner)).toHaveBeenCalledWith(ctx);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// /mulligan_checkpoint (SET) — case (c) DISABLED (spec/08 E14)
// ════════════════════════════════════════════════════════════════════════════

describe("/mulligan_checkpoint (set) — DISABLED (spec/08 E14)", () => {
  beforeEach(() => setConfig({ enabled: false }));
  afterEach(() => setConfig(undefined)); // → DEFAULT_CONFIG (enabled:true); don't bleed.

  it("notifies 'Mulligan is disabled' (warning, NO 'Mulligan: ' prefix); no setLabel; no reconcileBanner", async () => {
    const { labels, pi } = makePi();
    const { notifies, ctx } = makeCtx({ branch: branchEndingInMsg("leaf-9") });
    await runSet(pi, ctx, "valid-name");
    expect(labels).toHaveLength(0);
    expect(vi.mocked(reconcileBanner)).not.toHaveBeenCalled();
    expect(notifies).toHaveLength(1);
    expect(notifies[0].type).toBe("warning");
    // GOTCHA #5 — the disabled message has NO "Mulligan: " prefix (every other notify is prefixed).
    expect(notifies[0].msg).toBe("Mulligan is disabled");
  });

  // Bonus (GOTCHA #4 — disabled gate fires BEFORE name validation).
  it("disabled fires BEFORE name validation (invalid name still gets the disabled notify)", async () => {
    const { labels, pi } = makePi();
    const { notifies, ctx } = makeCtx({ branch: branchEndingInMsg("leaf-9") });
    await runSet(pi, ctx, "BAD NAME!"); // would be invalid-name if enabled
    expect(labels).toHaveLength(0);
    expect(notifies).toHaveLength(1);
    expect(notifies[0].msg).toBe("Mulligan is disabled"); // NOT the invalid-name notify
  });
});

// ════════════════════════════════════════════════════════════════════════════
// /mulligan_checkpoint_revoke (REVOKE) — case (d) EXISTING
// ════════════════════════════════════════════════════════════════════════════

describe("/mulligan_checkpoint_revoke — EXISTING (spec/13 §3 step 5)", () => {
  it("clears the label (setLabel(id, undefined)), notifies verbatim (info), and calls reconcileBanner", async () => {
    const { labels, pi } = makePi();
    const { notifies, ctx } = makeCtx({
      entries: [{ type: "label", label: "mulligan:checkpoint:before-refactor", targetId: "leaf-9" }],
      labelMap: { "leaf-9": "mulligan:checkpoint:before-refactor" }, // getLabel === needle → ACTIVE
    });
    await runRevoke(pi, ctx, "before-refactor");
    expect(labels).toEqual([{ entryId: "leaf-9", label: undefined }]); // CLEAR
    expect(notifies).toHaveLength(1);
    expect(notifies[0].type).toBe("info");
    // spec/13 §3 step 5 verbatim.
    expect(notifies[0].msg).toBe(
      "Mulligan: checkpoint 'before-refactor' revoked. The agent can no longer rewind across your prompts to it.",
    );
    expect(vi.mocked(reconcileBanner)).toHaveBeenCalledWith(ctx);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// /mulligan_checkpoint_revoke (REVOKE) — case (e) MISSING
// ════════════════════════════════════════════════════════════════════════════

describe("/mulligan_checkpoint_revoke — MISSING (spec/13 §3 step 2)", () => {
  it("notifies verbatim 'no active checkpoint' (info); no setLabel(undefined); no reconcileBanner", async () => {
    const { labels, pi } = makePi();
    const { notifies, ctx } = makeCtx({ entries: [] }); // no label entries at all
    await runRevoke(pi, ctx, "nope");
    expect(labels).toHaveLength(0); // no setLabel(undefined)
    expect(vi.mocked(reconcileBanner)).not.toHaveBeenCalled();
    expect(notifies).toHaveLength(1);
    expect(notifies[0].type).toBe("info");
    // spec/13 §3 step 2 verbatim (closing apostrophe on <name>).
    expect(notifies[0].msg).toBe("Mulligan: no active checkpoint named 'nope'.");
  });

  it("revoke when disabled → 'Mulligan is disabled'; no setLabel; clearCheckpointByName NOT reached", async () => {
    setConfig({ enabled: false });
    try {
      const { labels, pi } = makePi();
      const { notifies, ctx } = makeCtx({
        entries: [{ type: "label", label: "mulligan:checkpoint:x", targetId: "leaf-1" }],
        labelMap: { "leaf-1": "mulligan:checkpoint:x" },
      });
      await runRevoke(pi, ctx, "x");
      expect(labels).toHaveLength(0); // gate returned before clearCheckpointByName
      expect(vi.mocked(reconcileBanner)).not.toHaveBeenCalled();
      expect(notifies).toHaveLength(1);
      expect(notifies[0].type).toBe("warning");
      expect(notifies[0].msg).toBe("Mulligan is disabled"); // GOTCHA #5 — no prefix
    } finally {
      setConfig(undefined); // reset so the disabled state doesn't leak past this it()
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// clearCheckpointByName — case (f) UNIT (non-existent / existing / stale / never-throws)
// ════════════════════════════════════════════════════════════════════════════

describe("clearCheckpointByName — unit (two-phase discover+confirm)", () => {
  it("non-existent name → false; no setLabel", () => {
    const { labels, pi } = makePi();
    const { ctx } = makeCtx({ entries: [] });
    expect(clearCheckpointByName(pi, ctx, "x")).toBe(false);
    expect(labels).toHaveLength(0);
  });

  it("existing/active name → true; setLabel(id, undefined)", () => {
    const { labels, pi } = makePi();
    const { ctx } = makeCtx({
      entries: [{ type: "label", label: "mulligan:checkpoint:x", targetId: "leaf-1" }],
      labelMap: { "leaf-1": "mulligan:checkpoint:x" }, // ACTIVE (getLabel === needle)
    });
    expect(clearCheckpointByName(pi, ctx, "x")).toBe(true);
    expect(labels).toEqual([{ entryId: "leaf-1", label: undefined }]);
  });

  // GOTCHA #7 — the highest-value case. Pi's label map is APPEND-ONLY; a revoke appends a CLEAR entry, so
  // the historical SET stays in getEntries(). The helper DISCOVERS candidates from raw entries, then
  // CONFIRMS via getLabel(id)===needle (latest-wins → undefined once cleared). With entries containing
  // the historical SET but getLabel returning undefined, the CONFIRM phase catches the staleness → false.
  it("stale label (entries has the SET but getLabel→undefined) → false; no setLabel (two-phase confirm)", () => {
    const { labels, pi } = makePi();
    const { ctx } = makeCtx({
      entries: [{ type: "label", label: "mulligan:checkpoint:x", targetId: "leaf-1" }], // historical SET present
      labelMap: { "leaf-1": undefined }, // but already cleared (latest-wins → undefined)
    });
    expect(clearCheckpointByName(pi, ctx, "x")).toBe(false);
    expect(labels).toHaveLength(0); // CONFIRM phase rejected the stale candidate
  });

  it("never throws: a throwing getEntries → returns false (no throw)", () => {
    const { labels, pi } = makePi();
    const { ctx } = makeCtx({ throwOnGetEntries: true });
    expect(() => clearCheckpointByName(pi, ctx, "x")).not.toThrow();
    expect(clearCheckpointByName(pi, ctx, "x")).toBe(false);
    expect(labels).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// BONUS — hasUI=false guard (GOTCHA #6)
// ════════════════════════════════════════════════════════════════════════════

describe("hasUI guard (GOTCHA #6 — the guard is on the notify, NOT the label mutation)", () => {
  it("hasUI=false + valid set → no notify, but setLabel STILL runs + reconcileBanner still called", async () => {
    const { labels, pi } = makePi();
    const { notifies, ctx } = makeCtx({ hasUI: false, branch: branchEndingInMsg("leaf-9") });
    await runSet(pi, ctx, "before-refactor");
    expect(notifies).toHaveLength(0); // notify is hasUI-guarded
    // label mutation runs regardless of hasUI:
    expect(labels).toEqual([{ entryId: "leaf-9", label: "mulligan:checkpoint:before-refactor" }]);
    // banner refresh is hasUI-independent (the command always mutates → always refreshes):
    expect(vi.mocked(reconcileBanner)).toHaveBeenCalledWith(ctx);
  });

  it("hasUI=false + invalid name → no notify (the invalid-name notify is guarded too)", async () => {
    const { labels, pi } = makePi();
    const { notifies, ctx } = makeCtx({ hasUI: false, branch: branchEndingInMsg("leaf-9") });
    await runSet(pi, ctx, "BAD NAME!");
    expect(notifies).toHaveLength(0);
    expect(labels).toHaveLength(0); // invalid → still no setLabel (validation precedes mutation)
  });
});

// ════════════════════════════════════════════════════════════════════════════
// BONUS — never-throws (shared command convention)
// ════════════════════════════════════════════════════════════════════════════

describe("never throws (command handlers wrap the body in try/catch)", () => {
  it("a throwing setLabel + valid set → 'could not set checkpoint' warning notify; no throw", async () => {
    const { pi } = makePi({ throwOnSetLabel: true });
    const { notifies, ctx } = makeCtx({ branch: branchEndingInMsg("leaf-9") });
    await expect(runSet(pi, ctx, "before-refactor")).resolves.toBeUndefined();
    expect(notifies).toHaveLength(1);
    expect(notifies[0].type).toBe("warning");
    expect(notifies[0].msg).toContain("could not set checkpoint");
    expect(notifies[0].msg).toContain("setLabel boom");
  });

  it("a throwing getBranch + valid set → 'could not set checkpoint' warning notify; no throw", async () => {
    const { pi } = makePi();
    const { notifies, ctx } = makeCtx({ throwOnGetBranch: true });
    await expect(runSet(pi, ctx, "before-refactor")).resolves.toBeUndefined();
    expect(notifies).toHaveLength(1);
    expect(notifies[0].type).toBe("warning");
    expect(notifies[0].msg).toContain("could not set checkpoint");
    expect(notifies[0].msg).toContain("getBranch boom");
  });

  it("a throwing getEntries + revoke → clearCheckpointByName returns false → 'no active checkpoint' info; no throw", async () => {
    const { pi } = makePi();
    const { notifies, ctx } = makeCtx({ throwOnGetEntries: true });
    await expect(runRevoke(pi, ctx, "nope")).resolves.toBeUndefined();
    expect(notifies).toHaveLength(1);
    expect(notifies[0].type).toBe("info");
    expect(notifies[0].msg).toBe("Mulligan: no active checkpoint named 'nope'.");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Types (mirror checkpoint.test.ts's expectTypeOf block)
// ════════════════════════════════════════════════════════════════════════════

describe("types", () => {
  it("makeCheckpointCommand returns { description: string; handler: (args, ctx) => Promise<void> }", () => {
    const { pi } = makePi();
    const cmd = makeCheckpointCommand(pi);
    expectTypeOf(cmd.description).toEqualTypeOf<string>();
    expectTypeOf(cmd.handler).parameters.toEqualTypeOf<[string, ExtensionCommandContext]>();
    expectTypeOf(cmd.handler).returns.toEqualTypeOf<Promise<void>>();
  });

  it("makeCheckpointRevokeCommand returns { description: string; handler: (args, ctx) => Promise<void> }", () => {
    const { pi } = makePi();
    const cmd = makeCheckpointRevokeCommand(pi);
    expectTypeOf(cmd.description).toEqualTypeOf<string>();
    expectTypeOf(cmd.handler).parameters.toEqualTypeOf<[string, ExtensionCommandContext]>();
    expectTypeOf(cmd.handler).returns.toEqualTypeOf<Promise<void>>();
  });

  it("clearCheckpointByName returns boolean", () => {
    const { pi } = makePi();
    const { ctx } = makeCtx();
    expectTypeOf(clearCheckpointByName(pi, ctx, "x")).toEqualTypeOf<boolean>();
  });
});