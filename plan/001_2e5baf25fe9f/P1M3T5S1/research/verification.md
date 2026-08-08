# Verification & analysis — P1.M3.T5.S1 (filterPipeline / stableSortBySeq / protectedOk)

Live-state proof + the load-bearing design decisions. Every claim below is verified against the LANDED
`src/transforms.ts` (764 lines, `grep -c '^import'` → 0) + the merged spec.

---

## 1. EXACT signatures of the LANDED sibling functions filterPipeline consumes

Verified by `grep -n '^export ' src/transforms.ts` (this session):

| Symbol | Signature (LANDED) | Notes |
|---|---|---|
| `partitionIntoUnits` | `(messages: MessageLike[] \| null \| undefined): Unit[]` | the pairing primitive |
| `resolveLastToolCallGroup` | `(units: Unit[], messages: MessageLike[], excludeToolCallId?: string): number[] \| null` | **takes UNITS first, then messages** — returns a unit's `.indices` |
| `resolveLastTurn` | `(messages, opts: { to_previous_prompt?: boolean } \| undefined, excludeToolCallId?: string): { remove: number[] }` | reads `to_previous_prompt` VERBATIM (snake_case) |
| `resolveCheckpoint` | `(messages, branchEntries: BranchEntry[], checkpointName: string, excludeToolCallId?: string): { remove: number[] } \| null` | takes `branchEntries` (NOT ctx) — purity |
| `applyRewind` | `(messages: MessageLike[], remove: number[]): MessageLike[]` | empty/no-op remove → SAME ref; non-array → [] |
| `applyShrink` | `(messages, marker: { target: ShrinkTarget; replacement: string }): MessageLike[]` | no-match/non-record → SAME ref; non-array → [] |
| `resolveShrinkTarget` | `(messages, target: ShrinkTarget): number \| null` | (used internally by applyShrink) |
| Types | `MessageLike`, `Unit`, `BranchEntry`, `ShrinkTarget` (all EXPORTED) | |
| Module-private | `isRecord`, `readOwn`, `assistantIssuedCall`, `isMulliganCustomMessage`, `entryMessageYield`, `isContextProducingType`, `stringifyContent` | all reusable in module scope |

`ContentBlock` is module-private (NOT exported). filterPipeline does NOT need it (it delegates to the siblings).

---

## 2. THE load-bearing gotcha: RE-PARTITION each rewind iteration

`resolveLastToolCallGroup(units, messages, excludeToolCallId)` returns `unit.indices` — indices that point into
the array that was partitioned to produce `units`. spec/06 §12's pseudocode partitions ONCE before the loop:

```ts
const units = partitionIntoUnits(m);          // partitioned on ORIGINAL m
for (const rw of rewinds) {
  ...
  remove = resolveLastToolCallGroup(units, m, ...);   // unit.indices index the ORIGINAL m
  m = removeIndices(m, remove);                       // but m is now REDUCED → indices STALE
}
```

After rewind#1 removes indices [3,4] from a 10-element array, rewind#2 resolves against the 8-element `m` but
`units` still carries ORIGINAL indices → `applyRewind(reducedM, staleIndices)` removes the WRONG messages.

**FIX (what filterPipeline implements):** partition FRESH inside the loop, only for `last_tool_call_group` rewinds:

```ts
if (granularity === "last_tool_call_group") {
  const units = partitionIntoUnits(m);   // FRESH — indices match the CURRENT m
  remove = resolveLastToolCallGroup(units, m, excludeId) ?? [];
}
```

`resolveLastTurn` and `resolveCheckpoint` take `messages` directly (not units) and compute `remove` against it →
inherently correct against current `m` (no partition needed for them).

---

## 3. spec/06 §11 ERRATUM — the two-rewind example is mechanically inconsistent

The §11 narrative claims:
```
rewind#1 (exclude res3's call) → remove a2/r2 (the read)
rewind#2 (exclude res4's call) → remove a1/r1 (the grep)
Result: [u0, a3+res3, note, a4+res4]
```

But applying spec/06 §3's exclude-own-call rule LIVE against the full 10-element array:

- Input: `[u0(0), a1(1), r1(2), a2(3), r2(4), a3(5), res3(6), note(7), a4(8), res4(9)]`
- toolGroups: `{a1,r1}[1,2]`, `{a2,r2}[3,4]`, `{a3,res3}[5,6]`, `{a4,res4}[8,9]`
- **rewind#1** (exclude a3's call): walk end→start → `{a4,res4}[8,9]` does NOT contain a3's call → NOT excluded →
  **returns [8,9]** (NOT a2/r2). remove [8,9] → `m' = [u0,a1,r1,a2,r2,a3,res3,note]`.
- **rewind#2** (exclude a4's call; a4 now gone): partition `m'` → `{a3,res3}[5,6]` does not contain a4's call →
  **returns [5,6]**. remove [5,6] → `m'' = [u0,a1,r1,a2,r2,note]`.
- **CORRECT live result: `[u0, a1, r1, a2, r2, note]`** — the OPPOSITE of the narrative (narrative keeps the
  rewinds + removes the mistakes; mechanics remove the rewinds + keep the mistakes).

Root cause: `resolveLastToolCallGroup` excludes ONLY the rewind's OWN group. The most-recent NON-own group is always
the newest other toolGroup. With two rewind calls in the array, the older rewind (applied first) resolves to the
newer rewind's group. The exclude-own-call mechanic is fundamentally **single-rewind**; multiple
`last_tool_call_group` rewinds interfere.

**Decision for the PRP:** do NOT reproduce the §11 narrative literally (it is impossible under §3's rule). The
§1.9 "two rewinds compose" test uses a CLEAN, mechanically-correct scenario (rewind#1 removes the mistake group;
rewind#2 re-resolves against the reduced array and no-ops because no further non-excluded group remains) and asserts
its exact, intent-consistent result. The §11 erratum is documented in the PRP gotchas so the implementer does not
chase the broken narrative.

---

## 4. Idempotency — what actually holds (spec/10 §3 is too strong as written)

- **Shrinks are STRICTLY idempotent** under `filterPipeline∘filterPipeline`: a `by_tool_call_id` shrink re-matches
  the same toolResult (the first shrink's spread PRESERVED `toolCallId`) and re-substitutes the SAME replacement →
  identical output. A `by_content_includes` shrink whose needle the first pass removed → second pass no-ops → still
  identical. ✓ Assert this.
- **Rewinds are idempotent in the spec's INTENDED sense** ("re-firing on the same session reproduces the same
  result" = DETERMINISM: same input → same output). This ALWAYS holds (filterPipeline is pure). ✓ Assert this.
- **`filterPipeline(filterPipeline(m)) === filterPipeline(m)` does NOT hold in general for `last_tool_call_group`
  rewinds**: after rewind#1 removes a group, re-running against the reduced array re-resolves to an EARLIER group
  and removes MORE. It DOES hold in the common single-mistake case (after removal, no further non-excluded group
  remains → second pass no-ops). The spec/10 §3 property is aspirational for rewinds; the PRP asserts the TRUE
  properties (shrink idempotency + determinism + the single-mistage-rewind idempotent case) and documents the
  limitation. This is honest and matches the implemented live-re-resolution design (spec/03 §3.1 D7).

---

## 5. protectedOk design — min(remove) > iFirstUser (spec/06 §8 verbatim)

- Empty/non-array `remove` → `true` (vacuous — nothing to remove).
- `iFirstUser` = index of FIRST `role==="user"` message; none → `true` (nothing protected by first:user).
- `min(remove) > iFirstUser` → `true`; else `false`. (Non-number/NaN entries ignored — never a valid index.)
- Config: honor `"first:user"` when present in `config.rewind.protectedRoles` (v1 default always includes it).
  Empty/absent/malformed `protectedRoles` → **FAIL SAFE: enforce first:user** (never silently remove the original
  task). A config that explicitly omits `"first:user"` → `true` (protection disabled, per config).
- NEVER throws (all reads via isRecord/readOwn). No `iLatestUser`/nuclear logic here — that is
  construction-enforced in `resolveLastTurn` (already implemented + tested). protectedOk is the filter's
  defense-in-depth DOUBLE-CHECK (spec/06 §8 "the filter double-checks and no-ops as defense-in-depth").
- **Cannot be triggered to BLOCK by real resolvers** (they are designed never to cross iFirstUser: resolveLastTurn
  anchors at iLastUser ≥ iFirstUser; resolveCheckpoint anchors at iTarget ≥ 0 with remove = >iTarget). Its block is
  purely defense-in-depth for a hypothetical buggy/adversarial resolver — tested via direct unit tests.

---

## 6. stableSortBySeq design

- Return a NEW array (shallow copy via `[...markers]`), sorted ASCENDING by `seq` (oldest-first), STABLE
  (Array.prototype.sort is stable per ES2019; Node has been stable since v10).
- `seq` read via `readOwn` (throwing-Proxy-safe); non-finite/non-number `seq` → treated as 0 (sorted first).
  Ties impossible by construction (runtime.ts nextSeq is a monotonic pre-increment), but stable regardless.
- Non-array input → `[]`. NEVER mutates the input array (marker OBJECTS shared by reference — filterPipeline does
  not mutate them).
- Generic `<T extends { seq?: unknown }>` so it types both `RewindMarkerLike[]` and `ShrinkMarkerLike[]`.

---

## 7. Local structural types (Pi-free invariant — 0 imports)

transforms.ts must stay Pi-FREE (`grep -c '^import'` → 0). So declare LOCALLY (structurally identical to markers.ts
/ config.ts exports; a real one assigns in with NO cast):

- `RewindMarkerLike` — { seq, granularity, options?, excludeToolCallId?, checkpoint? } (the slice filterPipeline reads).
- `ShrinkMarkerLike` — { seq, target: ShrinkTarget, replacement: string } (adds seq to applyShrink's {target, replacement}).
- `MarkerBundle` — { rewinds: RewindMarkerLike[]; shrinks: ShrinkMarkerLike[] }.
- `ProtectedConfig` — { rewind: { protectedRoles: string[] } }.

This mirrors the MessageLike / ShrinkTarget / BranchEntry convention (each pure module declares its own local
structural types, never importing the Pi-coupled originals).

---

## 8. filterPipeline algorithm (final)

```
filterPipeline(messages, markers?, config?, branchEntries?):
  if non-array messages → []
  rewinds = markers?.rewinds (array?) ?? []
  shrinks  = markers?.shrinks  (array?) ?? []
  m = messages
  for rw in stableSortBySeq(rewinds):           # oldest-first
    g = readOwn(rw,"granularity"); ex = readOwn(rw,"excludeToolCallId")
    if g == "last_tool_call_group": units = partitionIntoUnits(m); remove = resolveLastToolCallGroup(units,m,ex) ?? []
    elif g == "last_turn":          remove = resolveLastTurn(m, readOwn(rw,"options"), ex).remove
    elif g == "checkpoint":         remove = resolveCheckpoint(m, branchEntries??[], readOwn(rw,"checkpoint"), ex)?.remove ?? []
    else: remove = []
    if not protectedOk(m, remove, config): continue   # defense-in-depth skip (caller logs)
    m = applyRewind(m, remove)
  for sh in stableSortBySeq(shrinks):           # oldest-first, on post-rewind array
    m = applyShrink(m, sh)                       # ShrinkMarkerLike is structurally assignable to {target, replacement}
  return m
```

- No markers / all no-ops → returns `messages` SAME reference (applyRewind/applyShrink return same-ref on no-op;
  empty-marker loops never reassign `m`).
- NEVER throws (every read via isRecord/readOwn; applyRewind never reads message internals; applyShrink is
  already try/caught). Side-effect-free.

---

## 9. Property-test design (spec/10 §3, no external dep)

- Seeded `mulberry32` PRNG (deterministic, fixed seeds) — no fast-check dependency (not in package.json).
- `genMessages(rng)` builds WELL-FORMED lists: user / text-assistant / fully-paired assistant+results (each
  assistant IMMEDIATELY followed by its results → pairs are contiguous, never split across a turn boundary).
- **Pairing invariant:** 300 iters; random rewinds (last_tool_call_group / last_turn) + assert no orphan
  toolCall/toolResult in output. Holds because removals are whole-units (last_tool_call_group) or whole-suffix
  (last_turn/checkpoint) and pairs are contiguous in the generated input.
- **Monotonic shrinkage:** 300 iters; a random rewind → `out.length <= msgs.length` (applyRewind only removes).
- **Shrink idempotency:** 200 iters; random by_tool_call_id shrinks → `filterPipeline(filterPipeline(m))` deep-equals
  `filterPipeline(m)` (re-substitute same replacement).
- **Determinism:** 200 iters; same input twice → deep-equal (the spec/03 §5 "re-fire reproduces same result").

---

## 10. Validation gates (verified this session)

- `npx tsc --noEmit -p tsconfig.json` → exit 0 (baseline green).
- `npx vitest run test/transforms.test.ts` → **107 passed** (baseline; this task ADDS the new block).
- `grep -c '^import' src/transforms.ts` → **0** (must stay 0; declare types LOCALLY).
- No eslint/prettier/ruff configured (package.json has only tsc + vitest). Gates = tsc + vitest + the import-count invariant.