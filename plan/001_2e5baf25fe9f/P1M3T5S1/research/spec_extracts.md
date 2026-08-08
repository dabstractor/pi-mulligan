# Spec extracts — P1.M3.T5.S1 (filterPipeline / stableSortBySeq / protectedOk)

Verbatim quotes that PIN the contract. Section numbers are stable across the merged spec.

---

## spec/06-context-filter.md §1 — the handler glue (the pipeline call site)

```ts
pi.on("context", async (event, ctx) => {
  ...
  const markers = readMarkers(ctx);   // { rewinds: RewindMarker[], shrinks: ShrinkMarker[], metric }
  let messages = event.messages as AgentMessage[];

  // 1) rewinds, oldest-first
  for (const m of stableSortBySeq(markers.rewinds)) {
    messages = applyRewindSafe(messages, m, config, ctx);
  }
  // 2) shrinks, oldest-first
  for (const m of stableSortBySeq(markers.shrinks)) {
    messages = applyShrinkSafe(messages, m);
  }
  // 3) nudge injection ...
  rt.lastFiltered = messages;
  return { messages };
});
```

> `stableSortBySeq` orders markers by their `seq` (monotonic per-session counter); ties impossible by
> construction. Ordering oldest-first means earlier decisions are applied first, so a later rewind resolves
> against an already-reduced list (correct composition).

NOTE: `applyRewindSafe`/`applyShrinkSafe` are filter.ts (P1.M4.T2) try/catch WRAPPERS. The PURE pipeline
this task ships is `filterPipeline`; it calls `applyRewind` / `applyShrink` directly (the pure fns).

## spec/06 §5 — applyShrink (the shrink half; sibling T4.S2, LANDED)

```ts
function applyShrink(messages, marker) {
  const i = resolveShrinkTarget(messages, marker.target);
  if (i === null) return messages;          // no match → no-op (SAME reference)
  ...
}
```

## spec/06 §8 — Protected messages (the protectedOk contract, VERBATIM)

> The filter and tools enforce `config.rewind.protectedRoles`. ... a rewind that would remove a message at or
> before the first user message ... is **refused** ... the filter double-checks and no-ops as defense-in-depth.
>
> Implementation: compute `iFirstUser` and `iLatestUser` in `messages`. A rewind's `remove` set MUST satisfy
> `min(remove) > iFirstUser`. For `last_turn` default, `iLatestUser` is kept by construction. For
> `to_previous_prompt`, refuse if `iLatestUser === iFirstUser`.

So **protectedOk = (min(remove) > iFirstUser)**. The latest:user boundary + the nuclear refusal are
construction-enforced in resolveLastTurn (already implemented + tested). protectedOk is the filter's
defense-in-depth DOUBLE-CHECK of the first:user boundary.

## spec/06 §11 — Composition & idempotency (ERRATUM — see verification.md §3)

```
messages: [u0, a1(grep call), r1(big), a2(read call), r2, a3(rewind#1 call), res3, note, a4(rewind#2 call), res4]
markers (seq order): rewind#1 (last_tool_call_group, exclude res3's call), rewind#2 (last_tool_call_group, exclude res4's call)

Filter pass:
  rewind#1: resolve last toolGroup excluding res3's call → the a2/r2 unit (the read). Remove → [u0,a1,r1,a3,res3,note,a4,res4]
  rewind#2: resolve last toolGroup excluding res4's call → the a1/r1 unit (the grep). Remove → [u0,a3,res3,note,a4,res4]
Result the model sees: [u0, a3(rewind#1)+res3, note, a4(rewind#2)+res4]
```

> Idempotency: re-firing the filter on the same session reproduces the same result ... No double-removal because
> removed messages are absent from subsequent passes within the same fire, and across fires the session is
> unchanged between user prompts.

## spec/06 §12 — Pseudocode: the full pipeline (REFERENCE — has TWO bugs, see verification.md §1+§3)

```ts
function filterPipeline(messages, markers, config, ctx) {
  let m = messages;
  const units = partitionIntoUnits(m);                       // BUG 1: partitioned ONCE (stale after rewind#1)
  for (const rw of stableSortBySeq(markers.rewinds)) {
    let remove;
    if (rw.granularity === "last_tool_call_group") {
      const u = resolveLastToolCallGroup(units, m, rw.excludeToolCallId);   // uses STALE units
      remove = u ? u.indices : [];
    } else if (rw.granularity === "last_turn") {
      remove = resolveLastTurn(m, rw.options, rw.excludeToolCallId).remove;
    } else { // checkpoint
      const res = resolveCheckpoint(m, ctx, rw.checkpoint);                 // BUG 2: takes ctx, not branchEntries
      remove = res ? res.remove : [];
    }
    if (!protectedOk(m, remove, config)) { log("warn","rewind.protected",...); continue; }
    m = removeIndices(m, remove);
  }
  for (const sh of stableSortBySeq(markers.shrinks)) {
    m = applyShrink(m, sh);
  }
  if (config.nudges.perTurnDrift && markers.metric && shouldNudge(markers.metric, config)) {
    m = injectNudge(m, markers.metric);                       // NOT this task — filter.ts's nudge concern
  }
  return m;
}
```

## spec/03 §5 — Ordering, composition, idempotency (the architecture rationale)

> The filter applies transforms in a **fixed order** ... :
> 1. **Resolve & apply rewinds** (oldest marker first). Each removal mutates the working array; later rewinds
>    resolve against the already-reduced array.
> 2. **Resolve & apply shrinks** (oldest first), on the post-rewind array.
> 3. **Inject nudge** ... only if the latest metric warrants.
> 4. Return the array.
>
> **Idempotency:** every operation is idempotent w.r.t. re-firing. A rewind marker whose target range has already
> been removed resolves to an empty range and is a no-op. A shrink whose target no longer matches is a no-op.
> ... Fail-open: every stage is wrapped in try/catch ...

## spec/10 §1.9 — Pipeline composition tier-1 tests (the test contract for THIS task)

> - Two rewinds compose to the example in `@06-context-filter.md` §11 (assert exact resulting index set).
> - Rewind-then-shrink-on-removed-target → shrink no-ops.
> - Protected message → rewind skipped + warn.

## spec/10 §3 — Property/invariant tests (optional, high-value) — the item REQUIRES these

> - **Pairing invariant (property):** for any random message list and any sequence of rewind/shrink markers, the
>   filtered output never contains an orphan `toolCall` or `toolResult`. Quickcheck-style.
> - **Idempotency (property):** `filterPipeline(filterPipeline(m)) === filterPipeline(m)` for stable inputs.
> - **Monotonic shrinkage:** applying a rewind never *increases* the message count.

## spec/04 §3 — RewindMarker shape (the fields filterPipeline reads)

granularity: `"last_tool_call_group" | "last_turn"` (+ `"checkpoint"` per spec/05 §1/§6 + config.ts Granularity).
options: `{ to_previous_prompt?: boolean }`. excludeToolCallId?: string. seq: number. (NO `checkpoint` field in
spec/04 §3 — but spec/06 §12 + spec/05 require it for checkpoint granularity; the checkpoint tool P1.M5.T1 will add
it. filterPipeline reads it defensively via readOwn.)

## config.ts — protectedRoles (the ProtectedConfig slice)

`MulliganConfig.rewind.protectedRoles: string[]`, DEFAULT `["first:user", "latest:user"]`. validateConfig keeps only
KNOWN selectors (`first:user`, `latest:user`). transforms.ts is Pi-FREE (0 imports) and must NOT import
MulliganConfig from config.ts — declare a LOCAL structural `ProtectedConfig = { rewind: { protectedRoles: string[] } }`
(a real MulliganConfig assigns in with no cast).