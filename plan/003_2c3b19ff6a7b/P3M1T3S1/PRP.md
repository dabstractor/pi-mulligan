# PRP — P3.M1.T3.S1: Create mulligan_cancel tool + register in index.ts

## Goal

**Feature Goal**: Create the 5th agent-callable Mulligan tool, `mulligan_cancel`, as `src/tools/cancel.ts` — a thin, typebox-schema'd, fail-open adapter that lets an agent retract an erroneous/stale `mulligan:rewind` or `mulligan:shrink` marker so it stops applying going forward (spec/08 E21; amends D6). The tool receives the target as `markerId` (the ENTRY id the agent got back in `details.markerId` from rewind/shrink), maps it to the marker's uuid `data.id`, and appends a `mulligan:cancel` marker via the already-landed `appendCancelMarker` wrapper. `readMarkers` (P3.M1.T2.S1) then drops the retired marker on the next `context` fire. Then register the tool in `src/index.ts` alongside the other four, and document it in `spec/05-tools.md` (Mode A — doc rides with the work).

**Deliverable**:
- `src/tools/cancel.ts` — NEW: exports `makeCancelTool`, `CancelParams`, `CancelDetails`, `CANCEL_DESC`. Factory `makeCancelTool(pi): ToolDefinition<typeof CancelParams, CancelDetails>` mirrors `makeShrinkTool` exactly (closure-captured `pi`, `defineTool`, one try/catch → refusal, `details` on every return path).
- `src/index.ts` — MODIFIED: `import { makeCancelTool } from "./tools/cancel.js";` + `pi.registerTool(makeCancelTool(pi));`; update the "all 4 agent-callable tools" comment to 5.
- `test/tools/cancel.test.ts` — NEW: mirror `test/tools/shrink.test.ts`'s `makePi()`/`makeCtx()` fake idiom, but the `makeCtx` fake MUST also script `sessionManager.getEntries()` (the cancel tool's FRESH read surface — C12); 7 cases (cancel rewind, cancel shrink, non-existent no-op, already-cancelled no-op, config-disabled refusal, appendEntry-throws refusal, registration metadata).
- `spec/05-tools.md` — MODIFIED: new `mulligan_cancel` section (parameter schema, return shape, step-by-step behavior, refusal conditions), updated registration-summary code block (5th `registerTool` line), CANCEL_DESC added to the description-strings list.

**Success Definition**:
- `makeCancelTool(pi)` returns a `ToolDefinition<typeof CancelParams, CancelDetails>` with `name:"mulligan_cancel"`, `label`, `description`===CANCEL_DESC verbatim, `parameters`===CancelParams.
- Cancelling an existing rewind (by entry id) → `appendCancelMarker` invoked with `{targetId: <that marker's uuid data.id>}`; confirmation text returned; `details:{cancelled:true, markerId}`.
- Cancelling an existing shrink → same.
- Non-existent `markerId` → safe no-op text `"Mulligan: no active marker found with that id — nothing to cancel."`, `details:{cancelled:false}`, appendEntry NOT called.
- Already-cancelled marker (a `mulligan:cancel` entry with `data.targetId === uuid` present) → safe no-op text `"Mulligan: that marker is already cancelled."`, `details:{cancelled:false}`, appendEntry NOT called.
- `config.enabled===false` → refusal text `"Mulligan: refused — Mulligan is disabled."`, `details:{}`.
- `appendEntry` throws → tool never throws; returns refusal text `"Mulligan: refused — unexpected error: <msg>."`.
- `npx tsc --noEmit` clean; `npm test` green (cancel tests pass, no regressions in the other 17 test files).

## Why

- This is the **agent-facing half** of marker retraction (G3 / spec/08 E21). The runtime half (readMarkers dropping cancelled markers) is P3.M1.T2.S1; the data-model/persistence half (`appendCancelMarker`, `CancelMarker`) is P3.M1.T1.S1 — **both already landed** (confirmed by grep: `src/markers.ts` exports `appendCancelMarker`/`CancelMarker`/`CancelMarkerInput`; `MulliganEnvelope.kind` already includes `"cancel"`). Without this tool, an agent that issues a mis-targeted shrink/rewind cannot retract it: a `mulligan_rewind` of the issuing call does NOT retire it (markers are `custom` control entries outside the rewind's `hideEntryIds` span — verified in live use), so the unwanted transform applies on every subsequent `context` fire for the rest of the session.
- Amends decision **D6** ("agent rewinds are permanent"): a mistaken marker is now retractable. Scope is narrow — retraction suppresses the marker going forward only; it does NOT undo on-disk side effects (D1/E5) or replay hidden content (E21 "what retraction is NOT").
- It is the immediate consumer of `appendCancelMarker` (markers.ts) and `readMarkers`'s cancel-drop (filter.ts). It produces the `markerId`-in-`details` contract that `mulligan_audit` (P3.M1.T4.S1 — "lists cancelled markers as retired") and the stale-retirement logic (P3.M2.T3.S1 — appends a cancel to retire a marker) build on.

## What

**User-visible behavior**: The agent calls `mulligan_cancel({ markerId })` with the value it received as `details.markerId` from an earlier `mulligan_rewind` or `mulligan_shrink`. The tool confirms cancellation ("The transform will no longer apply from the next turn on"). On the *next* `context` fire, `readMarkers` drops the retired marker, so the originally-hidden/shrunk content reappears verbatim in the filtered view (E21 acceptance (b)). Cancelling a non-existent or already-cancelled id is a safe no-op that returns a reason and never throws (E13).

**Technical requirements** (from the work-item contract — implement EXACTLY):
1. `CancelParams = Type.Object({ markerId: Type.String({ description: "The marker id to cancel (the markerId value returned by mulligan_rewind or mulligan_shrink in details.markerId)." }) })`.
2. `CancelDetails = { cancelled: boolean; markerId?: string | null; reason?: string }`.
3. `makeCancelTool(pi): ToolDefinition<typeof CancelParams, CancelDetails>` — factory captures `pi` via closure (mirror `makeShrinkTool`).
4. `execute` body, in order:
   1. Config gate — `if (!getConfig().enabled) return refusal("Mulligan is disabled")` (E14 master switch; there is NO `config.cancel` sub-knob).
   2. Read `ctx.sessionManager.getEntries()` FRESH (C12) — wrap in try/catch → `[]` on throw (defense-in-depth).
   3. Scan for a custom entry whose `entry.id === params.markerId` AND `customType ∈ {"mulligan:rewind", "mulligan:shrink"}`.
   4. If NOT found → safe no-op: return `{content:[{type:"text", text:"Mulligan: no active marker found with that id — nothing to cancel."}], details:{cancelled:false}}`.
   5. Read the marker's uuid `id` from `entry.data.id` (via the local `readOwn` defensive helper).
   6. Scan entries for an existing `mulligan:cancel` with `data.targetId === uuid` → if found → safe no-op: return `{content:[{type:"text", text:"Mulligan: that marker is already cancelled."}], details:{cancelled:false}}`.
   7. `appendCancelMarker(pi, ctx, {targetId: uuid})` → `markerId` (entry id or null).
   8. Return `{content:[{type:"text", text:"Mulligan: marker cancelled. The transform will no longer apply from the next turn on."}], details:{cancelled:true, markerId}}`.
5. WRAP the entire body in ONE try/catch → `refusal("unexpected error: <msg>")` (E13 — never throws).
6. Register in `src/index.ts`: `import { makeCancelTool } from "./tools/cancel.js"` + `pi.registerTool(makeCancelTool(pi))` alongside the existing four.

### Success Criteria
- [ ] `makeCancelTool` returns the correct `ToolDefinition` (name/label/description/parameters).
- [ ] Cancelling an existing rewind/shrink (by entry id) appends a `mulligan:cancel` with `targetId` = that marker's uuid `data.id`; returns `details:{cancelled:true, markerId}`.
- [ ] Non-existent markerId → no-op text + `cancelled:false` + appendEntry NOT called.
- [ ] Already-cancelled marker → no-op text + `cancelled:false` + appendEntry NOT called.
- [ ] `config.enabled===false` → refusal text + `details:{}`.
- [ ] `appendEntry` throws → refusal text (never throws).
- [ ] `src/index.ts` registers the 5th tool; `spec/05-tools.md` has the cancel section + updated registration summary.

## All Needed Context

### Context Completeness Check

> If someone knew nothing about this codebase, would they have everything needed to implement this successfully?

**Yes** — provided they read `src/tools/shrink.ts` (the EXACT factory template to clone), `src/markers.ts` (the already-landed `appendCancelMarker`/`CancelMarkerInput` to call), `src/config.ts` (`getConfig().enabled`), and `src/index.ts` (the registration pattern). The cancel tool is strictly SIMPLER than shrink: no best-effort match, no `sessionEntryToContextMessages`, no `resolveShrinkTarget`, no note/ledger. It scans `getEntries()`, maps entry id → uuid `data.id`, checks not-already-cancelled, and delegates persistence to `appendCancelMarker`. The two non-obvious bits — (a) the `markerId`(entry id)→`targetId`(uuid) indirection, and (b) `readOwn`/`isRecord` being module-private to filter.ts so cancel.ts needs local copies — are spelled out in the gotchas below. The test idiom is a direct clone of `test/tools/shrink.test.ts` with one added surface (`getEntries`) on the fake sessionManager.

### Documentation & References

```yaml
# MUST READ — the EXACT factory template to clone (verbatim structure)
- file: src/tools/shrink.ts
  why: |
    makeShrinkTool(pi): ToolDefinition<typeof ShrinkParams, ShrinkDetails> is the canonical pattern: imports
    (defineTool + types from @earendil-works/pi-coding-agent; Type/Static from typebox; .js ESM import paths),
    the refusal(reason) helper → {content:[{type:'text',text:`Mulligan: refused — ${reason}.`}], details:{}},
    the module-private xxxExecute(pi,_toolCallId,params,_signal,_onUpdate,ctx) with ONE try/catch → refusal,
    and the factory defineTool({name,label,description,parameters,async execute(...){return xxxExecute(pi,...)}}).
    Every return path includes `details` (REQUIRED by Pi's AgentToolResult<T> — strict tsconfig). CANCEL IS SIMPLER:
    no resolveTargetEntryId/best-effort match, no sessionEntryToContextMessages, no leaveNote. Strip those; keep
    the config gate + refusal + try/catch + factory shape.
  pattern: |
    export function makeShrinkTool(pi: ExtensionAPI): ToolDefinition<typeof ShrinkParams, ShrinkDetails> {
      return defineTool({ name:"mulligan_shrink", label:"Mulligan Shrink", description: SHRINK_DESC,
        parameters: ShrinkParams,
        async execute(toolCallId, params, signal, onUpdate, ctx) {
          return shrinkExecute(pi, toolCallId, params, signal, onUpdate, ctx); // pi via closure
        }});
    }
  gotcha: toolCallId (1st execute arg) is UNUSED for cancel — name it `_toolCallId` (shrink does too).

# MUST READ — the persistence wrapper to call (already landed, DO NOT modify)
- file: src/markers.ts
  why: |
    appendCancelMarker(pi, ctx, data: CancelMarkerInput): string|null is the SOLE writer this tool uses. It stamps
    the envelope {schema:'pi-mulligan',v:1,kind:'cancel'} + seq + ts, calls pi.appendEntry('mulligan:cancel', entry),
    and returns ctx.sessionManager.getLeafId(). NEVER throws (try/catch → null). CancelMarkerInput === {targetId:string}
    EXACTLY. CancelMarker has NO `id` field (a cancel isn't cancellable; mirrors TurnMetric). DO NOT re-stamp an id.
  section: appendCancelMarker (~line 311); CancelMarker/CancelMarkerInput (~lines 169-182)
  gotcha: The wrapper is DUMB persistence — it does NOT validate targetId exists on the branch. That validation is
    THIS tool's job (scan getEntries). Pass {targetId: uuid} where uuid = entry.data.id (NOT the entry id).

# MUST READ — the config read
- file: src/config.ts
  why: |
    getConfig(): MulliganConfig returns a fresh defensive clone each call. The cancel gate is the MASTER switch ONLY:
    `if (!getConfig().enabled) return refusal('Mulligan is disabled')`. There is NO config.cancel sub-knob (retraction
    is a safety/escape hatch — always on when mulligan is on). Read getConfig() ONCE per execute.
  section: getConfig() (~line 100); MulliganConfig.enabled (line ~20)
  gotcha: Do NOT add a config.cancel field — it is out of scope (and intentional). Match rewind/shrink's master-gate
    ordering: master `enabled` FIRST, before any sub-feature gate (cancel has none, so just the master check).

# MUST READ — the registration site
- file: src/index.ts
  why: |
    The extension factory. Lines 6-10 import the 4 tool factories; line ~32-35 call pi.registerTool(makeXxxTool(pi))
    for each (auditTool is a plain const — the only non-factory). Add makeCancelTool the SAME way: a factory import
    + pi.registerTool(makeCancelTool(pi)). Update the "all 4 agent-callable tools" comment to 5.
  pattern: |
    import { makeCancelTool } from "./tools/cancel.js";   // after the checkpoint import
    ...
    pi.registerTool(makeRewindTool(pi));
    pi.registerTool(makeShrinkTool(pi));
    pi.registerTool(makeCheckpointTool(pi));
    pi.registerTool(auditTool);
    pi.registerTool(makeCancelTool(pi));                  // 5th tool (P3.M1.T3.S1)

# CONTRACT — the runtime retraction this tool triggers (already landed, read-only consumer)
- file: src/filter.ts
  why: |
    readMarkers (P3.M1.T2.S1) builds cancelledIds:Set<string> from every mulligan:cancel entry's data.targetId, then
    drops rewinds/shrinks whose data.id ∈ cancelledIds BEFORE the pipeline sees them. So this tool's appendCancelMarker
    (which writes data.targetId = uuid) is what makes the drop fire on the NEXT context event. THIS TASK DOES NOT EDIT
    filter.ts. CRITICAL: readOwn/isRecord are MODULE-PRIVATE here (line 55/60, unexported) — cancel.ts CANNOT import
    them; it must define LOCAL copies (verbatim ~8-line clones). filter.ts is out of scope to modify.
  section: readOwn/isRecord (lines 55-65); readMarkers cancel-drop (~lines 94-154)

# MUST READ — the test idiom to clone (the ONE difference: getEntries must be scripted)
- file: test/tools/shrink.test.ts
  why: |
    House pattern: vitest, hand-rolled makePi()/makeCtx() fakes (NO vi.fn), .js imports, expectTypeOf type asserts,
    clearAll() in beforeEach+afterEach (nextSeq mutates shared runtime map). makePi({throwOnAppend?}) captures
    appendEntry calls into `appended[]`; makeCtx({...}) exposes sessionManager.{getSessionId,getLeafId,buildContextEntries}.
    run(pi,ctx,params) helper calls makeXxxTool(pi).execute('call-1',params,undefined,undefined,ctx). firstText(res).
    CRITICAL DIFFERENCE: cancel scans ctx.sessionManager.getEntries() (FRESH — C12), which shrink's makeCtx does NOT
    expose. cancel.test.ts's makeCtx MUST script `getEntries()` returning a scripted SessionEntry[]. Add the method.
  pattern: |
    // makeCtx for cancel — add getEntries (returns the scripted array):
    function makeCtx(opts: { entries?: SessionEntry[]; leafId?: string|null; throwOnGetEntries?: boolean } = {}) {
      const leafId = opts.leafId === undefined ? "leaf-1" : opts.leafId;
      const sessionManager = {
        getSessionId: () => "sess-1",
        getLeafId: () => leafId,
        getEntries: () => { if (opts.throwOnGetEntries) throw new Error("boom"); return opts.entries ?? []; },
      };
      return { sessionManager } as unknown as ExtensionContext;
    }
  gotcha: The fake SessionEntry for a rewind marker needs {type:"custom", id:<entryId>, customType:"mulligan:rewind",
    data:{schema:"pi-mulligan",v:1,kind:"rewind",id:<uuid>,...}}. The entry.id is what the agent passes as markerId;
    data.id is the uuid that becomes targetId. Use DISTINCT values (e.g. entry id "entry-rw-1", uuid "uuid-rw-1") so
    tests prove the mapping works (a bug that passes the entry id as targetId would FAIL such a test).

# MUST UPDATE — the docs (Mode A: ride with the work)
- file: spec/05-tools.md
  why: |
    Currently 4 tool sections (§1 rewind, §2 shrink, §3 checkpoint, §4 audit) + §5 registration summary + §6 cross-refs.
    Add a mulligan_cancel section (parameter schema, return shape, step-by-step behavior mirroring §2 shrink, refusal
    conditions: disabled/non-existent/already-cancelled). Update the §5 registration-summary code block (5th
    registerTool line) and add CANCEL_DESC to the description-strings list. Reference the D6-amendment framing.
  section: new section (insert as §5 mulligan_cancel AFTER audit §4, bump registration→§6, cross-refs→§7) + §registration summary
  gotcha: The §5 registration-summary code block is the SUMMARY form (object literal w/ execute: cancelExecute);
    index.ts uses the FACTORY form (pi.registerTool(makeCancelTool(pi))). Both are correct representations — keep the
    spec block in its existing summary style for consistency, add the factory note in prose.

# Pi type reference (SessionEntry shape — from node_modules @earendil-works/pi-coding-agent)
- file: node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts
  why: |
    SessionEntryBase { type:string; id:string; parentId:string|null; timestamp:string }.
    CustomEntry<T> extends SessionEntryBase { type:"custom"; customType:string; data?:T }.
    So a rewind/shrink marker entry: e.type==="custom" && e.customType==="mulligan:rewind"|"mulligan:shrink" &&
    e.id (entry id, stable string) && e.data.id (uuid) && e.data.kind. A cancel entry: e.customType==="mulligan:cancel"
    && e.data.targetId (uuid) && e.data.kind==="cancel". NOTE: CustomMessageEntry ALSO has customType (e.g. mulligan:note)
    — the customType∈{rewind,shrink} guard excludes notes automatically (note customType is "mulligan:note").

# Architecture sketch (Pattern 3 is the canonical sketch for THIS task)
- docfile: plan/003_2c3b19ff6a7b/architecture/implementation_patterns.md
  why: "Pattern 3 (mulligan_cancel tool) sketches the exact execute flow + the markerId→uuid mapping DECISION. The doc
        ALSO floats an earlier 'entry id' alternative for targetId (Pattern 2 deliberation) — that is OVER-RULED by the
        landed contract: targetId = the marker's uuid data.id. Follow Pattern 3's DECISION (map entry id → data.id)."
  section: "G3 / P3.M1 — Pattern 3"

# Re-planning contract (the two sibling tasks this builds on — both already landed)
- docfile: plan/003_2c3b19ff6a7b/P3M1T1S1/PRP.md
  why: P3.M1.T1.S1 landed CancelMarker/CancelMarkerInput/appendCancelMarker in markers.ts (CONFIRMED by grep — done).
- docfile: plan/003_2c3b19ff6a7b/P3M1T2S1/PRP.md
  why: P3.M1.T2.S1 lands the readMarkers cancel-drop in filter.ts (builds cancelledIds from data.targetId, drops by
        data.id). This tool's appendCancelMarker writes data.targetId = uuid; readMarkers consumes it next fire.
```

### Current Codebase tree (relevant slice)

```bash
src/
  config.ts            # read-only dep (getConfig().enabled — master gate only)
  filter.ts            # read-only dep (readMarkers cancel-drop; readOwn/isRecord PRIVATE — clone locally)
  index.ts             # <-- MODIFY: import + registerTool(makeCancelTool(pi)); comment "4"→"5"
  markers.ts           # read-only dep (appendCancelMarker/CancelMarkerInput — ALREADY LANDED)
  tools/
    rewind.ts          # sibling factory (reference)
    shrink.ts          # <-- the EXACT template to clone (makeShrinkTool factory)
    checkpoint.ts      # sibling factory (reference)
    audit.ts           # sibling (plain const, not a factory — N/A as template)
    cancel.ts          # <-- CREATE (new file)
test/
  tools/
    shrink.test.ts     # <-- the test idiom to clone (makePi/makeCtx fakes)
    cancel.test.ts     # <-- CREATE (new file; makeCtx scripts getEntries)
    markers.test.ts    # already tests appendCancelMarker — DO NOT touch
spec/
  05-tools.md          # <-- MODIFY: new mulligan_cancel section + updated registration summary
```

### Desired Codebase tree with files to be added and responsibility

```bash
src/tools/cancel.ts    # NEW — makeCancelTool(pi) factory + CancelParams + CancelDetails + CANCEL_DESC;
                       #   thin fail-open adapter: config gate → scan getEntries → map entry.id→data.id(uuid) →
                       #   check not-already-cancelled → appendCancelMarker → confirmation/no-op/refusal text.
src/index.ts           # MODIFIED — register the 5th tool (makeCancelTool(pi)).
test/tools/cancel.test.ts # NEW — 7 cases mirroring shrink.test.ts; makeCtx scripts getEntries().
spec/05-tools.md       # MODIFIED — mulligan_cancel section + registration summary (5th line) + CANCEL_DESC.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: the markerId→targetId indirection is the WHOLE point of this tool. The agent passes the ENTRY id
// (details.markerId from rewind/shrink = getLeafId()). But readMarkers drops by the marker's uuid data.id ∈
// cancelledIds. So the cancel's targetId MUST be data.id (uuid), NOT the entry id. The tool MAPS: scan getEntries
// for entry.id===markerId (with customType rewind/shrink) → read entry.data.id (uuid) → that uuid is targetId.
// A bug that passes the entry id as targetId would make the cancel a permanent no-op (readMarkers would never
// match it). PROVE the mapping in tests by using DISTINCT entry-id vs uuid values.

// CRITICAL: readOwn/isRecord are MODULE-PRIVATE in filter.ts (unexported, line 55/60). cancel.ts CANNOT import them.
// filter.ts is out of scope (P3.M1.T2.S1 owns it). DEFINE LOCAL COPIES in cancel.ts — verbatim ~8-line clones:
//   function isRecord(v: unknown): v is Record<string, unknown> { return typeof v === "object" && v !== null && !Array.isArray(v); }
//   function readOwn(obj: unknown, key: string): unknown { if (!isRecord(obj)) return undefined; try { return obj[key]; } catch { return undefined; } }
// Defense-in-depth: a Proxy get-trap may throw → readOwn swallows → undefined → safe. Read entry.id, entry.customType,
// entry.data, data.id, data.targetId, data.kind ALL through readOwn. Never use `entry.id` / `data.id` directly.

// CRITICAL: every AgentToolResult<CancelDetails> return path MUST include a `details` field. Pi's strict tsconfig
// rejects a {content:[...]}-only return (the spec/05 §2 return shape is a SIMPLIFICATION — details is REQUIRED).
// refusal() returns details:{}; success returns details:{cancelled:true, markerId}; no-ops return details:{cancelled:false}.

// CRITICAL: the WHOLE execute body is ONE try/catch → refusal("unexpected error: <msg>") (E13 — never throws on the
// tool hot path). Wrap getEntries() reads AND appendCancelMarker in it. appendCancelMarker already never throws
// (returns null), but belt-and-suspenders: if it somehow did, the outer catch converts it to a refusal.

// CRITICAL: read ctx.sessionManager.getEntries() FRESH (C12) — do NOT cache a sessionManager handle across calls.
// Each execute invocation re-reads via ctx.sessionManager. (markers.ts wrappers do the same for getSessionId/getLeafId.)

// GOTCHA: there is NO config.cancel sub-knob. The gate is the MASTER `getConfig().enabled` ONLY. (rewind/shrink have
// sub-feature gates config.rewind.enabled / config.shrink.enabled; cancel intentionally has none — retraction is a
// safety escape hatch, always available when mulligan is enabled.) Do NOT add a config.cancel field.

// GOTCHA: CustomMessageEntry (e.g. mulligan:note) ALSO carries a customType field. The customType∈{rewind,shrink}
// guard on the target scan EXCLUDES notes automatically (note customType is "mulligan:note"). No extra type guard needed,
// but DO read customType through readOwn and compare against the two literal strings — never assume the entry type.

// GOTCHA: a markerId that matches a rewind/shrink entry but whose data.id (uuid) is unreadable/missing is a malformed
// marker — treat as "not found" (safe no-op). readOwn(data, "id") returning undefined/non-string → no-op text. Do not
// pass undefined as targetId to appendCancelMarker (it would persist a junk cancel). Guard: `if (!uuid) return <no-op>`.

// GOTCHA: the already-cancelled check scans for customType==="mulligan:cancel" && readOwn(data,"targetId")===uuid.
// This PREVENTS duplicate cancel entries for the same marker (idempotency). It is a full re-scan of getEntries (cheap;
// sessions are bounded). Do NOT short-circuit — a cancel could appear anywhere in the entry list.

// GOTCHA: .js ESM import paths are REQUIRED (tsconfig "moduleResolution":"bundler" + "type":"module" in package.json).
// `import { appendCancelMarker } from "../markers.js"` (NOT "../markers"). Every existing src file does this.

// GOTCHA: the test fake SessionEntry must use DISTINCT entry.id vs data.id(uuid) values so the mapping is PROVEN.
// E.g. a rewind entry: {type:"custom", id:"entry-rw-1", customType:"mulligan:rewind",
//   data:{schema:"pi-mulligan",v:1,kind:"rewind",id:"uuid-rw-1",granularity:"last_turn",options:{},note:{...},ledger:{...},seq:1,ts:1}}.
// Assert the captured appendEntry data.targetId === "uuid-rw-1" (NOT "entry-rw-1"). This catches the entry-id-as-targetId bug.
```

## Implementation Blueprint

### Data models and structure

No new persisted types (markers.ts is already landed). Only the tool's own schema + details interface:

```typescript
// src/tools/cancel.ts
import { Type } from "typebox";
import type { Static } from "typebox";
import {
  defineTool,
  type AgentToolResult,
  type ExtensionAPI,
  type ExtensionContext,
  type SessionEntry,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { appendCancelMarker } from "../markers.js";
import type { CancelMarkerInput } from "../markers.js";
import { getConfig } from "../config.js";

// Parameter schema (the agent passes the ENTRY id it received as details.markerId from rewind/shrink).
export const CancelParams = Type.Object({
  markerId: Type.String({
    description:
      "The marker id to cancel (the markerId value returned by mulligan_rewind or mulligan_shrink in details.markerId).",
  }),
});
export type CancelArgs = Static<typeof CancelParams>;

// The structured details payload surfaced to logs/audit/UI. Present on EVERY return path.
export interface CancelDetails {
  /** true when a mulligan:cancel marker was appended; false on no-op/refusal paths. */
  cancelled?: boolean;
  /** The new cancel marker's ENTRY id (appendCancelMarker return; null when append threw / no leaf). Success path. */
  markerId?: string | null;
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/tools/cancel.ts — the tool module
  - IMPLEMENT: CancelParams, CancelArgs, CANCEL_DESC, CancelDetails, refusal(), local isRecord/readOwn,
    cancelExecute(pi, _toolCallId, params, _signal, _onUpdate, ctx), makeCancelTool(pi).
  - FOLLOW pattern: src/tools/shrink.ts (makeShrinkTool factory) EXACTLY — same imports shape, same defineTool
    shape, same closure-captured pi, same one-try/catch → refusal, same `details` on every return path.
  - NAMING: makeCancelTool (factory), CancelParams/CancelArgs/CancelDetails, CANCEL_DESC, cancelExecute (module-private).
  - PLACEMENT: src/tools/cancel.ts.
  - STRIP from the shrink template: resolveTargetEntryId/entryIdAtMessageIndex (no best-effort match), the
    sessionEntryToContextMessages import, resolveShrinkTarget, targetIsStructurallyValid, isNonEmpty, leaveNote.
    Cancel has NONE of those — it is a pure scan + delegate.
  - CANCEL_DESC (craft for the LLM — drives usage; mirror the cost/benefit framing of the other four):
    "Retract (cancel) a mulligan_rewind or mulligan_shrink marker so it no longer applies going forward. Use when " +
    "you issued a rewind or shrink against the wrong target and need to undo it — without it, the mistaken " +
    "transform would apply on every turn for the rest of the session. Pass the markerId you received in details " +
    "when you issued the marker. The transform stops applying from the next turn on (cancelled markers stay on " +
    "disk for the audit trail). Cancelling a non-existent or already-cancelled marker is a safe no-op."

Task 2: cancelExecute — the execute body (spec/05 §3.5 behavior; the work-item contract steps 1-8)
  - BODY (in order, all wrapped in ONE try/catch):
    1. `if (!getConfig().enabled) return refusal("Mulligan is disabled");`  // E14 master gate (no sub-knob)
    2. `let entries: SessionEntry[]; try { entries = ctx.sessionManager.getEntries(); } catch { entries = []; }`
       (FRESH read — C12; defense-in-depth on a throwing getEntries)
    3. Find the target entry:
       ```
       let targetUuid: string | null = null;
       for (const e of entries) {
         if (readOwn(e, "id") !== params.markerId) continue;
         const ct = readOwn(e, "customType");
         if (ct !== "mulligan:rewind" && ct !== "mulligan:shrink") continue;
         const data = readOwn(e, "data");
         const uuid = readOwn(data, "id");
         if (typeof uuid === "string" && uuid.length > 0) { targetUuid = uuid; break; }
       }
       ```
    4. `if (targetUuid === null) return { content:[{type:"text", text:"Mulligan: no active marker found with that id — nothing to cancel."}], details:{cancelled:false} };`
    5. Already-cancelled check:
       ```
       for (const e of entries) {
         if (readOwn(e, "customType") !== "mulligan:cancel") continue;
         if (readOwn(readOwn(e, "data"), "targetId") === targetUuid) {
           return { content:[{type:"text", text:"Mulligan: that marker is already cancelled."}], details:{cancelled:false} };
         }
       }
       ```
    6. `const markerId = appendCancelMarker(pi, ctx, { targetId: targetUuid } satisfies CancelMarkerInput);`
       (appendCancelMarker never throws → returns null; the uuid is non-null by step 3's guard)
    7. `return { content:[{type:"text", text:"Mulligan: marker cancelled. The transform will no longer apply from the next turn on."}], details:{cancelled:true, markerId} };`
  - CATCH: `catch (e) { return refusal("unexpected error: " + (e instanceof Error ? e.message : String(e))); }`
  - GOTCHA: the `params` arg is typed `CancelArgs` but at runtime may be the raw tool-call object; read
    params.markerId through readOwn too if paranoid: `const markerId = readOwn(params, "markerId")`. (Shrink reads
    params.replacement directly — Pi validates against the typebox schema before execute, so direct access is fine
    in this codebase. Match shrink: read params.markerId directly, but the outer try/catch covers any surprise.)

Task 3: makeCancelTool — the factory
  - IMPLEMENT:
    ```
    export function makeCancelTool(pi: ExtensionAPI): ToolDefinition<typeof CancelParams, CancelDetails> {
      return defineTool({
        name: "mulligan_cancel",
        label: "Mulligan Cancel",
        description: CANCEL_DESC,
        parameters: CancelParams,
        async execute(toolCallId, params, signal, onUpdate, ctx) {
          return cancelExecute(pi, toolCallId, params, signal, onUpdate, ctx);  // pi via closure
        },
      });
    }
    ```
  - FOLLOW pattern: makeShrinkTool (shrink.ts) — defineTool preserves CancelParams inference when assigning to the
    typed return (checkpoint.ts precedent). pi is captured, NOT an execute argument.
  - GOTCHA: toolCallId/signal/onUpdate are UNUSED → name them _toolCallId/_signal/_onUpdate (shrink does this).

Task 4: MODIFY src/index.ts — register the 5th tool
  - ADD import (after the checkpoint import, keeping the tools grouped): `import { makeCancelTool } from "./tools/cancel.js";`
  - ADD registration (after the auditTool line): `pi.registerTool(makeCancelTool(pi));`
  - UPDATE the comment above the registerTool block: "all 4 agent-callable tools" → "all 5 agent-callable tools"
    (and optionally note makeCancelTool is the 5th factory; auditTool remains the only plain const).
  - PRESERVE: the existing 4 registrations, the config/logger/runtime wiring, the 3 event handlers, session lifecycle.

Task 5: CREATE test/tools/cancel.test.ts — 7 cases mirroring shrink.test.ts
  - REUSE the makePi()/makeCtx() idiom from test/tools/shrink.test.ts (hand-rolled fakes, NO vi.fn, .js imports,
    expectTypeOf, clearAll() in beforeEach+afterEach). COPY makePi verbatim (it captures appendEntry into `appended[]`).
  - makeCtx for cancel ADDS `getEntries()` (shrink's does not):
    ```
    function makeCtx(opts: { entries?: SessionEntry[]; leafId?: string | null; throwOnGetEntries?: boolean } = {}) {
      const leafId = opts.leafId === undefined ? "leaf-1" : opts.leafId;
      const sessionManager = {
        getSessionId: () => "sess-1",
        getLeafId: () => leafId,
        getEntries: () => { if (opts.throwOnGetEntries) throw new Error("boom"); return opts.entries ?? []; },
      };
      return { sessionManager } as unknown as ExtensionContext;
    }
    ```
  - HELPERS (local, mirroring markers.test.ts shape): makeRewindEntry(entryId, uuid), makeShrinkEntry(entryId, uuid),
    makeCancelEntry(targetId) returning custom SessionEntry objects with DISTINCT entry.id vs data.id (uuid).
    (Rewind data needs the full RewindMarker shape minimally — kind, id, granularity, options, note, ledger, seq, ts.
     Shrink data needs kind, id, target, replacement, seq, ts. Cancel data needs kind, targetId, seq, ts. The cancel
     tool only reads customType + data.id/data.targetId, so minimal payloads suffice.)
  - run(pi, ctx, params) helper: makeCancelTool(pi).execute("call-1", params, undefined, undefined, ctx).
  - firstText(res): narrow content[0].text.
  - CASES (one it each):
    1. "cancelling an existing rewind maps its entry id → uuid targetId and appends a mulligan:cancel":
       entries=[makeRewindEntry("entry-rw-1","uuid-rw-1")]; run({markerId:"entry-rw-1"}); assert appended.length===1,
       appended[0].customType==="mulligan:cancel", appended[0].data.targetId==="uuid-rw-1" (NOT "entry-rw-1"),
       firstText matches /marker cancelled/, res.details.cancelled===true, res.details.markerId==="leaf-1".
    2. "cancelling an existing shrink behaves identically": entries=[makeShrinkEntry("entry-sh-1","uuid-sh-1")];
       run({markerId:"entry-sh-1"}); assert appended[0].data.targetId==="uuid-sh-1", cancelled===true.
    3. "non-existent markerId is a safe no-op (appendEntry NOT called)": entries=[makeRewindEntry("entry-rw-1","uuid-rw-1")];
       run({markerId:"nope"}); assert appended.length===0, firstText matches /no active marker found/, cancelled===false.
    4. "already-cancelled marker is a safe no-op": entries=[makeRewindEntry("entry-rw-1","uuid-rw-1"),
       makeCancelEntry("uuid-rw-1")]; run({markerId:"entry-rw-1"}); assert appended.length===0,
       firstText matches /already cancelled/, cancelled===false.
    5. "config.enabled===false refuses (E14)": setConfig({enabled:false}); run({markerId:"entry-rw-1"});
       assert appended.length===0, firstText==="Mulligan: refused — Mulligan is disabled.", res.details canceled via
       details:{} (no cancelled field). RESET config after (setConfig(undefined) or structuredClone default) to avoid
       bleeding into later tests.
    6. "appendEntry throwing → refusal text, never throws": makePi({throwOnAppend:true}) with a valid rewind entry;
       run({markerId:"entry-rw-1"}); assert firstText matches /unexpected error/, res does NOT throw.
       (NOTE: appendCancelMarker catches internally and returns null — so to test the OUTER catch, make getEntries
        throw instead via makeCtx({throwOnGetEntries:true}) AFTER the config gate, OR mock appendCancelMarker. Simplest:
        throwOnGetEntries proves the outer try/catch wraps step 2. Document that appendCancelMarker's own catch makes
        the append-throws path unreachable through the public API — cover it by asserting the outer catch on a throwing
        getEntries instead.)
    7. "registration metadata: makeCancelTool returns the correct ToolDefinition": const tool = makeCancelTool(fakePi);
       assert tool.name==="mulligan_cancel", tool.label==="Mulligan Cancel", tool.description===CANCEL_DESC,
       tool.parameters===CancelParams; expectTypeOf(tool).toEqualTypeOf<ToolDefinition<typeof CancelParams, CancelDetails>>().
  - TYPE ASSERTS (match shrink.test.ts): expectTypeOf(res).toEqualTypeOf<AgentToolResult<CancelDetails>>() on a run.
  - PLACEMENT: test/tools/cancel.test.ts.

Task 6: MODIFY spec/05-tools.md — document mulligan_cancel (Mode A: rides with the work)
  - INSERT a new section. Recommended placement: AFTER §4 (audit) as new §5 "mulligan_cancel", bumping the
    registration summary to §6 and cross-refs to §7 (renumber the two `## 5.` / `## 6.` headings). Alternative:
    insert as `## 3.5 mulligan_cancel` between checkpoint(§3) and audit(§4) to avoid renumbering — either is
    acceptable per the contract ("new §3.5 or renumber"). Pick ONE and be consistent.
  - SECTION CONTENT (mirror §2 shrink's structure — Purpose / When to use / Parameter schema / Return shape /
    Behavior / refusal conditions):
    * Purpose: retract a mulligan:rewind or mulligan:shrink marker so it no longer applies going forward (E21;
      amends D6). The agent passes the markerId it received in details.markerId from the issuing call.
    * Parameter schema (copy the CancelParams typebox VERBATIM incl. the markerId description).
    * Return shape: success `{content:[{type:"text", text:"Mulligan: marker cancelled. The transform will no longer apply from the next turn on."}], details:{cancelled:true, markerId}}`;
      no-op (non-existent) `details:{cancelled:false}`; no-op (already-cancelled) `details:{cancelled:false}`;
      refusal (disabled) `details:{}`.
    * Behavior (step by step, mirroring the contract steps 1-8): config gate → read getEntries FRESH → find entry by
      id+customType → map to data.id(uuid) → check not-already-cancelled → appendCancelMarker → confirmation. Note
      the markerId(entry id)→targetId(uuid) mapping explicitly. Note cancelled markers stay on disk (audit trail);
      the drop takes effect on the NEXT context fire (D7/readMarkers). Note retraction is forward-only — it does NOT
      undo on-disk side effects (D1/E5) or replay hidden content (E21).
    * Refusal conditions: disabled (config.enabled false), non-existent markerId (no-op, not a refusal — returns
      cancelled:false), already-cancelled (no-op). Reference the D6-amendment framing.
  - UPDATE the registration-summary code block: add a 5th line:
    `pi.registerTool({ name:"mulligan_cancel", label:"Mulligan Cancel", description: CANCEL_DESC, parameters: CancelParams, execute: cancelExecute });`
    (Add a prose note that index.ts uses the FACTORY form `pi.registerTool(makeCancelTool(pi))` — the block is the
    summary form for consistency with the existing 4 lines.)
  - ADD CANCEL_DESC (the verbatim string from Task 1) to the description-strings list in the registration-summary section.
```

### Implementation Patterns & Key Details

```typescript
// The local readOwn/isRecord clones (filter.ts's are private — DO NOT import them; clone verbatim):
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readOwn(obj: unknown, key: string): unknown {
  if (!isRecord(obj)) return undefined;
  try {
    return obj[key];
  } catch {
    return undefined; // a Proxy get-trap may throw — swallow (defense-in-depth, E13)
  }
}

// refusal() — identical to shrink.ts's (every path needs `details`):
function refusal(reason: string): AgentToolResult<CancelDetails> {
  return {
    content: [{ type: "text", text: `Mulligan: refused — ${reason}.` }],
    details: {}, // no `cancelled` on the refusal path (matches shrink's details:{} on refusal)
  };
}

// The markerId(entry id)→targetId(uuid) mapping — the CORE indirection:
//   agent passes markerId (the ENTRY id from details.markerId = getLeafId())
//   tool finds entry.id===markerId (customType rewind/shrink) → reads entry.data.id (the uuid)
//   tool appends cancel with targetId=uuid → readMarkers drops by data.id∈cancelledIds NEXT fire
// TRUTH TABLE for step 3 (find target):
//   entry.id !== markerId                → skip (not the target)
//   customType not in {rewind,shrink}    → skip (wrong kind; excludes notes/turn-metric/cancel)
//   data.id not a non-empty string       → skip (malformed marker) → eventually no-op (safe)
//   otherwise                            → targetUuid = data.id (uuid); break

// Step 5 (already-cancelled) short-circuits to a no-op BEFORE appendCancelMarker, preventing duplicate cancels
// (idempotency). It re-scans ALL entries (a cancel could appear anywhere); O(n) is fine (sessions are bounded).

// appendCancelMarker(pi, ctx, {targetId: uuid}) — the SOLE write. It never throws (try/catch→null internally).
// Its return (the cancel marker's ENTRY id) becomes details.markerId on the success path. If it returns null
// (append threw / no leaf), details.markerId===null but cancelled stays true (the intent was recorded best-effort —
// matching how rewind/shrink report markerId:null on a failed leaf capture).
```

### Integration Points

```yaml
TYPES (src/tools/cancel.ts):
  - exports: makeCancelTool (factory), CancelParams (typebox), CancelArgs (Static), CancelDetails (interface), CANCEL_DESC (string)

REGISTRATION (src/index.ts):
  - add import: "import { makeCancelTool } from \"./tools/cancel.js\";"
  - add call: "pi.registerTool(makeCancelTool(pi));"  (5th tool; after auditTool)
  - update comment: "4" → "5" agent-callable tools

NO DATABASE / NO CONFIG CHANGES / NO EVENT HANDLERS / NO FILTER CHANGES:
  - markers.ts appendCancelMarker/CancelMarker/CancelMarkerInput — ALREADY LANDED (P3.M1.T1.S1); read-only consumer.
  - filter.ts readMarkers cancel-drop — ALREADY LANDED (P3.M1.T2.S1); read-only consumer (this tool's appendCancelMarker
    writes data.targetId; readMarkers drops by data.id∈cancelledIds next fire).
  - config.ts — read-only (getConfig().enabled master gate only); NO new config.cancel knob.
  - DO NOT touch markers.ts, filter.ts, transforms.ts, nudges.ts, config.ts, runtime.ts.

DOCS (spec/05-tools.md):
  - new mulligan_cancel section (Purpose/schema/return/behavior/refusal; reference E21 + D6-amendment).
  - registration-summary code block: 5th registerTool line.
  - description-strings list: add CANCEL_DESC.

DOWNSTREAM CONSUMERS (no edit needed this task; documented for awareness):
  - readMarkers (filter.ts): consumes the mulligan:cancel entry's data.targetId → drops the retired marker next fire.
  - mulligan_audit (audit.ts, P3.M1.T4.S1): will list cancelled markers as retired (reads markers.cancelledIds).
  - stale-retirement (P3.M2.T3.S1): will call appendCancelMarker directly to retire stale shrinks (same wrapper).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Type-check the whole project (typescript ^5 devDep; no separate build script).
npx tsc --noEmit
# Expected: zero errors. cancel.ts is a fresh file with full type annotations; the makeCancelTool return type is
# ToolDefinition<typeof CancelParams, CancelDetails>. If a type error appears, the two usual causes are:
#   (1) a return path missing `details` (Pi's AgentToolResult<T> REQUIRES it — strict tsconfig), or
#   (2) params/ctx typed loosely — ensure execute's ctx is ExtensionContext and params is CancelArgs.
# index.ts: adding makeCancelTool(pi) to pi.registerTool is type-clean (same signature as the other factories).

# (No linter/formatter is configured — package.json has only "test" and "smoke" scripts.)
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run ONLY the new cancel test file (fast feedback while iterating).
npx vitest run test/tools/cancel.test.ts
# Expected: all 7 cases pass:
#   cancel rewind (uuid mapping), cancel shrink, non-existent no-op, already-cancelled no-op,
#   config-disabled refusal, getEntries-throws → refusal (outer catch), registration metadata.

# Then run the tools/ suite to confirm no sibling regressions.
npx vitest run test/tools/
# Expected: rewind/shrink/checkpoint/audit tests still green (cancel.ts is additive; no shared mutable state beyond
# the runtime seq map, which clearAll() resets per test).

# Then the FULL suite (markers/audit/edge/drift/nudges/filter/transforms/tokens/ledger/notes/config/log/runtime/index).
npm test
# Expected: all green. markers.test.ts already tests appendCancelMarker (untouched). filter.test.ts tests the
# readMarkers cancel-drop (untouched). index.test.ts (if it asserts the registered tool set) may need the 5th tool
# — CHECK it; if it snapshots registered tool names, add "mulligan_cancel".
```

### Level 3: Integration Testing (System Validation)

```bash
# This task adds one tool registration (no event-handler signature change, no filter change). The integration smoke
# harness (test/integration/) is unaffected by the cancel tool existing (it exercises context/rewind/shrink). Optional:
npm run smoke   # optional — should pass unchanged (no cancel invocation in the smoke scenarios yet)

# The end-to-end retraction behavior (cancel a shrink → original message reappears next fire) is exercised
# TRANSITIVELY by filter.test.ts's cancel-drop tests (P3.M1.T2.S1) + cancel.test.ts's append test (this task):
# this tool writes the mulligan:cancel; readMarkers drops by its targetId next fire. No separate integration test is
# required for this task (the two unit layers compose the contract). A future integration scenario may chain them.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Behavioral proof via the unit tests (the real gate for this tool):
#   - cancel a rewind → appendCancelMarker({targetId: <uuid data.id>}); confirmation text; cancelled:true
#   - cancel a shrink → same
#   - non-existent markerId → no-op; appendEntry NOT called; cancelled:false
#   - already-cancelled → no-op; appendEntry NOT called; cancelled:false
#   - config disabled → refusal text; details:{}
#   - getEntries throws → outer catch → refusal text (never throws)
# These mirror E21 acceptance (a) "an agent can cancel any mulligan:rewind/mulligan:shrink by id" and (d)
# "cancelling a non-existent/already-cancelled id is a safe no-op that returns a reason and never throws (E13)".
# The (b) acceptance ("on the context fire after cancellation the transform no longer applies") is satisfied
# transitively by readMarkers (P3.M1.T2.S1) consuming this tool's appended cancel — covered by filter.test.ts.
```

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` — zero errors (cancel.ts fully typed; every return path has `details`).
- [ ] `npx vitest run test/tools/cancel.test.ts` — all 7 cases pass.
- [ ] `npm test` — full suite green (no regressions; check index.test.ts for a registered-tool-set assertion).

### Feature Validation
- [ ] `makeCancelTool(pi)` returns `{name:"mulligan_cancel", label:"Mulligan Cancel", description:CANCEL_DESC, parameters:CancelParams}`.
- [ ] Cancelling an existing rewind/shrink appends `mulligan:cancel` with `targetId` = the marker's uuid `data.id` (NOT the entry id); `details:{cancelled:true, markerId}`.
- [ ] Non-existent markerId → no-op text + `cancelled:false` + appendEntry NOT called.
- [ ] Already-cancelled marker → no-op text + `cancelled:false` + appendEntry NOT called.
- [ ] `config.enabled===false` → refusal text + `details:{}`.
- [ ] Tool never throws (outer try/catch → refusal on any exception, incl. a throwing getEntries).
- [ ] `src/index.ts` registers the 5th tool; comment updated to "5 agent-callable tools".

### Code Quality Validation
- [ ] `cancel.ts` mirrors `shrink.ts`'s factory structure (closure-captured pi, defineTool, one try/catch, details everywhere).
- [ ] Local `isRecord`/`readOwn` clones are verbatim copies of filter.ts's (readOwn swallows Proxy-trap throws).
- [ ] `.js` ESM import paths used (`../markers.js`, `../config.js`).
- [ ] No changes outside `src/tools/cancel.ts`, `src/index.ts`, `test/tools/cancel.test.ts`, `spec/05-tools.md`.

### Documentation & Deployment
- [ ] `spec/05-tools.md` has the mulligan_cancel section (schema + return + behavior + refusal; references E21 + D6-amendment).
- [ ] Registration-summary code block has the 5th `registerTool` line; CANCEL_DESC added to the description-strings list.
- [ ] CANCEL_DESC states when to use the tool and what it accomplishes (cost/benefit framing for the LLM).

---

## Anti-Patterns to Avoid

- ❌ Do NOT pass the ENTRY id as the cancel's `targetId` — `targetId` MUST be the marker's uuid `data.id`. The tool MAPS entry id (markerId arg) → uuid (data.id). A bug that forwards the entry id makes the cancel a permanent no-op (readMarkers matches by `data.id`, never entry id).
- ❌ Do NOT import `readOwn`/`isRecord` from filter.ts — they are module-private and filter.ts is out of scope. Define LOCAL clones in cancel.ts.
- ❌ Do NOT omit `details` from ANY return path — Pi's `AgentToolResult<T>` REQUIRES it (strict tsconfig). `refusal()` returns `details:{}`; no-ops return `details:{cancelled:false}`; success returns `details:{cancelled:true, markerId}`.
- ❌ Do NOT let the tool throw — wrap the ENTIRE execute body in ONE try/catch → `refusal("unexpected error: …")` (E13).
- ❌ Do NOT add a `config.cancel` sub-knob — the gate is the MASTER `getConfig().enabled` ONLY (retraction is a safety hatch, always on when mulligan is on). rewind/shrink have sub-knobs; cancel intentionally does not.
- ❌ Do NOT skip the already-cancelled check — it prevents duplicate `mulligan:cancel` entries (idempotency). Re-scan all entries for `customType==="mulligan:cancel" && data.targetId===uuid`.
- ❌ Do NOT cache the `sessionManager` handle or `getEntries()` result across execute calls — read FRESH each invocation (C12). The entries array may rebind after operations.
- ❌ Do NOT read `entry.id`/`data.id`/`data.targetId` directly — go through `readOwn` (a Proxy get-trap may throw; readOwn swallows it → undefined → safe skip/no-op).
- ❌ Do NOT modify markers.ts, filter.ts, transforms.ts, nudges.ts, config.ts, or runtime.ts — this task is cancel.ts + index.ts + cancel.test.ts + spec/05-tools.md only. (markers.ts and filter.ts are ALREADY landed; treat them as read-only contracts.)
- ❌ Do NOT stamp an `id` on the cancel payload — `appendCancelMarker` takes `{targetId}` ONLY (CancelMarkerInput === `{targetId:string}`; CancelMarker has NO id field — a cancel isn't cancellable).
- ❌ Do NOT use sync where async is required — `execute` is `async` (returns `Promise<AgentToolResult<CancelDetails>>`), matching shrink.ts. The body itself is synchronous logic; the `async` keyword + the factory's `async execute` signature satisfy the contract.
- ❌ Do NOT use non-`.js` import paths — ESM/Bundler resolution requires `../markers.js` / `./tools/cancel.js`. Every existing src file does this.

---

## Confidence Score

**9 / 10** — one-pass success is highly likely. The tool is a strict simplification of `makeShrinkTool` (the exact, fully-commented template present in-repo): same factory shape, same refusal/details/try-catch discipline, but with the best-effort-match + note machinery stripped and replaced by a linear scan + delegate. The persistence wrapper (`appendCancelMarker`) and the runtime consumer (`readMarkers` cancel-drop) are BOTH already landed and unit-tested, so this task is pure additive glue. The one non-obvious correctness hinge — the `markerId`(entry id)→`targetId`(uuid) indirection — is pinned by the landed contracts (markers.ts `appendCancelMarker` takes `targetId`; filter.ts `readMarkers` drops by `data.id`) and is explicitly proven by the test design (distinct entry-id vs uuid fixture values). The `readOwn`/`isRecord` private-to-filter.ts constraint is the only "gotcha" that could trip a naïve implementer — it is documented in three places above. Residual risk: `index.test.ts` may snapshot/assert the registered tool set and need the 5th entry (flagged in Level 2). No other downstream surface is affected (the cancel tool only writes a marker that readMarkers already knows how to drop).