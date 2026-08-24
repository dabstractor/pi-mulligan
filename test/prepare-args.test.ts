/**
 * prepare-args.test.ts — regression tests for the `prepareArguments` compatibility shims
 * (src/prepare-args.ts) on the three object-param tools: mulligan_shrink (`target`), mulligan_cancel
 * (`target`), mulligan_rewind (`note`).
 *
 * THE BUG: some models send OBJECT-typed tool parameters as a JSON-ENCODED STRING (observed live:
 * `mulligan_shrink` called with `target: "{\"by_tool_call_id\": \"call_bash_pclntab\"}"`). The Pi host
 * validates args BEFORE execute() runs (pi-agent-core agent-loop → pi-ai validateToolArguments):
 * `Value.Convert` + compiled `Check`. Value.Convert coerces primitives only — it NEVER turns a JSON
 * string into an object (verified empirically against typebox 1.3.7 host-side and 1.3.11 repo-side) — so
 * every `anyOf` arm fails ("must be object" ×2) and the tool call is dead on arrival; the tool body never
 * runs and cannot catch this. The host's OWN edit tool hits the identical failure class ("Some models
 * (Opus 4.6, GLM-5.1) send edits as a JSON string instead of an array") and fixes it via the sanctioned
 * `ToolDefinition.prepareArguments` hook — "Optional compatibility shim to prepare raw tool call arguments
 * BEFORE schema validation". These tests lock that fix.
 *
 * PIPELINE UNDER TEST — mirrors pi-ai validateToolArguments EXACTLY:
 *   1. prepared = tool.prepareArguments(args)      (agent-loop prepareToolCallArguments)
 *   2. Value.Convert(params, prepared)             (validateToolArguments step 1)
 *   3. Compile(params).Check(prepared) === true    (validateToolArguments step 2)
 *
 * House idiom: vitest, NO vi.fn(), `.js` import paths, clearAll() runtime reset.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Value } from "typebox/value";
import { Compile } from "typebox/compile";
import { prepareObjectArgs } from "../src/prepare-args.js";
import { makeShrinkTool, ShrinkParams, type ShrinkArgs } from "../src/tools/shrink.js";
import { makeCancelTool, CancelParams, type CancelArgs } from "../src/tools/cancel.js";
import { makeRewindTool, RewindParams, type RewindArgs } from "../src/tools/rewind.js";
import { clearAll } from "../src/runtime.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

beforeEach(() => clearAll());
afterEach(() => clearAll());

/** A minimal fake ExtensionAPI (tools are only CONSTRUCTED here — execute is never called). */
const fakePi = {} as unknown as ExtensionAPI;

/**
 * The exact host validation pipeline (pi-ai validateToolArguments): structuredClone →
 * prepareArguments (when present) → Value.Convert → compiled Check. Returns Check's boolean.
 */
function hostPipelinePasses(
  params: Parameters<typeof Value.Convert>[0],
  args: unknown,
  prepareArguments?: ((raw: unknown) => unknown) | undefined,
): boolean {
  let prepared = structuredClone(args) as Record<string, unknown>;
  if (typeof prepareArguments === "function") {
    prepared = prepareArguments(prepared) as Record<string, unknown>;
  }
  Value.Convert(params as never, prepared as never);
  return Compile(params as never).Check(prepared as never);
}

// ════════════════════════════════════════════════════════════════════════════
// prepareObjectArgs — the shared helper (unit tests)
// ════════════════════════════════════════════════════════════════════════════

describe("prepareObjectArgs — the shared string→object coercion helper", () => {
  const prep = prepareObjectArgs<{ target?: unknown; note?: unknown }>(["target", "note"]);

  it("parses a JSON-string-encoded object property into a real object", () => {
    const out = prep({ target: '{"by_tool_call_id": "call_x"}', replacement: "r" });
    expect(out.target).toEqual({ by_tool_call_id: "call_x" });
  });

  it("leaves an already-object property untouched (idempotent)", () => {
    const target = { by_tool_call_id: "call_x" };
    const out = prep({ target });
    expect(out.target).toBe(target); // identity — not cloned, not rebuilt
  });

  it("leaves MALFORMED JSON untouched (schema validation rejects it later with a clear error)", () => {
    const out = prep({ target: "{oops not json" });
    expect(out.target).toBe("{oops not json");
  });

  it("leaves JSON that parses to a NON-object untouched (array / scalar — not coercible to the union)", () => {
    expect(prep({ target: "[1,2]" }).target).toBe("[1,2]");
    expect(prep({ target: "42" }).target).toBe("42"); // parses to number 42 → left as the original string
    expect(prep({ target: "null" }).target).toBe("null");
  });

  it("coerces MULTIPLE listed keys in one call", () => {
    const out = prep({ target: '{"by_tool_call_id": "a"}', note: '{"next": "x"}' });
    expect(out.target).toEqual({ by_tool_call_id: "a" });
    expect(out.note).toEqual({ next: "x" });
  });

  it("is a pure pass-through for non-record args (undefined / string / array / null — never throws)", () => {
    expect(prep(undefined)).toBeUndefined();
    expect(prep("garbage")).toBe("garbage");
    expect(prep([1, 2])).toEqual([1, 2]);
    expect(prep(null)).toBeNull();
  });

  it("returns the SAME reference for record args (agent-loop's `preparedArguments === toolCall.arguments` short-circuit)", () => {
    // The host agent-loop returns the original toolCall when the shim returns identity; mutating in place +
    // returning the same ref is the edit.js precedent this shim follows. Lock the contract.
    const coerced = { target: '{"by_tool_call_id": "a"}' };
    expect(prep(coerced)).toBe(coerced);
    const untouched = { target: { by_tool_call_id: "a" } };
    expect(prep(untouched)).toBe(untouched);
  });

  it("never throws even when JSON.parse does (reviver-free parse of edge strings)", () => {
    // a string whose parse throws is already covered by malformed JSON; belt: property getters must not throw
    expect(() => prep({ target: '{"__proto__": {"polluted": true}}' })).not.toThrow();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// mulligan_shrink — the OBSERVED bug (string-encoded `target`)
// ════════════════════════════════════════════════════════════════════════════

describe("mulligan_shrink — prepareArguments (string-encoded target regression)", () => {
  // The EXACT args from the field report.
  const bugReportArgs = {
    target: '{"by_tool_call_id": "call_bash_pclntab"}',
    replacement: "pclntab hand-parse FAILED (garbage). Use rabin2 -s instead.",
  };

  it("exposes a prepareArguments shim (the ToolDefinition compatibility hook)", () => {
    const tool = makeShrinkTool(fakePi);
    expect(typeof tool.prepareArguments).toBe("function");
  });

  it("WITHOUT the shim the host pipeline rejects the bug-report args (documents the root cause)", () => {
    expect(hostPipelinePasses(ShrinkParams, bugReportArgs, undefined)).toBe(false); // ← the observed failure
  });

  it("WITH the shim the host pipeline accepts the bug-report args (the fix)", () => {
    const tool = makeShrinkTool(fakePi);
    expect(hostPipelinePasses(ShrinkParams, bugReportArgs, tool.prepareArguments)).toBe(true);
  });

  it("the shim yields the SAME validated value as a proper object call (no behavioral fork)", () => {
    const tool = makeShrinkTool(fakePi);
    const prepared = tool.prepareArguments!(structuredClone(bugReportArgs));
    expect(prepared).toEqual({
      target: { by_tool_call_id: "call_bash_pclntab" },
      replacement: bugReportArgs.replacement,
    });
  });

  it.each([
    ['{"by_tool_call_id": "call_x"}', true],
    ['{"by_tool_name": "bash", "occurrence": "last"}', true],
  ])("prepareArguments + host schema: %s", (targetJson, shouldPass) => {
    const tool = makeShrinkTool(fakePi);
    expect(hostPipelinePasses(ShrinkParams, { target: targetJson, replacement: "r" }, tool.prepareArguments)).toBe(shouldPass);
  });

  it("proper-object args still pass through the pipeline unchanged (no regression on the happy path)", () => {
    const tool = makeShrinkTool(fakePi);
    const args: ShrinkArgs = { target: { by_tool_call_id: "call-A" }, replacement: "r" };
    expect(hostPipelinePasses(ShrinkParams, args, tool.prepareArguments)).toBe(true);
  });

  it("a target that is NEITHER object NOR valid JSON string still fails the pipeline (honest refusal preserved)", () => {
    const tool = makeShrinkTool(fakePi);
    expect(hostPipelinePasses(ShrinkParams, { target: "call_bash_pclntab", replacement: "r" }, tool.prepareArguments)).toBe(false);
    expect(hostPipelinePasses(ShrinkParams, { target: "{oops", replacement: "r" }, tool.prepareArguments)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// mulligan_cancel — identical union shape (same failure class)
// ════════════════════════════════════════════════════════════════════════════

describe("mulligan_cancel — prepareArguments (string-encoded target regression)", () => {
  it("WITH the shim the host pipeline accepts a string-encoded target", () => {
    const tool = makeCancelTool(fakePi);
    expect(typeof tool.prepareArguments).toBe("function");
    const args = { target: '{"by_tool_call_id": "call-A"}' };
    expect(hostPipelinePasses(CancelParams, args, tool.prepareArguments)).toBe(true);
  });

  it("markerId-ONLY args (the documented fallback) pass through untouched", () => {
    const tool = makeCancelTool(fakePi);
    const args: CancelArgs = { markerId: "leaf-9" };
    const prepared = tool.prepareArguments!(structuredClone(args));
    expect(prepared).toEqual({ markerId: "leaf-9" });
    expect(hostPipelinePasses(CancelParams, args, tool.prepareArguments)).toBe(true);
  });

  it("WITHOUT the shim a string-encoded target fails (documents the shared root cause)", () => {
    expect(hostPipelinePasses(CancelParams, { target: '{"by_tool_call_id": "call-A"}' }, undefined)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// mulligan_rewind — the `note` object param (same failure class)
// ════════════════════════════════════════════════════════════════════════════

describe("mulligan_rewind — prepareArguments (string-encoded note regression)", () => {
  const NOTE = {
    what_happened: "Grep dumped 38k tokens.",
    true_current_state: "Nothing changed.",
    next: "Re-run with grep -l.",
  };

  it("WITH the shim the host pipeline accepts a string-encoded note", () => {
    const tool = makeRewindTool(fakePi);
    expect(typeof tool.prepareArguments).toBe("function");
    const args = { note: JSON.stringify(NOTE), granularity: "last_turn" };
    expect(hostPipelinePasses(RewindParams, args, tool.prepareArguments)).toBe(true);
  });

  it("a proper object note still passes (no regression on the happy path)", () => {
    const tool = makeRewindTool(fakePi);
    const args: RewindArgs = { note: NOTE, granularity: "last_turn" };
    expect(hostPipelinePasses(RewindParams, args, tool.prepareArguments)).toBe(true);
  });

  it("WITHOUT the shim a string-encoded note fails (documents the shared root cause)", () => {
    expect(hostPipelinePasses(RewindParams, { note: JSON.stringify(NOTE), granularity: "last_turn" }, undefined)).toBe(false);
  });
});
