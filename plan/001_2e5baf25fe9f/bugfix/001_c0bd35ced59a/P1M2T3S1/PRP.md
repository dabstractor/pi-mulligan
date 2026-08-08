# PRP — P1.M2.T3.S1: `captureHideEntryIds` + integrate into `resolvePreview` (the PRODUCER half of permanent hiding)

**Work item:** P1.M2.T3.S1 · **Points:** 2 · **Bugfix:** fix_design.md §Change 2 (capture stable entry IDs at marker-creation time)
**Scope:** **EDIT `src/tools/rewind.ts`** (add a module-local `captureHideEntryIds` helper + thread `hideEntryIds` through
`resolvePreview` → `rewindExecute` step-7 payload → the `RewindDetails` result; add `type SessionEntry` to the Pi
import; Mode-A JSDoc updates) + **APPEND a `hideEntryIds` describe block** to `test/tools/rewind.test.ts`. **No other
file touched. No new files. No new deps.** This is the **PRODUCER**: it pins the stable entry IDs of the messages to
hide AT marker-creation time so the RESOLVER (`resolvePinnedHide`, P1.M2.T2.S1 — landed) can map them to current
message indices on every later fire → **permanent soft-delete** (fixes BUG-001 leak-back + BUG-002 infinite loop).

> **Dependency state (VERIFIED LIVE):** the three upstream pieces have ALL landed. `hideEntryIds?: string[]` is on
> `RewindMarker`/`RewindMarkerInput` (markers.ts:74 — P1.M2.T1.S1 Complete) and `RewindMarkerLike` (transforms.ts —
> P1.M2.T1.S1). `resolvePinnedHide` exists (transforms.ts:625 — P1.M2.T2.S1 landed). Baseline: `tsc` exit 0,
> `vitest` 18 files / 676 tests green (rewind.test.ts = 40). **OUT OF SCOPE:** `resolvePinnedHide` (P1.M2.T2 — landed),
> the `filterPipeline` dispatch (P1.M2.T4 — Planned), `resolveCheckpoint`/`setCheckpoint` (P1.M1 — Complete), any
> `transforms.ts`/`markers.ts` edit. My edits are CONFINED to `src/tools/rewind.ts` + `test/tools/rewind.test.ts`.

---

## Goal

**Feature Goal**: Make every **new** rewind marker carry the **stable entry IDs** of the messages it intends to hide,
captured ONCE at marker-creation time against the current (correct) session snapshot. This replaces the broken
"store a relative spec and re-resolve it against the constantly-growing message list every fire" model (BUG-001/002
root cause) with "store STABLE anchors; resolve them by identity every fire." The captured IDs are consumed by
`resolvePinnedHide` (P1.M2.T2 — landed) via the `filterPipeline` dispatch (P1.M2.T4) to produce permanent hiding.

**Deliverable** (edits to two existing files, no new files):
1. `src/tools/rewind.ts`:
   - **NEW module-local helper** `captureHideEntryIds(entries: SessionEntry[], remove: readonly number[]): string[]` — walks `entries` with a cursor (yield = `sessionEntryToContextMessages(e).length`, typically 1), and for each entry whose message index is in the removal set, captures its stable `id` (each entry at most once). Defensive on non-array inputs; never needs its own try/catch (it runs inside `resolvePreview` inside `rewindExecute`'s best-effort catch).
   - `resolvePreview` return widens from `{ ledger, k }` → `{ ledger, k, hideEntryIds }` (computed from the SAME `entries` + `remove` already in scope — index→entry mapping is exact by construction since `messages = entries.flatMap(sessionEntryToContextMessages)`).
   - `rewindExecute` step-5 destructure adds `hideEntryIds` (catch path → `hideEntryIds = []`); step-7 payload adds `hideEntryIds` (typed on `RewindMarkerInput` now — no cast for it; the existing `checkpoint` cast stays); step-9 `details` adds `hideEntryIds` for audit.
   - `RewindDetails` gains `hideEntryIds?: string[]`.
   - `type SessionEntry` added to the existing Pi import (rewind.ts is NOT Pi-free — it already imports from Pi).
   - Mode-A JSDoc on `captureHideEntryIds`, `resolvePreview`, `rewindExecute` step 7, and the `RewindDetails` field.
2. `test/tools/rewind.test.ts`: a NEW `msgEntryId(id, message)` fixture + a NEW `describe("mulligan_rewind — hideEntryIds capture …")` block asserting the persisted marker + result `details` carry the RIGHT entry IDs for last_tool_call_group, last_turn, checkpoint, K=0 (→ `[]`), and snapshot-failure (→ `[]`), plus a type assertion.

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0** (the threaded field + helper are type-sound under `strict`).
- `npx vitest run` is **all-green** — the new `hideEntryIds` tests **AND** all 676 existing tests (zero regressions; the field is additive, existing assertions don't break).
- `grep -n "captureHideEntryIds" src/tools/rewind.ts` → exactly 1 (the helper) + ≥1 call site.
- The **pinned contract**: a last_tool_call_group rewind over `[u, asst(X), result(X), asst(RW), result(RW)]` (excludeToolCallId=RW) persists `hideEntryIds` === the entry ids of the X group (the removed messages' entries) — and on a GROWN session (the permanence scenario) those same IDs still resolve to the SAME (still-hidden) messages. (The growth/fire-2 assertion belongs to the resolver/dispatch/regression tests — P1.M2.T2/P1.M2.T4/P1.M3 — not here; here we only assert the marker CARRIES the right ids.)

---

## User Persona

**Target User**: The resumed agent + the `filterPipeline` dispatch (P1.M2.T4 — the SOLE downstream reader of the
persisted `hideEntryIds`). The dispatch reads `readOwn(rw, "hideEntryIds")` off each rewind marker on every context
fire; when non-empty, it calls `resolvePinnedHide(messages, branchEntries, hideEntryIds)` (P1.M2.T2 — landed) to map
those stable IDs → current message indices → `applyRewind` hides them. Because the IDs are pinned (captured once, at
creation), the hidden set is **invariant across session growth** — the agent's NEW work (new entries, new IDs) is
never in the pinned set → it stays visible; the originally-hidden mistake (its IDs ARE pinned) stays hidden. That is
the BUG-001/002 fix.

**Use Case**: An agent runs a bloated `read /etc/hostname` (entry `e_read`), calls
`mulligan_rewind(granularity:"last_tool_call_group")`. At creation, `resolvePreview` resolves the read's toolGroup
(message indices [1,2]) and `captureHideEntryIds` maps those back to `["e_read_asst", "e_read_result"]`. The marker
persists `hideEntryIds:["e_read_asst","e_read_result"]`. The agent then reads `/etc/os-release` (NEW entries
`e_os_asst`, `e_os_result` — NOT in the pinned set). On every later fire, `resolvePinnedHide` resolves the pinned IDs
→ the hostname read is STILL hidden; the os-release read (new IDs) is VISIBLE. **Permanent hiding achieved.**

**User Journey**:
1. Agent calls `mulligan_rewind(note, granularity)`.
2. Tool step 2 validates note; step 4 depth guard; step 5 `resolvePreview` → `{ ledger, k, hideEntryIds }`.
3. Tool step 7 persists the marker payload INCLUDING `hideEntryIds` (spread in `appendRewindMarker` preserves it).
4. Every later `context` fire: `filterPipeline` (P1.M2.T4) reads `hideEntryIds` → `resolvePinnedHide` → permanent hide.

**Pain Points Addressed**: Today the marker stores only a RELATIVE spec (`granularity`) + the rewind's own
`excludeToolCallId`. `filterPipeline` re-resolves that spec against the grown message list every fire → "last tool
group" re-targets onto the agent's NEW (legitimate) work, un-hiding the original mistake and hiding the new work
(BUG-001); "last turn" hides the agent's own redo every fire → infinite loop (BUG-002). Pinning stable entry IDs at
creation removes the moving target entirely.

---

## Why

- **This IS the producer half of the root-cause fix.** PRD §Recommendations: *"Pin rewind targets at marker-creation
  time (capture the entry ids) instead of re-resolving a relative spec every fire."* `captureHideEntryIds` + the
  payload wiring turn that recommendation into persisted data. The resolver (P1.M2.T2 — landed) + dispatch (P1.M2.T4)
  consume it; without the producer, the resolver has nothing to read.
- **The removal set is ALREADY resolved correctly at creation time** (spec_and_test_analysis §KEY QUESTION 2: the
  available-but-unpersisted snapshot). `resolvePreview` computes `remove` (the right message indices against the
  CURRENT snapshot); today it uses `remove` only for the advisory K/ledger and DISCARDS it. The fix simply maps those
  indices back to their stable entry IDs and persists them. Cheapest possible correctness gain.
- **Entry IDs are the stable anchor Pi gives us.** `SessionEntryBase.id: string` (verified — session-manager.d.ts:17)
  is a permanent UUID; it survives compaction, reload, and session growth. Message INDICES are not stable (they shift
  on compaction: the message list is compaction-aware, `getBranch()` is not). Pinning IDs (not indices) is exactly
  why the fix works where the relative model failed.
- **Exact-by-construction alignment.** `captureHideEntryIds` walks the SAME `entries` that produced `messages` (via
  the SAME `sessionEntryToContextMessages`), so entry `e` ↔ `messages[cursor..cursor+yield)` is exact. No guessing,
  no fragile position math.
- **Backward compatible.** `hideEntryIds` is OPTIONAL (P1.M2.T1.S1). Old markers lack it → dispatch falls back to
  legacy relative resolution (still buggy, but they were created by buggy code). New markers always have it.

---

## What

EDIT `src/tools/rewind.ts` (7 surgical edits — exact oldText/newText below) + APPEND to `test/tools/rewind.test.ts`.

- **`captureHideEntryIds(entries, remove)`**: build a `Set<number>` from `remove`; walk `entries` root→leaf with a
  `cursor`; per entry `y = sessionEntryToContextMessages(e).length`; if ANY index in `[cursor, cursor+y)` is in the
  set → push `e.id` and `break` (capture each entry once); `cursor += y`. Return the id list. Non-array inputs → `[]`.
- **`resolvePreview`**: after `extractFileLedger`, add `const hideEntryIds = captureHideEntryIds(entries, remove);`;
  widen the return type + literal to include `hideEntryIds`.
- **`rewindExecute`**: destructure `hideEntryIds` from `resolvePreview`; `catch { … hideEntryIds = []; }`; add
  `hideEntryIds,` to the step-7 `payload` object; add `hideEntryIds,` to the step-9 `details` object.
- **`RewindDetails`**: add `hideEntryIds?: string[]`.
- **Pi import**: add `type SessionEntry,`.
- **Mode-A JSDoc**: document the capture on `captureHideEntryIds`, the widened `resolvePreview` return, step 7, and the field.

This subtask does **NOT**: touch `src/transforms.ts` (resolvePinnedHide/filterPipeline/resolveCheckpoint — other
tasks' scope); touch `src/markers.ts` (the field + wrapper are already there); implement the dispatch or any
multi-fire/regression test (P1.M2.T4 / P1.M3); change the typebox schema, refusal paths, note validation, depth
guard, K-preview math, ledger extraction, or mutation warning; mutate inputs; or add a runtime dep.

### Success Criteria

- [ ] `captureHideEntryIds` is added (module-local) to `src/tools/rewind.ts`; called exactly once from `resolvePreview`.
- [ ] `resolvePreview` returns `{ ledger: FileLedger; k: number; hideEntryIds: string[] }`.
- [ ] `rewindExecute` destructures `hideEntryIds`; defaults it to `[]` in the best-effort catch; adds it to the payload AND the success `details`.
- [ ] `RewindDetails` has `hideEntryIds?: string[]`.
- [ ] `type SessionEntry` is imported from Pi (no new import SOURCE — same `@earendil-works/pi-coding-agent` line).
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] `npx vitest run` is fully green (676 existing + new tests; zero regressions).
- [ ] **Pinned (last_tool_call_group):** `[u(e_u), asst(X)(e_X), result(X)(e_rX), asst(RW)(e_rw), result(RW)(e_rrw)]`
      with toolCallId `RW` → marker `hideEntryIds === ["e_X","e_rX"]` (the removed messages' entries); `e_u/e_rw/e_rrw` NOT included.
- [ ] **Pinned (last_turn):** the same shape, `last_turn` → `hideEntryIds` === the BAD-toolGroup entries (rewind's own unit kept).
- [ ] **Pinned (K=0):** only the rewind's own group in the snapshot → `remove=[]` → `hideEntryIds === []` (present, not undefined).
- [ ] **Pinned (snapshot failure):** `throwOnBuildContext:true` → catch → `hideEntryIds === []`; marker STILL persisted.
- [ ] **Result audit:** `res.details.hideEntryIds` equals the marker's `hideEntryIds` on the success path.
- [ ] **Existing tests untouched & green:** the 40 existing rewind tests (payload contract, K, mutation warning, best-effort, never-throws, types) still pass — `hideEntryIds` is additive.

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"_
> — **Yes.** All 7 source edits are given as exact `oldText`/`newText` (Tasks 1–4) and the exact test block (Task 5),
> hand-traced against the pinned scenarios. The current `resolvePreview` + `rewindExecute` step-5/7/9 text is quoted
> verbatim (it is the oldText source). The Pi type facts (`SessionEntry.id: string`, exported, `buildContextEntries():
> SessionEntry[]`, `sessionEntryToContextMessages(entry: SessionEntry): AgentMessage[]`) are verified against the
> installed `.d.ts`. The wrapper spread (`{ ...data, … }`) is quoted. The test fixture idiom (`makePi`/`makeCtx`/
> `msgEntry`) is quoted. No prior knowledge beyond "tsc + vitest are green on the current tree; the 3 upstream pieces
> have landed" is required.

### Scope decision (READ BEFORE CODING)

- **EDIT `src/tools/rewind.ts` ONLY** (plus the test file). Do NOT touch `transforms.ts` (resolvePinnedHide/
  filterPipeline/resolveCheckpoint — P1.M2.T2/T4, P1.M1) or `markers.ts` (field + wrapper already there — P1.M2.T1).
- **Do NOT add a runtime dep.** `SessionEntry` is a TYPE import on the EXISTING `@earendil-works/pi-coding-agent`
  import line. rewind.ts is NOT Pi-free (no zero-imports gate — that's only transforms.ts/ledger.ts/tokens.ts).
- **Do NOT make `captureHideEntryIds` exported.** It is module-local (like `resolvePreview`, `countRewindMarkers`,
  `checkpointExists`). It is tested via the tool's `execute` path (the established rewind.test.ts idiom — `makeCtx`
  scripts `buildContextEntries`, then assert on the persisted marker).
- **Do NOT add per-entry try/catch inside `captureHideEntryIds`.** A throwing `sessionEntryToContextMessages(e)`
  propagates to `resolvePreview` → `rewindExecute`'s catch → `hideEntryIds=[]` + emptyLedger + K=0 + still-succeeds
  (E13/E8). Per-entry try/catch would RISK misaligning the cursor (a throwing entry that actually yields messages
  would shift the index→entry mapping). Let the existing outer catch handle it.
- **Do NOT change the removal-resolution math.** `resolvePreview`'s granularity dispatch (resolveLastToolCallGroup /
  resolveLastTurn / resolveCheckpoint) is UNCHANGED. `captureHideEntryIds` only maps the EXISTING `remove` → entry ids.
- **Do NOT omit `hideEntryIds` on the catch path or for K=0.** The contract: "Every new rewind marker has
  hideEntryIds populated." Both paths set `hideEntryIds = []` (present). The dispatch (T4) decides `[]` → legacy
  fallback; that is its concern, not mine.
- **Do NOT hand-edit `appendRewindMarker` or `RewindMarkerInput`.** The `{ ...data }` spread persists `hideEntryIds`
  unchanged; the field is already typed (P1.M2.T1.S1).

### Documentation & References

```yaml
# MUST READ — authoritative sources for captureHideEntryIds + the integration
- file: plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/architecture/fix_design.md
  section: "Change 2: Rewind tool captures entry IDs at creation time"
  why: "THE design doc for this exact change. Gives the captureHideEntryIds algorithm (cursor walk, yield = sessionEntryToContextMessages(entry).length,
        push entry.id when any of [cursor,cursor+yield) is in remove), the resolvePreview seam (entries + remove are both already in scope),
        and the 'removal set resolved ONCE at creation time → entry IDs stable forever' key property."
  critical: "fix_design's algorithm matches the item_description EXACTLY. Use a Set<number> for the remove lookup (O(1)) — it is
        equivalent to the pseudocode's remove.includes(j) and produces identical results."

- file: src/tools/rewind.ts
  section: "resolvePreview (≈290-308) + rewindExecute step 5 (≈340-348) + step 7 payload (≈360-372) + step 9 return (≈378-382) + RewindDetails (≈113-121) + Pi import (≈21-29)"
  why: "THE file you EDIT. resolvePreview already has `entries` + `remove` in scope → captureHideEntryIds(entries, remove) is a 1-line
        addition. rewindExecute's try/catch already exists → add `hideEntryIds` to destructure + catch + payload + details. RewindDetails
        already has granularity/k/ledger/markerId → add hideEntryIds. The Pi import already lists sessionEntryToContextMessages → add type SessionEntry."
  pattern: "Module-local pure helper (mirror countRewindMarkers/checkpointExists/resolvePreview — defensive on inputs, called inside execute)."
  gotcha: "The step-7 payload has `checkpoint: params.checkpoint` which is NOT in RewindMarkerInput's frozen type → the `payload as RewindMarkerInput`
        cast STAYS. Adding `hideEntryIds` (which IS typed now) does NOT remove the need for that cast — checkpoint still needs it (GOTCHA #1)."

- file: src/markers.ts
  section: "appendRewindMarker (≈166): `const entry: RewindMarker = { ...data, schema, v:1, kind, id: randomUUID(), seq, ts: Date.now() }`"
  why: "PROVES the wrapper persists hideEntryIds with NO edit: the { ...data } spread copies every field in data (now incl. hideEntryIds) into the
        persisted entry. The checkpoint field already rides this exact mechanism. DO NOT edit appendRewindMarker."
  pattern: "spread-preserves-extra-fields (same as the existing checkpoint precedent)."

- file: src/transforms.ts
  section: "resolvePinnedHide (line 625) — the landed RESOLVER that consumes hideEntryIds"
  why: "The IMMEDIATE downstream consumer. Reads hideEntryIds as a plain `string[]` param, walks getBranch() root→leaf, matches by id, returns the
        message indices to hide. CONFIRMS the producer must emit ENTRY ids (stable), NOT message indices. Do NOT edit transforms.ts."

- file: plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/P1M2T1S1/PRP.md   # the data-model PRP (Complete — landed)
  why: "Defines the hideEntryIds field shape (optional string[] on RewindMarker/RewindMarkerInput/RewindMarkerLike) my payload edit populates.
        Its GOTCHA #1 (Omit-propagation) + GOTCHA #5 (spread persists it) confirm my task needs NO markers.ts edit."

- file: plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/P1M2T2S1/PRP.md   # the resolver PRP (Implementing → landed)
  why: "Defines resolvePinnedHide — the fn that consumes my output. Its GOTCHA #4 confirms: 'captureHideEntryIds pins the WHOLE unit's entry ids
        (assistant + all its results)' → pairing safety comes from the PRODUCER resolving at the UNIT level (resolveLastToolCallGroup/resolveLastTurn
        already return unit-level indices). So captureHideEntryIds naturally captures whole units (the entries of every removed message)."

- file: test/tools/rewind.test.ts
  section: "makePi/makeCtx fakes + msgEntry fixture (≈140-240) + the success-path payload contract describe block (≈300-360)"
  why: "THE test idiom to mirror. makeCtx({contextEntries}) scripts buildContextEntries; the persisted marker is (appended[0].data as RewindMarker);
        details is res.details. msgEntry uses a RANDOM id → ADD a msgEntryId(id,message) helper for deterministic-id assertions."
  pattern: "beforeEach/afterEach clearAll()+setConfig(undefined); hand-rolled fakes (no vi.fn()); .js imports; expectTypeOf."

- file: plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/architecture/spec_and_test_analysis.md
  section: "KEY QUESTION 2 (the available-but-unpersisted snapshot)"
  why: "The original analysis that identified resolvePreview already resolves remove at creation time but DISCARDS it. This task PERSISTS it (as
        entry ids). KEY QUESTION 3 documents the test gap (no multi-fire test) — the multi-fire/permanence regression tests are P1.M3, NOT here."

# Pi type facts (VERIFIED against /home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/dist):
#   session-manager.d.ts:17  -> SessionEntryBase { type; id: string; parentId; timestamp }  (EVERY SessionEntry has a stable string id)
#   session-manager.d.ts:105 -> type SessionEntry = SessionMessageEntry | … | LabelEntry | SessionInfoEntry
#   session-manager.d.ts:266 -> buildContextEntries(): SessionEntry[]
#   session-manager.d.ts:151 -> sessionEntryToContextMessages(entry: SessionEntry): AgentMessage[]
#   index.d.ts:19            -> `export { type SessionEntry, … }`  (SessionEntry IS exported → import { type SessionEntry })
#   => captureHideEntryIds(entries: SessionEntry[], remove): string[]; e.id is typed `string`; sessionEntryToContextMessages(e) type-checks.

- file: plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/P1M2T3S1/research/codebase_recon.md
  why: "First-hand recon: dependency-landed state, the exact resolvePreview/rewindExecute text, the wrapper spread, Pi type facts, producer↔resolver
        alignment, K=0/snapshot-failure design decisions, parallel-task boundary."
```

### Current Codebase tree (state at this subtask's start — VERIFIED LIVE)

```bash
pi-mulligan/
├── package.json            # type:'module'; scripts.test:'vitest run'. NO new dep needed.
├── tsconfig.json           # strict, noImplicitAny, moduleResolution:'Bundler', include:['src','test']
├── src/
│   ├── tools/rewind.ts     # EDIT: +type SessionEntry import; +captureHideEntryIds helper; resolvePreview +return; rewindExecute +destructure/catch/payload/details; RewindDetails +field.
│   ├── markers.ts          # READ-ONLY (hideEntryIds field at :74 + appendRewindMarker spread at :166 — both ALREADY correct; P1.M2.T1.S1 landed).
│   ├── transforms.ts       # READ-ONLY (resolvePinnedHide at :625 + RewindMarkerLike.hideEntryIds — P1.M2.T2/T1 landed). DO NOT TOUCH.
│   ├── tools/{checkpoint,shrink,audit}.ts / filter.ts / nudges.ts / config.ts / log.ts / runtime.ts / tokens.ts / ledger.ts / notes.ts / index.ts  # untouched
├── test/
│   └── tools/rewind.test.ts # APPEND: +msgEntryId helper + a hideEntryIds describe block. Existing 40 tests untouched.
└── plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/architecture/fix_design.md  # §Change 2 = authoritative algorithm
# VERIFIED BASELINE: `npx tsc --noEmit -p tsconfig.json` → exit 0; `npx vitest run` → 18 files / 676 tests green (rewind.test.ts = 40).
# NOTE: no eslint/prettier configured (devDeps = typescript + vitest + @types/node). The gate is `tsc --noEmit` + `vitest run`. Do NOT invent a lint command.
```

### Desired Codebase tree with files to be changed (THIS subtask)

```bash
pi-mulligan/
├── src/
│   └── tools/rewind.ts     # +captureHideEntryIds; resolvePreview/rewindExecute/RewindDetails/import threaded for hideEntryIds. ~25 new lines.
└── test/
    └── tools/rewind.test.ts # +msgEntryId helper + ~1 new describe block. ~70 new lines.
# No new files. No new deps. No package.json change. No spec-doc change (P1.M4 owns spec/06 sync).
```

### Known Gotchas of our codebase & Library Quirks

```bash
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #1 (CRITICAL) — The `payload as RewindMarkerInput` cast STAYS. The payload object contains `checkpoint: params.checkpoint`,
#   which is NOT in the frozen RewindMarkerInput type (spec/04 §3 omits it; it rides the spread at runtime — rewind.ts header GOTCHA #1).
#   Adding `hideEntryIds` (which IS typed now, P1.M2.T1.S1) does NOT remove the need for the cast — `checkpoint` still forces it. So the
#   payload line becomes `{ …, ledger, hideEntryIds, checkpoint: params.checkpoint }` and the call stays `appendRewindMarker(pi, ctx, payload as RewindMarkerInput)`.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #2 (CRITICAL) — captureHideEntryIds aligns BY CONSTRUCTION with messages. `messages = entries.flatMap(sessionEntryToContextMessages)`,
#   and the helper walks the SAME `entries` with `cursor += sessionEntryToContextMessages(e).length`. So entry e ↔ messages[cursor..cursor+yield)
#   is EXACT — no position math, no off-by-one. Do NOT re-derive messages or invent a parallel index; reuse the `entries` resolvePreview already built.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #3 (CRITICAL) — `entries` and `remove` are BOTH already in scope inside resolvePreview (entries from buildContextEntries, remove from the
#   granularity dispatch). captureHideEntryIds(entries, remove) is a 1-arg-thread addition. Do NOT re-fetch entries or re-resolve remove.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #4 (CRITICAL) — Do NOT add per-entry try/catch in captureHideEntryIds. A throwing sessionEntryToContextMessages(e) must propagate to
#   resolvePreview → rewindExecute's catch (which sets hideEntryIds=[] + emptyLedger + K=0 + still-succeeds — E13/E8). Swallowing per-entry would
#   RISK cursor misalignment (a throwing entry that yields >0 messages would shift every later mapping). One light input guard
#   (`if (!Array.isArray(entries) || !Array.isArray(remove)) return []`) is enough; NO try/catch around the per-entry work.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #5 — ALWAYS set hideEntryIds on new markers (even []). The contract: "Every new rewind marker has hideEntryIds populated." For remove=[]
#   (K=0) → captureHideEntryIds returns [] → persisted []. For snapshot failure (catch) → hideEntryIds=[]. Both are PRESENT (not undefined). The
#   dispatch (P1.M2.T4) treats [] as "legacy fallback" — that is its design, NOT mine. I just persist what captureHideEntryIds returns.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #6 — capture each entry AT MOST ONCE. The inner loop `for j in [cursor, cursor+yield)` BREAKS after the first match (an entry whose message
#   is in remove → push e.id once). yield is 1 in practice (message/custom_message/branch_summary), so the break is belt-and-suspenders, but it
#   matters if a future entry type yields >1 message. Do NOT remove the break.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #7 — `type SessionEntry` is a TYPE-only import on the EXISTING Pi import line. Add it as `type SessionEntry,` (not a value import — it's
#   erased at runtime). rewind.ts is NOT Pi-free; the only Pi-free modules are transforms.ts/ledger.ts/tokens.ts. No new dep; no new import SOURCE.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #8 — rewind.test.ts's `msgEntry(message)` uses a RANDOM id (`e-${Math.random()…}`). For hideEntryIds assertions you need DETERMINISTIC,
#   known ids → ADD a `msgEntryId(id, message)` helper. Do NOT mutate `msgEntry` (40 existing tests rely on its signature).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #9 — There is NO lint/format tool configured (devDeps = typescript + vitest + @types/node only). The type+style gate is `tsc --noEmit`
#   (TS strict). Do NOT invent a ruff/eslint/prettier command — it would fail "command not found". Validation = tsc + vitest, nothing else.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #10 — Do NOT touch the typebox RewindParams schema, the refusal paths, note validation, depth guard, K math, extractFileLedger, or the
#   mutation warning. hideEntryIds is PURELY ADDITIVE threading. The 40 existing rewind tests must stay green unchanged (they assert on
#   entry.granularity/options/excludeToolCallId/note/ledger/checkpoint + res.details.k/ledger/markerId — none of which change).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #11 — The marker persisted via `appended[0].data` is the entry object that went through `{ ...data, … }` in appendRewindMarker. So
#   `hideEntryIds` is readable directly as `(appended[0].data as RewindMarker).hideEntryIds` — NO cast beyond `as RewindMarker` (the field is typed).
#   (Unlike `checkpoint`, which needs `as RewindMarker & { checkpoint?: string }` because it's not in the frozen type.)
# ─────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

```ts
// EDIT src/tools/rewind.ts — RewindDetails gains one field:
export interface RewindDetails {
  granularity: Granularity;
  k?: number;
  ledger?: FileLedger;
  /** Stable ENTRY ids pinned for permanent hiding at marker-creation time (fix_design.md §Change 2; audit surface).
   *  Present on the success path (possibly []); omitted on refusal paths. Read by filterPipeline (P1.M2.T4) via the
   *  persisted marker; resolved by resolvePinnedHide (P1.M2.T2). Holds ENTRY ids (stable), NOT message indices. */
  hideEntryIds?: string[];
  markerId?: string | null;
}

// NEW module-local helper (NOT exported — tested via the tool execute path):
//   function captureHideEntryIds(entries: SessionEntry[], remove: readonly number[]): string[]
// Algorithm: Set<number> from remove; cursor=0; for each entry: y = sessionEntryToContextMessages(e).length;
//   if any j in [cursor,cursor+y) is in the set → push e.id (if truthy) + break; cursor += y. Return ids. (GOTCHA #2/#6)
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY BASELINE + dependency-landed state (no edits — run only)
  - RUN: npx tsc --noEmit -p tsconfig.json                      # expect exit 0
  - RUN: npx vitest run test/tools/rewind.test.ts                # expect 40 passed
  - RUN: grep -n "hideEntryIds" src/markers.ts                   # expect ≥1 hit (P1.M2.T1.S1 landed — field exists)
  - RUN: grep -n "export function resolvePinnedHide" src/transforms.ts  # expect 1 hit (P1.M2.T2.S1 landed — resolver exists)
  - RUN: grep -c "captureHideEntryIds" src/tools/rewind.ts       # expect 0 (we are ADDING it)

Task 1: EDIT src/tools/rewind.ts — add `type SessionEntry` to the Pi import (exact oldText/newText below)
  - FIND: the `import { defineTool, … sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent"` block.
  - INSERT: `type SessionEntry,` after `type ToolDefinition,` (GOTCHA #7 — TYPE-only; same import SOURCE; no new dep).

Task 2: EDIT src/tools/rewind.ts — add `hideEntryIds?: string[]` to RewindDetails (exact oldText/newText below)
  - FIND: the RewindDetails interface (the `ledger?: FileLedger;` + `markerId?: string | null;` lines).
  - INSERT: the JSDoc'd `hideEntryIds?: string[];` field AFTER `ledger?: FileLedger;` (BEFORE `markerId`).

Task 3: EDIT src/tools/rewind.ts — ADD the `captureHideEntryIds` helper (exact content below — insert BEFORE resolvePreview)
  - INSERT: the full function (header doc + body) immediately BEFORE the `resolvePreview` JSDoc (anchor: the line
    `/**\n * resolvePreview —`). Module-local (no `export`).
  - CONSTRAINTS: signature `captureHideEntryIds(entries: SessionEntry[], remove: readonly number[]): string[]`;
    Set<number> lookup; cursor walk with sessionEntryToContextMessages(e).length; push e.id + break on first match;
    non-array guard → []; NO per-entry try/catch (GOTCHA #4).

Task 4: EDIT src/tools/rewind.ts — thread hideEntryIds through resolvePreview + rewindExecute (4 sub-edits below)
  - (4a) resolvePreview: widen the return-type annotation to add `hideEntryIds: string[]`; add the captureHideEntryIds
        call before the return; add `hideEntryIds` to the returned object.
  - (4b) rewindExecute step-5: add `let hideEntryIds: string[];` to the declarations; destructure it from
        resolvePreview; set `hideEntryIds = [];` in the catch.
  - (4c) rewindExecute step-7 payload: add `hideEntryIds,` (the `as RewindMarkerInput` cast STAYS — GOTCHA #1).
  - (4d) rewindExecute step-9 details: add `hideEntryIds,` to the success return object.

Task 5: APPEND to test/tools/rewind.test.ts — a msgEntryId helper + a hideEntryIds describe block (exact content below)
  - APPEND `msgEntryId(id, message)` (deterministic-id variant of msgEntry — GOTCHA #8).
  - APPEND a `describe("mulligan_rewind — hideEntryIds capture (fix_design.md §Change 2; permanent-hiding producer)")`
    block covering: last_tool_call_group, last_turn, K=0, snapshot-failure, result-audit, marker-always-has-field,
    and a RewindDetails type assertion.
  - NO change to the existing 40 tests (they stay green — hideEntryIds is additive).

Task 6: VALIDATE (no edits — run the gates in the Validation Loop)
  - Level 1 (tsc + grep gates) and Level 2 (full vitest run). Levels 3/4 N/A (producer; the multi-fire permanence
    proof is the resolver/dispatch/regression tests in P1.M2.T2/T4 + P1.M3 — NOT here).
```

#### Exact edits — `src/tools/rewind.ts`

**Task 1 — add `type SessionEntry` to the Pi import** (`edit` tool):

oldText:
```
import {
  defineTool,
  type AgentToolResult,
  type ExtensionAPI,
  type ExtensionContext,
  type ToolDefinition,
  sessionEntryToContextMessages,
} from "@earendil-works/pi-coding-agent";
```
newText:
```
import {
  defineTool,
  type AgentToolResult,
  type ExtensionAPI,
  type ExtensionContext,
  type ToolDefinition,
  type SessionEntry,
  sessionEntryToContextMessages,
} from "@earendil-works/pi-coding-agent";
```

**Task 2 — add `hideEntryIds?: string[]` to `RewindDetails`** (`edit` tool):

oldText:
```
  /** The extracted file ledger (success path only; empty on best-effort failure). */
  ledger?: FileLedger;
  /** The persisted marker's entry id (success path; null/omitted when append returned null). */
  markerId?: string | null;
```
newText:
```
  /** The extracted file ledger (success path only; empty on best-effort failure). */
  ledger?: FileLedger;
  /** Stable ENTRY ids pinned for permanent hiding at marker-creation time (fix_design.md §Change 2; audit surface).
   *  Present on the success path (possibly []); omitted on refusal paths. Read by filterPipeline (P1.M2.T4) off the
   *  persisted marker and resolved by resolvePinnedHide (P1.M2.T2). Holds ENTRY ids (stable), NOT message indices. */
  hideEntryIds?: string[];
  /** The persisted marker's entry id (success path; null/omitted when append returned null). */
  markerId?: string | null;
```

**Task 3 — ADD `captureHideEntryIds`** (`edit` tool — insert immediately BEFORE the `resolvePreview` JSDoc). Anchor
oldText = the first line of the resolvePreview JSDoc; newText = the helper + a blank line + that same anchor line.

oldText:
```
/**
 * resolvePreview — the read-only ledger + K preview (step 5; GOTCHA #5/#6/#7/#8). Builds a SNAPSHOT via
```
newText:
```
/**
 * captureHideEntryIds — map the resolved MESSAGE-INDEX removal set back to the STABLE ENTRY ids of the entries that
 * produced those messages, for PERMANENT pinned hiding (fix_design.md §Change 2; the PRODUCER half of the BUG-001/
 * BUG-002 fix; consumed at filter time by resolvePinnedHide, P1.M2.T2, via the persisted marker's hideEntryIds).
 *
 * ALGORITHM (fix_design.md §Change 2; mirrors how `messages` was built): walk `entries` with a `cursor`; for each
 * entry `e`, `yield = sessionEntryToContextMessages(e).length` (typically 1 for message/custom_message/branch_summary);
 * if ANY index in `[cursor, cursor+yield)` is in `remove`, push `e.id` ONCE and break; then `cursor += yield`. Because
 * `messages = entries.flatMap(sessionEntryToContextMessages)` (resolvePreview, above), entry `e` ↔ `messages[cursor..cursor+yield)`
 * is EXACT BY CONSTRUCTION — no position math. The captured ids are the STABLE anchors Pi gives us (SessionEntryBase.id
 * is a permanent UUID; survives compaction/reload/growth), which is precisely why pinned hiding is permanent where the
 * relative re-resolution model (BUG-001/002) failed.
 *
 * Defensive: non-array `entries`/`remove` → []. Does NOT itself try/catch: it runs inside `resolvePreview` inside
 * rewindExecute's best-effort catch, so a throwing `sessionEntryToContextMessages(e)` propagates → hideEntryIds=[] +
 * emptyLedger + K=0 + the rewind STILL proceeds (E13/E8). Per-entry try/catch is intentionally AVOIDED — it would risk
 * misaligning the cursor (a throwing entry that yields >0 messages would shift every later mapping). Module-local
 * (tested via the tool execute path, like resolvePreview/countRewindMarkers/checkpointExists).
 *
 * @param entries the buildContextEntries() snapshot resolvePreview already built (root→leaf); each e.id is a stable string
 * @param remove  the MESSAGE-INDEX removal set resolvePreview already resolved (number[]); non-array → []
 * @returns the stable ENTRY ids of the entries whose message(s) are in `remove` (each entry at most once); [] if nothing
 */
function captureHideEntryIds(entries: SessionEntry[], remove: readonly number[]): string[] {
  if (!Array.isArray(entries) || !Array.isArray(remove)) return [];
  const removeSet = new Set<number>(remove);
  const ids: string[] = [];
  let cursor = 0;
  for (const e of entries) {
    const y = sessionEntryToContextMessages(e).length; // typically 1 (message/custom_message/branch_summary)
    for (let j = cursor; j < cursor + y; j++) {
      if (removeSet.has(j)) {
        if (e.id) ids.push(e.id); // SessionEntryBase.id is a stable string; guard rejects the empty-string edge
        break; // capture each entry at most once (matters if a future entry type yields >1 message)
      }
    }
    cursor += y;
  }
  return ids;
}

/**
 * resolvePreview — the read-only ledger + K preview (step 5; GOTCHA #5/#6/#7/#8). Builds a SNAPSHOT via
```

**Task 4a — `resolvePreview` return type + capture call + return literal** (`edit` tool):

oldText:
```
function resolvePreview(
  ctx: ExtensionContext,
  params: RewindArgs,
  toolCallId: string,
): { ledger: FileLedger; k: number } {
  const entries = ctx.sessionManager.buildContextEntries(); // GOTCHA #5: snapshot, compaction-aware
```
newText:
```
function resolvePreview(
  ctx: ExtensionContext,
  params: RewindArgs,
  toolCallId: string,
): { ledger: FileLedger; k: number; hideEntryIds: string[] } {
  const entries = ctx.sessionManager.buildContextEntries(); // GOTCHA #5: snapshot, compaction-aware
```

oldText:
```
  const ledger = extractFileLedger(messages, remove); // GOTCHA #7: remove = message indices
  return { ledger, k: remove.length };
}
```
newText:
```
  const ledger = extractFileLedger(messages, remove); // GOTCHA #7: remove = message indices
  // Pin the STABLE ENTRY ids of the removed messages (fix_design.md §Change 2): the removal set is resolved ONCE
  // against this current snapshot (the correct session state); the captured entry ids are stable forever, so the
  // filter can re-resolve them by identity every later fire (permanent hiding — BUG-001/002 fix).
  const hideEntryIds = captureHideEntryIds(entries, remove);
  return { ledger, k: remove.length, hideEntryIds };
}
```

**Task 4b — `rewindExecute` step-5 destructure + catch default** (`edit` tool):

oldText:
```
    let ledger: FileLedger;
    let k: number;
    try {
      ({ ledger, k } = resolvePreview(ctx, params, toolCallId));
    } catch {
      ledger = emptyLedger();
      k = 0;
    }
```
newText:
```
    let ledger: FileLedger;
    let k: number;
    let hideEntryIds: string[];
    try {
      ({ ledger, k, hideEntryIds } = resolvePreview(ctx, params, toolCallId));
    } catch {
      // Snapshot/resolution failure → best-effort: empty ledger + K=0 + hideEntryIds=[] + STILL proceed (E13/E8).
      // (captureHideEntryIds itself doesn't try/catch — a throw inside resolvePreview lands here.)
      ledger = emptyLedger();
      k = 0;
      hideEntryIds = [];
    }
```

**Task 4c — `rewindExecute` step-7 payload** (`edit` tool). NOTE: the `as RewindMarkerInput` cast STAYS (GOTCHA #1).

oldText:
```
    const payload = {
      granularity,
      options: { to_previous_prompt: params.to_previous_prompt, protect: config.rewind.protectedRoles },
      excludeToolCallId: toolCallId,
      note: params.note,
      ledger,
      checkpoint: params.checkpoint, // GOTCHA #1: persists even when undefined; spec/04 §3 omits it (cast below)
    };
```
newText:
```
    const payload = {
      granularity,
      options: { to_previous_prompt: params.to_previous_prompt, protect: config.rewind.protectedRoles },
      excludeToolCallId: toolCallId,
      note: params.note,
      ledger,
      // fix_design.md §Change 2: the stable ENTRY ids pinned for permanent hiding. Typed on RewindMarkerInput
      // (P1.M2.T1.S1), so NO cast needed for THIS field — the `as RewindMarkerInput` cast below stays only for
      // `checkpoint` (GOTCHA #1 — spec/04 §3 omits it; it rides the spread). The wrapper's {...data} persists it.
      hideEntryIds,
      checkpoint: params.checkpoint, // GOTCHA #1: persists even when undefined; spec/04 §3 omits it (cast below)
    };
```

**Task 4d — `rewindExecute` step-9 success details** (`edit` tool):

oldText:
```
    const { text } = successText(granularity, k, hasWarning);
    return {
      content: [{ type: "text", text }],
      details: { granularity, k, ledger, markerId },
    };
```
newText:
```
    const { text } = successText(granularity, k, hasWarning);
    return {
      content: [{ type: "text", text }],
      details: { granularity, k, ledger, hideEntryIds, markerId },
    };
```

#### Exact edits — `test/tools/rewind.test.ts` (Task 5 — APPEND)

Append the following to the END of `test/tools/rewind.test.ts`. (The `msgEntry`/`asst`/`result`/`user` helpers,
`makePi`/`makeCtx` fakes, and `beforeEach`/`afterEach` are already defined above in the file — reuse them. `RewindMarker`
is already imported.) The `msgEntryId` helper is the ONLY new fixture (deterministic ids — GOTCHA #8).

```ts
// ── hideEntryIds capture (fix_design.md §Change 2; PRODUCER half of permanent hiding — BUG-001/002) ──────

/** Like msgEntry but with a DETERMINISTIC id (needed to assert which entry ids were captured). Mirrors msgEntry's shape. */
function msgEntryId(id: string, message: Record<string, unknown>): { type: "message"; id: string; message: Record<string, unknown> } {
  return { type: "message", id, message };
}

describe("mulligan_rewind — hideEntryIds capture (fix_design.md §Change 2; permanent-hiding producer)", () => {
  it("last_tool_call_group → hideEntryIds === the removed toolGroup's entry ids (the X group; NOT the rewind's own, NOT the user)", async () => {
    const { appended, pi } = makePi();
    // snapshot: u(e_u), asst(X)(e_X), result(X)(e_rX), asst(call-1)(e_rw), result(call-1)(e_rrw).
    // last_tool_call_group excludes the rewind's OWN group (call-1) → resolves the X group → remove=[1,2] → K=2.
    const { ctx } = makeCtx({
      contextEntries: [
        msgEntryId("e_u", user("u")),
        msgEntryId("e_X", asst("X")),
        msgEntryId("e_rX", result("X")),
        msgEntryId("e_rw", asst("call-1")),
        msgEntryId("e_rrw", result("call-1")),
      ],
    });
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" }, "call-1");
    expect(appended).toHaveLength(1);
    const entry = appended[0].data as RewindMarker;
    // the removed messages are at indices 1,2 → their entries are e_X, e_rX (the whole bad toolGroup)
    expect(entry.hideEntryIds).toEqual(["e_X", "e_rX"]);
    expect(entry.hideEntryIds).not.toContain("e_u"); // user kept
    expect(entry.hideEntryIds).not.toContain("e_rw"); // rewind's own assistant kept
    expect(entry.hideEntryIds).not.toContain("e_rrw"); // rewind's own result kept
    // result audit surface carries the same ids
    expect(res.details.hideEntryIds).toEqual(["e_X", "e_rX"]);
    expect(res.details.k).toBe(2);
  });

  it("last_turn → hideEntryIds === the BAD toolGroup's entry ids (rewind's own unit kept)", async () => {
    const { appended, pi } = makePi();
    // snapshot: u(e_u), asst(BAD)(e_bad), result(BAD)(e_rbad), asst(call-1)(e_rw), result(call-1)(e_rrw).
    // last_turn removes everything after the last user msg (idx 0) EXCEPT the rewind's own unit + notes → remove=[1,2].
    const { ctx } = makeCtx({
      contextEntries: [
        msgEntryId("e_u", user("please do X")),
        msgEntryId("e_bad", asst("BAD")),
        msgEntryId("e_rbad", result("BAD")),
        msgEntryId("e_rw", asst("call-1")),
        msgEntryId("e_rrw", result("call-1")),
      ],
    });
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_turn" }, "call-1");
    const entry = appended[0].data as RewindMarker;
    expect(entry.hideEntryIds).toEqual(["e_bad", "e_rbad"]);
    expect(entry.hideEntryIds).not.toContain("e_rw");
    expect(entry.hideEntryIds).not.toContain("e_rrw");
    expect(res.details.hideEntryIds).toEqual(["e_bad", "e_rbad"]);
  });

  it("K=0 (only the rewind's own group in the snapshot) → remove=[] → hideEntryIds === [] (PRESENT, not undefined)", async () => {
    const { appended, pi } = makePi();
    // snapshot: only the rewind's own group → resolveLastToolCallGroup returns null → remove=[] → K=0.
    const { ctx } = makeCtx({
      contextEntries: [msgEntryId("e_rw", asst("call-1")), msgEntryId("e_rrw", result("call-1"))],
    });
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" }, "call-1");
    expect(res.details.k).toBe(0);
    const entry = appended[0].data as RewindMarker;
    expect(Array.isArray(entry.hideEntryIds)).toBe(true); // present (every new marker has it)
    expect(entry.hideEntryIds).toEqual([]);
    expect(res.details.hideEntryIds).toEqual([]);
  });

  it("snapshot failure (buildContextEntries throws) → catch → hideEntryIds === [] + marker STILL persisted", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ throwOnBuildContext: true });
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" });
    expect(firstText(res)).toContain("Mulligan: rewound");
    expect(appended).toHaveLength(1); // marker persisted despite the preview failure
    const entry = appended[0].data as RewindMarker;
    expect(entry.hideEntryIds).toEqual([]); // best-effort: nothing captured
    expect(res.details.hideEntryIds).toEqual([]);
    expect(res.details.ledger).toEqual({ readFiles: [], modifiedFiles: [], bashSideEffects: [] });
    expect(res.details.k).toBe(0);
  });

  it("every persisted success marker HAS a hideEntryIds array (the contract: 'every new rewind marker has hideEntryIds populated')", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({
      contextEntries: [
        msgEntryId("e_u", user("u")),
        msgEntryId("e_X", asst("X")),
        msgEntryId("e_rX", result("X")),
        msgEntryId("e_rw", asst("call-1")),
        msgEntryId("e_rrw", result("call-1")),
      ],
    });
    await run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" }, "call-1");
    expect(appended).toHaveLength(1);
    expect(Array.isArray((appended[0].data as RewindMarker).hideEntryIds)).toBe(true);
  });

  it("hideEntryIds order follows entry order (root→leaf cursor walk) and is deterministic for the same snapshot", async () => {
    const { appended, pi } = makePi();
    const snap = [
      msgEntryId("e_u", user("u")),
      msgEntryId("e_A", asst("A")),
      msgEntryId("e_rA", result("A")),
      msgEntryId("e_B", asst("B")),
      msgEntryId("e_rB", result("B")),
      msgEntryId("e_rw", asst("call-1")),
      msgEntryId("e_rrw", result("call-1")),
    ];
    const { ctx } = makeCtx({ contextEntries: snap });
    // last_tool_call_group excludes call-1 → resolves the B group (most-recent non-excluded) → remove=[3,4]
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" }, "call-1");
    expect(res.details.k).toBe(2);
    expect((appended[0].data as RewindMarker).hideEntryIds).toEqual(["e_B", "e_rB"]); // root→leaf order
  });
});

describe("mulligan_rewind — RewindDetails.hideEntryIds type (fix_design.md §Change 2 audit surface)", () => {
  it("RewindDetails has hideEntryIds?: string[]", () => {
    expectTypeOf<RewindDetails>().toMatchTypeOf<{ hideEntryIds?: string[] }>();
  });
});
```

### Implementation Patterns & Key Details

```ts
// PATTERN: captureHideEntryIds aligns BY CONSTRUCTION (GOTCHA #2). resolvePreview builds:
//   const entries = ctx.sessionManager.buildContextEntries();
//   const messages = entries.flatMap(sessionEntryToContextMessages(e));
// captureHideEntryIds walks the SAME entries reproducing the flatMap (cursor += sessionEntryToContextMessages(e).length),
// so entry e ↔ messages[cursor..cursor+yield) is exact. The index→id mapping can NEVER drift from messages.
function captureHideEntryIds(entries: SessionEntry[], remove: readonly number[]): string[] {
  if (!Array.isArray(entries) || !Array.isArray(remove)) return [];        // light guard (GOTCHA #4 — no try/catch)
  const removeSet = new Set<number>(remove);                              // O(1) lookup (== remove.includes, identical result)
  const ids: string[] = [];
  let cursor = 0;
  for (const e of entries) {
    const y = sessionEntryToContextMessages(e).length;                    // typically 1
    for (let j = cursor; j < cursor + y; j++) {
      if (removeSet.has(j)) { if (e.id) ids.push(e.id); break; }          // capture each entry once (GOTCHA #6)
    }
    cursor += y;
  }
  return ids;
}
// GOTCHA #1: payload cast `as RewindMarkerInput` STAYS (checkpoint forces it). GOTCHA #5: always set hideEntryIds (even []).
// GOTCHA #7: SessionEntry is a TYPE import on the existing Pi line. GOTCHA #10: additive only — 40 existing tests stay green.
```

### Integration Points

```yaml
EDITS (this task — confined to src/tools/rewind.ts + test/tools/rewind.test.ts):
  - src/tools/rewind.ts:  +type SessionEntry import; +captureHideEntryIds helper; resolvePreview +{hideEntryIds};
                          rewindExecute +destructure/catch/payload/details; RewindDetails +hideEntryIds?: string[].
  - test/tools/rewind.test.ts: +msgEntryId helper; +hideEntryIds describe block.

PERSISTENCE (NO edit — already correct):
  - src/markers.ts appendRewindMarker: `{ ...data, schema, v:1, kind, id, seq, ts }` spread persists hideEntryIds unchanged.

DOWNSTREAM CONSUMERS (LATER/landed subtasks — do NOT implement here):
  - P1.M2.T2 (resolvePinnedHide, transforms.ts:625 — LANDED): the resolver; reads hideEntryIds as a plain string[] param.
  - P1.M2.T4 (filterPipeline dispatch, transforms.ts — PLANNED): readOwn(rw,"hideEntryIds"); if non-empty → resolvePinnedHide else legacy.

NO DATABASE / NO ROUTES / NO CONFIG / NO NEW DEPS — purely additive threading of one field through the rewind tool +
its result surface. SessionEntry is a TYPE import on the existing Pi line (no new dep source). No spec-doc change
(P1.M4 owns spec/06 sync). No Pi BEHAVIOR change (the tool still resolves + persists exactly as before; it now also
records the entry ids).
```

---

## Validation Loop

### Level 1: Type-safety & scope gates (run after Tasks 1–4)

```bash
# Type-check the whole project (the threaded field + helper must be type-sound under strict):
npx tsc --noEmit -p tsconfig.json          # MUST exit 0

# The helper exists (1 def + ≥1 call site) and is module-local (NOT exported):
grep -c "function captureHideEntryIds" src/tools/rewind.ts        # expect 1 (the definition)
grep -c "captureHideEntryIds(entries, remove)" src/tools/rewind.ts # expect 1 (the call site in resolvePreview)
grep -c "export function captureHideEntryIds" src/tools/rewind.ts # expect 0 (module-local, NOT exported)

# hideEntryIds is threaded through the 4 seams:
grep -c "hideEntryIds" src/tools/rewind.ts   # expect ≥6 (import? no — RewindDetails field, resolvePreview return + call + literal, rewindExecute let + destructure + catch + payload + details)

# SessionEntry is a TYPE import on the existing Pi line (no new import SOURCE):
grep -c "type SessionEntry" src/tools/rewind.ts   # expect 1

# Expected: tsc exit 0; helper defined once + called once + NOT exported; hideEntryIds in ≥6 places; SessionEntry type-imported once.
```

### Level 2: Unit tests (run after all edits)

```bash
# The directly-relevant suite (existing 40 + new hideEntryIds tests):
npx vitest run test/tools/rewind.test.ts            # MUST be all-green

# Full regression — hideEntryIds is additive; NOTHING else should change:
npx vitest run                                       # MUST be all-green (676 + new; zero regressions)

# Expected: every test green. If a PRE-EXISTING test fails, you almost certainly edited something out of scope
#   (e.g. the removal-resolution math, the payload cast, or a refusal path) — revert and re-read GOTCHA #10.
```

### Level 3: Integration / runtime (N/A for this producer task)

This task adds a PRODUCER (capture + persist entry ids). The actual permanent-hiding ACROSS FIRES — "rewind, resume
work, assert the originally-hidden content is STILL absent on every later context.fire" — is the RESOLVER +
DISPATCH + regression-test surface (P1.M2.T2 landed, P1.M2.T4 Planned, P1.M3 regression tests). My task's
"integration" is: the marker CARRIES the right ids (asserted in Level 2). Nothing to run at the Pi-runtime level here.

### Level 4: Creative / domain-specific validation (optional hand-trace)

```bash
# Optional: hand-trace the pinned scenario to confirm the index→id mapping is exact.
# snapshot: [u(e_u), asst(X)(e_X), result(X)(e_rX), asst(call-1)(e_rw), result(call-1)(e_rrw)]  (5 entries, 5 msgs)
# toolCallId = "call-1"; last_tool_call_group excludes call-1's group → resolveLastToolCallGroup → remove=[1,2] (the X group)
# captureHideEntryIds: cursor=0
#   e_u: y=1, j=0 not in {1,2}; cursor=1
#   e_X: y=1, j=1 IN {1,2} → push "e_X", break; cursor=2
#   e_rX: y=1, j=2 IN {1,2} → push "e_rX", break; cursor=3
#   e_rw: y=1, j=3 not in {1,2}; cursor=4
#   e_rrw: y=1, j=4 not in {1,2}; cursor=5
# → hideEntryIds=["e_X","e_rX"]  ✓ (matches the Level-2 test assertion)
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] `npx vitest run` is fully green (676 existing + new hideEntryIds tests; zero regressions).
- [ ] `captureHideEntryIds` defined once, called once, NOT exported (module-local).
- [ ] `type SessionEntry` imported once (TYPE-only, existing Pi import line).
- [ ] `hideEntryIds` threaded through: resolvePreview return + call + literal; rewindExecute let + destructure + catch + payload + details; RewindDetails field.

### Feature Validation

- [ ] **last_tool_call_group**: marker `hideEntryIds` === the removed toolGroup's entry ids (X group); user + rewind's-own NOT included.
- [ ] **last_turn**: marker `hideEntryIds` === the BAD toolGroup's entry ids (rewind's own unit kept).
- [ ] **K=0**: `hideEntryIds === []` (present, not undefined).
- [ ] **snapshot failure**: catch → `hideEntryIds === []`; marker STILL persisted.
- [ ] `res.details.hideEntryIds` mirrors the marker's `hideEntryIds` on the success path.
- [ ] `RewindDetails` has `hideEntryIds?: string[]` (type assertion).
- [ ] The 40 existing rewind tests are UNCHANGED and still green (additive only — GOTCHA #10).

### Code Quality Validation

- [ ] Mirrors the existing module-local-helper style (`countRewindMarkers`, `checkpointExists`, `resolvePreview`).
- [ ] `captureHideEntryIds` aligns by construction (reuses `entries` resolvePreview built — GOTCHA #2/#3).
- [ ] No per-entry try/catch (relies on rewindExecute's outer catch — GOTCHA #4).
- [ ] `hideEntryIds` always set on new markers (even [] — GOTCHA #5).
- [ ] Mode-A JSDoc on `captureHideEntryIds`, `resolvePreview` return, step 7, and the `RewindDetails` field.
- [ ] Anti-patterns avoided (see below).

### Documentation & Deployment

- [ ] JSDoc documents the capture algorithm, the exact-by-construction alignment, and the permanent-hiding rationale.
- [ ] No spec-doc change required here (P1.M4 owns spec/06 sync).
- [ ] No new environment variables; no new deps (SessionEntry is a type import on the existing Pi line).

---

## Anti-Patterns to Avoid

- ❌ **Re-deriving `entries` or `remove` inside `captureHideEntryIds`** — both are already in scope in `resolvePreview`; pass them in (GOTCHA #3).
- ❌ **Adding per-entry try/catch in `captureHideEntryIds`** — it risks cursor misalignment; rely on rewindExecute's outer catch (GOTCHA #4).
- ❌ **Removing the `as RewindMarkerInput` cast** — `checkpoint` still needs it (it's not in the frozen type). Adding `hideEntryIds` does NOT remove the cast (GOTCHA #1).
- ❌ **Exporting `captureHideEntryIds`** — it's module-local, tested via the execute path (like the other preview helpers).
- ❌ **Omitting `hideEntryIds` on the catch path or for K=0** — the contract says every new marker has it; set `[]` (GOTCHA #5).
- ❌ **Storing message INDICES instead of entry ids** — indices shift on compaction; ids are stable (the whole point of the fix).
- ❌ **Mutating the existing `msgEntry` fixture** — add `msgEntryId` instead (GOTCHA #8); 40 tests rely on `msgEntry`'s signature.
- ❌ **Touching `transforms.ts` / `markers.ts`** — out of scope (resolvePinnedHide/filterPipeline/RewindMarkerLike = P1.M2.T2/T4; the field + wrapper = P1.M2.T1 landed).
- ❌ **Inventing a lint/format command** — none is configured; the gate is `tsc` + `vitest` (GOTCHA #9).

---

## Confidence Score

**9/10** for one-pass implementation success. The change is purely additive threading of one field through a
well-understood tool (resolvePreview already computes the exact `entries` + `remove`; captureHideEntryIds maps them
by construction), all three upstream pieces are verified landed on disk, the Pi types are verified (`SessionEntry.id:
string`, exported), and every edit is given as exact oldText/newText + a hand-traced test block. The −1 is for the
one subtlety a careless implementer could trip on: the `payload as RewindMarkerInput` cast must STAY (checkpoint
still needs it) even though `hideEntryIds` itself is now typed — GOTCHA #1 spells this out.

**Confidence Score**: 9/10