# PRP — P1.M4.T1.S2: `leaveNote` + `setCheckpoint` — the note (sendMessage) + checkpoint (setLabel) wrappers

**Work item:** P1.M4.T1.S2 · **Points:** 1 · **Stage:** Pi Integration Layer (spec/11 §2 Step 4 — the `leaveNote` +
`setCheckpoint` half of `markers.ts`)
**Scope:** **APPEND to two existing files** — `src/markers.ts` (the `NoteDetails` interface + the `SetCheckpointResult`
type + the `leaveNote` and `setCheckpoint` wrappers) and `test/markers.test.ts` (extend `makePi` to also capture
`sendMessage`/`setLabel`; append the `leaveNote`/`setCheckpoint`/types describe blocks). **No new files. No other file
is touched.** This is **S2 of the `markers.ts` build** — it appends to the module S1 (P1.M4.T1.S1) created and REUSES
the `ExtensionAPI`/`ExtensionContext` imports + the hot-path-never-throws discipline S1 established.

> **Runs in parallel with S1's implementation.** Treat the S1 PRP (`plan/001_2e5baf25fe9f/P1M4T1S1/PRP.md`) as a
> CONTRACT: when S2 begins, `src/markers.ts` exists exporting `MulliganEnvelope`/`RewindMarker`/`ShrinkMarker`/
> `TurnMetric`/`ShrinkTarget` + the three `*Input` types + `appendRewindMarker`/`appendShrinkMarker`/`appendTurnMetric`
> (each `: string | null`, try/catch → `null`), already importing `randomUUID`, `ExtensionAPI`, `ExtensionContext`,
> `nextSeq`, `Granularity`, `FileLedger`, `NoteInput`. **Verified live** during S2 research: S1 is implemented (the
> file matches the S1 PRP verbatim); `npx tsc --noEmit` exits 0; `test/markers.test.ts` exists with hand-rolled
> `makePi`/`makeCtx` fakes.

---

## Goal

**Feature Goal**: Ship Mulligan's **note + checkpoint wrappers** — the two remaining Pi-coupled glue functions in
`markers.ts`. `leaveNote` appends the agent's self-authored rewind note as an **in-context** `CustomMessage`
(`pi.sendMessage`, customType `mulligan:note`) so the resumed model reads it as its most-recent context; `setCheckpoint`
labels the current leaf as a named checkpoint (`pi.setLabel`, label `mulligan:checkpoint:<name>`) so a later
`mulligan_rewind(granularity:"checkpoint")` can target it. Together they complete the write surface every agent tool
consumes: the rewind tool calls `appendRewindMarker` then `leaveNote`; the checkpoint tool calls `setCheckpoint`.

**Deliverable** (APPEND to two existing files — no new files):
1. **`src/markers.ts`** — append, after S1's `appendTurnMetric`:
   - `export interface NoteDetails` — the `mulligan:note` `CustomMessage` details envelope
     (`{schema:"pi-mulligan", v:1, kind:"note", rewindId}`; spec/04 §3 end). **NOT** a `MulliganEnvelope` (`kind:"note"`
     is outside the marker kind union).
   - `export type SetCheckpointResult = { entryId: string } | { error: string }` — `setCheckpoint`'s return.
   - `export function leaveNote(pi, content, rewindId): void` — `pi.sendMessage({customType:"mulligan:note", content,
     display:true, details})` with **no `options` arg** (C8); try/catch swallow (hot-path discipline).
   - `export function setCheckpoint(pi, ctx, name): SetCheckpointResult` — `getLeafId` → null-check → `setLabel(leafId,
     "mulligan:checkpoint:"+name)` → `{entryId}`; try/catch → `{error}`.
   - **No new imports** — `ExtensionAPI`/`ExtensionContext` are already imported by S1; these wrappers use only them.
2. **`test/markers.test.ts`** — extend `makePi` (add `sendMessage`/`setLabel` capture + `throwOnSendMessage`/
   `throwOnSetLabel`), extend the `markers.js` import (`leaveNote`, `setCheckpoint`, `type NoteDetails`,
   `type SetCheckpointResult`), and append the `leaveNote` / `setCheckpoint` / `NoteDetails`+`SetCheckpointResult`
   describe blocks. `makeCtx` is **reused as-is** (it already exposes `getLeafId` with `leafId` + `throwOnGetLeafId`).

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0** (the new types + wrappers type-sound under `strict`; the
  `sendMessage`/`setLabel` calls match the verified `.d.ts` signatures).
- `npx vitest run test/markers.test.ts` → all markers tests pass, including the new S2 describe blocks.
- `npx vitest run` → **all-green, no regression**. (S2 adds tests only; it cannot touch another suite. See the
  known-baseline caveat below.)
- `leaveNote`: calls `pi.sendMessage` **exactly once** with `customType:"mulligan:note"`, `display:true`, the caller's
  `content`, and `details:{schema:"pi-mulligan", v:1, kind:"note", rewindId}`; passes **no second `options` arg**
  (no `triggerTurn` — C8); returns `void`; **never throws** (swallows a throwing `sendMessage`).
- `setCheckpoint`: reads `ctx.sessionManager.getLeafId()` **fresh** (C12); returns `{error:"no leaf"}` when it is
  `null` **without** calling `setLabel`; otherwise calls `pi.setLabel(leafId, "mulligan:checkpoint:"+name)` **once**
  and returns `{entryId: leafId}`; **never throws** — a thrown `setLabel`/`getLeafId` yields `{error: <msg>}`.

---

## User Persona

**Target User**: The implementing AI agents for `tools/rewind.ts` (`mulligan_rewind`, P1.M5.T1.S1) and
`tools/checkpoint.ts` (`mulligan_checkpoint`, P1.M5.T3.S1) — the **two runtime consumers**. Per spec/05 §1 step 6,
the rewind tool — after `appendRewindMarker` and capturing the marker entry id — calls
`pi.sendMessage({customType:"mulligan:note", content: renderedNote, display:true, details:{schema, v:1, kind:"note",
rewindId}})`; `leaveNote` is exactly that call factored into a named, never-throwing wrapper. Per spec/05 §3, the
checkpoint tool validates the name (`/^[a-z0-9_-]{1,40}$/`), then `getLeafId` → `setLabel(leafId, prefix+name)` →
returns the entry id; `setCheckpoint` is the `getLeafId`→`setLabel`→return half (validation stays in the tool). The
second consumer is the test suite (spec/10) + the audit tool (P1.M5.T4, which enumerates checkpoints by reading
`label` entries — it does not call `setCheckpoint`, but may import `SetCheckpointResult`/`NoteDetails` for typing).

**Use Case**: An agent just wasted a turn and calls `mulligan_rewind`. The tool has already persisted the rewind
marker (control state, NOT in context) via `appendRewindMarker`. Now it must deliver the **note** — the structured,
self-authored guidance the resumed model will read — into LLM context. It calls `leaveNote(pi, renderedNote,
rewindId)`. The note becomes the most-recent context the resumed model sees (C5: the model auto-continues; C8:
sendMessage is safe from a tool). Separately, before a speculative sub-task, the agent calls `mulligan_checkpoint`;
the tool validates the name and calls `setCheckpoint(pi, ctx, name)`, which labels the current leaf so a later
rewind can jump straight back.

**User Journey**:
1. The rewind/checkpoint tool obtains `pi` (ExtensionAPI) + `ctx` (ExtensionContext) — from `execute(..., ctx)` for a
   tool; `pi` from the factory closure.
2. Rewind tool: `const markerEntryId = appendRewindMarker(pi, ctx, {...});` then `leaveNote(pi, renderedNote,
   markerEntryId);` (the rewind tool passes the marker's entry id as `rewindId` — see the interface note in Why).
3. Checkpoint tool: validate `name`; `const res = setCheckpoint(pi, ctx, name);` then echo `res.entryId` to the agent
   (or surface `res.error` as a refusal if `res` is the error arm).
4. On the next inference: the `context` filter (P1.M4.T2) reads the `mulligan:note` `custom_message` entry as part of
   the active branch (it's in context by Pi's design — no filter action needed for the note), applies the rewind, and
   the resumed model works from `[kept prefix] + [note] + [rewind confirmation]`. For a checkpoint-targeted rewind,
   the filter maps the `mulligan:checkpoint:<name>` `label` entry → a message position (spec/06 §6).

**Pain Points Addressed**: `pi.sendMessage` and `pi.setLabel` are low-level Pi calls with two subtle invariants that
are easy to get wrong and noisy if repeated across tools: (a) **C8** — never pass `triggerTurn:true` from inside a
tool (we're mid-turn; doing so would recurse the loop destructively); (b) **C1** — `setLabel` is on `ExtensionAPI`
(`pi`), **not** on `ReadonlySessionManager` (a tool that tries `ctx.sessionManager.setLabel(...)` will not compile).
Centralizing both in named wrappers (alongside S1's `appendRewindMarker` family) guarantees the invariants hold
everywhere and gives the tools a clean, never-throwing call surface.

---

## Why

- **Completes the Pi Integration write surface — unblocks the agent tools.** `leaveNote` is the second half of every
  rewind (S1's `appendRewindMarker` is the first); `setCheckpoint` is the entirety of the checkpoint tool's Pi
  interaction. Until both ship, `tools/rewind.ts` (P1.M5.T1.S1) and `tools/checkpoint.ts` (P1.M5.T3.S1) cannot be
  implemented. Shipping them now lets those tools be pure glue (validate → render → call the wrapper → format the
  result).
- **Faithful to the spec's data flow (spec/04 §1 table).** The note is a `custom_message` (**IN** context — the
  resumed model must read it); the checkpoint is a `label` (**NOT** in context — resolved only on a targeted rewind).
  `leaveNote` uses `sendMessage` (→ `custom_message`); `setCheckpoint` uses `setLabel` (→ `label`). Getting the
  Pi-call↔entry-type mapping right is the whole point: a marker's note that landed as a `custom` entry (via
  `appendEntry`) would be invisible to the model — a silent, catastrophic failure.
- **Encapsulates the two easy-to-miss invariants (C8, C1) in one place.** A stray `triggerTurn:true` would recurse the
  agent loop mid-turn (C8); a `ctx.sessionManager.setLabel(...)` call would not type-check (C1). Both wrappers bake in
  the correct call (no `options` for `leaveNote`; `pi.setLabel` for `setCheckpoint`) so downstream tools cannot get
  them wrong.
- **Honors the module's never-throws hot-path discipline (established by S1's GOTCHA #3).** `markers.ts` sits on the
  tool/event hot path — a throw breaks an agent turn. S1's three `append*` wrappers never throw (try/catch → `null`).
  The two S2 wrappers match: `setCheckpoint` returns `{error}` instead of throwing; `leaveNote` swallows (the rewind
  marker — the authoritative control state — is already persisted by the caller, so a failed note is non-fatal). See
  GOTCHA #1 for the `leaveNote` swallow decision.

### Interface note — what `rewindId` semantically is (for the rewind tool, P1.M5.T1.S1)

`leaveNote(pi, content, rewindId)` is **rewindId-agnostic**: it places whatever `rewindId` it receives into
`details.rewindId`. spec/04 §3 literally names `rewindId: <marker.id>` (the marker's uuid). BUT the rewind tool's
only handle to the marker is `appendRewindMarker`'s **return value = the marker's entry id (leaf id)** — S1's wrapper
generates the uuid internally and returns the leaf id, so the tool does not have the uuid. In practice the rewind
tool will pass the **leaf id** as `rewindId`. Both ids are unique-per-entry, so note↔marker correlation works either
way; the leaf id is simply the value the call chain yields. **`leaveNote` does not care** — this is the rewind tool's
decision. Flagged here so the S2→S5 interface is unambiguous. (`setCheckpoint` has no such ambiguity: it returns the
leaf id directly as `entryId`.)

---

## What

APPEND to `src/markers.ts` (after S1's last wrapper) and to `test/markers.test.ts` (extend `makePi`; add imports;
append describe blocks). The exact code is in the Implementation Blueprint (copy verbatim).

- **`leaveNote(pi: ExtensionAPI, content: string, rewindId: string): void`** —
  `pi.sendMessage({customType:"mulligan:note", content, display:true, details:{schema:"pi-mulligan", v:1, kind:"note",
  rewindId}})`, with **no second `options` argument** (C8). Whole body in `try { ... } catch { /* swallow */ }`. The
  `details` literal is annotated `: NoteDetails` for compile-time shape checking.
- **`setCheckpoint(pi: ExtensionAPI, ctx: ExtensionContext, name: string): SetCheckpointResult`** —
  `try { const leafId = ctx.sessionManager.getLeafId(); if (!leafId) return { error: "no leaf" };
  pi.setLabel(leafId, \`mulligan:checkpoint:${name}\`); return { entryId: leafId }; } catch (e) { return { error:
  e instanceof Error ? e.message : String(e) }; }`.
- **`NoteDetails`** = `{ schema:"pi-mulligan"; v:1; kind:"note"; rewindId:string }` — the `mulligan:note`
  `CustomMessage` details envelope (spec/04 §3 end). Exported. **NOT** a `MulliganEnvelope`.
- **`SetCheckpointResult`** = `{ entryId: string } | { error: string }`. Exported.

This subtask does **NOT**: touch S1's existing interfaces/wrappers/imports in `markers.ts`; implement the rewind or
checkpoint tool (P1.M5.T1/T3); validate the note fields or the checkpoint name (the tools' jobs); implement the
context filter (P1.M4.T2); wire anything into `index.ts` (P1.M7.T1); pass `options`/`triggerTurn` to `sendMessage`;
call `setLabel` on `ctx.sessionManager`; or create any new file.

### Success Criteria

- [ ] `src/markers.ts` EXPORTS `leaveNote`, `setCheckpoint`, `NoteDetails`, `SetCheckpointResult` (appended after
      S1's `appendTurnMetric`; S1's existing exports unchanged).
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] `npx vitest run test/markers.test.ts` → all markers tests pass (incl. the new S2 describe blocks); `npx vitest run`
      → no regression (see known-baseline caveat below).
- [ ] **`leaveNote` calls `pi.sendMessage` exactly once** with `customType:"mulligan:note"`, `display:true`, the
      caller's `content`, and `details` equal to `{schema:"pi-mulligan", v:1, kind:"note", rewindId}`.
- [ ] **`leaveNote` passes NO second argument** (`options === undefined` → no `triggerTurn` — C8).
- [ ] **`leaveNote` returns `void`** and **never throws** (a throwing `sendMessage` is swallowed → `undefined`).
- [ ] **`setCheckpoint` prefixes the name** — `setLabel` is called with `"mulligan:checkpoint:" + name` (owns the
      namespace; passes the raw validated name through).
- [ ] **`setCheckpoint` writes through `pi.setLabel` and reads through `ctx.sessionManager.getLeafId`** (C1/C9 split).
- [ ] **`setCheckpoint` returns `{entryId: leafId}` on success** (the same leaf id it labeled).
- [ ] **`setCheckpoint` returns `{error:"no leaf"}` when `getLeafId()` is null**, and does **not** call `setLabel`.
- [ ] **`setCheckpoint` never throws** — a thrown `setLabel` or `getLeafId` yields `{error: <string>}`.
- [ ] **`NoteDetails` is NOT assignable to `MulliganEnvelope`** (`kind:"note"` ∉ `"rewind"|"shrink"|"turn-metric"`).

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"_
> — **Yes.** The exact code to APPEND to `src/markers.ts` is given verbatim in the Implementation Blueprint (Task 1),
> and the exact `makePi` extension + new describe blocks for `test/markers.test.ts` are given verbatim (Task 2). The
> two Pi signatures (`sendMessage` → `void`, message = `Pick<CustomMessage<T>,"customType"|"content"|"display"|"details">`,
> optional `options?:{triggerTurn?;deliverAs?}`; `setLabel(entryId, label:string|undefined): void`) are quoted from
> the **verified installed `.d.ts`** (`dist/core/extensions/types.d.ts:924` + `:942`); `getLeafId(): string | null`
> from `dist/core/session-manager.d.ts:239`; the `CustomMessageEntry`/`LabelEntry` shapes from `:97`/`:75`. The two
> proven constraints (C8, C9) + C1 (ReadonlySessionManager) are quoted from spec/02. The S1 module S2 appends to is
> confirmed present (verified live). No prior knowledge beyond "append two Pi-coupled wrappers to the existing
> markers.ts" is required.

### Scope decision (READ BEFORE CODING)

- **APPEND to `src/markers.ts` — it ALREADY EXISTS (S1 created it).** Do not rewrite it; do not touch S1's envelope /
  marker interfaces / `append*` wrappers / imports. Append `NoteDetails`, `SetCheckpointResult`, `leaveNote`,
  `setCheckpoint` after S1's `appendTurnMetric`. **No import changes** — `ExtensionAPI`/`ExtensionContext` are
  already imported.
- **APPEND to / EXTEND `test/markers.test.ts` — it ALREADY EXISTS (S1 created it).** (a) EXTEND `makePi` to also
  capture `sendMessage` + `setLabel` (additive — keep S1's `appendEntry`/`appended`). (b) EXTEND the `markers.js`
  import to add `leaveNote`, `setCheckpoint`, `type NoteDetails`, `type SetCheckpointResult`. (c) APPEND the new
  describe blocks at the end. **Reuse `makeCtx` as-is** — it already exposes `getLeafId` with `leafId` +
  `throwOnGetLeafId`, which is exactly what the `setCheckpoint` tests need.
- **`leaveNote` swallows (try/catch → void), even though the item contract writes `: void` with no try/catch.** This
  is a deliberate, documented alignment with the module's hot-path-never-throws discipline (S1's GOTCHA #3): the
  rewind marker is already persisted by the caller, so a throwing `sendMessage` must not break the turn. See GOTCHA
  #1. (`setCheckpoint`'s try/catch → `{error}` is explicitly mandated by the contract.)
- **`NoteDetails.kind` is `"note"`, NOT in the `MulliganEnvelope` kind union.** Do NOT make `NoteDetails extends
  MulliganEnvelope` (it won't type-check — `kind:"note"` ∉ `"rewind"|"shrink"|"turn-metric"`). Define it standalone.
- **`setCheckpoint` does NOT validate `name`.** The checkpoint tool (P1.M5.T3.S1) validates `/^[a-z0-9_-]{1,40}$/`
  (spec/05 §3 step 1) BEFORE calling the wrapper. The wrapper trusts the caller and just prefixes. Do not add a
  regex check here (would duplicate the tool's responsibility and couple the wrapper to the config).
- **Do NOT pass `options`/`triggerTurn` to `sendMessage`.** The wrapper calls `sendMessage(message)` — one argument.
  C8 is explicit: passing `triggerTurn:true` from inside a tool (mid-turn) recurses the loop destructively.
- **There is NO lint/format tool** (devDeps = typescript + vitest + @types/node only). The type+style gate is
  `tsc --noEmit`. Do not invent a ruff/eslint/prettier command.

### Documentation & References

```yaml
# MUST READ — authoritative sources for the two wrappers
- file: spec/02-proven-constraints.md
  section: "C8 (sendMessage from a tool is safe; do NOT pass triggerTurn:true) + C9 (setLabel/getLabel round-trip;
            setLabel on ExtensionAPI) + C1 (ReadonlySessionManager — setLabel absent) + C12 (read sessionManager fresh)"
  why: "THE constraint source. C8: leaveNote uses pi.sendMessage({customType, content, display}) and the note IS in
        context; default mid-turn behavior is correct (no triggerTurn). C9: checkpoints are pi.setLabel(leafId, label)
        round-trips. C1: setLabel is on `pi` (ExtensionAPI), NOT on ctx.sessionManager — confirmed by ReadonlySessionManager
        being a Pick of read methods only. C12: read ctx.sessionManager fresh each call (setCheckpoint does, inline)."
  critical: "C8 (no triggerTurn) + C1 (pi.setLabel, not ctx.sessionManager.setLabel) are THE two invariants leaveNote/
             setCheckpoint exist to enforce. Getting either wrong is a silent or compile-time failure."

- file: spec/04-data-model.md
  section: "§1 (customType→entry-type table: mulligan:note=custom_message/IN context; checkpoint=label/NOT in context)
            + §3 end (note details = {schema:'pi-mulligan', v:1, kind:'note', rewindId}) + §6 (checkpoint = LabelEntry,
            prefix 'mulligan:checkpoint:', names /^[a-z0-9_-]{1,40}$/)"
  why: "THE data-model source. §1 table: leaveNote MUST use sendMessage (→ custom_message, in context) — using appendEntry
        would make the note invisible to the model. §3 end: the exact NoteDetails shape. §6: the checkpoint label prefix +
        the read-back (getLabel / scan getEntries for label entries)."
  critical: "NoteDetails.kind is 'note' — NOT in the marker kind union, so NoteDetails is standalone (not MulliganEnvelope).
             The note's details.rewindId correlates to the marker (see the interface note in Why)."

- file: spec/05-tools.md
  section: "§1 mulligan_rewind step 6 (Persist) — the exact leaveNote call + §3 mulligan_checkpoint (Behavior)"
  why: "§1 step 6: 'pi.sendMessage({customType:\"mulligan:note\", content: renderedNote, display:true, details:{schema,
        v:1, kind:\"note\", rewindId: id}})' — leaveNote is this verbatim. §3: validate name → getLeafId →
        setLabel(leafId, 'mulligan:checkpoint:'+name) → return entry id — setCheckpoint is the getLeafId→setLabel→return
        half (validation stays in the tool)."
  critical: "The rewind tool calls leaveNote AFTER appendRewindMarker (order matters: marker first, then note). The
             checkpoint tool validates the name BEFORE calling setCheckpoint."

- file: plan/001_2e5baf25fe9f/architecture/api_verification.md
  section: "§2.1 (sendMessage/setLabel signatures) + §4 (getLeafId→string|null) + §5 (CustomMessageEntry/LabelEntry) +
            §9 (constraint table)"
  why: "The verified .d.ts signatures. sendMessage<T>(message: Pick<CustomMessage<T>, 'customType'|'content'|'display'|
        'details'>, options?:{triggerTurn?;deliverAs?}): void. setLabel(entryId: string, label: string|undefined): void.
        getLeafId(): string|null. CustomMessageEntry{type:'custom_message';customType;content;details?;display}.
        LabelEntry{type:'label';targetId;label:string|undefined}."
  critical: "sendMessage returns void (not a Promise on the tool-facing ExtensionAPI); getLeafId CAN be null (setCheckpoint
             null-checks). All re-verified against the installed dist during S2 research — see research/api-signatures-verified.md."

# THE S1 MODULE S2 APPENDS TO (read-only — treat as a contract)
- file: src/markers.ts
  section: "S1's full content (envelope + marker interfaces + appendRewindMarker/appendShrinkMarker/appendTurnMetric)"
  why: "S2 APPENDS to THIS file. Reuse the already-imported ExtensionAPI/ExtensionContext. Match S1's header-doc +
        JSDoc + try/catch-never-throws style. Append AFTER appendTurnMetric. Do not modify S1's lines."
  pattern: "S1's wrappers: `export function appendX(pi: ExtensionAPI, ctx: ExtensionContext, data: XInput): string|null
            { try { ...; pi.appendEntry(...); return ctx.sessionManager.getLeafId(); } catch { return null; } }` —
            leaveNote/setCheckpoint mirror the never-throws discipline (swallow / {error})."

- file: test/markers.test.ts
  section: "S1's makePi + makeCtx fakes + the clearAll() before/afterEach + the house style"
  why: "S2 EXTENDS makePi (add sendMessage/setLabel capture) and APPENDS describe blocks. Reuse makeCtx (it has getLeafId).
        Mirror the describe/it/expect/expectTypeOf conventions + the hand-rolled-fake approach (no vi.fn() required)."
  pattern: "makePi returns {appended, pi}; makeCtx returns {calls, ctx}. S2 extends makePi to also return {sent, labels}."

# PROOF PATTERNS (the empirical spike — mirror for the test fakes)
- file: spec/reference/looper-smoke.proto.ts
  section: "A2.sendMessage (line 224) + A4.setLabel (lines 234–238)"
  why: "A2 proves sendMessage → custom_message entry (in context). A4 proves setLabel(id,label) → getLabel(id) round-trips.
        The unit-test fakes mirror these: a fake pi.sendMessage capturing the message (+options), a fake pi.setLabel
        capturing (entryId,label), a fake ctx.sessionManager.getLeafId returning a scripted leaf id."
  critical: "Do NOT spin up a real `pi -e` for these unit tests — hand-rolled fakes are sufficient (markers.ts has no
             async). The real end-to-end (note in context; checkpoint resolves on a targeted rewind) is the filter
             (P1.M4.T2) + F-rewind-core/F-checkpoint integration (P1.M7.T2)."

# DOWNSTREAM CONSUMERS (read-only — these import what S2 exports)
- file: plan/001_2e5baf25fe9f/P1M4T1S1/PRP.md
  section: "S1's markers.ts contract (the file S2 appends to)"
  why: "The S1 PRP defines the exact markers.ts S2 appends to. Confirms S1 imports ExtensionAPI/ExtensionContext already,
        so S2 adds NO imports. Confirms S1's never-throws discipline that S2 matches."
- file: plan/001_2e5baf25fe9f/architecture/system_context.md
  section: "Module layout (markers.ts: appendEntry/setLabel/sendMessage wrappers + id capture)"
  why: "Confirms markers.ts is THE Pi-Integration write module owning all three Pi write calls (appendEntry=S1;
        sendMessage+setLabel=S2)."
```

### Current Codebase tree (state at this subtask's start — VERIFIED LIVE)

```bash
pi-mulligan/
├── package.json            # type:'module'; deps @earendil-works/pi-coding-agent *, typebox *; devDeps typescript ^5,
│                           #   vitest ^1, @types/node ^22; scripts.test:'vitest run'. NO eslint/prettier/biome.
├── tsconfig.json           # strict, noImplicitAny, types:['node'], moduleResolution:'Bundler', include:['src','test']
│                           #   (NO noUnusedParameters/noUnusedLocals; target ES2022). exit 0 verified.
├── src/
│   ├── index.ts            # no-op stub. DO NOT TOUCH.
│   ├── config.ts           # exports Granularity, MulliganConfig, DEFAULT_CONFIG, getConfig. DO NOT TOUCH.
│   ├── log.ts              # fail-open JSONL logger. DO NOT TOUCH.
│   ├── runtime.ts          # exports nextSeq/getRuntime/resetRuntime/clearAll + SessionRuntime. DO NOT TOUCH.
│   ├── tokens.ts / ledger.ts / notes.ts   # pure helpers (notes exports NoteInput). DO NOT TOUCH.
│   ├── transforms.ts       # pure core. DO NOT TOUCH.
│   └── markers.ts          # ← S1 CREATED THIS. S2 APPENDS NoteDetails + SetCheckpointResult + leaveNote + setCheckpoint.
│                           #   S1 imports already present: randomUUID, ExtensionAPI, ExtensionContext, nextSeq,
│                           #   Granularity, FileLedger, NoteInput. S2 adds NO imports.
├── test/
│   ├── config/ledger/log/runtime/tokens/notes/transforms.test.ts   # 7 files, all green. Read-only.
│   └── markers.test.ts     # ← S1 CREATED THIS. S2 EXTENDS makePi + the import + APPENDS describe blocks.
└── spec/                   # 02 (C8/C9/C1/C12) + 04 §1/§3/§6 + 05 §1 step6 / §3 + 10 (testing) + 11 §2 Step4.
# VERIFIED BASELINE: `npx tsc --noEmit -p tsconfig.json` → exit 0; `npx vitest run` → 8 files / 289 tests
#   (288 pass / 1 KNOWN pre-existing S1 failure — see caveat below; S1 owns its fix).
# This task is pure-append (2 existing files); it cannot regress the other 7 suites.
# NOTE: NO eslint/prettier/biome configured. The type+style gate is `tsc --noEmit` (TS strict). Do NOT invent lint/format.
# NOTE: `satisfies`/template-literal types are fine (TS ^5, target ES2022).
```

> **Known baseline caveat:** `test/markers.test.ts` has ONE pre-existing failure (~line 142,
> `expect(entry.id).toBe(id)` — asserts a stamped **uuid** equals the **leaf id**; always false). This is a bug in the
> **S1 PRP's verbatim test**, carried into the file. **S1 owns its fix; S2 must NOT modify S1's existing assertions.**
> When S2 begins, assume S1 is complete (that line fixed) → full suite green. S2's NEW describe blocks must pass
> independently. If you still see that failure after your work, it is NOT yours.

### Desired Codebase tree with files to be MODIFIED (THIS subtask — APPEND only)

```bash
pi-mulligan/
├── src/
│   └── markers.ts          # MODIFIED (APPEND): + NoteDetails interface + SetCheckpointResult type + leaveNote +
│                           #   setCheckpoint. (S1's content unchanged; no import changes.)
└── test/
    └── markers.test.ts     # MODIFIED (EXTEND + APPEND): makePi extended (sendMessage/setLabel capture) + import
                           #   extended (leaveNote, setCheckpoint, NoteDetails, SetCheckpointResult) + new describe
                           #   blocks appended. (makeCtx reused as-is; S1's existing tests unchanged.)
# No new files. No other files touched.
```

### Known Gotchas of our codebase & Library Quirks

```bash
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #1 (CRITICAL) — leaveNote swallows (try/catch → void), even though the item contract writes `: void` with no
#   try/catch. REASON: markers.ts sits on the tool/event hot path — a throw breaks an agent turn (S1's GOTCHA #3
#   established this for the append* wrappers; leaveNote must match). The rewind tool calls leaveNote AFTER
#   appendRewindMarker has ALREADY persisted the marker (the authoritative control state). So if sendMessage throws,
#   the rewind still takes effect via the filter; a failed note only means the resumed model has one fewer hint —
#   never a broken turn. Swallowing is SAFE and aligns with the module's discipline. The contract's `: void` return
#   is preserved (the catch returns void implicitly). If you prefer literal-contract fidelity, you MAY omit the
#   try/catch — but the swallow is the recommended, safer choice (and the tests assert `not.toThrow()`).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #2 (CRITICAL) — NEVER pass `options`/`triggerTurn` to sendMessage from leaveNote (C8). Call
#   `pi.sendMessage(message)` — ONE argument. triggerTurn:true from inside a tool (we are mid-turn) recurses the agent
#   loop destructively. The default (no options) is correct. The unit test asserts the fake's captured `options === undefined`.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #3 (CRITICAL) — setLabel is on ExtensionAPI (`pi`), NOT on ReadonlySessionManager (C1/C9). The wrapper takes
#   BOTH `pi` and `ctx`: writes via `pi.setLabel`, reads via `ctx.sessionManager.getLeafId`. Do NOT write
#   `ctx.sessionManager.setLabel(...)` — it is absent from the type (ReadonlySessionManager is a Pick of read methods)
#   and will not compile.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #4 (CRITICAL) — getLeafId() returns `string | null` (verified: dist/core/session-manager.d.ts:239). setCheckpoint
#   MUST null-check: `if (!leafId) return { error: "no leaf" }` — and must NOT call setLabel when there's no leaf.
#   The unit test asserts labels.length === 0 on the null path.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #5 (CRITICAL) — NoteDetails is NOT a MulliganEnvelope. kind:"note" is OUTSIDE the marker kind union
#   ("rewind"|"shrink"|"turn-metric"). Define `export interface NoteDetails { schema:"pi-mulligan"; v:1; kind:"note";
#   rewindId:string }` STANDALONE. Do NOT write `NoteDetails extends MulliganEnvelope` (won't type-check).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #6 — sendMessage returns `void` on the tool-facing ExtensionAPI (dist/.../types.d.ts:924; api_verification §2.1).
#   (A `ReplacedSessionContext` variant at :298 returns Promise<void>, but that is NOT the surface a tool uses.)
#   leaveNote does NOT await. The wrapper body is synchronous.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #7 — setCheckpoint does NOT validate the name. `/^[a-z0-9_-]{1,40}$/` (spec/05 §3 step 1) is the checkpoint
#   TOOL's responsibility (P1.M5.T3.S1), enforced BEFORE calling the wrapper. The wrapper trusts the caller and just
#   prefixes. Adding a regex here would duplicate the tool's job and couple the wrapper to config.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #8 — sendMessage's `content` accepts `string | (TextContent|ImageContent)[]`. leaveNote passes a plain string
#   (the rendered note from notes.renderNote) — a string is valid. Do not wrap it in an array.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #9 — `details` is the CustomMessage's generic `T`. Annotating the literal `const details: NoteDetails = {...}`
#   gives compile-time shape checking AND lets sendMessage infer T=NoteDetails. Do not inline an untyped object literal
#   (you'd lose the shape guard).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #10 — setCheckpoint reads ctx.sessionManager FRESH inside the function body (C12) — never cache the handle.
#   (It only calls getLeafId, but the discipline still applies.) leaveNote does not touch sessionManager at all.
# ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
# GOTCHA #11 — The test imports from "../src/markers.js" (.js extension, even though the file is markers.ts).
#   moduleResolution:"Bundler" + type:"module" → TS resolves .js to .ts. Established convention (every existing test).
# ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
# GOTCHA #12 — There is NO lint/format tool configured (devDeps = typescript + vitest + @types/node only). The
#   "Level 1 syntax & style" gate reduces to `tsc --noEmit` (TS strict IS the type+style gate). Do NOT invent a
#   ruff/eslint/prettier command — it would fail "command not found". Validation = tsc + vitest, nothing else.
# ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
# GOTCHA #13 (BASELINE) — test/markers.test.ts currently has ONE pre-existing S1 failure (~line 142,
#   `expect(entry.id).toBe(id)`). It is S1's bug (uuid vs leaf-id assertion), NOT S2's. S2 must NOT touch S1's
#   existing assertions; S2's NEW describe blocks must pass independently. If the full suite is still 1-failing after
#   S2, that failure is S1's to fix.
# ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

APPEND these to `src/markers.ts` (after S1's `appendTurnMetric`). Two new exported types:

```ts
// spec/04-data-model.md §3 end — the mulligan:note CustomMessage `details` envelope.
// NOTE (GOTCHA #5): NOT a MulliganEnvelope — kind:"note" is outside the marker kind union.
export interface NoteDetails {
  schema: "pi-mulligan";
  v: 1;
  kind: "note";
  /** Correlates the note to its rewind marker. The rewind tool passes appendRewindMarker's return (entry id);
   *  spec/04 §3 names <marker.id> (uuid) — both are unique; see PRP interface note. */
  rewindId: string;
}

// setCheckpoint's discriminated return (spec/05 §3). Narrow with `"entryId" in r` / `"error" in r`.
export type SetCheckpointResult = { entryId: string } | { error: string };
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY BASELINE (no edits — run only)
  - RUN: npx tsc --noEmit -p tsconfig.json          # expect exit 0
  - RUN: npx vitest run                              # expect 8 files; note the 1 KNOWN pre-existing S1 failure
                                                     #   (~line 142) — NOT yours (GOTCHA #13).
  - RUN: grep -n "export function appendTurnMetric" src/markers.ts   # confirm S1's last wrapper exists (append AFTER it)
  - RUN: grep -n "function makePi" test/markers.test.ts && grep -n "function makeCtx" test/markers.test.ts
        # confirm the S1 fakes you will extend exist.
  - RUN: grep -n "import {" test/markers.test.ts | head -1   # confirm the markers.js import block to extend.

Task 1: APPEND to src/markers.ts   (exact content below — copy verbatim, append after appendTurnMetric)
  - APPEND: the NoteDetails interface, the SetCheckpointResult type, the leaveNote function, the setCheckpoint function
    (in that order, after S1's appendTurnMetric and its closing brace).
  - CONSTRAINTS:
      * leaveNote: signature `(pi: ExtensionAPI, content: string, rewindId: string): void`. Body: try { const details:
        NoteDetails = {...}; pi.sendMessage({customType:"mulligan:note", content, display:true, details}); } catch {}
        — NO options arg (GOTCHA #2); swallows (GOTCHA #1).
      * setCheckpoint: signature `(pi: ExtensionAPI, ctx: ExtensionContext, name: string): SetCheckpointResult`. Body:
        try { const leafId = ctx.sessionManager.getLeafId(); if(!leafId) return {error:"no leaf"}; pi.setLabel(leafId,
        `mulligan:checkpoint:${name}`); return {entryId: leafId}; } catch(e) { return {error: ...message} }.
      * NoteDetails is STANDALONE (NOT extends MulliganEnvelope — GOTCHA #5). details annotated : NoteDetails (GOTCHA #9).
      * setLabel on `pi` (GOTCHA #3); getLeafId null-checked (GOTCHA #4); read ctx.sessionManager fresh (GOTCHA #10).
      * NO import changes (ExtensionAPI/ExtensionContext already imported by S1). NO name validation (GOTCHA #7).
  - NAMING/PLACEMENT: append to src/markers.ts. New exports: NoteDetails, SetCheckpointResult, leaveNote, setCheckpoint.

Task 2: EXTEND + APPEND to test/markers.test.ts   (exact content below — copy verbatim)
  - EDIT (extend) makePi: add `sent` + `labels` capture arrays, `sendMessage` + `setLabel` methods, and
    `throwOnSendMessage` + `throwOnSetLabel` options (keep S1's appendEntry/appended). Return {appended, sent, labels, pi}.
  - EDIT (extend) the markers.js import: add leaveNote, setCheckpoint, type NoteDetails, type SetCheckpointResult.
  - APPEND the new describe blocks (leaveNote, setCheckpoint, NoteDetails/SetCheckpointResult types) at END of file.
  - CONSTRAINTS: reuse makeCtx as-is (it has getLeafId + leafId + throwOnGetLeafId). Hand-rolled fakes (no vi.fn()).
  - COVERAGE: every success-criteria bullet has a corresponding assertion (sendMessage args, no-options, display:true,
    details envelope, void return, never-throws swallow; setLabel prefix, {entryId} success, {error:"no leaf"} null path
    with zero setLabel calls, never-throws on thrown setLabel/getLeafId, the pi-vs-ctx split, the union type, NoteDetails
    shape + non-assignability to MulliganEnvelope).

Task 3: VALIDATE (no edits — run the gates in the Validation Loop)
  - Level 1 (tsc) and Level 2 (vitest). Level 3 N/A (Pi-coupled glue — the real end-to-end is the filter P1.M4.T2 +
    the F-rewind-core / F-checkpoint integration P1.M7.T2; unit tests use fakes). Level 4 = the C8-no-options +
    never-throws + null-path assertions.
```

#### Exact content to APPEND — `src/markers.ts` (Task 1 — copy verbatim, after S1's `appendTurnMetric`)

```ts
// ── Note details envelope (spec/04-data-model.md §3 — the mulligan:note CustomMessage details) ─────────────

/**
 * NoteDetails — the `details` payload of the mulligan:note CustomMessage (spec/04 §3 end). Correlates the in-context
 * note back to the rewind marker that produced it. EXPORTED so the rewind tool (P1.M5.T1.S1), audit (P1.M5.T4), and
 * tests share ONE shape.
 *
 * NOTE (GOTCHA #5): this is NOT a `MulliganEnvelope` — `kind:"note"` is the message-level discriminator and is
 * intentionally OUTSIDE the marker kind union ("rewind"|"shrink"|"turn-metric"). The note is a CustomMessage
 * (custom_message entry, IN LLM context); markers are CustomEntrys (NOT in context).
 */
export interface NoteDetails {
  schema: "pi-mulligan";
  v: 1;
  kind: "note";
  /** Correlates the note to its rewind marker. The rewind tool passes appendRewindMarker's return value (the marker's
   *  entry id); spec/04 §3 literally names `<marker.id>` (uuid). Both are unique-per-entry, so correlation holds either
   *  way — see the PRP's interface note. */
  rewindId: string;
}

// ── leaveNote: append the rewind note as an in-context CustomMessage (spec/04 §3, spec/05 §1 step6; C8) ─────

/**
 * leaveNote — append the agent's self-authored rewind note as an in-context CustomMessage (spec/04 §3, spec/05 §1
 * step 6; constraint C8). The note IS in LLM context — the resumed model reads it as its most-recent context and uses
 * it to re-attempt the turn better-informed. The control marker (NOT in context) is persisted SEPARATELY by
 * appendRewindMarker BEFORE this call (the rewind tool calls appendRewindMarker first, then leaveNote).
 *
 * CRITICAL (C8 / GOTCHA #2): do NOT pass `options.triggerTurn:true` — leaveNote runs from inside a tool (we are
 * mid-turn); the default mid-turn behavior is correct. The wrapper passes ONLY the message object (no second arg).
 *
 * `display:true` (spec/04 §3) so the note is visible in the UI transcript (/tree). `content` is the rendered note
 * string (notes.renderNote output).
 *
 * Returns void. NEVER throws (markers.ts hot-path discipline, matching appendRewindMarker/appendShrinkMarker/
 * appendTurnMetric): a throwing `sendMessage` is swallowed (GOTCHA #1). This is SAFE because the rewind marker — the
 * authoritative control state — is already persisted by the caller; a failed note only means the resumed model has one
 * fewer hint, never a broken agent turn.
 *
 * @param pi       the Pi ExtensionAPI (sendMessage lives here — C8).
 * @param content  the rendered note string (notes.renderNote output).
 * @param rewindId correlates the note to its marker (rewindId-agnostic; see the PRP interface note).
 */
export function leaveNote(pi: ExtensionAPI, content: string, rewindId: string): void {
  try {
    const details: NoteDetails = { schema: "pi-mulligan", v: 1, kind: "note", rewindId };
    // C8: NO second `options` arg — we are mid-turn; triggerTurn must stay default (false).
    pi.sendMessage({ customType: "mulligan:note", content, display: true, details });
  } catch {
    // never throw on the tool hot path — the rewind marker is already persisted; a failed note is non-fatal (GOTCHA #1)
  }
}

// ── setCheckpoint: label the current leaf as a named checkpoint (spec/04 §6, spec/05 §3; C9, C1) ───────────

/**
 * SetCheckpointResult — the discriminated return of setCheckpoint. Success carries the labeled entry id (the checkpoint
 * tool echoes this to the agent); failure carries a short reason. Narrow with `"entryId" in r` / `"error" in r`.
 * EXPORTED for the checkpoint tool (P1.M5.T3.S1) + tests.
 */
export type SetCheckpointResult = { entryId: string } | { error: string };

/**
 * setCheckpoint — label the current leaf as a named checkpoint (spec/04 §6, spec/05 §3; constraints C9, C1).
 *
 * A checkpoint is a Pi `LabelEntry` (NOT a CustomEntry) — it does NOT participate in LLM context. It is resolved by
 * the context filter (P1.M4.T2, spec/06 §6) ONLY when a later `mulligan_rewind(granularity:"checkpoint",
 * checkpoint:"<name>")` targets it (the filter maps the labeled entry → a position in event.messages). The label uses
 * the `mulligan:checkpoint:` prefix so Mulligan checkpoints are distinct from user/bookmark labels.
 *
 * Writes through `pi.setLabel` (ExtensionAPI — C9/C1/GOTCHA #3: setLabel is on `pi`, NOT on ReadonlySessionManager);
 * reads the target leaf id through `ctx.sessionManager.getLeafId()` (`string | null` — GOTCHA #4: must null-check).
 * Reads `ctx.sessionManager` FRESH each call (C12/GOTCHA #10).
 *
 * Returns `{entryId: leafId}` on success, `{error: "no leaf"}` when `getLeafId()` is null (and does NOT call setLabel),
 * or `{error: <msg>}` on any thrown failure (try/catch). NEVER throws.
 *
 * NOTE (GOTCHA #7): `name` validation (`/^[a-z0-9_-]{1,40}$/`, spec/05 §3 step 1) is the checkpoint TOOL's job, NOT
 * this wrapper's — the wrapper trusts the caller's `name` and only prefixes it.
 *
 * @param pi   the Pi ExtensionAPI (setLabel lives here).
 * @param ctx  the Pi ExtensionContext (sessionManager.getLeafId lives here — read-only, C1).
 * @param name the checkpoint name (ALREADY validated by the caller); the wrapper prefixes it with `mulligan:checkpoint:`.
 */
export function setCheckpoint(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  name: string,
): SetCheckpointResult {
  try {
    const leafId = ctx.sessionManager.getLeafId();
    if (!leafId) return { error: "no leaf" };
    pi.setLabel(leafId, `mulligan:checkpoint:${name}`);
    return { entryId: leafId };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
```

#### Exact content — `test/markers.test.ts` EXTEND `makePi` (Task 2a — replace S1's `makePi` with this)

```ts
/** A minimal fake ExtensionAPI capturing appendEntry + sendMessage + setLabel calls (GOTCHA: hand-rolled, no vi.fn()).
 *  Set a throwOn* flag to simulate a Pi failure on any of the three write methods. */
function makePi(opts: {
  throwOnAppend?: boolean;
  throwOnSendMessage?: boolean;
  throwOnSetLabel?: boolean;
} = {}) {
  const appended: { customType: string; data: unknown }[] = [];
  const sent: {
    customType: string;
    content: unknown;
    display: boolean;
    details?: unknown;
    options?: unknown; // captured to assert leaveNote passes NO options (C8)
  }[] = [];
  const labels: { entryId: string; label: string | undefined }[] = [];
  const pi = {
    appendEntry(customType: string, data?: unknown) {
      if (opts.throwOnAppend) throw new Error("appendEntry boom");
      appended.push({ customType, data });
    },
    sendMessage(
      message: { customType: string; content: unknown; display: boolean; details?: unknown },
      options?: unknown,
    ) {
      if (opts.throwOnSendMessage) throw new Error("sendMessage boom");
      sent.push({ ...message, options });
    },
    setLabel(entryId: string, label: string | undefined) {
      if (opts.throwOnSetLabel) throw new Error("setLabel boom");
      labels.push({ entryId, label });
    },
  };
  return { appended, sent, labels, pi: pi as unknown as ExtensionAPI };
}
```

> `makeCtx` is **reused unchanged** (S1's version already exposes `getLeafId` with `leafId` + `throwOnGetLeafId`).

#### Exact content — `test/markers.test.ts` EXTEND the import (Task 2b — add these to the existing `markers.js` import)

Add `leaveNote`, `setCheckpoint`, `type NoteDetails`, `type SetCheckpointResult` to the existing import block from
`"../src/markers.js"` (keep S1's existing named imports). Resulting import shape:

```ts
import {
  appendRewindMarker,
  appendShrinkMarker,
  appendTurnMetric,
  leaveNote,
  setCheckpoint,
  type MulliganEnvelope,
  type RewindMarker,
  type RewindMarkerInput,
  type ShrinkMarker,
  type ShrinkMarkerInput,
  type ShrinkTarget,
  type TurnMetric,
  type TurnMetricInput,
  type NoteDetails,
  type SetCheckpointResult,
} from "../src/markers.js";
```

#### Exact content to APPEND — `test/markers.test.ts` new describe blocks (Task 2c — append at END of file)

```ts
// ── leaveNote — sendMessage mulligan:note, in-context, no triggerTurn (spec/04 §3, spec/05 §1 step6; C8) ────

describe("leaveNote — sendMessage mulligan:note, in-context, no triggerTurn (C8)", () => {
  it("calls pi.sendMessage once with customType 'mulligan:note', display:true, content=renderedNote", () => {
    const { sent, pi } = makePi();
    leaveNote(pi, "RENDERED NOTE BODY", "rewind-entry-7");
    expect(sent).toHaveLength(1);
    expect(sent[0].customType).toBe("mulligan:note");
    expect(sent[0].content).toBe("RENDERED NOTE BODY");
    expect(sent[0].display).toBe(true);
  });

  it("stamps details envelope {schema, v:1, kind:'note', rewindId} and passes rewindId verbatim", () => {
    const { sent, pi } = makePi();
    leaveNote(pi, "x", "leaf-abc");
    expect(sent[0].details).toEqual({
      schema: "pi-mulligan",
      v: 1,
      kind: "note",
      rewindId: "leaf-abc",
    });
  });

  it("does NOT pass options (no triggerTurn) — sendMessage receives NO second arg (C8, GOTCHA #2)", () => {
    const { sent, pi } = makePi();
    leaveNote(pi, "n", "r");
    expect(sent[0].options).toBeUndefined();
  });

  it("does NOT call appendEntry or setLabel (the note is a sendMessage, not a marker/label)", () => {
    const { appended, labels, pi } = makePi();
    leaveNote(pi, "n", "r");
    expect(appended).toHaveLength(0);
    expect(labels).toHaveLength(0);
  });

  it("returns void", () => {
    const { pi } = makePi();
    expectTypeOf(leaveNote(pi, "n", "r")).toEqualTypeOf<void>();
  });

  it("never throws — a throwing sendMessage is swallowed (GOTCHA #1; marker already persisted by caller)", () => {
    const { pi } = makePi({ throwOnSendMessage: true });
    expect(() => leaveNote(pi, "n", "r")).not.toThrow();
    expect(leaveNote(pi, "n", "r")).toBeUndefined();
  });
});

// ── setCheckpoint — setLabel mulligan:checkpoint:<name> (spec/04 §6, spec/05 §3; C9, C1) ────────────────────

describe("setCheckpoint — labels the leaf with 'mulligan:checkpoint:<name>' (spec/04 §6, C9)", () => {
  it("calls pi.setLabel once with (leafId, 'mulligan:checkpoint:'+name) and returns {entryId: leafId}", () => {
    const { labels, pi } = makePi();
    const { ctx } = makeCtx({ leafId: "leaf-9" });
    const res = setCheckpoint(pi, ctx, "before-refactor");
    expect(labels).toHaveLength(1);
    expect(labels[0]).toEqual({ entryId: "leaf-9", label: "mulligan:checkpoint:before-refactor" });
    expect(res).toEqual({ entryId: "leaf-9" });
  });

  it("owns the mulligan:checkpoint: namespace (prefixes); passes the raw name through", () => {
    const { labels, pi } = makePi();
    const { ctx } = makeCtx({ leafId: "L" });
    setCheckpoint(pi, ctx, "x_y-z1");
    expect(labels[0].label).toBe("mulligan:checkpoint:x_y-z1");
  });

  it("returns {error:'no leaf'} when getLeafId() is null, and does NOT call setLabel", () => {
    const { labels, pi } = makePi();
    const { ctx } = makeCtx({ leafId: null });
    const res = setCheckpoint(pi, ctx, "x");
    expect(res).toEqual({ error: "no leaf" });
    expect(labels).toHaveLength(0);
  });

  it("never throws — a throwing setLabel yields {error: string} (try/catch)", () => {
    const { pi } = makePi({ throwOnSetLabel: true });
    const { ctx } = makeCtx();
    expect(() => setCheckpoint(pi, ctx, "x")).not.toThrow();
    const res = setCheckpoint(pi, ctx, "x");
    expect("error" in res).toBe(true);
    expect(typeof (res as { error: string }).error).toBe("string");
  });

  it("never throws — a throwing getLeafId yields {error: string} (try/catch)", () => {
    const { pi } = makePi();
    const { ctx } = makeCtx({ throwOnGetLeafId: true });
    expect(() => setCheckpoint(pi, ctx, "x")).not.toThrow();
    const res = setCheckpoint(pi, ctx, "x");
    expect("error" in res).toBe(true);
    expect(typeof (res as { error: string }).error).toBe("string");
  });

  it("writes through pi.setLabel, reads through ctx.sessionManager.getLeafId (C1/C9 split — GOTCHA #3)", () => {
    const setLabelCalls: string[] = [];
    const getLeafIdCalls: string[] = [];
    const pi = {
      setLabel: (id: string, label: string) => {
        setLabelCalls.push(`setLabel:${id}:${label}`);
      },
    } as unknown as ExtensionAPI;
    const ctx = {
      sessionManager: {
        getLeafId: () => {
          getLeafIdCalls.push("getLeafId");
          return "L";
        },
      },
    } as unknown as ExtensionContext;
    const res = setCheckpoint(pi, ctx, "n");
    expect(setLabelCalls).toEqual(["setLabel:L:mulligan:checkpoint:n"]);
    expect(getLeafIdCalls).toEqual(["getLeafId"]);
    expect(res).toEqual({ entryId: "L" });
  });

  it("returns the discriminated union {entryId:string} | {error:string}", () => {
    const { pi } = makePi();
    const ok = setCheckpoint(pi, makeCtx().ctx, "n");
    const fail = setCheckpoint(pi, makeCtx({ leafId: null }).ctx, "n");
    expectTypeOf(ok).toEqualTypeOf<{ entryId: string } | { error: string }>();
    expectTypeOf(fail).toEqualTypeOf<{ entryId: string } | { error: string }>();
  });
});

// ── NoteDetails / SetCheckpointResult types ──────────────────────────────────────────────────────────────────

describe("NoteDetails + SetCheckpointResult types (GOTCHA #5 — NoteDetails is NOT a MulliganEnvelope)", () => {
  it("NoteDetails is { schema:'pi-mulligan'; v:1; kind:'note'; rewindId:string }", () => {
    const d = {} as NoteDetails;
    expectTypeOf(d.schema).toEqualTypeOf<"pi-mulligan">();
    expectTypeOf(d.v).toEqualTypeOf<1>();
    expectTypeOf(d.kind).toEqualTypeOf<"note">();
    expectTypeOf(d.rewindId).toEqualTypeOf<string>();
  });

  it("NoteDetails is NOT assignable to MulliganEnvelope (kind 'note' ∉ the marker union)", () => {
    // @ts-expect-error — NoteDetails.kind:'note' is not in MulliganEnvelope.kind's union
    const _: MulliganEnvelope = {} as NoteDetails;
    expectTypeOf(_).toEqualTypeOf<MulliganEnvelope>();
  });

  it("SetCheckpointResult is the discriminated union", () => {
    const ok: SetCheckpointResult = { entryId: "x" };
    const err: SetCheckpointResult = { error: "boom" };
    expectTypeOf(ok).toEqualTypeOf<SetCheckpointResult>();
    expectTypeOf(err).toEqualTypeOf<SetCheckpointResult>();
  });
});
```

### Implementation Patterns & Key Details

```ts
// PATTERN (leaveNote): one sendMessage call, message-only (NO options), swallow on throw (GOTCHA #1/#2).
try {
  const details: NoteDetails = { schema: "pi-mulligan", v: 1, kind: "note", rewindId };
  pi.sendMessage({ customType: "mulligan:note", content, display: true, details }); // ← NO second arg (C8)
} catch {
  // swallow: the rewind marker is already persisted; a failed note is non-fatal
}

// PATTERN (setCheckpoint): read leaf FRESH, null-check, label via `pi` (NOT ctx.sessionManager), return union.
try {
  const leafId = ctx.sessionManager.getLeafId(); // string | null (GOTCHA #4); read fresh (C12)
  if (!leafId) return { error: "no leaf" };
  pi.setLabel(leafId, `mulligan:checkpoint:${name}`); // writes through `pi` (C1/C9 — GOTCHA #3)
  return { entryId: leafId };
} catch (e) {
  return { error: e instanceof Error ? e.message : String(e) }; // never throws
}

// CRITICAL: NoteDetails is STANDALONE — `kind:"note"` is NOT in MulliganEnvelope's union (GOTCHA #5).
//   export interface NoteDetails { schema:"pi-mulligan"; v:1; kind:"note"; rewindId:string }
//   (do NOT `extends MulliganEnvelope` — it won't type-check.)
```

### Integration Points

```yaml
# This task adds NO wiring (no index.ts change). It EXTENDS the write-path surface other tasks consume:

EXPORTS (consumed by downstream tasks):
  - leaveNote             → tools/rewind.ts step 6 (P1.M5.T1.S1): called right after appendRewindMarker, with the
                            rendered note + the marker's entry id as rewindId.
  - setCheckpoint         → tools/checkpoint.ts (P1.M5.T3.S1): called after the tool validates the name; the tool
                            echoes res.entryId or surfaces res.error.
  - NoteDetails           → tools/rewind.ts (typing the sendMessage details) + audit (P1.M5.T4) + tests.
  - SetCheckpointResult   → tools/checkpoint.ts (narrowing the result) + tests.

INPUT SOURCES (already specified upstream — no action here):
  - pi / ctx:             handed in by the tool execute(toolCallId, params, signal, onUpdate, ctx) (pi from the factory
                          closure). Both wrappers take pi; setCheckpoint also takes ctx.
  - content (leaveNote):  the rendered note string (notes.renderNote(note, ledger, granularity) — P1.M2.T3.S2).
  - rewindId (leaveNote): the rewind tool passes appendRewindMarker's return (the marker's entry id).
  - name (setCheckpoint): validated by the checkpoint tool (/^[a-z0-9_-]{1,40}$/) BEFORE the call.

CONFIG / DATABASE / ROUTES: none — markers.ts is write glue. leaveNote persists via pi.sendMessage (a custom_message
  entry, JSONL on disk, IN context); setCheckpoint persists via pi.setLabel (a label entry, JSONL on disk, NOT in
  context). Neither owns a schema/migration/route.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Run after appending to src/markers.ts (and again after the test edits). The type+style gate IS tsc.
npx tsc --noEmit -p tsconfig.json
# Expected: exit 0, zero errors. If errors exist, READ the output and fix before proceeding.
#   Common fixes: `NoteDetails extends MulliganEnvelope` won't compile → make it standalone (GOTCHA #5);
#   `ctx.sessionManager.setLabel` is not on the type → use `pi.setLabel` (GOTCHA #3);
#   a stray second arg to sendMessage → remove it (GOTCHA #2); an untyped details literal → annotate `: NoteDetails`.
# (There is NO eslint/prettier/biome — GOTCHA #12. Do NOT run a lint/format command.)
```

### Level 2: Unit Tests (Component Validation)

```bash
# Test the markers suite (incl. the new S2 describe blocks).
npx vitest run test/markers.test.ts
# Expected: all markers tests pass. NOTE the 1 KNOWN pre-existing S1 failure (~line 142, entry.id===id) — that is
#   S1's bug (GOTCHA #13), NOT yours. Your NEW leaveNote/setCheckpoint/types describe blocks must all pass.

# Full suite — confirm NO regression to the other 7 files.
npx vitest run
# Expected: 8 files; the other 7 suites (config/ledger/log/notes/runtime/tokens/transforms) stay green; markers has
#   your new tests passing. (The 1 pre-existing S1 failure, if still present, is S1's to fix.)

# Expected: S2's new tests pass. If a new test fails, debug root cause and fix the implementation (do NOT weaken the
#   tests — the sendMessage-args / no-options / setLabel-prefix / null-path / never-throws contract is spec-mandated).
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for this subtask's UNIT tier. markers.ts is Pi-coupled glue, fully exercised with hand-rolled fakes (the
# looper-smoke A2/A1 patterns) in Level 2 — NO real `pi -e` run is needed here. The REAL end-to-end is:
#   - the note appearing in context (the resumed model reads it): validated by the F-rewind-core scenario
#     (P1.M7.T2 / spec/10 §2.1) — `context.fire` log shows notePresent:true; session JSONL has a mulligan:note
#     custom_message entry.
#   - the checkpoint resolving on a targeted rewind: validated by F-checkpoint (P1.M7.T2) — label entry exists;
#     rewind hides back to the labeled point.
# Do NOT spin up `pi -e ./src/index.ts` in this task — the unit fakes are the correct Tier-1 validation surface.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# The domain-specific checks for THIS subtask are the C8 no-options guarantee + the never-throws guarantee + the
# null-path (no-leaf → no setLabel) guarantee, all encoded as Level-2 assertions. The highest-value tests:
#   1. leaveNote "does NOT pass options" (sent[0].options === undefined) — proves C8 (no triggerTurn).
#   2. setCheckpoint "returns {error:'no leaf'} ... does NOT call setLabel" (labels.length === 0) — proves the
#      null-guard doesn't label a phantom target.
#   3. both never-throws blocks (a throwing sendMessage is swallowed; a throwing setLabel/getLeafId → {error}).
# No additional tooling required.
```

---

## Final Validation Checklist

### Technical Validation

- [ ] Level 1 green: `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] Level 2 green: S2's new describe blocks all pass (`npx vitest run test/markers.test.ts`); no regression to the
      other 7 suites (`npx vitest run`).
- [ ] No lint/format command invented (none configured — GOTCHA #12).

### Feature Validation

- [ ] **`leaveNote` calls `pi.sendMessage` once** with `customType:"mulligan:note"`, `display:true`, the caller's
      `content`, and `details:{schema:"pi-mulligan", v:1, kind:"note", rewindId}`.
- [ ] **`leaveNote` passes NO `options`** (no `triggerTurn` — C8/GOTCHA #2).
- [ ] **`leaveNote` returns `void` and never throws** (swallows a throwing sendMessage — GOTCHA #1).
- [ ] **`setCheckpoint` prefixes the name** (`mulligan:checkpoint:<name>`); writes via `pi.setLabel` (GOTCHA #3).
- [ ] **`setCheckpoint` returns `{entryId: leafId}` on success.**
- [ ] **`setCheckpoint` returns `{error:"no leaf"}` when `getLeafId()` is null**, without calling `setLabel`.
- [ ] **`setCheckpoint` never throws** — a thrown `setLabel`/`getLeafId` → `{error: <string>}`.
- [ ] **`NoteDetails` is standalone** (NOT a `MulliganEnvelope` — GOTCHA #5); **`SetCheckpointResult`** is the union.

### Code Quality Validation

- [ ] Appended to `src/markers.ts` after S1's `appendTurnMetric`; S1's lines unchanged; **no import changes**.
- [ ] Extended `makePi` additively (S1's `appendEntry`/`appended` kept); reused `makeCtx` as-is.
- [ ] Mirrors S1's header-doc + JSDoc + try/catch-never-throws style.
- [ ] The wrappers are thin glue (no note/name validation — those are the tools' jobs; GOTCHA #7).
- [ ] Anti-patterns avoided (see below).

### Documentation & Deployment

- [ ] Each new export has a JSDoc block citing the spec sections + the relevant GOTCHA.
- [ ] No new environment variables (uses only the already-imported ExtensionAPI/ExtensionContext).

---

## Anti-Patterns to Avoid

- ❌ Don't pass `options`/`triggerTurn` to `sendMessage` from `leaveNote` — C8: a tool is mid-turn; triggerTurn:true
  recurses the loop destructively (GOTCHA #2).
- ❌ Don't call `ctx.sessionManager.setLabel(...)` — setLabel is on `ExtensionAPI` (`pi`), not on ReadonlySessionManager
  (C1/C9). It won't compile (GOTCHA #3).
- ❌ Don't skip the `getLeafId()` null-check in `setCheckpoint` — it returns `string | null`; labeling `null` is a bug
  (GOTCHA #4). Return `{error:"no leaf"}` and do NOT call setLabel on the null path.
- ❌ Don't make `NoteDetails extends MulliganEnvelope` — `kind:"note"` is outside the marker kind union; it won't
  type-check. Define it standalone (GOTCHA #5).
- ❌ Don't drop the try/catch in `leaveNote` — markers.ts is on the tool hot path; a throw breaks a turn (GOTCHA #1).
  (The rewind marker is already persisted; swallowing a failed note is safe.)
- ❌ Don't validate the checkpoint `name` inside `setCheckpoint` — that's the checkpoint tool's job (GOTCHA #7).
- ❌ Don't create new files — this task APPENDS to `src/markers.ts` + `test/markers.test.ts` (both S1 created).
- ❌ Don't touch S1's existing assertions in `test/markers.test.ts` — the ~line-142 failure is S1's bug (GOTCHA #13).
- ❌ Don't invent a lint/format command — none is configured; the gate is `tsc --noEmit` (GOTCHA #12).
- ❌ Don't `await` `pi.sendMessage` — the tool-facing ExtensionAPI method returns `void`, not a Promise (GOTCHA #6).
- ❌ Don't read `ctx.sessionManager` outside the function body / cache the handle — read it fresh each call (C12/GOTCHA #10).