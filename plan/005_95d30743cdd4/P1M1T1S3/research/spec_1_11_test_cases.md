# Research: spec/10 §1.11 — the 7 cancel-target test cases mapped to fixtures

Mirrors PRD heading h3.72 ("1.11 Cancel target resolution") + the item-description case list (a)–(g).
Each case below gives: drive (params), fixtures (entries + contextEntries), and pass criteria (assertions).

## Shared setup (every case)
- `beforeEach(() => { clearAll(); setConfig(undefined); })` + `afterEach(() => clearAll())`.
  (clearAll resets the shared runtime seq map — GOTCHA #8. setConfig(undefined) → DEFAULT_CONFIG enabled:true.)
- DISTINCT entry.id vs data.id(uuid) on every marker fixture (proves the uuid mapping).
- `makePi()` captures appendEntry; assert `appended[0].customType === "mulligan:cancel"` and
  `appended[0].data.targetId === <the uuid>` on success; `appended.toHaveLength(0)` on no-op.

## (a) by_tool_call_id → single covering marker
**Drive:** `{ target: { by_tool_call_id: "call-A" } }`.
**contextEntries:** `[ msgEntry("toolResult", toolResult("call-A","read","big log")) ]` → message idx 0,
entry id "e-1".
**Sub-case a1 — shrink covers via its own target:**
  entries: `[ makeShrinkEntry("entry-sh-1","uuid-sh-1", { target:{by_tool_call_id:"call-A"}, seq:1 }) ]`.
  Shrink's target resolves to idx 0 === matchedIndex → covers. bestUuid="uuid-sh-1".
**Sub-case a2 — rewind covers via hideEntryIds:**
  entries: `[ makeRewindEntry("entry-rw-1","uuid-rw-1", { hideEntryIds:["e-1"], seq:1 }) ]`.
  matchedEntryId="e-1" ∈ hideEntryIds → covers. bestUuid="uuid-rw-1".
**Pass:** cancelled:true; appended[0].targetId === "uuid-sh-1" (a1) / "uuid-rw-1" (a2). markerId "leaf-1".

## (b) by_tool_name:"read", occurrence:"last" → most-recent covering the LAST read
**Drive:** `{ target: { by_tool_name:"read", occurrence:"last" } }`.
**contextEntries:** `[ msgEntry("toolResult", toolResult("c1","read","first")),
                      msgEntry("toolResult", toolResult("c2","read","second")) ]` → "last" resolves to idx 1,
entry id of the 2nd entry (e.g. "e-2").
**entries:** a shrink whose target is `{by_tool_name:"read", occurrence:"last"}` (resolves to idx 1) OR a
rewind with hideEntryIds including the 2nd entry's id.
**Pass:** cancelled:true; appended[0].targetId === that marker's uuid.
**Bonus (occurrence:first):** same fixtures, drive `{by_tool_name:"read", occurrence:"first"}` → resolves
idx 0; a marker covering idx 0 (not idx 1) is retired. Asserts the occurrence selector is honored.

## (c) by_content_includes:"<substr>" → most-recent covering a message with the substring
**Drive:** `{ target: { by_content_includes: "ENOSPC" } }`.
**contextEntries:** `[ msgEntry("toolResult", toolResult("call-A","bash", 'df -h ... "ENOSPC at /disk"')) ]`
→ resolveShrinkTarget stringifies content, finds "ENOSPC" → idx 0, entry id "e-1".
**entries:** a shrink with `target:{by_content_includes:"ENOSPC"}` (resolves idx 0) covers.
**Pass:** cancelled:true; appended[0].targetId === uuid. Also a NEGATIVE: substring "ZZZ-NOT-PRESENT"
→ no message matches → no marker covers → no-op (see case e).

## (d) Several markers cover → MOST RECENT by seq retired (LIFO); rest stay active
**Drive:** `{ target: { by_tool_call_id:"call-A" } }`.
**contextEntries:** `[ msgEntry("toolResult", toolResult("call-A","read","x")) ]` → idx 0, entry id "e-1".
**entries:** TWO markers BOTH covering idx 0:
  - older: `makeShrinkEntry("entry-sh-old","uuid-sh-old",{target:{by_tool_call_id:"call-A"},seq:1})`
  - newer: `makeShrinkEntry("entry-sh-new","uuid-sh-new",{target:{by_tool_call_id:"call-A"},seq:5})`
**Pass:** cancelled:true; appended EXACTLY ONE cancel; appended[0].targetId === "uuid-sh-new" (higher seq).
The older marker (uuid-sh-old) is NOT retired by this cancel (only the most-recent covering marker is).
**Cross-marker-type LIFO:** mix a shrink (seq 1) and a rewind (seq 5, hideEntryIds:["e-1"]) → the rewind wins.

## (e) No active marker covers → safe no-op (cancelled:false); nothing appended
**Drive:** `{ target: { by_tool_call_id:"call-A" } }`.
**contextEntries:** `[ msgEntry("toolResult", toolResult("call-Z","read","unrelated")) ]` → "call-A" unmatched.
**entries:** a shrink with target `{by_tool_call_id:"call-B"}` (does NOT cover idx 0) and/or a rewind with
hideEntryIds:["e-9"] (not "e-1"). Even though markers EXIST, none COVER the matched message.
**Pass:** appended.toHaveLength(0); text "no active marker found for that target" (or "with that id" —
VERIFY wording per research note); details {cancelled:false}.
**Empty-snapshot variant:** contextEntries:[] → matchedIndex null → no marker can cover → same no-op.

## (f) Explicit markerId fallback → exact marker retired; unknown id → safe no-op
**Drive (known):** `{ markerId:"entry-rw-1" }` (markerId path — does NOT call buildContextEntries).
**entries:** `[ makeRewindEntry("entry-rw-1","uuid-rw-1") ]`.
**Pass:** cancelled:true; appended[0].targetId === "uuid-rw-1" (uuid, not entry id).
**Drive (unknown):** `{ markerId:"nope" }` → no-op; appended.toHaveLength(0); details {cancelled:false}.
**markerId-wins-over-target:** `{ target:{by_tool_call_id:"call-A"}, markerId:"entry-rw-1" }` with BOTH a
target-matchable marker and the markerId marker → markerId path wins; appended[0].targetId === the
markerId marker's uuid (NOT the target-resolved one). Proves the "markerId wins" ordering.

## (g) After a successful cancel: cancelled:true + markerId; appendEntry called with the right shape
This is the INTEGRITY assertion layered onto cases (a)–(d). For a representative success (e.g. case a1):
**Pass:**
- `res.details.cancelled === true`.
- `res.details.markerId === "leaf-1"` (the fake's getLeafId).
- `appended.toHaveLength(1)`.
- `appended[0].customType === "mulligan:cancel"`.
- `appended[0].data` is a record with: `schema:"pi-mulligan"`, `v:1`, `kind:"cancel"`,
  `targetId === <the uuid>` (NEVER the entry id), `seq` (number, from nextSeq — first marker = 1),
  `ts` (number, ≤ Date.now()).
- confirmation text === "Mulligan: marker cancelled. The transform will no longer apply from the next turn on."

## TDD ordering (spec/10 §1.11 mandates RED→GREEN)
Write the cases as failing tests FIRST (against the not-yet-landed S2 cancel.ts → they fail because
makeCtx has no buildContextEntries and the target branch doesn't exist), then S2 makes them pass. In
practice S2 + S3 land together in P1.M1.T1; the tests should be authored to assert the CONTRACT above and
run green once S2's cancel.ts is in place. If a case fails after S2 lands, the failure pinpoints either a
covering-logic bug (S2) or a fixture/alignment bug (S3).