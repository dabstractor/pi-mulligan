# Scope-Guard Design — v2.0 current-turn scoping (interpretation ruling + mechanics)

Grounding: PRD §2 (interpretation ruling), spec/06 §5 v2.0 block (verified verbatim by scout), spec/04 §4
("enforced at BOTH creation … and resolution"), spec/05 §2 step 3 (hard refusal text, verified verbatim).

## 1. The ruling (binding for all downstream tasks)

`@06` §5 says the filter enforces "the same bound" as the tool. **The bound is the marker's ISSUING turn,
not the fire-time current turn.** Binding consequences:

1. **Eligibility** (creation, `@05` §2 step 3): the target must match within the current turn's span —
   everything after the latest `user` message. Reuse the `iLastUser` scan from `resolveLastTurn`
   (`src/transforms.ts:331-337`): `span = [iLastUser + 1, messages.length)`.
2. **Persistence is RETAINED.** `@05` §5 / SPEC.md:165: the replacement "persists for as long as the marker
   exists (permanent soft substitution)". The cache rationale only works if it does: the substitution enters the
   message array once, tail-adjacent, and later turns cache THAT form. A fire-time-current-turn bound would expire
   markers at the next prompt, resurrect the shed bloat, and re-invalidate the cache — rejected.
3. **Filter guard = defense in depth, not expiry.** A shrink marker must never substitute a message from a turn
   EARLIER THAN THE MARKER'S OWN. It applies forever WITHIN its issuing turn's span (which stays stable: the span
   is derived from the marker's own stable branch position, not from the mutable "current turn").
4. **Live (unpinned) selectors** resolve only within the marker's turn span — never onto earlier OR later content
   (kills moving-target drift on the fallback path too).

Spec-text note (scout-verified): 06 §5's fire-time phrasing ("enforces the same bound at every fire") is satisfied
by the issuing-turn interpretation — the filter checks the bound at every fire; the BOUND ITSELF is the marker's
issuing turn. The PRD ruling is the tie-breaker; do not implement fire-time-current-turn expiry. Do NOT edit spec/.

## 2. Where the marker's turn span comes from (filter side)

The marker is an ENTRY on the branch (`mulligan:shrink` custom entry). `filterPipeline` already receives
`branchEntries` (4th param, `src/transforms.ts:1374`; threaded from filter.ts). Algorithm (pure, in transforms.ts):

1. **Marker position**: walk `branchEntries` root→leaf; find the FIRST entry whose `id === markerEntryId`.
   - Marker entry id availability: `readMarkers` (filter.ts:118–190) reads entries — **the marker's own ENTRY id is
     the entry's `id`** in that scan. Thread it through: widen `ShrinkMarkerLike` (~1126–1141) with `id?: string`
     (structural; the real `ShrinkMarker` has it — `id` is the marker uuid… CAREFUL: in markers.ts `ShrinkMarker.id`
     is the marker UUID stored in `data.id`, while the ENTRY id is `readOwn(entry, "id")` from the session entry).
     **Downstream must confirm which id `readMarkers` exposes and thread the ENTRY id (not just data.id) into
     `markers.shrinks`** — the read-side may need to carry `entryId` alongside (e.g. `ShrinkMarkerLike.id`:
     the filter reads both `e.id` (entry) and `e.data.id` (uuid) already; verify at implementation time.
2. **Marker's iLastUser**: scan `branchEntries[0..markerPos)` — count context-producing entries (`entryMessageYield > 0`:
   message/custom_message/branch_summary) that yield a `user` message… BUT branch entries don't expose role cheaply.
   **Simpler, verified-feasible alternative**: the marker's turn span = the message-index span derived from the
   ORIGINAL `messages` array (filterPipeline's 1st param) — compute `iLastUserBefore(markerPos)` by mapping
   branch-entry positions to message indices with the SAME `entryMessageYield` cursor walk used by
   `entryIdAtMessageIndex` (shrink.ts:228–243) and `resolvePinnedShrink`'s tail alignment:
   - cursor-walk entries → message index range per entry (exact by construction);
   - find the last `user`-role message index at-or-before the marker's message position;
   - marker span in message space = `[iLastUser + 1, messages.length)` **at fire time** — this is stable because
     entries BEFORE the marker never lose their relative order (append-only tree; C28 persistence), and the
     retained-tail walk (BUG-002) already tolerates compaction misalignment by no-oping.
   **Fail-safe rule (PRD R1.4): if the marker's span cannot be determined from `branchEntries` → no-op the marker**
   (E8-style silence; never throw — E13).
3. **Enforcement points** (both paths of the shrink pass, `src/transforms.ts:1522–1547`):
   - **Pinned path**: `resolvePinnedShrink(messages, branch, pinnedId)` → `origIdx`; ADD check
     `origIdx ∈ markerSpan` else `continue` (no-op). Identity resolution is inherently scope-safe for well-formed
     markers (the tool only pins in-span matches); the explicit check no-ops malformed/legacy markers — pure
     defense in depth.
   - **Live path**: `resolveShrinkTarget(m /*reduced*/, target, markerSpanInReducedSpace)` — span must be
     translated to reduced space after rewinds (use `reducedToOrig`; span bounds map via binary search; conservative:
     if the span's boundary entries were removed by a rewind, clamp/no-op — never widen).
   - PRAGMATIC OPTION (recommended): compute the marker span in ORIGINAL space; for the live path resolve against
     the ORIGINAL `messages` within the span FIRST, and only apply if that original index survives translation —
     this reuses the pinned path's translation machinery and avoids a second span-space mapping. Downstream
     implementer may choose either, provided BOTH invariants hold: (a) never substitute outside the marker's
     issuing-turn span; (b) in-span pinned shrinks keep applying across later turns (persistence).

## 3. The critical persistence regression (must-exist test)

A pinned in-turn shrink issued in turn N keeps applying after the user sends message N+1:
messages = `[user(u0), asst(c1), toolResult(c1, "read", BIG)]` (turn N: marker issued, pinnedEntryId = entry of c1's
result) → next fire with messages = `[user(u0), asst(c1), result(c1), user(u1), asst(c2), result(c2)]` →
the c1 result is STILL substituted; c2 untouched. Guards the §2 ruling against a fire-time-bound regression.
Also: an out-of-scope marker (span empty / target outside span) no-ops on every fire; a live selector never
re-targets beyond its marker's turn (add a later-turn `read` result — selector `by_tool_name:"read", occurrence:"last"`
must NOT drift onto it when the marker's turn has no… note: within-marker-turn "last" is correct; drift protection
= the span bound, asserted by placing a LATER-turn read after a new user message).

## 4. Auto-retirement interaction (no code change — document only)

filter.ts:380–410 retires pinned shrinks whose identity misses `staleAfterFires` times. Scope-guard no-ops resolve
`null` → count as misses → malformed/legacy out-of-scope markers auto-retire naturally. CORRECT disposition;
do not special-case.

## 5. Tool-side eligibility (creation bound)

`resolveTargetEntryId` (shrink.ts:258–275): build snapshot → `currentTurnSpan(messages)` (new helper; the same
`iLastUser` scan) → `resolveShrinkTarget(messages, target, span)`. Outcomes:
- Match in-span → proceed, pin `pinnedEntryId` (as today).
- No in-span match, or match only in earlier turns, or span empty (no user message → full-range fallback decision:
  **if no user message exists, span = [0, messages.length)** — session-start edge; match allowed) →
  **hard refusal** (exact text in R2) EXCEPT structurally-invalid keeps its own discriminator message.
- Advisory throw (`buildContextEntries` etc.): KEEP the E13 rule — persist with `matched:false`
  (the filter guard makes an unverifiable marker inherently safe — it can only ever apply within its own turn).
  The v1.2 orientation line `~0` path (05 §2 step 6; 10 §1.12) remains reachable exactly here.

## 6. Spec staleness registry (report to owner; do NOT copy into code, do NOT edit spec/)

1. 05 §6 SHRINK description string says "past tool result" (stale vs §2 v2.0) — PRD §4.1. Confirmed verbatim by scout.
2. 05 §6 CANCEL description string still lists `by_content_includes` (stale vs §5 two-arm schema) — PRD §4.2. Confirmed.
3. 05 §5 purpose prose enumerates three arms (minor internal inconsistency). Confirmed.
4. 10 §1.11 — PRD claims a stale content-arm bullet; **scout found NONE** (grep = 0 hits). PRD's claim is itself stale.
   Tests derive from normative sections instead.
5. 10 §1.5/§2.1 lack explicit current-turn test scenarios (gap; R5 supplies them).
6. Spec 04 §4 has NO `matched` field on ShrinkMarker — PRD prose "persist with matched:false" means the TOOL RESULT
   rendering (`Matched: no`), not a persisted field. Do not add a persisted `matched` field.