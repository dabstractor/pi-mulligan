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
import {
  describe,
  it,
  expect,
  expectTypeOf,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import type { Mock } from "vitest"; // type-only — for fakeStore capture spy casts (step 4b)
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

// vi.mock is HOISTED to the top of the file (before the imports below) and is FILE-SCOPED — it replaces
// banner.js for every test in this file. This mirrors the settings.js/log.js module-mock idiom in
// test/index.test.ts. The spy is module-level → we mockClear() it in beforeEach (GOTCHA #9) so call
// counts don't leak across tests.
vi.mock("../src/banner.js", () => ({ reconcileBanner: vi.fn() }));

import {
  makeCheckpointCommand,
  makeCheckpointRevokeCommand,
  clearCheckpointByName,
  makeAuditCommand,
} from "../src/commands.js";
import { reconcileBanner } from "../src/banner.js"; // the MOCKED binding (the spy target)
import { getConfig, setConfig } from "../src/config.js"; // disabled-gate control (+ getConfig to re-derive the expected report)
import { clearAll, getRuntime } from "../src/runtime.js"; // module-scoped runtime reset (+ getRuntime to seed rt.lastFiltered)
import type { SnapshotStore } from "../src/snapshot/store.js"; // type-only (erased) — for step-4b fakeStore cast
import {
  renderAuditReport,
  listCheckpoints,
  describeMessage,
  messageBytes,
  buildCallLookup,
  type AuditRow,
} from "../src/tools/audit.js"; // the EXPORTED audit renderer + label helpers (parity re-derivation for case (a))
import { estimateTokens } from "../src/tokens.js"; // total + per-message token estimates
import { readMarkers } from "../src/filter.js"; // active markers (rewinds/shrinks/cancelledIds)
import { bloatThresholdFor } from "../src/nudges.js"; // per-tool bloat threshold (Nudge A)
import type { RewindMarker, ShrinkMarker } from "../src/markers.js"; // type-only (the audit writes nothing)

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
 *
 * The audit section extends this with `appendEntry`/`sendMessage` no-op spies (the F-useraudit invariant —
 * case (c): the handler NEVER calls them, so `appended`/`sent` MUST stay length 0). Returned as extra keys
 * that existing checkpoint tests ignore (they destructure only `{ labels, pi }` — NON-BREAKING).
 */
function makePi(opts: { throwOnSetLabel?: boolean } = {}) {
  const labels: { entryId: string; label: string | undefined }[] = [];
  // step-4b (P3.M2.T1.S1) records the control-entry payload: { customType, data }. The existing audit
  // case-(c) test asserts `appended.toHaveLength(0)` — still holds (shape change is internal).
  const appended: { customType: string; data: unknown }[] = [];
  const sent: boolean[] = [];
  const pi = {
    setLabel(entryId: string, label: string | undefined) {
      if (opts.throwOnSetLabel) throw new Error("setLabel boom");
      labels.push({ entryId, label });
    },
    appendEntry(customType: string, data: unknown) {
      appended.push({ customType, data });
    },
    sendMessage() {
      sent.push(true);
    },
  };
  return { labels, appended, sent, pi: pi as unknown as ExtensionAPI };
}

/**
 * A minimal fake ExtensionCommandContext (GOTCHA #2 — RICHER than checkpoint.test.ts's makeCtx). Command
 * handlers touch `hasUI` + `ui.{notify,setWidget}`, setCheckpoint reads `sessionManager.getBranch`, and
 * clearCheckpointByName scans `sessionManager.getEntries`/`getLabel`. `getLeafId` is defensive
 * (forward-compat) — unused by the paths under test today.
 *
 * `widgets` is captured (defensive) but NEVER asserted — GOTCHA #1 (reconcileBanner is a stub).
 */
function makeCtx(
  opts: {
    hasUI?: boolean;
    branch?: unknown[];
    entries?: unknown[];
    labelMap?: Record<string, string | undefined>;
    throwOnGetBranch?: boolean;
    throwOnGetEntries?: boolean;
    sessionId?: string;
    contextEntries?: unknown[];
    throwOnGetSessionId?: boolean;
    throwOnBuildContext?: boolean;
  } = {},
) {
  const notifies: { msg: string; type: string }[] = [];
  const widgets: { key: string; content: unknown; options?: unknown }[] = [];
  const branch = opts.branch ?? [
    {
      type: "message",
      id: "u1",
      parentId: null,
      message: { role: "user", content: [] },
    },
    {
      type: "message",
      id: "leaf-1",
      parentId: "u1",
      message: { role: "assistant", content: [] },
    },
  ];
  const entries = opts.entries ?? [];
  const labelMap = opts.labelMap ?? {};
  const contextEntries = opts.contextEntries ?? [];
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
      getSessionId() {
        if (opts.throwOnGetSessionId) throw new Error("getSessionId boom");
        return opts.sessionId ?? "s1";
      },
      buildContextEntries() {
        if (opts.throwOnBuildContext)
          throw new Error("buildContextEntries boom");
        return contextEntries;
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
    {
      type: "message",
      id: "u1",
      parentId: null,
      message: { role: "user", content: [] },
    },
    {
      type: "message",
      id: leafMsgId,
      parentId: "u1",
      message: { role: "assistant", content: [] },
    },
  ];
}

/** The testable seam: call the factory's handler directly (no real Pi). */
async function runSet(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  name: string,
) {
  await makeCheckpointCommand(pi).handler(name, ctx);
}
async function runRevoke(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  name: string,
) {
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
    expect(labels).toEqual([
      { entryId: "leaf-9", label: "mulligan:checkpoint:before-refactor" },
    ]);
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
    expect(labels[0]).toEqual({
      entryId: "leaf-42",
      label: "mulligan:checkpoint:pre-experiment",
    });
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
  ])(
    "rejects %s → verbatim 'invalid' warning notify; no setLabel; no reconcileBanner",
    async (_label, name) => {
      const { labels, pi } = makePi();
      const { notifies, ctx } = makeCtx({
        branch: branchEndingInMsg("leaf-9"),
      });
      await runSet(pi, ctx, name);
      expect(labels).toHaveLength(0);
      expect(vi.mocked(reconcileBanner)).not.toHaveBeenCalled();
      expect(notifies).toHaveLength(1);
      expect(notifies[0].type).toBe("warning");
      // spec/13 §2 step 1 verbatim (echoes the offending name + the regex constraint).
      expect(notifies[0].msg).toBe(
        `Mulligan: invalid checkpoint name '${name}' (lowercase, digits, hyphen, underscore; max 40)`,
      );
    },
  );

  // ACCEPT parity with the tool's validCheckpointName (proves the command shares the regex).
  it.each([
    ["single char 'a'", "a"],
    ["mixed 'a-b_c1'", "a-b_c1"],
    ["40-char name (boundary-valid)", FORTY],
    ["hyphen-only '---'", "---"],
    ["digits '123'", "123"],
  ])(
    "accepts %s → setLabel once + verbatim warning notify + reconcileBanner",
    async (_label, name) => {
      const { labels, pi } = makePi();
      const { notifies, ctx } = makeCtx({
        branch: branchEndingInMsg("leaf-1"),
      });
      await runSet(pi, ctx, name);
      expect(labels).toHaveLength(1);
      expect(labels[0]).toEqual({
        entryId: "leaf-1",
        label: `mulligan:checkpoint:${name}`,
      });
      expect(notifies[0].type).toBe("warning");
      expect(notifies[0].msg).toContain(`'${name}' set.`);
      expect(vi.mocked(reconcileBanner)).toHaveBeenCalledWith(ctx);
    },
  );
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
      entries: [
        {
          type: "label",
          label: "mulligan:checkpoint:before-refactor",
          targetId: "leaf-9",
        },
      ],
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
    expect(notifies[0].msg).toBe(
      "Mulligan: no active checkpoint named 'nope'.",
    );
  });

  it("revoke when disabled → 'Mulligan is disabled'; no setLabel; clearCheckpointByName NOT reached", async () => {
    setConfig({ enabled: false });
    try {
      const { labels, pi } = makePi();
      const { notifies, ctx } = makeCtx({
        entries: [
          { type: "label", label: "mulligan:checkpoint:x", targetId: "leaf-1" },
        ],
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
      entries: [
        { type: "label", label: "mulligan:checkpoint:x", targetId: "leaf-1" },
      ],
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
      entries: [
        { type: "label", label: "mulligan:checkpoint:x", targetId: "leaf-1" },
      ], // historical SET present
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
    const { notifies, ctx } = makeCtx({
      hasUI: false,
      branch: branchEndingInMsg("leaf-9"),
    });
    await runSet(pi, ctx, "before-refactor");
    expect(notifies).toHaveLength(0); // notify is hasUI-guarded
    // label mutation runs regardless of hasUI:
    expect(labels).toEqual([
      { entryId: "leaf-9", label: "mulligan:checkpoint:before-refactor" },
    ]);
    // banner refresh is hasUI-independent (the command always mutates → always refreshes):
    expect(vi.mocked(reconcileBanner)).toHaveBeenCalledWith(ctx);
  });

  it("hasUI=false + invalid name → no notify (the invalid-name notify is guarded too)", async () => {
    const { labels, pi } = makePi();
    const { notifies, ctx } = makeCtx({
      hasUI: false,
      branch: branchEndingInMsg("leaf-9"),
    });
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
    expect(notifies[0].msg).toBe(
      "Mulligan: no active checkpoint named 'nope'.",
    );
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
    expectTypeOf(cmd.handler).parameters.toEqualTypeOf<
      [string, ExtensionCommandContext]
    >();
    expectTypeOf(cmd.handler).returns.toEqualTypeOf<Promise<void>>();
  });

  it("makeCheckpointRevokeCommand returns { description: string; handler: (args, ctx) => Promise<void> }", () => {
    const { pi } = makePi();
    const cmd = makeCheckpointRevokeCommand(pi);
    expectTypeOf(cmd.description).toEqualTypeOf<string>();
    expectTypeOf(cmd.handler).parameters.toEqualTypeOf<
      [string, ExtensionCommandContext]
    >();
    expectTypeOf(cmd.handler).returns.toEqualTypeOf<Promise<void>>();
  });

  it("clearCheckpointByName returns boolean", () => {
    const { pi } = makePi();
    const { ctx } = makeCtx();
    expectTypeOf(clearCheckpointByName(pi, ctx, "x")).toEqualTypeOf<boolean>();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// /mulligan_audit — the v1.1 HUMAN-facing diagnostic command (spec/13 §4 / F-useraudit)
// ════════════════════════════════════════════════════════════════════════════
// The audit command renders the SAME report as the agent's `mulligan_audit` tool and surfaces it to the
// HUMAN via ctx.ui.notify ONLY — the report NEVER enters event.messages (a human command must not bloat
// the model's context; spec/13 §4 step 2). Four contract cases + bonuses, mirroring the checkpoint idiom.

/** userMsg — a minimal user message fixture (copied from test/tools/audit.test.ts; not exported there). */
function userMsg(text: string): Record<string, unknown> {
  return { role: "user", content: text };
}

/** toolResult — a minimal tool-result message fixture (copied from test/tools/audit.test.ts; not exported there). */
function toolResult(
  id: string,
  name: string,
  text: string,
): Record<string, unknown> {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName: name,
    content: [{ type: "text", text }],
  };
}

/**
 * buildExpectedReport — re-derive the report string from the SAME `filtered` + `ctx` the handler consumed,
 * using the SAME pure helpers the production handler (src/commands.ts makeAuditCommand) calls. The row loop
 * is a BYTE-IDENTICAL replica of the handler's step-6 top-N ranking (map→sort b-a→slice 0,8→map AuditRow),
 * so any divergence between the command path and a direct renderAuditReport call surfaces as an exact-string
 * failure in case (a). PURE: derives ONLY from its args (seeds nothing; the caller seeds rt.lastFiltered).
 */
function buildExpectedReport(
  filtered: Record<string, unknown>[],
  ctx: ExtensionCommandContext,
): string {
  const config = getConfig();
  const totalTokens = estimateTokens(
    filtered as unknown as Parameters<typeof estimateTokens>[0],
  ).tokens;
  const callLookup = buildCallLookup(filtered);
  type TM = Parameters<typeof estimateTokens>[0];
  const rows: AuditRow[] = filtered
    .map((m) => ({
      tokens: estimateTokens([m] as unknown as TM).tokens,
      msg: m,
    }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 8)
    .map(({ tokens, msg }) => {
      const toolName =
        typeof msg.toolName === "string" ? msg.toolName : undefined;
      const rowThreshold = bloatThresholdFor(toolName, config);
      return {
        tokens,
        role: typeof msg.role === "string" ? msg.role : "?",
        label: describeMessage(msg, callLookup),
        bloaty: messageBytes(msg) > rowThreshold,
        thresholdBytes: rowThreshold,
      };
    });
  const markers = readMarkers(ctx);
  const checkpointNames = listCheckpoints(
    (ctx.sessionManager.getEntries() as unknown as unknown[]) ?? [],
  );
  return renderAuditReport({
    totalTokens,
    confidence: config.audit.estimateConfidence,
    rewinds: markers.rewinds as RewindMarker[],
    shrinks: markers.shrinks as ShrinkMarker[],
    checkpointNames,
    protectedRoles: config.rewind.protectedRoles,
    rows,
    filtered,
    cancelledCount: markers.cancelledIds.size,
  });
}

/** The testable seam: call the audit factory's handler directly (no real Pi). */
async function runAudit(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  args = "",
) {
  await makeAuditCommand(pi).handler(args, ctx);
}

// ── case (a) — renders the SAME string as renderAuditReport (PRIMARY / cached path) ───────────

describe("/mulligan_audit — case (a) renders the same report as renderAuditReport (cached path)", () => {
  it("notify msg === renderAuditReport re-derived from the same filtered+ctx (exact string equality)", async () => {
    const filtered = [
      userMsg("hello world"),
      toolResult("c1", "read", "big file body"),
    ];
    getRuntime("s1").lastFiltered = filtered; // PRIMARY path seed (confidence = config.audit.estimateConfidence)
    const { pi } = makePi();
    const { notifies, ctx } = makeCtx({ entries: [] }); // no markers, no checkpoints
    await runAudit(pi, ctx);
    const expected = buildExpectedReport(filtered, ctx);
    expect(notifies).toHaveLength(1);
    expect(notifies[0].msg).toBe(expected); // EXACT string equality (the renderer-parity assertion)
  });
});

// ── case (b) — report delivered to the HUMAN sink (info notify) ──────────────────────────────

describe("/mulligan_audit — case (b) report delivered to the human sink (info notify)", () => {
  it("notifies length 1, type 'info', and msg contains the report", async () => {
    const filtered = [
      userMsg("hello world"),
      toolResult("c1", "read", "big file body"),
    ];
    getRuntime("s1").lastFiltered = filtered;
    const { pi } = makePi();
    const { notifies, ctx } = makeCtx({ entries: [] });
    await runAudit(pi, ctx);
    const expected = buildExpectedReport(filtered, ctx);
    expect(notifies).toHaveLength(1);
    expect(notifies[0].type).toBe("info");
    expect(notifies[0].msg).toContain(expected); // "contains the report" (== holds; toContain is robust)
  });
});

// ── case (c) — ZERO writes that could enter event.messages (F-useraudit invariant) ────────────

describe("/mulligan_audit — case (c) ZERO writes (the report never enters event.messages)", () => {
  it("after a successful run, pi.appendEntry and pi.sendMessage were each called 0 times", async () => {
    getRuntime("s1").lastFiltered = [
      userMsg("hello world"),
      toolResult("c1", "read", "big file body"),
    ];
    const { appended, sent, pi } = makePi();
    const { ctx } = makeCtx({ entries: [] });
    await runAudit(pi, ctx);
    expect(appended).toHaveLength(0); // no pi.appendEntry
    expect(sent).toHaveLength(0); // no pi.sendMessage
  });
});

// ── case (d) — config.enabled=false → 'Mulligan is disabled' (fires FIRST) ────────────────────

describe("/mulligan_audit — case (d) disabled gate fires FIRST (spec/08 E14)", () => {
  it("setConfig({enabled:false}) → one warning notify, msg EXACTLY 'Mulligan is disabled' (no prefix)", async () => {
    setConfig({ enabled: false });
    try {
      const { pi } = makePi();
      const { notifies, ctx } = makeCtx();
      await runAudit(pi, ctx);
      expect(notifies).toHaveLength(1);
      expect(notifies[0].type).toBe("warning");
      expect(notifies[0].msg).toBe("Mulligan is disabled"); // NO "Mulligan: " prefix
    } finally {
      setConfig(undefined); // reset so the disabled state doesn't leak past this it()
    }
  });
});

// ── bonus (e) — enabled + hasUI=false → silent early return (no notify, no throw) ────────────

describe("/mulligan_audit — bonus (e) hasUI=false silent early return", () => {
  it("enabled + hasUI=false → resolves with no notify (the expensive pipeline is skipped)", async () => {
    getRuntime("s1").lastFiltered = [userMsg("x")];
    const { pi } = makePi();
    const { notifies, ctx } = makeCtx({ hasUI: false });
    await expect(runAudit(pi, ctx)).resolves.toBeUndefined();
    expect(notifies).toHaveLength(0);
  });
});

// ── bonus (f) — never throws (shared command convention) ─────────────────────────────────────

describe("/mulligan_audit — bonus (f) never throws", () => {
  it("a throwing getSessionId → caught → 'Mulligan: unexpected error: …' warning notify; no throw", async () => {
    getRuntime("s1").lastFiltered = [userMsg("x")];
    const { pi } = makePi();
    const { notifies, ctx } = makeCtx({ throwOnGetSessionId: true });
    await expect(runAudit(pi, ctx)).resolves.toBeUndefined();
    expect(notifies).toHaveLength(1);
    expect(notifies[0].type).toBe("warning");
    expect(notifies[0].msg).toContain("Mulligan: unexpected error:");
  });
});

// ── bonus (g) — args IGNORED (reserved for a future `top` override) ──────────────────────────

describe("/mulligan_audit — bonus (g) args ignored (reserved for future top override)", () => {
  it("passing '20' runs normally and still emits the report === renderAuditReport output", async () => {
    const filtered = [
      userMsg("hello world"),
      toolResult("c1", "read", "big file body"),
    ];
    getRuntime("s1").lastFiltered = filtered;
    const { pi } = makePi();
    const { notifies, ctx } = makeCtx({ entries: [] });
    await runAudit(pi, ctx, "20"); // args ignored — top still hardcoded to 8
    const expected = buildExpectedReport(filtered, ctx);
    expect(notifies).toHaveLength(1);
    expect(notifies[0].msg).toBe(expected);
  });
});

// ── bonus (h) — types (mirror the checkpoint expectTypeOf block) ─────────────────────────────

describe("/mulligan_audit — bonus (h) types", () => {
  it("makeAuditCommand returns { description: string; handler: (args, ctx) => Promise<void> }", () => {
    const { pi } = makePi();
    const cmd = makeAuditCommand(pi);
    expectTypeOf(cmd.description).toEqualTypeOf<string>();
    expectTypeOf(cmd.handler).parameters.toEqualTypeOf<
      [string, ExtensionCommandContext]
    >();
    expectTypeOf(cmd.handler).returns.toEqualTypeOf<Promise<void>>();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// step 4b — checkpoint snapshot capture (P3.M2.T1.S1 / @spec/13 §2 step 4b + @14 §5)
// ════════════════════════════════════════════════════════════════════════════
// The v1.2 working-tree-revert capture half of /mulligan_checkpoint. When config.revert.enabled is ON
// and rt.store is a real backend, step 4b captures("ckpt:<name>") → sets rt.snapshots + appends a
// mulligan:revert-checkpoint control entry. BEST-EFFORT: the checkpoint label + fair-warning notify +
// reconcileBanner ALWAYS fire regardless of the capture outcome (the block is gated + own-try-catch +
// no early return). Eight cases: happy path, revert-OFF (v1.1 parity), store-undefined, none-backend,
// capture-null, capture-reject, cas-backend, hasUI=false.

/**
 * fakeStore — a recording SnapshotStore for step-4b tests. describe().backend + capture()'s resolved
 * ref are configurable. The other SnapshotStore methods are unused by step 4b and omitted (the cast
 * via `as unknown as SnapshotStore` satisfies the structural need). cast `capture` to Mock to assert
 * the call arg / override the return.
 */
function fakeStore(
  opts: { backend?: "git" | "cas" | "none"; ref?: string | null } = {},
): SnapshotStore {
  return {
    describe: () => ({ backend: opts.backend ?? "git" }),
    capture: vi
      .fn()
      .mockResolvedValue(opts.ref === undefined ? "sha-abc" : opts.ref),
  } as unknown as SnapshotStore;
}

/**
 * setRevertOn — turn the v1.2 working-tree-revert feature ON for a step-4b capture test. DEFAULT_CONFIG
 * has it OFF (v1.1 parity). Reset with setConfig(undefined) in a `finally` (mirrors the audit disabled-test
 * try/finally pattern) so the ON state never leaks past the it().
 */
function setRevertOn() {
  setConfig({
    revert: {
      enabled: true,
      allowDeleteCreatedFiles: false,
      nonGitMode: "cas",
      storageDir: null,
      maxFileBytes: 262144,
      maxTotalBytes: 33554432,
      maxSnapshotsPerTurn: 64,
      excludeGlobs: [".git", "node_modules"],
    },
  });
}

describe("step 4b checkpoint snapshot capture (P3.M2.T1.S1)", () => {
  // ── happy path: revert ON + git store → capture + snapshots.set + appendEntry ────────────────
  it("captures ckpt:<name> + sets rt.snapshots + appends mulligan:revert-checkpoint (revert ON + git store)", async () => {
    setRevertOn();
    try {
      const store = fakeStore({ backend: "git", ref: "sha-abc" });
      getRuntime("s1").store = store;
      const { labels, appended, pi } = makePi();
      const { notifies, ctx } = makeCtx({
        branch: branchEndingInMsg("leaf-9"),
      });
      await runSet(pi, ctx, "before-refactor");
      // capture called with the checkpoint namespace key "ckpt:<name>" (NOT "checkpoint:"):
      expect(
        vi.mocked(store.capture as unknown as Mock).mock.calls[0]![0],
      ).toBe("ckpt:before-refactor");
      // rt.snapshots now holds the RevertCheckpoint (turnIndex:-1 sentinel; no afterRef):
      const ckpt = getRuntime("s1").snapshots?.get("ckpt:before-refactor");
      expect(ckpt).toMatchObject({
        label: "ckpt:before-refactor",
        backend: "git",
        beforeRef: "sha-abc",
        turnIndex: -1,
      });
      expect(ckpt?.afterRef).toBeUndefined();
      // the control entry was appended with { label, ref, backend }:
      expect(appended).toEqual([
        {
          customType: "mulligan:revert-checkpoint",
          data: {
            label: "ckpt:before-refactor",
            ref: "sha-abc",
            backend: "git",
          },
        },
      ]);
      // step 4b did NOT block the checkpoint label + fair-warning notify + reconcileBanner:
      expect(labels).toEqual([
        { entryId: "leaf-9", label: "mulligan:checkpoint:before-refactor" },
      ]);
      expect(notifies).toHaveLength(1);
      expect(notifies[0].type).toBe("warning");
      expect(notifies[0].msg).toContain("'before-refactor' set.");
      expect(vi.mocked(reconcileBanner)).toHaveBeenCalledWith(ctx);
    } finally {
      setConfig(undefined); // reset to DEFAULT_CONFIG (revert OFF) so it doesn't leak
    }
  });

  // ── revert OFF (DEFAULT) → step 4b is a complete no-op (v1.1 parity) ─────────────────────────
  it("revert.enabled === false (DEFAULT) → NO capture / snapshots.set / appendEntry; checkpoint+notify+banner fire (v1.1 parity)", async () => {
    // NO setRevertOn() — DEFAULT_CONFIG has revert OFF
    const store = fakeStore();
    getRuntime("s1").store = store;
    const { labels, appended, pi } = makePi();
    const { notifies, ctx } = makeCtx({ branch: branchEndingInMsg("leaf-9") });
    await runSet(pi, ctx, "x");
    expect(store.capture).not.toHaveBeenCalled(); // the gate skipped before any capture access
    expect(getRuntime("s1").snapshots?.has("ckpt:x")).toBe(false);
    expect(appended).toHaveLength(0); // NO control entry
    // checkpoint + notify + banner STILL fire (behaves EXACTLY as v1.1):
    expect(labels).toEqual([
      { entryId: "leaf-9", label: "mulligan:checkpoint:x" },
    ]);
    expect(notifies).toHaveLength(1);
    expect(notifies[0].type).toBe("warning");
    expect(vi.mocked(reconcileBanner)).toHaveBeenCalledWith(ctx);
  });

  // ── store undefined (P3.M1.T2.S1 not wired) → graceful skip ────────────────────────────────
  it("store undefined (not wired) → graceful skip; checkpoint+notify+banner fire", async () => {
    setRevertOn();
    try {
      // do NOT seed rt.store → undefined (the runtime's default)
      const { labels, appended, pi } = makePi();
      const { notifies, ctx } = makeCtx({
        branch: branchEndingInMsg("leaf-9"),
      });
      await runSet(pi, ctx, "x");
      expect(getRuntime("s1").snapshots?.has("ckpt:x")).toBe(false);
      expect(appended).toHaveLength(0);
      // checkpoint + notify + banner STILL fire (the if(rt.store) guard skipped cleanly):
      expect(labels).toEqual([
        { entryId: "leaf-9", label: "mulligan:checkpoint:x" },
      ]);
      expect(notifies).toHaveLength(1);
      expect(notifies[0].type).toBe("warning");
      expect(vi.mocked(reconcileBanner)).toHaveBeenCalledWith(ctx);
    } finally {
      setConfig(undefined);
    }
  });

  // ── backend === 'none' (NoOpStore) → skip capture ──────────────────────────────────────────
  it("backend === 'none' (NoOpStore) → NO capture / snapshots.set / appendEntry; checkpoint+notify+banner fire", async () => {
    setRevertOn();
    try {
      const store = fakeStore({ backend: "none" });
      getRuntime("s1").store = store;
      const { labels, appended, pi } = makePi();
      const { notifies, ctx } = makeCtx({
        branch: branchEndingInMsg("leaf-9"),
      });
      await runSet(pi, ctx, "x");
      expect(store.capture).not.toHaveBeenCalled(); // the !=="none" guard skipped
      expect(getRuntime("s1").snapshots?.has("ckpt:x")).toBe(false);
      expect(appended).toHaveLength(0);
      // checkpoint + notify + banner STILL fire:
      expect(labels).toEqual([
        { entryId: "leaf-9", label: "mulligan:checkpoint:x" },
      ]);
      expect(notifies).toHaveLength(1);
      expect(notifies[0].type).toBe("warning");
      expect(vi.mocked(reconcileBanner)).toHaveBeenCalledWith(ctx);
    } finally {
      setConfig(undefined);
    }
  });

  // ── capture returns null (caps exceeded) → skip snapshots.set + appendEntry ────────────────
  it("capture returns null (caps exceeded) → NO snapshots.set / appendEntry; checkpoint+notify+banner fire", async () => {
    setRevertOn();
    try {
      const store = fakeStore({ ref: null });
      getRuntime("s1").store = store;
      const { labels, appended, pi } = makePi();
      const { notifies, ctx } = makeCtx({
        branch: branchEndingInMsg("leaf-9"),
      });
      await runSet(pi, ctx, "x");
      expect(store.capture).toHaveBeenCalledWith("ckpt:x"); // capture WAS called (backend is git) → null
      expect(getRuntime("s1").snapshots?.has("ckpt:x")).toBe(false); // but the null ref skipped the set
      expect(appended).toHaveLength(0); // and skipped the control entry
      // checkpoint + notify + banner STILL fire:
      expect(labels).toEqual([
        { entryId: "leaf-9", label: "mulligan:checkpoint:x" },
      ]);
      expect(notifies).toHaveLength(1);
      expect(notifies[0].type).toBe("warning");
      expect(vi.mocked(reconcileBanner)).toHaveBeenCalledWith(ctx);
    } finally {
      setConfig(undefined);
    }
  });

  // ── capture REJECTS → step-4b swallows; checkpoint STILL sets (best-effort, E27) ────────────
  it("capture REJECTS → step-4b swallows; checkpoint STILL sets + notify + banner fire (best-effort, E27)", async () => {
    setRevertOn();
    try {
      const store = fakeStore();
      vi.mocked(store.capture as unknown as Mock).mockRejectedValue(
        new Error("boom"),
      );
      getRuntime("s1").store = store;
      const { labels, appended, pi } = makePi();
      const { notifies, ctx } = makeCtx({
        branch: branchEndingInMsg("leaf-9"),
      });
      await expect(runSet(pi, ctx, "x")).resolves.toBeUndefined(); // the handler NEVER throws
      expect(getRuntime("s1").snapshots?.has("ckpt:x")).toBe(false); // capture threw → no set
      expect(appended).toHaveLength(0); // and no control entry
      // checkpoint + fair-warning notify + banner STILL fire (the catch did NOT block the rest):
      expect(labels).toEqual([
        { entryId: "leaf-9", label: "mulligan:checkpoint:x" },
      ]);
      expect(notifies).toHaveLength(1);
      expect(notifies[0].type).toBe("warning");
      expect(notifies[0].msg).toContain("'x' set.");
      expect(vi.mocked(reconcileBanner)).toHaveBeenCalledWith(ctx);
    } finally {
      setConfig(undefined);
    }
  });

  // ── cas backend → snapshots.backend === 'cas' + control-entry backend 'cas' ─────────────────
  it("cas backend → snapshots.backend === 'cas' + control-entry backend 'cas'", async () => {
    setRevertOn();
    try {
      const store = fakeStore({ backend: "cas", ref: "manifest-xyz" });
      getRuntime("s1").store = store;
      const { appended, pi } = makePi();
      const { ctx } = makeCtx({ branch: branchEndingInMsg("leaf-9") });
      await runSet(pi, ctx, "exp1");
      expect(getRuntime("s1").snapshots?.get("ckpt:exp1")?.backend).toBe("cas");
      expect(appended[0]).toEqual({
        customType: "mulligan:revert-checkpoint",
        data: { label: "ckpt:exp1", ref: "manifest-xyz", backend: "cas" },
      });
    } finally {
      setConfig(undefined);
    }
  });

  // ── hasUI=false → capture STILL runs (hasUI-independent) ───────────────────────────────────
  it("hasUI=false → capture STILL runs (hasUI-independent); no notify but snapshots.set + appendEntry happen", async () => {
    setRevertOn();
    try {
      const store = fakeStore();
      getRuntime("s1").store = store;
      const { appended, pi } = makePi();
      const { notifies, ctx } = makeCtx({
        hasUI: false,
        branch: branchEndingInMsg("leaf-9"),
      });
      await runSet(pi, ctx, "x");
      // capture is NOT hasUI-guarded (only the notify is) → it ran:
      expect(store.capture).toHaveBeenCalledWith("ckpt:x");
      expect(getRuntime("s1").snapshots?.has("ckpt:x")).toBe(true);
      expect(appended).toHaveLength(1);
      // notify IS hasUI-guarded → none fired:
      expect(notifies).toHaveLength(0);
      // banner refresh is hasUI-independent too (still called):
      expect(vi.mocked(reconcileBanner)).toHaveBeenCalledWith(ctx);
    } finally {
      setConfig(undefined);
    }
  });
});
