# PRP — P1.M1.T1.S2: `cancelExecute` target resolution (M1 cancel-by-target, step 2/3)

---

## Goal

**Feature Goal**: Rewrite **step 3** of `cancelExecute` in `src/tools/cancel.ts` so that the agent can identify the marker to retire **by `target`** (the same hint shape `mulligan_shrink` uses) in addition to the existing explicit-`markerId` path. The target path resolves the hint → a matched message → the **most recent active rewind/shrink whose effect covers that message** (LIFO by `seq`) → that marker's uuid `data.id`, which then feeds the **unchanged** steps 4–7 (not-found no-op, already-cancelled idempotency, `appendCancelMarker`, return). This is the execute-body half of the cancel-by-target headline change (S1 shipped the schema + DESC; S3 ships the target-behavior tests).

**Deliverable**: In `src/tools/cancel.ts` — (1) two new imports (`sessionEntryToContextMessages` from the pi package; `resolveShrinkTarget` + the `ShrinkTarget`/`MessageLike` types from `../transforms.js`), (2) a local `entryIdAtMessageIndex(entries, index)` helper (~15 lines, verbatim clone of `shrink.ts`'s private helper), (3) a local `resolveTargetUuid(ctx, entries, target)` helper containing the inlined message-snapshot build + covering scan, (4) the rewritten step 3 inside `cancelExecute` (markerId-wins ordering: markerId path verbatim → else target path → else fallthrough no-op), (5) updated JSDoc on `cancelExecute` describing the target resolution path. **Steps 1, 2, 4, 5, 6, 7 are UNCHANGED.** No new files; no test changes in S2 (S3 owns the target-behavior tests).

**Success Definition**:
- `npx tsc --noEmit` — NO new errors originate from `src/tools/cancel.ts`.
- `npx vitest run test/tools/cancel.test.ts` — all existing tests pass (they use the markerId path, which is preserved verbatim; the target path is never invoked by them).
- `npx vitest run` — full suite passes (no regressions).
- The target path resolves `params.target` → covering marker → uuid via the SAME pure resolver (`resolveShrinkTarget`) and the SAME snapshot idiom (`buildContextEntries().flatMap(sessionEntryToContextMessages)`) that `shrink.ts` uses.

## User Persona (if applicable)

**Target User**: The coding agent (LLM) that calls `mulligan_cancel`, and the S3 implementer who writes the target-behavior tests.

**Use Case**: The agent issued a mis-targeted rewind/shrink and retracts it BY TARGET — `mulligan_cancel({ target: { by_tool_name: "read", occurrence: "last" } })` — because the toolkit's own shrink/rewind can hide the message that carried the opaque `markerId`. The explicit `markerId` path remains for hosts that surface `details.markerId`.

**User Journey**: agent passes `target` → `cancelExecute` builds the message snapshot → `resolveShrinkTarget` finds the matched message → covering scan finds the most-recent rewind/shrink affecting it → reads its uuid → steps 5–7 append the cancel and confirm. On the next `context` fire, `readMarkers` drops the retired marker (filter-side, already implemented).

**Pain Points Addressed**: An id captured at issue-time is fragile by construction (the carrying message can be hidden/shrunk). A content/role `target` hint re-resolves live each turn — the same compaction-robustness `mulligan_shrink` already enjoys.

## Why

- **Business value / user impact**: This is the BEHAVIOR half of the headline cancel-by-target change (M1). S1 made the schema accept `target`; S2 makes the execute body actually resolve it. After S2 (+ S3 tests), the agent can robustly retract a mistaken marker without tracking an opaque, possibly-hidden id. The master `enabled` gate, idempotency, and fail-open contract are all preserved.
- **Integration with existing features**: Reuses `resolveShrinkTarget` (transforms.ts:758, the SAME pure resolver `mulligan_shrink` uses) and the SAME compaction-aware snapshot idiom (`buildContextEntries().flatMap(sessionEntryToContextMessages)`) as `shrink.ts:resolveTargetEntryId`. The persisted `targetId` is still the marker's uuid `data.id` (NOT an entry id) — so `filter.ts`'s `readMarkers` cancel-drop logic is **UNCHANGED**.
- **Problems this solves and for whom**: For the agent: a compaction-proof way to name the marker to retract. For maintainers: one canonical target resolver shared by shrink + cancel (no second resolver).

## What

User-visible behavior: `mulligan_cancel` now resolves a `target` hint to the covering marker. The `markerId` path still works identically. Steps 4–7 (no-op / idempotency / persist / return) operate on the resolved uuid exactly as before.

### Success Criteria

- [ ] `cancelExecute` step 3 resolves via **markerId-wins ordering**: if `params.markerId` is a non-empty string → markerId path (verbatim current logic); else if `params.target` present → target path; else → fallthrough no-op.
- [ ] The target path: builds the snapshot via `ctx.sessionManager.buildContextEntries().flatMap(sessionEntryToContextMessages)`, resolves `params.target` via `resolveShrinkTarget` → matched index, then scans `entries` (the `getEntries()` result) for the most-recent covering rewind/shrink.
- [ ] SHRINK covers the matched index `i` iff resolving the shrink's OWN `data.target` against the snapshot yields `i`; REWIND covers `i` iff the matched message's entry id (via `entryIdAtMessageIndex`) is a member of the rewind's `data.hideEntryIds`. Highest `data.seq` wins (LIFO).
- [ ] A local `entryIdAtMessageIndex(entries, index)` helper exists (verbatim clone of `shrink.ts`'s private helper).
- [ ] Steps 1, 2, 4, 5, 6, 7 are byte-for-byte unchanged; the outer try/catch (E13) still wraps the whole body.
- [ ] `npx tsc --noEmit` no new errors from `cancel.ts`; `npx vitest run test/tools/cancel.test.ts` + `npx vitest run` pass.

## All Needed Context

### Context Completeness Check

_Before writing this PRP, validate: "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"_ — **YES.** This PRP contains the exact current `cancelExecute` (steps 1–7), the exact reference patterns from `shrink.ts` (`resolveTargetEntryId` + `entryIdAtMessageIndex`), the verified marker data shapes, the copy-pasteable new helpers + step-3 rewrite, and the resolved ordering/covering decisions. The S1 PRP (sibling) defines the `CancelParams` schema this builds on; this PRP treats it as a stable contract.

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: src/tools/cancel.ts
  why: "THE file being modified. cancelExecute is steps 1–7; step 3 (~the for-loop scanning entry.id===params.markerId) is what S2 rewrites. Steps 1 (config gate), 2 (getEntries fresh + try/catch→[]), 4 (not-found no-op), 5 (already-cancelled), 6 (appendCancelMarker), 7 (return) are UNCHANGED. readOwn/isRecord (LOCAL clones of filter.ts's, ~lines 150–175), refusal(), CancelDetails, makeCancelTool are UNCHANGED."
  pattern: "All entry/data field reads go through the local readOwn (a Proxy get-trap may throw → undefined → safe skip). Keep that discipline for EVERY new field read (data.target, data.hideEntryIds, data.seq, data.id)."
  gotcha: "After S1, CancelArgs = { target?: <union>; markerId?: string }. params.markerId is now `string | undefined` — the markerId path must guard `typeof params.markerId === 'string' && params.markerId.length > 0` (an empty/undefined markerId falls through to the target path, which is correct)."

- file: src/tools/shrink.ts
  why: "THE reference for the snapshot build + entryIdAtMessageIndex. resolveTargetEntryId (shrink.ts:215–225) is the 2-liner snapshot idiom to MIRROR (buildContextEntries().flatMap(sessionEntryToContextMessages) as unknown as MessageLike[]). entryIdAtMessageIndex (shrink.ts:187–200) is the cursor-walk helper to CLONE LOCALLY (~15 lines). shrink.ts's imports (lines 48–61) are the exact import block to mirror for sessionEntryToContextMessages + resolveShrinkTarget + ShrinkTarget + MessageLike."
  pattern: "function entryIdAtMessageIndex(entries, index) { guard → cursor=0 → for each e: y=sessionEntryToContextMessages(e).length; if index<cursor+y return entry id; cursor+=y → return null }"
  gotcha: "shrink.ts's entryIdAtMessageIndex is MODULE-PRIVATE (not exported). The item contract says CLONE it locally in cancel.ts (do NOT export from shrink.ts — that's a separate refactor). cancel.ts's clone should read entry.id via the LOCAL readOwn (more defensive than shrink's `(e as {id?:unknown}).id` — both work, readOwn matches cancel.ts's style)."

- file: src/transforms.ts
  why: "resolveShrinkTarget (line 758, EXPORTED, pure, Pi-free) is the resolver S2 reuses — returns a message INDEX or null. ShrinkTarget (line 728) + MessageLike (line 53) are the types to import. resolveShrinkTarget is defensive: non-array messages → null, non-record target → null, never throws."
  pattern: "resolveShrinkTarget(messages, target): number | null — by_tool_call_id→first toolResult match; by_tool_name+occurrence→last/first toolResult; by_content_includes→first message (any role) whose stringified content includes the needle."
  gotcha: "params.target is structurally identical to ShrinkTarget (S1 guarantee — GOTCHA #3 in the S1 PRP), so resolveShrinkTarget(messages, params.target) typechecks with NO cast. For a shrink marker's data.target (read via readOwn → unknown), cast `as ShrinkTarget` (unknown→ShrinkTarget is allowed via assertion; resolveShrinkTarget internally re-checks isRecord)."

- file: src/markers.ts
  why: "The marker DATA shapes the covering scan reads. RewindMarker.data (lines 54–82): {id(uuid), hideEntryIds?:string[], seq, ...}. ShrinkMarker.data (lines 106–127): {id(uuid), target:ShrinkTarget, pinnedEntryId?, seq, ...}. CancelMarker.data (lines 169–176): {targetId, seq} — NO id (a cancel isn't cancellable). appendCancelMarker (line 311) takes {targetId} and returns the entry id or null."
  pattern: "covering scan reads: entry.customType, entry.data.id (uuid), entry.data.target (shrink), entry.data.hideEntryIds (rewind), entry.data.seq — ALL via readOwn. customType ∈ {'mulligan:rewind','mulligan:shrink'} excludes notes/turn-metric/cancel automatically."
  gotcha: "hideEntryIds holds ENTRY ids (stable), NOT message indices — that's WHY we need entryIdAtMessageIndex to map the matched message index → its entry id before the membership check. hideEntryIds is OPTIONAL (absent on old markers / when capture failed) → a rewind with no hideEntryIds covers nothing (skip)."

- file: plan/005_95d30743cdd4/architecture/m1_cancel_target_resolution.md
  why: "The M1 design doc. §'Target resolution → marker uuid' specifies the covering rules (shrink: resolve own target; rewind: hideEntryIds membership) + LIFO-by-seq. §'Reading marker fields defensively' lists every field. §'Entry ID ↔ message index mapping' explains why entryIdAtMessageIndex is duplicated (private in shrink.ts). Recommends Option A (inline the 2-liner, clone the helper) — which this PRP follows."
  critical: "Confirms resolveShrinkTarget + sessionEntryToContextMessages + buildContextEntries are the verified reuse paths (no new resolver code). Confirms filter.ts cancel-drop is UNCHANGED (drops by uuid data.id)."

- file: test/tools/cancel.test.ts
  why: "Confirms S2's test-preservation bar. EVERY existing case calls run(pi, ctx, {markerId:'…'}) (cases at ~lines 212, 240, 257, 293, 325). makeCtx scripts getEntries() ONLY (NOT buildContextEntries). With markerId-wins ordering, these all take the markerId path → buildContextEntries is NEVER called → they pass unchanged. S3 (later) extends makeCtx to script buildContextEntries for the target-path tests."
  pattern: "fixture builders: makeRewindEntry(entryId, uuid, seq), makeShrinkEntry(entryId, uuid, seq), makeCancelEntry(targetId, seq). DISTINCT entry.id vs data.id(uuid) PROVES the uuid-not-entry-id mapping."
  gotcha: "Do NOT modify test/tools/cancel.test.ts in S2. The existing tests are the regression gate; target-behavior tests are S3 (P1.M1.T1.S3). If an existing test breaks, you have a bug in the markerId path (it must be byte-for-byte the old logic)."
```

### Current Codebase tree (run `tree` in the root of the project) to get an overview of the codebase

```bash
src/tools/
  cancel.ts     # ← MODIFY: step 3 rewrite + 2 new helpers (entryIdAtMessageIndex, resolveTargetUuid) + imports + JSDoc
  shrink.ts     # ← READ-ONLY reference (resolveTargetEntryId:215, entryIdAtMessageIndex:187, imports:48-61)
  rewind.ts, checkpoint.ts, audit.ts   # ← untouched
src/
  transforms.ts # ← READ-ONLY: resolveShrinkTarget:758, ShrinkTarget:728, MessageLike:53 (all EXPORTED)
  markers.ts    # ← READ-ONLY: marker data shapes (RewindMarker, ShrinkMarker, CancelMarker, appendCancelMarker)
  filter.ts     # ← UNCHANGED (readMarkers cancel-drop by uuid; already implemented)
test/tools/
  cancel.test.ts   # ← UNCHANGED in S2 (regression gate; target tests are S3)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. S2 MODIFIES exactly one source file (no test changes):
src/tools/cancel.ts   # + imports (sessionEntryToContextMessages, resolveShrinkTarget, ShrinkTarget, MessageLike)
                      # + local entryIdAtMessageIndex() helper (clone of shrink.ts's)
                      # + local resolveTargetUuid() helper (snapshot build + covering scan)
                      # + rewritten step 3 in cancelExecute (markerId-wins ordering)
                      # + updated cancelExecute JSDoc (target resolution path)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 (THE ordering decision — read Decision D1 in full). Spec §5 step 3 says "preferred target,
//   fallback markerId" BUT ALSO "markerId wins if both given". These tension ONLY when both are present.
//   RESOLUTION (D1): markerId is AUTHORITATIVE whenever it is a non-empty string — `if (typeof params.markerId ===
//   "string" && params.markerId.length > 0) { markerId path } else if (params.target) { target path }`. This
//   honors "markerId wins" literally AND preserves every existing test (they all pass a non-empty markerId →
//   markerId path → buildContextEntries is NEVER called → makeCtx need not script it). "Preferred target" just
//   means target is the documented primary mechanism (most agents lack a markerId).

// CRITICAL GOTCHA #2 (the markerId path must be byte-for-byte the OLD step-3 logic). The existing tests assert
//   exact targetId values (uuid, NOT entry id), exact no-op text, and appendEntry-not-called. If you refactor the
//   markerId loop (e.g. extract it, change the break, reorder conditions) you risk a regression. KEEP the markerId
//   scan identical: for each entry, skip if readOwn(e,"id")!==markerId, skip if customType not in {rewind,shrink},
//   read data.id uuid, set targetUuid, break. Only the SURROUNDING branching (the new if/else) changes.

// CRITICAL GOTCHA #3 (buildContextEntries vs getEntries are DIFFERENT surfaces — use BOTH). Markers (the
//   mulligan:rewind/shrink/cancel custom entries) live in getEntries() (raw). The message SNAPSHOT (what
//   resolveShrinkTarget resolves against) comes from buildContextEntries() (compaction-aware — custom control
//   entries do NOT produce context messages, so markers are NOT in the snapshot). entryIdAtMessageIndex MUST walk
//   the SAME snapshotEntries that built messages (exact alignment by construction). Do NOT pass getEntries() to
//   entryIdAtMessageIndex — alignment would break and the rewind hideEntryIds membership check would be wrong.

// CRITICAL GOTCHA #4 (hideEntryIds are ENTRY ids, NOT message indices). A rewind's data.hideEntryIds holds the
//   stable entry ids of the hidden messages (captured at rewind-creation). To check whether the matched message
//   (index i) is in a rewind's hidden span, you MUST map i → its entry id via entryIdAtMessageIndex(snapshotEntries,
//   i), THEN check membership in hideEntryIds. Checking `hideEntryIds.includes(i)` (a number) would ALWAYS be false.
//   A rewind with no/absent hideEntryIds covers nothing (skip).

// CRITICAL GOTCHA #5 (resolve the shrink's OWN data.target for the covering check — LIVE, not pinned). A shrink
//   covers index i iff resolving ITS data.target against the SAME snapshot yields i. Do NOT use pinnedEntryId for
//   the covering check — pinnedEntryId is the FILTER's identity-lock (resolvePinnedShrink); cancel wants LIVE
//   resolution (same compaction-robustness as the target itself). read shrinkTarget via readOwn(data,"target"),
//   cast `as ShrinkTarget`, call resolveShrinkTarget(messages, shrinkTarget), compare === matchedIndex.

// CRITICAL GOTCHA #6 (LIFO by seq — highest data.seq wins). Among covering markers, the latest-issued one is the
//   likely mistake (the agent just made it). Read data.seq via readOwn; coerce non-finite/non-number to 0 (a real
//   marker always has a stamped seq, so 0 only affects a malformed marker — it loses to any well-formed one). Track
//   bestUuid + bestSeq; replace when seqNum > bestSeq (strict > → first-found wins ties, acceptable).

// CRITICAL GOTCHA #7 (NEVER throw — the new helpers are wrapped). resolveTargetUuid has its OWN try/catch → null
//   (a throwing buildContextEntries/sessionEntryToContextMessages/resolveShrinkTarget → null → step 4 no-op). The
//   outer cancelExecute try/catch (E13) ALSO covers it as belt-and-suspenders. entryIdAtMessageIndex catches a
//   throwing sessionEntryToContextMessages → null (alignment indeterminate → no-cover). A malformed/unreadable
//   marker is SKIPPED (no uuid / unreadable target / unreadable seq), never throws.

// CRITICAL GOTCHA #8 (the persisted targetId is STILL the uuid data.id, NEVER an entry id). Both paths resolve to
//   the marker's uuid data.id; steps 5–7 operate on that uuid unchanged. filter.ts readMarkers drops by uuid ∈
//   cancelledIds — forwarding an entry id would make the cancel a permanent no-op (PROVEN by the distinct-fixture
//   tests). The target path reads the SAME data.id field the markerId path does.

// CRITICAL GOTCHA #9 (ESM imports — mirror shrink.ts:48-61 EXACTLY). Add `sessionEntryToContextMessages` to the
//   @earendil-works/pi-coding-agent destructure (it IS re-exported — dist/index.d.ts:19). Add `import { resolveShrinkTarget }
//   from "../transforms.js";` + `import type { ShrinkTarget, MessageLike } from "../transforms.js";` (the .js
//   extension + the value/type split match shrink.ts). transforms.ts is Pi-free (0 imports) → NO circular dep.

// CRITICAL GOTCHA #10 (the `as unknown as MessageLike[]` double-cast is REQUIRED). sessionEntryToContextMessages
//   returns Pi's AgentMessage[]; transforms.ts MessageLike is a Pi-free structural type. The assignment requires
//   `entries.flatMap((e) => sessionEntryToContextMessages(e)) as unknown as MessageLike[]` — the EXACT cast shrink.ts:220
//   uses. Omitting it is a tsc error (AgentMessage[] is not nominally MessageLike[]).

// CRITICAL GOTCHA #11 (scope — S2 is the execute body + helpers ONLY). Do NOT modify CancelParams/CANCEL_DESC/
//   CancelArgs (S1), do NOT write target-behavior tests (S3), do NOT touch filter.ts/markers.ts/transforms.ts/
//   config.ts/shrink.ts/rewind.ts, do NOT change makeCancelTool/CancelDetails/refusal()/readOwn/isRecord. The
//   schema (S1) and the filter drop-logic are stable contracts S2 consumes.
```

## Implementation Blueprint

### Data models and structure

**No data-model change.** S2 reuses the existing marker shapes (`RewindMarker.data.hideEntryIds`, `ShrinkMarker.data.target`, both markers' `data.id` + `data.seq`) and the existing `CancelMarker`/`appendCancelMarker` contract. The only new "structure" is two local helper functions + the step-3 branching. `CancelArgs` (from S1) is the input: `{ target?: ShrinkTarget-shaped-union; markerId?: string }`.

```typescript
// The structural handoff S2 depends on (S1 guarantee): CancelArgs.target ≡ ShrinkTarget.
// resolveShrinkTarget(messages, params.target) typechecks with NO cast because of this.
// params.target is `undefined` when absent → guarded by `else if (params.target)` before resolution.
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/tools/cancel.ts — add the imports (mirror shrink.ts:48-61)
  - ADD `sessionEntryToContextMessages` to the EXISTING @earendil-works/pi-coding-agent destructure:
      import {
        defineTool,
        sessionEntryToContextMessages,   // NEW (S2) — SessionEntry → AgentMessage[] for the target snapshot
        type AgentToolResult,
        type ExtensionAPI,
        type ExtensionContext,
        type SessionEntry,
        type ToolDefinition,
      } from "@earendil-works/pi-coding-agent";
  - ADD (after the markers.js/config.js imports):
      import { resolveShrinkTarget } from "../transforms.js"; // pure resolver (Pi-free; no circular dep) — NEW (S2)
      import type { ShrinkTarget } from "../transforms.js";   // ≡ markers.ts ShrinkTarget ≡ CancelParams.target — NEW (S2)
      import type { MessageLike } from "../transforms.js";    // Pi-free structural message type — NEW (S2)
  - GOTCHA: transforms.ts is Pi-free (0 imports) → importing it into cancel.ts creates NO circular dependency
    (shrink.ts already does this — transforms.ts:59 comment). Keep the value/type split (resolveShrinkTarget is a
    value; ShrinkTarget/MessageLike are types).
  - DEPENDENCIES: S1's cancel.ts (CancelParams already accepts target).

Task 2: MODIFY src/tools/cancel.ts — add local entryIdAtMessageIndex helper (clone of shrink.ts:187-200)
  - ADD (module-private, near the existing readOwn/isRecord helpers):
      /**
       * entryIdAtMessageIndex — map a resolved MESSAGE index back to the ENTRY id of the snapshot entry that
       * produced it (verbatim clone of shrink.ts's module-private helper — it is not exported there). Cursor-walks
       * `entries` using the SAME entries.flatMap(sessionEntryToContextMessages) mapping that built `messages`, so
       * entry↔messages[cursor..cursor+yield) is EXACT BY CONSTRUCTION (no position math). Returns null on no-match
       * / a non-string/empty entry id / a throwing mapping (defensive). Used by the cancel target path to check
       * rewind hideEntryIds membership (hideEntryIds hold ENTRY ids, not message indices — GOTCHA #4).
       */
      function entryIdAtMessageIndex(entries: SessionEntry[], index: number): string | null {
        if (!Array.isArray(entries) || typeof index !== "number" || !Number.isFinite(index) || index < 0) return null;
        let cursor = 0;
        for (const e of entries) {
          let y: number;
          try {
            y = sessionEntryToContextMessages(e).length; // typically 1 (message/custom_message/branch_summary)
          } catch {
            return null; // a throwing mapping → alignment indeterminate → null (safe no-cover, E13)
          }
          if (index < cursor + y) {
            const id = readOwn(e, "id");
            return typeof id === "string" && id.length > 0 ? id : null;
          }
          cursor += y;
        }
        return null;
      }
  - NAMING: entryIdAtMessageIndex (matches shrink.ts verbatim). Parameters `entries` + `index`.
  - GOTCHA: shrink.ts's version reads `(e as { id?: unknown }).id`; this clone uses the LOCAL readOwn(e,"id")
    (more defensive; matches cancel.ts's readOwn-everywhere discipline). Both are correct.
  - DEPENDENCIES: Task 1 (sessionEntryToContextMessages import) + the existing readOwn helper.

Task 3: MODIFY src/tools/cancel.ts — add local resolveTargetUuid helper (snapshot build + covering scan)
  - ADD (module-private, above cancelExecute):
      /**
       * resolveTargetUuid — the TARGET path of step 3 (spec/05 §5 step 3, target-preferred). Resolves params.target
       * against the compaction-aware message snapshot → matched message index → the MOST RECENT active rewind/shrink
       * whose effect COVERS that message (LIFO by seq) → that marker's uuid data.id. Returns null when target matches
       * nothing OR no active marker covers it (→ step 4 no-op). Mirrors shrink.ts:resolveTargetEntryId's snapshot
       * build (INLINED here — NOT a shared cross-file helper) + the entryIdAtMessageIndex cursor-walk.
       *
       * COVERING RULES (spec/05 §5 step 3):
       *  - SHRINK covers index i: resolving the shrink's OWN data.target against the SAME snapshot yields i (live
       *    resolution — compaction-robust; NOT pinnedEntryId, which is the filter's identity-lock — GOTCHA #5).
       *  - REWIND covers index i: the matched message's entry id (entryIdAtMessageIndex) is a member of the rewind's
       *    data.hideEntryIds (GOTCHA #4 — hideEntryIds hold ENTRY ids, not message indices).
       *  - LIFO: among covering markers, the one with the HIGHEST data.seq wins (latest-issued = likely mistake).
       *  - Malformed markers (no/empty uuid, unreadable target/hideEntryIds/seq) are SKIPPED — never throws.
       */
      function resolveTargetUuid(
        ctx: ExtensionContext,
        entries: SessionEntry[],
        target: ShrinkTarget,
      ): string | null {
        try {
          // (i) build the message snapshot (mirror shrink.ts:resolveTargetEntryId — INLINED, not a shared helper).
          const snapshotEntries = ctx.sessionManager.buildContextEntries();
          const messages = snapshotEntries.flatMap((e) => sessionEntryToContextMessages(e)) as unknown as MessageLike[];
          // (ii) resolve params.target → matched message index (the SAME pure resolver shrink uses).
          const matchedIndex = resolveShrinkTarget(messages, target);
          if (matchedIndex === null) return null; // target matched nothing → no covering marker
          // (iii) map the matched message index → its entry id (for the rewind hideEntryIds membership check).
          const matchedEntryId = entryIdAtMessageIndex(snapshotEntries, matchedIndex);
          // (iv) collect covering markers (active rewind/shrink) + pick the most recent by seq (LIFO).
          let bestUuid: string | null = null;
          let bestSeq = -Infinity;
          for (const e of entries) {
            const ct = readOwn(e, "customType");
            if (ct !== "mulligan:rewind" && ct !== "mulligan:shrink") continue; // excludes notes/turn-metric/cancel
            const data = readOwn(e, "data");
            const uuid = readOwn(data, "id");
            if (typeof uuid !== "string" || uuid.length === 0) continue; // malformed marker → skip
            let covers = false;
            if (ct === "mulligan:shrink") {
              const shrinkTarget = readOwn(data, "target");
              const resolved = resolveShrinkTarget(messages, shrinkTarget as ShrinkTarget);
              covers = resolved === matchedIndex; // SHRINK: own target resolves to the matched index
            } else {
              const hideEntryIds = readOwn(data, "hideEntryIds");
              if (matchedEntryId !== null && Array.isArray(hideEntryIds)) {
                covers = hideEntryIds.includes(matchedEntryId); // REWIND: matched msg's entry id ∈ hidden span
              }
            }
            if (!covers) continue;
            const seq = readOwn(data, "seq");
            const seqNum = typeof seq === "number" && Number.isFinite(seq) ? seq : 0;
            if (seqNum > bestSeq) {
              bestSeq = seqNum;
              bestUuid = uuid;
            }
          }
          return bestUuid;
        } catch {
          return null; // throwing buildContextEntries/sessionEntryToContextMessages/resolveShrinkTarget → null (E13)
        }
      }
  - NAMING: resolveTargetUuid. Parameters ctx, entries (the getEntries() result passed in), target.
  - GOTCHA: `entries` here is the getEntries() result (markers live there); snapshotEntries is buildContextEntries()
    (the messages). Pass `entries` from cancelExecute (step 2's getEntries) — do NOT re-read getEntries inside the
    helper (step 2 already did the fresh read; C12 is satisfied once per execute). entryIdAtMessageIndex gets
    snapshotEntries (NOT entries) for exact alignment.
  - GOTCHA: `shrinkTarget as ShrinkTarget` — readOwn returns unknown; resolveShrinkTarget re-checks isRecord(target)
    internally and returns null for a non-record, so the cast is safe. params.target needs NO cast (structural identity).
  - DEPENDENCIES: Tasks 1-2.

Task 4: MODIFY src/tools/cancel.ts — rewrite step 3 in cancelExecute (markerId-wins ordering)
  - REPLACE the current step-3 block (the `let targetUuid: string | null = null; for (const e of entries) {...}` loop)
    with the markerId-wins branching. Steps 1, 2, 4, 5, 6, 7 stay byte-for-byte identical:
      // (3) resolve the marker to retire (spec/05 §5 step 3 — target-preferred, markerId-fallback; markerId wins if both).
      //     markerId path: when markerId is present + non-empty, it is AUTHORITATIVE ("markerId wins if both given";
      //     also the sole path for markerId-only calls — Decision D1). target path: resolve target → matched message
      //     → covering marker (shrink|rewind, LIFO by seq) → uuid. Either yields targetUuid (the marker's data.id uuid)
      //     or null; both feed the UNCHANGED steps 4-7.
      let targetUuid: string | null = null;
      if (typeof params.markerId === "string" && params.markerId.length > 0) {
        // (3a) MARKERID PATH (verbatim current logic — preserved so existing tests pass unchanged).
        for (const e of entries) {
          if (readOwn(e, "id") !== params.markerId) continue;
          const ct = readOwn(e, "customType");
          if (ct !== "mulligan:rewind" && ct !== "mulligan:shrink") continue;
          const uuid = readOwn(readOwn(e, "data"), "id");
          if (typeof uuid === "string" && uuid.length > 0) {
            targetUuid = uuid;
            break;
          }
        }
      } else if (params.target) {
        // (3b) TARGET PATH — resolve target → covering marker → uuid (resolveTargetUuid never throws → null on no-match).
        targetUuid = resolveTargetUuid(ctx, entries, params.target);
      }
      // else: neither markerId nor target → targetUuid stays null → step 4 no-op (Decision D2 — no new refusal path).
  - GOTCHA: the markerId loop body is IDENTICAL to the current code (same readOwn chain, same break). Only the
    surrounding `if/else if` is new. Do NOT refactor the loop internals (GOTCHA #2).
  - GOTCHA: `params.target` is narrowed to the non-undefined union by `else if (params.target)`, which IS assignable
    to resolveTargetUuid's `target: ShrinkTarget` param (S1 structural-identity guarantee). No cast needed at the
    call site.
  - DEPENDENCIES: Tasks 1-3.

Task 5: MODIFY src/tools/cancel.ts — update the cancelExecute JSDoc (describe the target resolution path)
  - UPDATE the cancelExecute JSDoc's step-3 bullet (currently "find the target entry: scan for entry.id ===
    params.markerId...") to describe BOTH paths:
      "3. resolve the marker to retire (step 3; target-preferred, markerId-wins): if params.markerId is a non-empty
       string, scan entries for entry.id===markerId ∧ customType∈{rewind,shrink} → read data.id (uuid) [MARKERID PATH,
       verbatim]. ELSE if params.target, build the message snapshot (buildContextEntries().flatMap(
       sessionEntryToContextMessages)), resolveShrinkTarget → matched index, then pick the MOST RECENT active
       rewind/shrink whose effect COVERS that message (shrink: own target resolves to the index; rewind: the index's
       entry id ∈ hideEntryIds; LIFO by seq) → read data.id (uuid) [TARGET PATH, resolveTargetUuid]. A
       non-string/empty/malformed uuid → not found (step 4)."
  - Keep the rest of the JSDoc (steps 1,2,4-7, the outer try/catch note, the pi/toolCallId closure note) UNCHANGED.
  - DEPENDENCIES: Task 4.

Task 6: VALIDATE (no new code)
  - RUN `npx tsc --noEmit` → NO new errors from src/tools/cancel.ts. (Any pre-existing errors elsewhere are out of
    scope — your bar is "no NEW errors from the file I touched".)
  - RUN `npx vitest run test/tools/cancel.test.ts` → all pass (the markerId-path cases are untouched; the target path
    is never invoked by them).
  - RUN `npx vitest run` → full suite passes (no regressions in filter/transforms/markers/etc.).
  - DEPENDENCIES: Tasks 1-5.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN (Task 4): markerId-wins ordering — the markerId path is byte-for-byte the OLD step-3 logic.
let targetUuid: string | null = null;
if (typeof params.markerId === "string" && params.markerId.length > 0) {
  for (const e of entries) {
    if (readOwn(e, "id") !== params.markerId) continue;
    const ct = readOwn(e, "customType");
    if (ct !== "mulligan:rewind" && ct !== "mulligan:shrink") continue;
    const uuid = readOwn(readOwn(e, "data"), "id");
    if (typeof uuid === "string" && uuid.length > 0) { targetUuid = uuid; break; }
  }
} else if (params.target) {
  targetUuid = resolveTargetUuid(ctx, entries, params.target); // never throws → null on no-match
}
// → targetUuid feeds the UNCHANGED step 4 (not-found no-op), 5 (already-cancelled), 6 (appendCancelMarker), 7 (return).

// PATTERN (Task 3): the covering scan ternary IS the entire covering rule.
//   SHRINK: resolveShrinkTarget(messages, shrinkTarget) === matchedIndex  → covers (own target hits the matched msg)
//   REWIND: Array.isArray(hideEntryIds) && hideEntryIds.includes(matchedEntryId) → covers (matched msg in hidden span)
// Walk-through (cancel a mis-targeted shrink by target {by_tool_name:"read", occurrence:"last"}):
//   snapshot messages = [..., readResult@idx5, ...]; resolveShrinkTarget(messages, {by_tool_name:"read",occurrence:"last"}) → 5
//   matchedEntryId = entryIdAtMessageIndex(snapshotEntries, 5) → "entry-msg-5"
//   scan entries: a shrink marker with data.target={by_tool_name:"read",occurrence:"last"} → resolveShrinkTarget → 5 === 5 → covers
//                 a rewind marker with data.hideEntryIds=["entry-msg-3"] → "entry-msg-5" ∉ [...] → no cover
//   bestUuid = the shrink's data.id uuid (its seq is highest among covering) → steps 5-7 cancel it by uuid ✓

// PATTERN (Task 2): entryIdAtMessageIndex alignment is EXACT by construction — the SAME flatMap that built `messages`
//   is the cursor walk, so entry e ↔ messages[cursor..cursor+y). No position math; no off-by-one. A throwing
//   sessionEntryToContextMessages → return null (alignment indeterminate → safe no-cover).
```

### Integration Points

```yaml
CODE:
  - modify: src/tools/cancel.ts — + imports + entryIdAtMessageIndex + resolveTargetUuid + rewritten step 3 + cancelExecute JSDoc
  - untouched: CancelParams/CANCEL_DESC/CancelArgs (S1), CancelDetails/refusal()/readOwn/isRecord/makeCancelTool,
    steps 1,2,4-7 of cancelExecute, src/transforms.ts, src/markers.ts, src/filter.ts, src/tools/shrink.ts + others
TESTS:
  - untouched: test/tools/cancel.test.ts (regression gate — every case uses the markerId path; target-behavior tests are S3)
DOWNSTREAM (S3, NOT this subtask):
  - S3 extends makeCtx to script buildContextEntries() + adds fixtures with data.target/data.hideEntryIds for the
    target-path cases (cancel-by-target shrink, cancel-by-target rewind, LIFO, no-cover no-op, markerId-wins-when-both).
FILTER (unchanged):
  - filter.ts readMarkers builds cancelledIds from every cancel's data.targetId and drops the retired rewind/shrink
    by uuid data.id BEFORE the pipeline sees it. This is ALREADY implemented; S2 changes nothing here.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npx tsc --noEmit
# EXPECTED: no NEW errors from src/tools/cancel.ts. Common S2 mistakes tsc catches:
#   - forgot the `as unknown as MessageLike[]` double-cast on the snapshot flatMap (AgentMessage[] ≠ MessageLike[] nominally);
#   - `shrinkTarget as ShrinkTarget` written as `shrinkTarget` (unknown not assignable to ShrinkTarget without the assertion);
#   - a typo in an imported name (sessionEntryToContextMessages / resolveShrinkTarget / ShrinkTarget / MessageLike);
#   - resolveTargetUuid's `target: ShrinkTarget` param vs the call `resolveTargetUuid(ctx, entries, params.target)`
#     (params.target is the S1 union ≡ ShrinkTarget → assignable; if tsc complains, S1's target union diverged — re-check S1).
# Any PRE-EXISTING errors in OTHER files are out of scope — your bar is "no NEW errors from cancel.ts".
```

### Level 2: Unit Tests (Component Validation)

```bash
# The cancel test file in isolation — confirms the markerId path is preserved verbatim (regression gate).
npx vitest run test/tools/cancel.test.ts
# EXPECTED: all pass. These cases all call run(pi, ctx, {markerId:'…'}) → enter the markerId path → buildContextEntries
# is NEVER called → makeCtx need not script it. If a case FAILS, you changed the markerId loop internals (revert to the
# verbatim old logic — GOTCHA #2) OR broke the surrounding if/else branching.

# Full suite — confirm no regressions in filter/transforms/markers (S2 adds imports from transforms.js; a circular dep
# or a broken export would surface here).
npx vitest run
# EXPECTED: all pass.
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for S2: the target path has no OBSERVABLE behavior covered by existing tests (they're all markerId-path). The
# end-to-end "cancel by target retires the marker and the content reappears next fire" validation is S3's job
# (P1.M1.T1.S3 writes the target-behavior tests, extending makeCtx to script buildContextEntries). S2 ships the
# execute-body logic; S3 proves it. (Do NOT write those tests in S2 — scope boundary.)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Manual structural check (optional — proves the target path will resolve when S3 wires fixtures):
#   confirm cancel.ts now imports resolveShrinkTarget + sessionEntryToContextMessages, and that resolveTargetUuid
#   builds the snapshot via buildContextEntries() (NOT getEntries). A quick grep:
#     grep -n "resolveShrinkTarget\|sessionEntryToContextMessages\|buildContextEntries\|entryIdAtMessageIndex" src/tools/cancel.ts
#   Expected: resolveShrinkTarget imported + called in resolveTargetUuid; sessionEntryToContextMessages imported + used
#   in BOTH entryIdAtMessageIndex and the snapshot flatMap; buildContextEntries called ONCE (in resolveTargetUuid);
#   entryIdAtMessageIndex defined + called in resolveTargetUuid. getEntries still called in step 2 (unchanged).
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit` — no new errors from `src/tools/cancel.ts`.
- [ ] `npx vitest run test/tools/cancel.test.ts` — all existing tests pass (markerId path preserved verbatim).
- [ ] `npx vitest run` — full suite passes (no regressions).

### Feature Validation

- [ ] Step 3 uses markerId-wins ordering: non-empty `markerId` → markerId path; else `target` → target path; else → fallthrough no-op.
- [ ] The markerId path is byte-for-byte the old step-3 logic (same readOwn chain, same break).
- [ ] The target path builds the snapshot via `buildContextEntries().flatMap(sessionEntryToContextMessages)`, resolves via `resolveShrinkTarget`, and scans `entries` (getEntries result) for the most-recent covering marker.
- [ ] SHRINK covers iff resolving its own `data.target` === matched index; REWIND covers iff `entryIdAtMessageIndex(...)` ∈ `data.hideEntryIds`; highest `data.seq` wins.
- [ ] Steps 1, 2, 4, 5, 6, 7 are byte-for-byte unchanged; the outer try/catch (E13) still wraps the whole body.
- [ ] The persisted `targetId` is still the marker's uuid `data.id` (NEVER an entry id) — both paths resolve to it.

### Code Quality Validation

- [ ] `entryIdAtMessageIndex` is a verbatim clone of shrink.ts's private helper (local to cancel.ts, not exported from shrink.ts).
- [ ] The snapshot 2-liner is INLINED in `resolveTargetUuid` (not extracted to a cross-file shared helper — item contract).
- [ ] Every new field read (`data.target`, `data.hideEntryIds`, `data.seq`, `data.id`, `entry.id`) goes through the local `readOwn`.
- [ ] Only `src/tools/cancel.ts` is modified — NO changes to transforms.ts, markers.ts, filter.ts, shrink.ts, config.ts, tests, README, spec.

### Documentation & Deployment

- [ ] `cancelExecute` JSDoc step-3 bullet updated to describe BOTH the markerId path and the target resolution path (Mode A — rides with the code).
- [ ] No user-facing doc change in S2 (CANCEL_DESC was updated in S1; README sweep is P1.M5, after M1–M4).

---

## Anti-Patterns to Avoid

- ❌ Don't try the target path BEFORE the markerId path (spec's "preferred target" wording) — that contradicts "markerId wins if both given" and would route a `{markerId, target}` call through the wrong path. markerId is authoritative whenever it is a non-empty string (Decision D1). The "preferred" framing just means target is the documented primary mechanism.
- ❌ Don't refactor the markerId loop internals — it must be byte-for-byte the old step-3 logic so every existing test (exact targetId/no-op/appendEntry-not-called assertions) keeps passing. Only the surrounding `if/else if` is new (GOTCHA #2).
- ❌ Don't pass `getEntries()` to `entryIdAtMessageIndex` — alignment is only exact against the SAME `buildContextEntries()` snapshot that built `messages`. Markers live in `getEntries()`; the message snapshot + index→entry mapping come from `buildContextEntries()`. Mixing them silently breaks the rewind hideEntryIds membership check (GOTCHA #3).
- ❌ Don't check `hideEntryIds.includes(matchedIndex)` (a number) — hideEntryIds hold ENTRY ids. Map the matched index → its entry id via `entryIdAtMessageIndex` FIRST, then check membership (GOTCHA #4).
- ❌ Don't use `pinnedEntryId` for the shrink covering check — resolve the shrink's LIVE `data.target` against the snapshot (cancel wants compaction-robust live resolution, same as the target itself; pinnedEntryId is the filter's identity-lock, a different concern — GOTCHA #5).
- ❌ Don't extract a cross-file shared helper for the snapshot build or entryIdAtMessageIndex — the item contract says clone `entryIdAtMessageIndex` locally and inline the 2-liner. (A shared extraction is a separate refactor, out of scope.)
- ❌ Don't add a new refusal path for "neither markerId nor target given" — fall through to `targetUuid = null` → step 4 no-op (fail-open, consistent with E21 (d) "safe no-op, never throws"). The schema's "at least one MUST be present" is advisory; enforcing it as a refusal would be a behavior change beyond S2's scope.
- ❌ Don't re-read `getEntries()` inside `resolveTargetUuid` — step 2 already did the fresh read (C12 once per execute); pass `entries` in. (The helper DOES call `buildContextEntries()` fresh — that's a different, necessary surface.)
- ❌ Don't write target-behavior tests in S2 — that's S3 (P1.M1.T1.S3). S2's test bar is "existing markerId-path tests still pass"; S3 extends makeCtx + adds the target-path fixtures.
- ❌ Don't omit the `as unknown as MessageLike[]` double-cast or write `shrinkTarget` without the `as ShrinkTarget` assertion — both are tsc errors (GOTCHA #9, #10).

---

## Decision Log

- **D1 — markerId-wins ordering (markerId authoritative whenever present + non-empty).** Spec §5 step 3 says "preferred target, fallback markerId" yet also "if both `target` and `markerId` are given, `markerId` wins". These tension only when both are present. The literal "markerId wins" is authoritative (it is an explicit override rule; "preferred" is framing). Resolution: `if (markerId is non-empty string) markerId path; else if (target) target path; else no-op`. This honors "markerId wins" exactly AND preserves every existing test (they all pass a non-empty markerId → markerId path → `buildContextEntries()` is never called → `makeCtx` need not script it → zero test changes in S2). "Preferred target" just means target is the documented primary mechanism (most agents lack a `markerId`).

- **D2 — "neither markerId nor target" falls through to the not-found no-op (no new refusal).** S1 made both params `Type.Optional` (S1 Decision D1) so the schema admits markerId-ALONE; the symmetric consequence is that NEITHER is also schema-admissible. The spec's object description says "At least one MUST be present" but does not specify the violation behavior. Adding a refusal ("must provide target or markerId") would be a behavior change beyond S2's step-3 resolution scope. The fail-open no-op (targetUuid stays null → step 4 returns the existing "no active marker found" text + `details:{cancelled:false}`) is consistent with E21 (d) ("safe no-op, never throws") and requires no new code path. If a reviewer prefers an explicit refusal, that is a small follow-up — but it is out of scope for S2.

- **D3 — resolve the shrink's LIVE `data.target` for the covering check (not `pinnedEntryId`).** A shrink marker carries both `target` (the live selector) and an optional `pinnedEntryId` (the filter's identity-lock). Cancel's covering check wants the SAME live, compaction-robust resolution the target itself uses — so it resolves `data.target` against the snapshot via `resolveShrinkTarget`. Using `pinnedEntryId` would couple cancel to the filter's identity-lock semantics (and a shrink may lack a `pinnedEntryId` when the target didn't match at creation). The item contract specifies "resolve each shrink's target via readOwn(marker, 'target') → resolveShrinkTarget → same index" — this PRP follows it verbatim. `pinnedEntryId` is documented as a possible refinement (not used).

- **D4 — clone `entryIdAtMessageIndex` locally (do NOT export it from shrink.ts).** shrink.ts's `entryIdAtMessageIndex` is module-private. The item contract explicitly says to clone it locally in cancel.ts (~15 lines) rather than export it from shrink.ts (which would be a separate refactor touching shrink.ts — out of S2's scope, and shrink.ts is a stable read-only contract here). The clone uses the local `readOwn` for the entry-id read (more defensive than shrink's cast; both correct). The duplication is ~15 lines of trivial cursor-walk logic — acceptable for the scope boundary.

---