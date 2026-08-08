# Research notes — P1.M3.T2.S1: `resolveLastToolCallGroup`

## What this task is
APPEND `resolveLastToolCallGroup` to `src/transforms.ts` (which P1.M3.T1.S1 CREATES in
parallel) + APPEND its tests to `test/transforms.test.ts` (also created by T1.S1). Reuse the
`Unit` / `MessageLike` interfaces and the module-private `isRecord` / `readOwn` that T1.S1
defines. **No new imports** — the file stays foundation-tier pure (import count permanently 0).

## The exact algorithm (spec/06-context-filter.md §3)
```
resolveLastToolCallGroup(units, messages, excludeToolCallId?): number[] | null
  1. Iterate units from the END backward.
  2. Skip plain units.
  3. For each toolGroup: if its assistant message contains a toolCall whose id === excludeToolCallId → SKIP.
  4. First non-skipped toolGroup from the end → return its indices.
  5. None → return null.
```

## The exact tests (spec/10-testing.md §1.2)
- `[u, a(call A), r(A), a(call B), r(B)]`, exclude undefined → returns the a(B)+r(B) unit
  indices = `[3,4]`.
- exclude = "B" → returns the a(A)+r(A) unit indices = `[1,2]`.
- No toolGroup at all → `null`.

## Authoritative return type = `number[] | null`
- spec/06 §3 signature + the work-item contract both say `: number[] | null`.
- spec/06 §12 pseudocode (`const u = resolveLastToolCallGroup(...); remove = u ? u.indices : [];`)
  treats the return as a `Unit` — this is **reference-only pseudocode** and is INCONSISTENT with
  the authoritative signature. The later `filterPipeline` (T5.S1) must adapt:
  `remove = resolveLastToolCallGroup(units, m, rw.excludeToolCallId) ?? [];`
  → recorded as D1 / a cross-task coherence note in the PRP.

## excludeToolCallId source (spec/05 §1 + api_verification.md execute signature)
- `mulligan_rewind`'s `execute(toolCallId, params, …)` — first arg IS the toolCall id.
- Marker persists `excludeToolCallId: toolCallId` (api_verification.md "NOTE on execute signature").
- My function just receives it as a param; it does NOT interact with Pi.

## Why-exclude + edge cases (spec/06 §3 / §9; spec/08 E2, E6, E8)
- **E2 (rewinding the executing turn):** the rewind's OWN toolGroup (assistant carrying
  mulligan_rewind + its result) must be skipped — otherwise "last tool-call group" = the rewind
  itself. The exclude rule handles it; no special case.
- **E6 / §9 (parallel tool mode):** one assistant message carrying mulligan_rewind + sibling calls.
  The simple rule "skip the toolGroup whose assistant issued excludeToolCallId" handles it
  conservatively: that whole shared toolGroup is skipped → the PREVIOUS toolGroup becomes the target.
  No surgical splitting in this pure helper (correct + pairing-safe).
- **E8 (marker targets nothing / already removed):** resolver returns null → applyRewind no-ops.
- **E13 (never throws):** it sits on the context-handler hot path (via filterPipeline). All field
  reads go through isRecord/readOwn (Proxy-trap-safe). Non-array units → null.

## Defensive read pattern (reused verbatim from T1.S1's transforms.ts)
- `isRecord(value)` — true for plain records; false for null/primitives/arrays.
- `readOwn(obj, key)` — read an own property; try/catch swallows a throwing-Proxy get-trap → undefined.
- Only non-empty-string ids are compared (an undefined/empty/non-string excludeToolCallId → never skip;
  the strict `===` already guarantees this, but an explicit guard documents intent).

## Finding the assistant in a toolGroup
- partitionIntoUnits guarantees each toolGroup has exactly ONE assistant, at `indices[0]`.
- Defensive: scan the unit's indices for the member with `role === "assistant"` and array content;
  check ALL its toolCall blocks (so parallel-tool assistant messages are handled). If no assistant
  is found (malformed), there can be no excludeToolCallId match → the unit is NOT skipped (returned).

## Test fixtures available to reuse (defined by T1.S1 in test/transforms.test.ts)
- `asst(...callIds)`, `asstText(text)`, `result(toolCallId)`, `user(text)`, `custom(customType)`,
  `summary(units)`, `expectPairingInvariant(messages, units)`.
- I must MODIFY the existing import line to add `resolveLastToolCallGroup` (one precise edit).

## Verified baseline (state when this task runs)
- `src/transforms.ts` + `test/transforms.test.ts` will exist (T1.S1 lands first per parallel context).
- Baseline expected: 7 test files / 216+N tests green, `tsc --noEmit` exit 0.
- No eslint/prettier/biome — gate is `tsc --noEmit` (TS strict) + `npx vitest run`.

## On-disk verification (this session)
- `src/transforms.ts` currently ABSENT (T1.S1 not yet committed) — confirms APPEND-not-CREATE.
- spec/06 §3, spec/10 §1.2, spec/05 §1, spec/08 E2/E6/E8, api_verification §6.4 + execute note read.