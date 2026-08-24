/**
 * e21-cancel-composition.test.ts — the spec/08 E21(b)-demanded COMPOSITION test:
 * run the REAL filter pipeline (contextHandler → readMarkers → filterPipeline) with a cancelled
 * marker present on the branch and assert the hidden/replaced content REAPPEARS in the filtered view.
 *
 * The two halves are individually covered elsewhere (readMarkers drops cancelled ids; the cancel tool
 * appends the mulligan:cancel entry) — spec/08:108 demands the composition itself be proven: cancel
 * end-to-end ⇒ the transform no longer applies the retired marker.
 *
 * Idiom: hand-rolled fakes (no vi.fn for Pi objects — mirror filter.test.ts), .js import paths,
 * clearAll() runtime reset. No mocks of src/ — everything here is the real code path.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { contextHandler } from "../src/filter.js";
import { setConfig } from "../src/config.js";
import { clearAll } from "../src/runtime.js";
import type { ContextEvent, ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

// ── fakes ───────────────────────────────────────────────────────────────────────────────────

/** A custom (marker) session entry. type 'custom' → NOT in context. */
function customEntry(id: string, customType: string, data: unknown): SessionEntry {
  return { type: "custom", id, parentId: null, timestamp: new Date().toISOString(), customType, data } as unknown as SessionEntry;
}
/** A message-producing branch entry. */
function msgEntry(id: string, parentId: string | null): SessionEntry {
  return { type: "message", id, parentId } as unknown as SessionEntry;
}

/** Minimal fake ExtensionContext: getEntries/getBranch/getSessionId read the SAME mutable array. */
function makeCtx(entries: SessionEntry[]): ExtensionContext {
  const sessionManager = {
    getSessionId: () => "s-e21",
    getEntries: () => entries,
    getBranch: () => entries,
  };
  return { sessionManager } as unknown as ExtensionContext;
}

/** Minimal fake ExtensionAPI capturing appendEntry (stale-retirement path — not expected to fire here). */
function makePi(): { appendCalls: { customType: string; data: unknown }[]; pi: ExtensionAPI } {
  const appendCalls: { customType: string; data: unknown }[] = [];
  const pi = { on() {}, appendEntry(customType: string, data: unknown) { appendCalls.push({ customType, data }); } };
  return { appendCalls, pi: pi as unknown as ExtensionAPI };
}

/** The context event messages (compaction-free branch view). */
const MESSAGES = [
  { role: "user", content: "read the file" },
  { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "read", arguments: {} }] },
  { role: "toolResult", toolCallId: "c1", content: [{ type: "text", text: "BIG READ CONTENT" }] },
  { role: "assistant", content: [{ type: "text", text: "done" }] },
];

/** The branch: the 4 message entries, then the pinned shrink marker entry, then (added later) the cancel. */
const BASE_BRANCH: SessionEntry[] = [
  msgEntry("e_u", null),
  msgEntry("e_c1a", "e_u"),
  msgEntry("e_c1r", "e_c1a"), // ← the shrunk toolResult's entry (pinnedEntryId target)
  msgEntry("e_d", "e_c1r"),
  customEntry("e_mk", "mulligan:shrink", {
    schema: "pi-mulligan", v: 1, kind: "shrink", id: "sh-1",
    target: { by_tool_call_id: "c1" }, replacement: "[shrunk summary]",
    pinnedEntryId: "e_c1r", seq: 1, ts: 1,
  }),
];

function fire(entries: SessionEntry[]) {
  const { pi } = makePi();
  const res = contextHandler(pi, { type: "context", messages: structuredClone(MESSAGES) } as ContextEvent, makeCtx(entries));
  return (res as { messages: typeof MESSAGES }).messages;
}

function textOfToolResult(msgs: typeof MESSAGES, toolCallId: string): string {
  const m = msgs.find((x) => (x as { toolCallId?: string }).toolCallId === toolCallId);
  const c = m?.content as unknown;
  if (Array.isArray(c) && c.length > 0) return ((c[0] as { text?: string }).text) ?? "";
  return "";
}

beforeEach(() => setConfig({ enabled: true }));
afterEach(() => clearAll());

// ── E21(b) composition: shrink marker + its cancel → content reappears ───────────────────────

describe("E21(b) composition — cancel a shrink marker: the replaced content REAPPEARS (spec/08:108)", () => {
  it("BEFORE the cancel: the pinned shrink substitutes the toolResult (the marker is live)", () => {
    const out = fire(BASE_BRANCH);
    expect(textOfToolResult(out, "c1")).toContain("[shrunk summary]");
    expect(textOfToolResult(out, "c1")).not.toContain("BIG READ");
  });

  it("AFTER appending a mulligan:cancel targeting the shrink's uuid: readMarkers drops it → the ORIGINAL content is back", () => {
    const withCancel = [
      ...BASE_BRANCH,
      customEntry("e_cx", "mulligan:cancel", {
        schema: "pi-mulligan", v: 1, kind: "cancel", targetId: "sh-1", seq: 2, ts: 2,
      }),
    ];
    const out = fire(withCancel);
    expect(textOfToolResult(out, "c1")).toBe("BIG READ CONTENT"); // REAPPEARED — the transform no longer applies
  });

  it("A cancel targeting a DIFFERENT uuid does NOT retire the shrink (id-exact retirement)", () => {
    const strayCancel = [
      ...BASE_BRANCH,
      customEntry("e_cx", "mulligan:cancel", {
        schema: "pi-mulligan", v: 1, kind: "cancel", targetId: "sh-other", seq: 2, ts: 2,
      }),
    ];
    const out = fire(strayCancel);
    expect(textOfToolResult(out, "c1")).toContain("[shrunk summary]"); // still applied
    expect(textOfToolResult(out, "c1")).not.toContain("BIG READ");
  });

  it("Order-independence: a cancel entry BEFORE the shrink entry on the branch still retires it", () => {
    const cancelFirst = [
      customEntry("e_cx", "mulligan:cancel", {
        schema: "pi-mulligan", v: 1, kind: "cancel", targetId: "sh-1", seq: 0, ts: 0,
      }),
      ...BASE_BRANCH,
    ];
    const out = fire(cancelFirst);
    expect(textOfToolResult(out, "c1")).toBe("BIG READ CONTENT");
  });
});

// ── Same composition for a PINNED REWIND marker (E21 applies to both marker kinds) ───────────

describe("E21(b) composition — cancel a pinned rewind marker: the hidden messages REAPPEAR", () => {
  const BRANCH_RW: SessionEntry[] = [
    msgEntry("e_u", null),
    msgEntry("e_c1a", "e_u"),
    msgEntry("e_c1r", "e_c1a"),
    customEntry("e_mk", "mulligan:rewind", {
      schema: "pi-mulligan", v: 1, kind: "rewind", id: "rw-1",
      granularity: "last_tool_call_group", options: {}, hideEntryIds: ["e_c1a", "e_c1r"],
      seq: 1, ts: 1, note: { problem: "p", hypothesis: "h", nextStep: "n", evidence: "e" }, ledger: {},
    }),
  ];

  it("BEFORE the cancel: the pinned rewind hides the tool interaction", () => {
    const out = fire(BRANCH_RW);
    expect(out.some((m) => (m as { toolCallId?: string }).toolCallId === "c1")).toBe(false);
    expect(out.length).toBe(2); // user + final assistant text
  });

  it("AFTER the cancel: the hidden tool call + result REAPPEAR", () => {
    const withCancel = [
      ...BRANCH_RW,
      customEntry("e_cx", "mulligan:cancel", {
        schema: "pi-mulligan", v: 1, kind: "cancel", targetId: "rw-1", seq: 2, ts: 2,
      }),
    ];
    const out = fire(withCancel);
    expect(out.some((m) => (m as { toolCallId?: string }).toolCallId === "c1")).toBe(true);
    expect(out.length).toBe(4); // full view restored
  });
});