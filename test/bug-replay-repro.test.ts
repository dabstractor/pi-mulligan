/**
 * REPRO for BUG_TURN_REPLAY_LOOP.md — "assistant turn replays from the top after every tool call".
 *
 * Models ONE user turn where the agent: does a tool call (tA), then a mulligan_rewind (tRW),
 * then resumes and does a SECOND tool call (tB). We then fire the filter TWICE — once before
 * tB exists (the resume fire) and once AFTER tB (a mid-turn continuation fire) — and assert
 * what each rewind variant hides.
 *
 * The bug: a rewind marker WITHOUT hideEntryIds takes the LEGACY relative-resolution path
 * (resolveLastToolCallGroup re-partitions the CURRENT messages every fire). On the continuation
 * fire, "last tool-call group" re-targets onto the agent's NEW work (tB) and hides it every fire
 * → the model never sees its own just-produced work → restarts the turn → replay loop.
 *
 * The pinned variant (hideEntryIds present) resolves by stable entry identity and does NOT
 * re-target, so the new work survives — demonstrating the fix direction.
 */
import { describe, it, expect } from "vitest";
import { filterPipeline, type MessageLike, type BranchEntry, type RewindDiag } from "../src/transforms.js";

// ── a one-user-turn fixture, indices fixed for assertions ───────────────────
// 0:U  1:A1(tA)  2:R_A  3:A_rw(tRW)  4:R_RW  5:note  6:A2(tB)  7:R_B
function buildMessages(withNewWork: boolean): MessageLike[] {
  const msgs: MessageLike[] = [
    { role: "user", content: "do the task" },
    { role: "assistant", content: [{ type: "toolCall", id: "tA", name: "read", arguments: {} }] },
    { role: "toolResult", toolCallId: "tA", content: [{ type: "text", text: "file A contents" }] },
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "tRW", name: "mulligan_rewind", arguments: {} }],
    },
    { role: "toolResult", toolCallId: "tRW", content: [{ type: "text", text: "rewound" }] },
    { role: "custom", customType: "mulligan:note", content: "note left" },
  ];
  if (withNewWork) {
    msgs.push({
      role: "assistant",
      content: [{ type: "toolCall", id: "tB", name: "read", arguments: {} }],
    });
    msgs.push({
      role: "toolResult",
      toolCallId: "tB",
      content: [{ type: "text", text: "file B contents" }],
    });
  }
  return msgs;
}

// branchEntries root→leaf, 1:1 with the messages (no compaction). context-producing types only
// actually appear here, each yielding exactly 1 message (verified against Pi's sessionEntryToContextMessages).
function buildBranch(withNewWork: boolean): BranchEntry[] {
  const entries: BranchEntry[] = [
    { type: "message", id: "e_U", parentId: null },
    { type: "message", id: "e_A1", parentId: "e_U" },
    { type: "message", id: "e_RA", parentId: "e_A1" },
    { type: "message", id: "e_Arw", parentId: "e_RA" },
    { type: "message", id: "e_RRW", parentId: "e_Arw" },
    { type: "custom_message", id: "e_note", parentId: "e_RRW" },
  ];
  if (withNewWork) {
    entries.push({ type: "message", id: "e_A2", parentId: "e_note" });
    entries.push({ type: "message", id: "e_RB", parentId: "e_A2" });
  }
  return entries;
}

const CFG = { rewind: { protectedRoles: ["first:user", "latest:user"] } };

const tAGroup = (withNewWork: boolean) => (withNewWork ? [1, 2] : [1, 2]);
const tBGroup = [6, 7]; // only exists when withNewWork

describe("BUG_TURN_REPLAY_LOOP — legacy relative-resolution re-targets the new turn", () => {
  it("LEGACY marker (no hideEntryIds): resume fire hides the tA group (intended)", () => {
    const legacyMarker = {
      seq: 1,
      granularity: "last_tool_call_group" as const,
      excludeToolCallId: "tRW",
      // NO hideEntryIds → legacy path
    };
    const out = filterPipeline(buildMessages(false), { rewinds: [legacyMarker], shrinks: [] }, CFG, buildBranch(false));
    // indices 1,2 (A1,R_A) gone; U + rewind's own + note remain
    expect(out.map((m) => (m as { role?: string }).role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "custom",
    ]);
    expect(out.length).toBe(4);
  });

  it("REGRESSION: LEGACY marker (no hideEntryIds) NO-OPS on continuation — new tB work SURVIVES", () => {
    const legacyMarker = {
      seq: 1,
      granularity: "last_tool_call_group" as const,
      excludeToolCallId: "tRW",
      // NO hideEntryIds → must NO-OP (the safety gate), NOT re-target the new turn.
    };
    const out = filterPipeline(buildMessages(true), { rewinds: [legacyMarker], shrinks: [] }, CFG, buildBranch(true));
    // Before the fix this hid the just-produced tB toolGroup every fire (replay). Now it hides nothing.
    const hasTBcall = out.some((m) => {
      const c = (m as { content?: unknown }).content;
      return Array.isArray(c) && c.some((b) => (b as { id?: string }).id === "tB");
    });
    const hasRB = out.some((m) => (m as { toolCallId?: string }).toolCallId === "tB");
    expect(hasTBcall).toBe(true); // new assistant toolCall SURVIVES
    expect(hasRB).toBe(true); // new result SURVIVES
    expect(out.length).toBe(8); // the full message list is passed through unchanged
    void tAGroup;
    void tBGroup;
  });

  it("PINNED marker (hideEntryIds): continuation fire KEEPS the new tB group (correct)", () => {
    const pinnedMarker = {
      seq: 1,
      granularity: "last_tool_call_group" as const,
      excludeToolCallId: "tRW",
      hideEntryIds: ["e_A1", "e_RA"], // pinned at creation
    };
    const out = filterPipeline(buildMessages(true), { rewinds: [pinnedMarker], shrinks: [] }, CFG, buildBranch(true));
    const roles = out.map((m) => (m as { role?: string }).role);
    // the pinned span (A1,R_A) is hidden; the NEW tB work (A2,R_B) SURVIVES
    expect(roles).toContain("toolResult"); // R_B present
    const hasTB = out.some((m) => {
      const c = (m as { content?: unknown }).content;
      return Array.isArray(c) && c.some((b) => (b as { id?: string }).id === "tB");
    });
    expect(hasTB).toBe(true);
    expect(out.length).toBe(6); // U,Arw,RRW,note,A2,R_B — pinned A1,R_A (idx 1,2) stripped
  });

  it("REGRESSION: LEGACY last_turn marker (no hideEntryIds) NO-OPS — new work SURVIVES", () => {
    const legacyTurn = {
      seq: 1,
      granularity: "last_turn" as const,
      excludeToolCallId: "tRW",
      options: {},
    };
    const out = filterPipeline(buildMessages(true), { rewinds: [legacyTurn], shrinks: [] }, CFG, buildBranch(true));
    // Before the fix this swept everything after the user message every fire (replay). Now it no-ops.
    const hasTBcall = out.some((m) => {
      const c = (m as { content?: unknown }).content;
      return Array.isArray(c) && c.some((b) => (b as { id?: string }).id === "tB");
    });
    const hasRB = out.some((m) => (m as { toolCallId?: string }).toolCallId === "tB");
    expect(hasTBcall).toBe(true); // new toolCall SURVIVES
    expect(hasRB).toBe(true); // new result SURVIVES
    expect(out.length).toBe(8); // passed through unchanged — no replay
  });

  // ── does a PINNED marker (hideEntryIds present — the NORMAL rewind-tool output) ever replay? ──
  // Crux for the "only on read" evidence: a normal "undo my last read" rewind is PINNED, so if the pinned path
  // hid a LATER read every fire, the legacy guard above would NOT catch it. Verify it does not.
  it("PINNED 'undo prior read' marker: a LATER bloated read (multi-block, like the bloat reminder) SURVIVES", () => {
    const msgs: MessageLike[] = [
      { role: "user", content: "edit the spec" },
      { role: "assistant", content: [{ type: "toolCall", id: "r1", name: "read", arguments: {} }] },
      { role: "toolResult", toolCallId: "r1", content: [{ type: "text", text: "BIG READ #1" }] },
      { role: "assistant", content: [{ type: "toolCall", id: "rw", name: "mulligan_rewind", arguments: {} }] },
      { role: "toolResult", toolCallId: "rw", content: [{ type: "text", text: "rewound" }] },
      { role: "custom", customType: "mulligan:note", content: "note" },
      { role: "assistant", content: [{ type: "toolCall", id: "r2", name: "read", arguments: {} }] },
      // multi-block result, as the bloat reminder appends a second text block to a >threshold read
      {
        role: "toolResult", toolCallId: "r2",
        content: [
          { type: "text", text: "BIG READ #2" },
          { type: "text", text: "[mulligan] This result is ~NN KB ... call mulligan_shrink ..." },
        ],
      },
    ];
    const branch: BranchEntry[] = [
      { type: "message", id: "e_u", parentId: null },
      { type: "message", id: "e_r1a", parentId: "e_u" },
      { type: "message", id: "e_r1r", parentId: "e_r1a" }, // pinned (the undone read)
      { type: "message", id: "e_rwa", parentId: "e_r1r" },
      { type: "message", id: "e_rwr", parentId: "e_rwa" },
      { type: "custom_message", id: "e_note", parentId: "e_rwr" },
      { type: "message", id: "e_r2a", parentId: "e_note" },
      { type: "message", id: "e_r2r", parentId: "e_r2a" }, // NEW read (must survive)
    ];
    const pinnedMarker = {
      seq: 1, granularity: "last_tool_call_group" as const, excludeToolCallId: "rw",
      hideEntryIds: ["e_r1a", "e_r1r"], // the undone prior read, pinned at creation
    };
    const out = filterPipeline(msgs, { rewinds: [pinnedMarker], shrinks: [] }, CFG, branch);
    const hasR2 = out.some((m) => (m as { toolCallId?: string }).toolCallId === "r2");
    expect(hasR2).toBe(true); // the later bloated read SURVIVES (no replay)
    const r2 = out.find((m) => (m as { toolCallId?: string }).toolCallId === "r2") as MessageLike;
    expect(Array.isArray(r2.content) && (r2.content as unknown[]).length === 2).toBe(true); // both blocks intact
    const hasR1 = out.some((m) => (m as { toolCallId?: string }).toolCallId === "r1");
    expect(hasR1).toBe(false); // the pinned prior read IS hidden
    expect(out.length).toBe(6); // 8 - 2 (r1a,r1r)
  });

  // ── RESIDUAL: can a PINNED marker replay under COMPACTION? (the not-yet-reproduced alternative trigger) ──
  // event.messages is compaction-aware (old prefix gone, compaction summary first); getBranch() is RAW (still has the
  // old entries + the compaction entry). A pinned marker whose span was compacted away walks the raw branch. If the
  // pinned path could misalign and hide the agent's NEW post-compaction read every fire, THIS is where it would happen.
  it("COMPACTION: a pinned marker whose span was compacted NO-OPS — the NEW post-compaction read SURVIVES (no replay)", () => {
    // event.messages (compaction-aware, 5): the old hidden work is GONE (compacted); a fresh read follows compaction.
    const msgs: MessageLike[] = [
      { role: "user", content: "[compaction summary of the early session]" }, // [0] compaction summary msg
      { role: "assistant", content: [{ type: "toolCall", id: "ret", name: "read", arguments: {} }] }, // [1] retained
      { role: "toolResult", toolCallId: "ret", content: [{ type: "text", text: "retained read" }] }, // [2]
      { role: "assistant", content: [{ type: "toolCall", id: "r2", name: "read", arguments: {} }] }, // [3] NEW read
      { role: "toolResult", toolCallId: "r2", content: [{ type: "text", text: "NEW READ after compaction" }] }, // [4]
    ];
    // getBranch() (RAW root→leaf): pre-compaction entries + the compaction entry + retained + new. (resolvePinnedHide
    // filters to context-producing types, which INCLUDES compaction → entryMessageYield('compaction') === -1 → refuse.)
    const branch: BranchEntry[] = [
      { type: "message", id: "e_old_a", parentId: null },   // pre-compaction (the originally-hidden, now compacted)
      { type: "message", id: "e_old_r", parentId: "e_old_a" },
      { type: "compaction", id: "e_comp", parentId: "e_old_r" },
      { type: "message", id: "e_ret_a", parentId: "e_comp" },
      { type: "message", id: "e_ret_r", parentId: "e_ret_a" },
      { type: "message", id: "e_r2a", parentId: "e_ret_r" },
      { type: "message", id: "e_r2r", parentId: "e_r2a" }, // NEW read entry
    ];
    const pinnedMarker = {
      seq: 1, granularity: "last_tool_call_group" as const, excludeToolCallId: "rw",
      hideEntryIds: ["e_old_a", "e_old_r"], // the old span — stable ids, but the messages are gone (compacted)
    };
    const out = filterPipeline(msgs, { rewinds: [pinnedMarker], shrinks: [] }, CFG, branch);
    // The pinned walk hits the compaction entry → resolvePinnedHide returns [] (refuse) → NOTHING hidden this fire.
    // The new post-compaction read (r2) SURVIVES intact — no replay. (The originally-hidden content is gone from the
    // view anyway since it was compacted; this is a benign no-op/leak, NOT the catastrophic turn-replay.)
    expect(out.length).toBe(5); // unchanged — nothing hidden
    const hasR2 = out.some((m) => (m as { toolCallId?: string }).toolCallId === "r2");
    expect(hasR2).toBe(true); // NEW read SURVIVES (the replay would have hidden this)
    const r2 = out.find((m) => (m as { toolCallId?: string }).toolCallId === "r2") as MessageLike;
    expect((r2.content as unknown[]).length).toBe(1); // its content is intact, not substituted/removed
  });

  // ── the invariant log's data source: filterPipeline's OPTIONAL diag sink must report the right mode per rewind ──
  it("diag sink: PINNED → 'pinned'; LEGACY creating-fire → 'legacy-run'; LEGACY advanced-fire → 'legacy-noop-advanced'", () => {
    // PINNED: hide the prior read; new read follows. Mode must be 'pinned', remove touches the OLD span (not the tail).
    const diagPinned: RewindDiag[] = [];
    filterPipeline(
      [
        { role: "user", content: "u" },
        { role: "assistant", content: [{ type: "toolCall", id: "r1", name: "read", arguments: {} }] },
        { role: "toolResult", toolCallId: "r1", content: [{ type: "text", text: "x" }] },
        { role: "assistant", content: [{ type: "toolCall", id: "rw", name: "mulligan_rewind", arguments: {} }] },
        { role: "toolResult", toolCallId: "rw", content: [{ type: "text", text: "r" }] },
        { role: "custom", customType: "mulligan:note", content: "n" },
      ],
      { rewinds: [{ seq: 1, granularity: "last_tool_call_group" as const, excludeToolCallId: "rw", hideEntryIds: ["e_r1a", "e_r1r"] }], shrinks: [] },
      CFG,
      [
        { type: "message", id: "e_u", parentId: null },
        { type: "message", id: "e_r1a", parentId: "e_u" },
        { type: "message", id: "e_r1r", parentId: "e_r1a" },
        { type: "message", id: "e_rwa", parentId: "e_r1r" },
        { type: "message", id: "e_rwr", parentId: "e_rwa" },
        { type: "custom_message", id: "e_note", parentId: "e_rwr" },
      ],
      diagPinned,
    );
    expect(diagPinned).toHaveLength(1);
    expect(diagPinned[0].mode).toBe("pinned");
    expect(diagPinned[0].remove).toEqual([1, 2]); // the OLD span, not the tail
    expect(Math.max(...diagPinned[0].remove)).toBeLessThan(diagPinned[0].resolvedLen - 3); // not tail-touching

    // LEGACY creating fire (no new work after the rewind's own group): mode 'legacy-run', removes the prior group.
    const diagCreate: RewindDiag[] = [];
    filterPipeline(buildMessages(false), { rewinds: [{ seq: 1, granularity: "last_tool_call_group" as const, excludeToolCallId: "tRW" }], shrinks: [] }, CFG, buildBranch(false), diagCreate);
    expect(diagCreate[0].mode).toBe("legacy-run");
    expect(diagCreate[0].remove.length).toBeGreaterThan(0);

    // LEGACY advanced fire (new work appended): mode 'legacy-noop-advanced', remove empty (the guard fired).
    const diagAdvanced: RewindDiag[] = [];
    filterPipeline(buildMessages(true), { rewinds: [{ seq: 1, granularity: "last_tool_call_group" as const, excludeToolCallId: "tRW" }], shrinks: [] }, CFG, buildBranch(true), diagAdvanced);
    expect(diagAdvanced[0].mode).toBe("legacy-noop-advanced");
    expect(diagAdvanced[0].remove).toEqual([]);
  });
});