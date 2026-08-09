# P4.M1.T2.S1 — Per-prompt retry budget guard: research findings

Verified against the **current working tree** (P4.M1.T1.S1 already landed).

## 1. Config knobs already EXIST (P4.M1.T1.S1 done) — consume directly

`src/config.ts` (verified by grep):
- L45  `maxRetriesPerPrompt: number;`  (interface field, JSDoc cites @08 E22)
- L51  `abortContextFraction: number;`
- L131 `maxRetriesPerPrompt: 5,`        (DEFAULT_CONFIG)
- L132 `abortContextFraction: 0.9,`
- L239-243 validate maxRetriesPerPrompt (coerceNumber true + `Math.floor(n) >= 1` guard)
- L244-248 validate abortContextFraction (inline `v > 0 && v <= 1`)

→ This task only READS `config.rewind.maxRetriesPerPrompt` (already fetched once at execute step 1
  via `const config = getConfig();`). **No config change. No conflict with T1.S1.**

## 2. The exact sibling helper to mirror: `countRewindMarkers(ctx)` (src/tools/rewind.ts ~L212-235)

```ts
function countRewindMarkers(ctx: ExtensionContext): number {
  let count = 0;
  let entries: unknown;
  try { entries = ctx.sessionManager.getEntries(); } catch { return 0; }
  if (!Array.isArray(entries)) return 0;
  for (const e of entries) {
    if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
    try {
      if ((e as { type?: unknown }).type === "custom" && (e as { customType?: unknown }).customType === "mulligan:rewind") count++;
    } catch { /* throwing-Proxy entry → skip */ }
  }
  return count;
}
```
`countRetriesAtLatestPrompt` is the SAME defensive shape + an index walk to find the LAST user
message, then count only rewinds AFTER it. Per-entry try/catch retained (E13 hot-path).

## 3. The `refusal()` helper (~L190) — callers pass bare reason, it adds prefix + trailing period

```ts
function refusal(reason: string, granularity: Granularity): AgentToolResult<RewindDetails> {
  return { content: [{ type: "text", text: `Mulligan: refused — ${reason}.` }], details: { granularity } };
}
```
→ The refusal reason passed in MUST have NO trailing period (the helper appends `.`).

## 4. Insertion point in `rewindExecute` — AFTER maxDepth guard, BEFORE `(5) read-only ledger`

```ts
    // (4) depth guard ...
    const depth = countRewindMarkers(ctx);
    if (depth >= config.rewind.maxDepth) {
      return refusal(`max rewind depth (...) reached ...`, granularity);
    }
    /* <<< INSERT (4b) per-prompt retry budget guard HERE >>> */
    // (5) read-only ledger + K preview (step 5; best-effort — GOTCHA #6). ...
```
The whole execute body is ONE try/catch (E13). New helper MUST be defensive itself (the contract
says do NOT rely on the outer catch). config is already in scope (`config.rewind.maxRetriesPerPrompt`).

## 5. Entry shape (test fakes confirm)
- User prompt entry: `{ type: "message", id, message: { role: "user", content: ... } }`
  (test helper `msgEntry`/`userMessage`). role lives under `.message.role`, NOT on the entry top level.
- Rewind marker entry: `{ type: "custom", customType: "mulligan:rewind", data: { seq } }` (test helper
  `rewindEntry(seq)`).
→ countRetriesAtLatestPrompt must read `(e as any).message?.role === "user"` for the latest-prompt
  detection. A type:"message" entry with message.role !== "user" is NOT a prompt.

## 6. Existing tests do NOT break (verified)
Existing depth/success tests pass `entries` (→ getEntries) as either `[rewindEntry(n)...]` (no user
msg) or `[checkpointLabelEntry]` or `[]`. NONE place a user message in `getEntries()` entries with
rewind markers after it. So `countRetriesAtLatestPrompt` returns 0 for all existing tests → new guard
never fires on them → suite stays GREEN. (userMessage/msgEntry helpers feed `contextEntries` →
buildContextEntries, a different fake surface used only by the preview.)

## 7. ⚠ OFF-BY-ONE: contract code vs E22 acceptance (a) — FLAG FOR TEST TASK (P4.M1.T3.S1)

Contract (authoritative for THIS task) specifies EXACT code: `if (retries >= config.rewind.maxRetriesPerPrompt)`,
with refusal text `${retries}/${config.rewind.maxRetriesPerPrompt}`. With default budget 5:
- rewinds 1–5 succeed (prior-marker counts 0,1,2,3,4 — all < 5)
- the **6th** rewind sees retries=5 → `5 >= 5` → REFUSE, text reads **"(5/5 ...)"**

This is SELF-CONSISTENT within the contract (refusal shows 5/5 = budget fully consumed by 5 prior
rewinds). BUT E22 acceptance (a) literally says "first `maxRetriesPerPrompt−1` succeed; the Nth
(==budget) refuses" → 4 succeed / 5th refuses / text "(4/5)". These differ by one.

RESOLUTION (the PRP implements the CONTRACT verbatim): `>=` semantics → 5 succeed, 6th refuses,
"(5/5)" at refusal. The P4.M1.T3.S1 test MUST assert THIS boundary, not acceptance (a)'s literal
count. (The contract states its algorithm "passes §1.10 acceptance" → the test author reconciles to
the implemented `>=` boundary.)

## 8. Zero-hide rewind naturally counts (no special-case)
A K=0 rewind still persists a `mulligan:rewind` marker (execute step 7 runs regardless of K; K=0 is
just reported honestly). So countRetriesAtLatestPrompt counts it automatically. Contract instruction
"do NOT special-case it" is satisfied by counting ALL markers after the prompt. ✓

## 9. Scope boundary — NOT this task
- context-fraction stop (the "(4c)" guard) = P4.M1.T2.S2 (separate). Same insertion neighborhood but
  independent. This task leaves the (4c) spot free.
- suppress-drift-nudge-on-refused-turn = P4.M1.T2.S3 (separate).
- the detailed test matrix (drive a loop, assert the boundary) = P4.M1.T3.S1 (separate). This task
  writes the HELPER + the GUARD only.