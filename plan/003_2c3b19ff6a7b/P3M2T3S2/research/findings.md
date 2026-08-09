# Research Notes — P3.M2.T3.S2: Soft cap (retire oldest shrink when active count > maxActive)

## Task (verbatim contract)
After S1's stale-retirement pass, add a SEPARATE check in the SAME post-`filterPipeline`
block: `if (markers.shrinks.length > config.shrink.maxActive)`, find the oldest shrink by
`seq` (sort ascending, take first), call `appendCancelMarker(pi, ctx, { targetId: oldest.id })`.
Retire exactly ONE per fire (bounded, eventual). Wrap in the SAME try/catch as the stale pass.
NEVER breaks the turn.

## Dependency state (all LANDED or CONTRACT — this task CONSUMES, does not add)

| Dependency | Source | Status |
|---|---|---|
| `config.shrink.maxActive` (32, `coerceNumber(...,true)` integer-validated) | P3.M2.T1.S1 | ✅ LANDED (config.ts:52,113,222-223) |
| `config.shrink.staleAfterFires` (3) | P3.M2.T1.S1 | ✅ LANDED (S1's stale pass reads it) |
| `rt.shrinkMissCounts` Map | P3.M2.T2.S1 | ✅ LANDED (runtime.ts; S1 reads/writes it) |
| `appendCancelMarker(pi, ctx, {targetId})` (never throws) | P3.M1.T1.S1 | ✅ LANDED (markers.ts:311) |
| `readMarkers` cancel-drop → `markers.shrinks` is ACTIVE set | P3.M1.T2.S1 | ✅ LANDED (filter.ts:140-160) |
| `contextHandler(pi, event, ctx)` signature + `pi` threaded + stale pass + own inner try/catch | P3.M2.T3.S1 | 🔗 CONTRACT (implementing in parallel) |
| `appendCancelMarker` + `resolvePinnedShrink` imported (runtime) into filter.ts | P3.M2.T3.S1 | 🔗 CONTRACT |
| test/filter.test.ts `makePi()` extended with `appendEntry`→`appendCalls`; 14 call sites += `pi` | P3.M2.T3.S1 | 🔗 CONTRACT |

This task touches ONLY: `src/filter.ts` (add the cap block inside S1's try/catch) +
`test/filter.test.ts` (a soft-cap describe block) + `spec/06-context-filter.md` §1 (extend the note).

## Key codebase facts (verified)

1. **filter.ts current state** (before S1 lands; S1 changes this — treat S1's PRP as the
   post-state): `contextHandler(event, ctx)` single outer try/catch; reads `config=getConfig()`,
   `rt=getRuntime(sessionId)`, `markers=readMarkers(ctx)`, `branchEntries=getBranch()`,
   `messages=filterPipeline(...)`; nudge; `rt.lastFiltered` cache; observability try/catch;
   `return { messages }`. S1 ADDS, after the observability block + before the return, an inner
   `try { /* stale pass */ } catch (retireErr) { log("warn", "filter.retire", ...) }`.
   **S2's cap block goes INSIDE that same inner try, after the stale for-loop.**

2. **`markers.shrinks` is the ACTIVE set** (filter.ts:140-160): readMarkers drops any shrink
   whose `data.id ∈ cancelledIds`. So `markers.shrinks.length` is the live active count — no
   re-filter needed for the cap. A shrink cancelled THIS fire (by either pass) stays in
   `markers.shrinks` THIS fire (cancels take effect NEXT fire) — harmless; double-cancel is a
   no-op (readMarkers dedups via Set).

3. **`ShrinkMarker` shape** (markers.ts:106-127): `{ kind:"shrink", id: string (uuid),
   target, replacement, reason?, pinnedEntryId?, seq: number, ts }`. `seq` = monotonic
   per-session counter (nextSeq). "Oldest" = lowest `seq`. `id` = the uuid the cancel targets
   (NOT the Pi entry id).

4. **`stableSortBySeq<T extends {seq?:unknown}>(markers): T[]`** (transforms.ts:1068,
   EXPORTED): returns a NEW array sorted ASCENDING by seq; defensive (non-finite/missing seq →
   0, sorted first = oldest; never throws; never mutates input). Used by filterPipeline for the
   SAME oldest-first ordering. `readOwnSeq` (the seq reader) is module-private to transforms —
   so the cleanest in-repo way to find "oldest" is `stableSortBySeq(markers.shrinks)[0]`.
   Must be ADDED to filter.ts's value import from transforms.js (S1 already added
   `resolvePinnedShrink` to that line).

5. **`readOwn(obj, key)`** (filter.ts module-private): swallows Proxy get-trap throws →
   undefined. ALWAYS read `oldest.id` via `readOwn(oldest, "id")`, never bare `.id`.

6. **`appendCancelMarker(pi, ctx, {targetId})`**: dumb persistence; never throws (returns null
   on failure); takes effect NEXT fire. Do NOT pre-validate targetId existence — markers.shrinks
   is already active.

7. **config deep-merge**: `setConfig({ shrink: { maxActive: 2 } })` sets ONLY maxActive, keeps
   staleAfterFires=3 + enabled=true (config.ts:187 deep-clones DEFAULT_CONFIG then per-leaf
   `if (v !== undefined)` overrides). Verified: shrink.test.ts uses `setConfig({ shrink:
   { enabled: true } })` as a single-leaf override.

8. **test fakes** (filter.test.ts:51-112): `shrinkData(seq, id?)` builds a LIVE shrink (NO
   pinnedEntryId) → S1's stale pass `continue`s on it (pinnedEntryId guard), so cap tests with
   default shrinkData isolate the cap cleanly. `customEntry(type, data)`, `makeCancelEntry(id)`
   (a mulligan:cancel entry — used to simulate "next fire the cancel has taken effect"),
   `makeCtx({entries, branch, sessionId, throwOn*})`, `makePi()` → S1 extends to return
   `{ handlers, appendCalls, pi }` capturing `appendEntry(customType, data)`. `pipelineReturn`
   (module-level) controls the mocked filterPipeline's return.

## Mocking plan (from contract §5)
maxActive=2, 3 active shrinks. Fire contextHandler. Assert ONE cancel appended with the
lowest-seq shrink's id. To prove "next-fire drop" + "one-per-fire eventual", between fires add
a `makeCancelEntry(id)` to the entries fixture (mirrors the readMarkers cancel-drop tests at
filter.test.ts:183-279).

## Decisions made
- **Oldest = `stableSortBySeq(markers.shrinks)[0]`** (idiomatic, defensive, matches filterPipeline).
  Add `stableSortBySeq` to the transforms.js VALUE import (3rd symbol after filterPipeline,
  resolvePinnedShrink).
- **Single `if`, single append** — no loop. `>` (strict), so `length === maxActive` does NOT
  retire (equal is not exceeding).
- **Guard unreadable id**: `typeof id === "string" && id.length > 0` else skip (fail-open,
  retried next fire).
- **NO de-dup vs stale pass this fire** — a double cancel is a harmless readMarkers Set no-op;
  adding a guard violates the contract's "keep it simple". Documented as accepted edge.
- **Spec doc**: extend the §1 note S1 added (append a soft-cap sentence) — no new section.