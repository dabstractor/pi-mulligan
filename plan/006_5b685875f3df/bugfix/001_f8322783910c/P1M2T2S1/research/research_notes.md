# Research Notes — P1.M2.T2.S1: Make `countRetriesAtLatestPrompt` cancel-aware (BUG-005)

## Scope
A focused CODE change to ONE function (`countRetriesAtLatestPrompt` in `src/tools/rewind.ts`) + its JSDoc
(Mode A inline docs) + ONE regression test (`test/tools/rewind.test.ts`). The per-prompt retry budget must
exclude rewinds that were subsequently retired by a `mulligan:cancel`.

## The bug (BUG-005 — PRD §2.3 Issue 2)
`countRetriesAtLatestPrompt` (src/tools/rewind.ts:247-281) counts EVERY `mulligan:rewind` custom entry after
the latest user prompt, with no exclusion for rewinds later retired by a `mulligan:cancel`. A cancelled rewind
never took effect (readMarkers drops it before the filter sees it → it did not re-land at the prompt), yet it
still consumes budget. Cancel/rewind cycles can hit `maxRetriesPerPrompt` (default 5) prematurely and refuse a
legitimate rewind. PRD §2.5 recommends: "have countRetriesAtLatestPrompt subtract rewinds whose data.id is
targeted by a later mulligan:cancel on the branch."

## The target function (verbatim current — src/tools/rewind.ts:247-281)
```ts
function countRetriesAtLatestPrompt(ctx: ExtensionContext): number {
  let entries: unknown;
  try {
    entries = ctx.sessionManager.getEntries();
  } catch {
    return 0; // never let the retry-budget guard throw (E13)
  }
  if (!Array.isArray(entries)) return 0;

  // Find the INDEX of the LAST user-prompt entry (type:"message" with message.role:"user").
  let latestPromptIndex = -1;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
    try {
      const ee = e as { type?: unknown; message?: { role?: unknown } };
      if (ee.type === "message" && ee.message?.role === "user") latestPromptIndex = i;
    } catch {
      // a throwing-Proxy entry → skip (never throw on the tool hot path)
    }
  }
  if (latestPromptIndex === -1) return 0; // no user prompt → no budget consumption

  // Count mulligan:rewind markers appended AFTER the latest user prompt.
  let count = 0;
  for (let i = latestPromptIndex + 1; i < entries.length; i++) {
    const e = entries[i];
    if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
    try {
      const ee = e as { type?: unknown; customType?: unknown };
      if (ee.type === "custom" && ee.customType === "mulligan:rewind") count++;
    } catch {
      // a throwing-Proxy entry → skip (never throw on the tool hot path)
    }
  }
  return count;
}
```

### Defensive style to mirror
Per-entry `try/catch` with a direct `e as { type?: unknown; ... }` cast (NOT `readOwn`/`isRecord` — those live
in filter.ts). The contract says: "Read data.id and data.targetId defensively (try/catch per entry, mirroring
the existing Proxy-safe pattern)." → use the SAME try/catch + cast style already in this function.

## The existing cancel-aware pattern (readMarkers — src/filter.ts:120-204)
- `cancelledIds = new Set<string>()`.
- For each `customType === "mulligan:cancel" && kind === "cancel"` entry: `const targetId = readOwn(data, "targetId"); if (typeof targetId === "string" && targetId.length > 0) cancelledIds.add(targetId);`
- Then drop markers whose `data.id ∈ cancelledIds`.
- **Defensive polarity**: a marker whose `id` is unreadable is **KEPT** (never drop on bad data).

countRetriesAtLatestPrompt must use the SAME uuid-by-targetId mechanism. (It cannot import readMarkers — that
does a full marker bucketing and returns a MarkersBundle; the retry counter needs only the count. So replicate
the minimal cancel-id collection inline, in the function's own defensive style.)

## Entry shapes (for reading data.id / data.targetId)
- `mulligan:rewind` entry: `{ type: "custom", customType: "mulligan:rewind", data: { schema, v, kind:"rewind", id, granularity, options, excludeToolCallId, seq, note, ledger, ts } }` → **`entry.data.id`** is the rewind uuid.
- `mulligan:cancel` entry: `{ type: "custom", customType: "mulligan:cancel", data: { schema, v, kind:"cancel", targetId, ... } }` → **`entry.data.targetId`** is the cancelled marker's id (=== the rewind's data.id).
- Cross-check: src/markers.ts stamps `{schema,v,kind,id/seq,ts}` into entry.data via appendEntry; cancel stamps `targetId` (src/filter.ts cancelledIds collection confirms the field name).

## Implementation approach (from contract — two passes over the same post-prompt slice)
1. **Build the cancel-id Set**: scan entries after `latestPromptIndex` for `mulligan:cancel`; for each, read
   `data.targetId` defensively; if a non-empty string, add to `cancelledRewindIds`.
2. **Cancel-aware count**: scan entries after `latestPromptIndex` for `mulligan:rewind`; for each, read
   `data.id` defensively; if `typeof id === "string" && cancelledRewindIds.has(id)` → SKIP (cancelled); else
   `count++`.
- Order-independent (full cancel scan first, then count) — correct because a cancel can appear after the
  rewind it retires.
- **Backward-compatible**: a rewind with an UNREADABLE `data.id` (e.g. the test helper `rewindEntry(seq)` which
  yields `data: { seq }` — no id) is COUNTED (defensive: don't exclude unless we positively know it's
  cancelled). So existing retry-budget tests (which use id-less rewinds) still see count = 3 → still refuse 3/3.

## Call site (src/tools/rewind.ts:508-509) — UNCHANGED
```ts
//     all three apply; first refusal wins. countRetriesAtLatestPrompt is defensive (never throws — E13).
const retries = countRetriesAtLatestPrompt(ctx);
```
No signature change (still `(ctx): number`). The call site is untouched.

## JSDoc update (Mode A — lines 232-246)
The function JSDoc has an "OVER-APPROXIMATION (v1 entry-position)" note. Update it to:
- State rewinds retired by a `mulligan:cancel` are now EXCLUDED (the BUG-005 fix).
- Document the defensive polarity (unreadable data.id → counted).
- Cross-reference readMarkers' `cancelledIds` (src/filter.ts) — the same uuid-by-targetId mechanism.

## Test harness (test/tools/rewind.test.ts) — for the regression test
- `makeCtx({ entries: [...] })` builds a fake ctx with a STATIC entries array (pre-seeded; no loop simulation).
- `makePi()` → `{ appended, pi }` (appended tracks appendEntry).
- `run(pi, ctx, { note, granularity })` calls the rewind tool.
- `msgEntry(user("..."))` → a user-message entry.
- `rewindEntry(seq)` (line 207) → `{ type:"custom", customType:"mulligan:rewind", data:{ seq } }` — **NO id**.
- `firstText(res)` extracts the result text; tests assert `toContain("per-prompt retry budget")` / `toContain("N/N")`.
- Existing retry-budget block: `describe("mulligan_rewind — retry budget: per-prompt cap (...)", ...)` lines 1030+.

### The BUG-005 regression test (canonical PRD repro)
Scenario: `user(msg), rewind(id=rw1), cancel(targetId=rw1), rewind(id=rw2)`.
- WITHOUT fix: count = 2 (both rw1+rw2) → with maxRetriesPerPrompt:2 → 2>=2 → REFUSE.
- WITH fix: count = 1 (rw1 cancelled; rw2 active) → 1<2 → SUCCEED (appended>0).
- Assert: `appended.length > 0` AND `firstText(res)` does NOT contain "per-prompt retry budget".
- Needs a rewind-with-id helper and a cancel-entry helper (the existing `rewindEntry(seq)` has no id).

## Defensive polarity — keep-on-bad-id (CRITICAL for backward compat)
Both readMarkers and the new countRetries logic use: **exclude only if we POSITIVELY know it's cancelled**
(data.id is a string AND in the cancel set). An unreadable/non-string data.id → keep/count. This guarantees:
1. Existing retry-budget tests (id-less rewinds) still count → still refuse at budget. ✅ no regressions.
2. A malformed cancel (non-string/empty targetId) is skipped → never falsely excludes a rewind. ✅ fail-open.

## Validation commands (package.json)
- `npm run typecheck` → `tsc --noEmit`.
- `npx vitest run test/tools/rewind.test.ts` (or full `npm test` = `vitest run`).

## Parallel-sibling coordination (no file conflict)
- **P1.M2.T1.S1** (parallel, implementing): edits `src/nudges.ts` (turnEndMetricHandler block reorder) +
  `test/turn_metric.test.ts` ONLY. Does NOT touch `src/tools/rewind.ts` or `test/tools/rewind.test.ts`.
- This PRP (P1.M2.T2.S1) edits `src/tools/rewind.ts` (countRetriesAtLatestPrompt + JSDoc) +
  `test/tools/rewind.test.ts` (regression test). No overlap.

## Out of scope (do NOT touch)
- `src/filter.ts` (readMarkers — the referenced cancel-aware pattern; NOT a file to edit here).
- `src/markers.ts` (marker stamping — entry shape source; not edited).
- `src/nudges.ts` + `test/turn_metric.test.ts` (owned by P1.M2.T1.S1).
- `src/tools/cancel.ts`, `src/tools/checkpoint.ts`, etc. (other BUG-006/007 siblings).
- The call site at rewind.ts:508-509 (no signature change).
- Any OTHER function in rewind.ts (only countRetriesAtLatestPrompt + its JSDoc).
- spec/* (READ-ONLY reference: spec/08 E22 defines the retry semantics; spec/10 §1.10 the test tier).