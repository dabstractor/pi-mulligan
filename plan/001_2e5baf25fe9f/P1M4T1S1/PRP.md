# PRP — P1.M4.T1.S1: `appendRewindMarker`, `appendShrinkMarker`, `appendTurnMetric` — marker persistence wrappers (seq + leaf-id capture)

**Work item:** P1.M4.T1.S1 · **Points:** 1.5 · **Stage:** Pi Integration Layer (spec/11 §2 Step 4)
**Scope:** **CREATE two new files** — `src/markers.ts` (the versioned-envelope marker interfaces + the three Pi-coupled
persistence wrappers that stamp `seq`, capture the new marker's entry id, and never throw) and `test/markers.test.ts`
(vitest Tier-1 unit tests with hand-rolled `pi`/`ctx` fakes). **No other file is touched.** This is **S1 of a multi-part
`markers.ts`** (S2 = `leaveNote` + `setCheckpoint` wrappers, P1.M4.T1.S2 — APPENDS later and REUSES the interfaces +
the capture-after-append idiom defined here). The three wrappers are the write path consumed by `tools/*` (P1.M5) and
`nudges.ts` (P1.M6); they are thin glue over `pi.appendEntry` + `ctx.sessionManager` + `runtime.nextSeq`.

---

## Goal

**Feature Goal**: Ship Mulligan's **marker persistence wrappers** — the Pi-coupled glue that turns a caller-supplied
marker payload into a persisted `CustomEntry` with the stamped versioned envelope `{schema:"pi-mulligan", v:1, kind}`,
a monotonic per-session `seq` (from `runtime.ts nextSeq`), an `id` (uuid, for rewind+shrink), and `ts`; then captures
the new marker's entry id **immediately after** `pi.appendEntry` (constraint **C7**: `appendEntry` returns `void`, so
the id must be read via `ctx.sessionManager.getLeafId()` in the same synchronous tick). This is the write half of the
marker round-trip: the `context` filter (P1.M4.T2.S1) reads these markers back via `getEntries()` filtered by
`customType` (`spec/06` §1) and resolves them. `seq` is the field the filter's `stableSortBySeq` orders markers by
(`spec/06` §1) — so the wrapper MUST stamp it (the persisted marker is the authoritative carrier).

**Deliverable** (two NEW files):
1. `src/markers.ts` — exports:
   - **Envelope + marker interfaces** (spec/04 §1/§3/§4/§5 verbatim-ish): `MulliganEnvelope`, `ShrinkTarget`,
     `RewindMarker`, `ShrinkMarker`, `TurnMetric` — so the filter/tools/audit/tests share ONE canonical shape.
   - **Caller payload types**: `RewindMarkerInput`, `ShrinkMarkerInput`, `TurnMetricInput` — each an
     `Omit<Marker, envelope+id+seq+ts fields>` (the wrapper stamps those).
   - **The three wrappers**: `appendRewindMarker(pi, ctx, data)`, `appendShrinkMarker(pi, ctx, data)`,
     `appendTurnMetric(pi, ctx, data)` — each `: string | null` (see GOTCHA #2), never throws.
   - Imports: `randomUUID` from `node:crypto`; types `ExtensionAPI`/`ExtensionContext` from
     `@earendil-works/pi-coding-agent`; `nextSeq` from `./runtime.js`; types `Granularity`/`FileLedger`/`NoteInput`
     from `./config.js`/`./ledger.js`/`./notes.js`.
2. `test/markers.test.ts` — vitest, imports the wrappers + interfaces from `../src/markers.js`, mirrors
   `test/runtime.test.ts` + `test/notes.test.ts` conventions, uses hand-rolled `pi`/`ctx` fakes (the
   `looper-smoke` A1.appendEntry capture pattern, `spec/reference/looper-smoke.proto.ts`).

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0** (new module + test type-sound under `strict`; the Pi type imports
  resolve — verified live, the same way `src/index.ts` already imports `ExtensionAPI`).
- `npx vitest run` is **all-green** — the new `markers` suite **AND** the pre-existing 7 files / 264 tests (baseline,
  verified live). No regression (this task is 2 new files; it cannot touch another suite).
- Each wrapper: (a) stamps the envelope `{schema:"pi-mulligan", v:1, kind}`; (b) stamps `seq` from `nextSeq(sessionId)`;
  (c) stamps `ts = Date.now()`; (d) rewind+shrink stamp `id = randomUUID()`, turn-metric does **NOT** (spec/04 §5 — GOTCHA #4);
  (e) calls `pi.appendEntry` exactly once with the right `customType`; (f) returns `ctx.sessionManager.getLeafId()`
  captured **immediately after** `appendEntry` (C7 ordering — GOTCHA #5).
- Every wrapper **never throws** — a throwing `appendEntry`/`getSessionId`/`getLeafId`, or a `getLeafId()` that returns
  `null`, yields a `null` return, never an exception (fail-open hot-path discipline — GOTCHA #3).

---

## User Persona

**Target User**: The implementing AI agents for `tools/rewind.ts` (`mulligan_rewind`, P1.M5.T1.S1),
`tools/shrink.ts` (`mulligan_shrink`, P1.M5.T2.S1), and `nudges.ts`'s `turn_end` handler (P1.M6.T2.S1) — the THREE
runtime consumers. The rewind tool, at step 6 of its behavior (`spec/05` §1), calls
`appendRewindMarker(pi, ctx, { granularity, options, excludeToolCallId, note, ledger })`, uses the returned id only
for correlation/logging, then calls `pi.sendMessage({customType:"mulligan:note", ...})` separately. The shrink tool
(`spec/05` §2 step 4) calls `appendShrinkMarker(pi, ctx, { target, replacement, reason })`. The turn_end handler
(`spec/04` §5) calls `appendTurnMetric(pi, ctx, { deltaTokens, bloatHit, bloatHits, grewOverThreshold, turnIndex })`.
The SECOND consumer set is the test suite (spec/10) + the filter (`filter.ts` P1.M4.T2.S1, which casts
`getEntries()` `data` to `RewindMarker`/`ShrinkMarker`/`TurnMetric`).

**Use Case**: An agent just wasted a turn and calls `mulligan_rewind`. The tool validates the note, composes the
ledger, and needs to persist the rewind marker + capture its entry id — WITHOUT a real Pi tree branch (impossible,
C2/C3) and WITHOUT `appendEntry` returning an id (it returns `void`, C7). `appendRewindMarker` does exactly this:
it stamps the envelope + seq + id + ts, appends, and reads back the leaf id in the same synchronous tick. The filter
then finds this marker on the next inference (by `customType:"mulligan:rewind"`) and applies the rewind.

**User Journey**:
1. Tool/event handler obtains `pi` (ExtensionAPI) + `ctx` (ExtensionContext) — for a tool, from `execute(..., ctx)`;
   for an event, from the handler's `(event, ctx)`. `pi` comes from the factory closure.
2. Caller builds the marker payload (the `*Input` type) — e.g. the rewind tool builds `{granularity, options,
   excludeToolCallId: toolCallId, note, ledger}`.
3. Caller calls `appendRewindMarker(pi, ctx, payload)` → `string | null`.
4. The wrapper: `seq = nextSeq(ctx.sessionManager.getSessionId())`; builds `entry = {...payload, schema, v:1,
   kind:"rewind", id: randomUUID(), seq, ts: Date.now()}`; `pi.appendEntry("mulligan:rewind", entry)`;
   `return ctx.sessionManager.getLeafId()` (C7 capture, same tick).
5. On the next inference, the `context` filter's `readMarkers` scans `getEntries()` for `type==="custom" &&
   customType==="mulligan:rewind"`, casts `data` to `RewindMarker`, and `stableSortBySeq` orders it for application.

**Pain Points Addressed**: `pi.appendEntry` returns `void` (C7) — there is no direct way to know which entry a marker
became. The leaf-id-capture idiom (read `getLeafId()` immediately after) is the ONLY reliable way, and it is racy if
any other append sneaks in between. Centralizing it in ONE wrapper (instead of copy-pasting the idiom across the
rewind tool, shrink tool, and turn_end handler) guarantees the C7 ordering invariant is honored everywhere and the
envelope/seq stamping is uniform — so the filter's `stableSortBySeq` + `readMarkers` see a consistent shape.

---

## Why

- **Unblocks the entire Pi Integration Layer + the tools + the nudges.** `appendRewindMarker`/`appendShrinkMarker`/
  `appendTurnMetric` are the write path every agent-callable tool and the turn_end handler depend on. `leaveNote`
  (P1.M4.T1.S2) and `setCheckpoint` (P1.M4.T1.S2) APPEND to this same `markers.ts` next and REUSE the
  `MulliganEnvelope` + marker interfaces + the capture-after-append idiom defined here. Shipping the three marker
  wrappers + the canonical marker TYPES now lets the downstream tools focus on glue (validation, ledger, rendering),
  not on Pi write-path mechanics or shape definition.
- **`seq` must be stamped at the write site, not computed at read.** spec/04 §3/§4/§5 make `seq` a persisted field of
  every marker, and spec/06 §1 `stableSortBySeq` orders markers by it. If `seq` were assigned at filter-read time,
  marker order across a reload/resume would be non-deterministic. Stamping it in the wrapper (via `nextSeq`) at the
  moment of append makes ordering durable and monotonic per session (the same `nextSeq` the runtime map exposes).
- **The C7 leaf-id-capture idiom is subtle and easy to get wrong.** `appendEntry` returns `void`; the only way to
  learn the new marker's id is `ctx.sessionManager.getLeafId()` immediately after, before any other append
  (`spec/02` C7; `spec/05` §1 step 6). Centralizing it (with the seq/id/ts stamping ordered BEFORE the append so the
  marker is always complete even if capture later fails) is the DRY + correct path.
- **Faithful to spec/04 — the marker TYPES are first-class.** spec/04 §1–§5 are the authoritative data model; the
  header says "Implement these EXACTLY (field names, casing, optionality)". Defining `MulliganEnvelope`/
  `RewindMarker`/`ShrinkMarker`/`TurnMetric`/`ShrinkTarget` in `markers.ts` (the module that PERSISTS them) and
  EXPORTING them means the filter, tools, audit, and tests all reference ONE shape — no drift between the writer and
  the reader. Two spec nuances are resolved defensively and documented as GOTCHAs (#4 turn-metric has no `id`;
  #6 `deltaTokens` widened to `number | null`; the `granularity` union nuance).

---

## What

CREATE `src/markers.ts` exporting the envelope + marker interfaces + the three payload types + the three wrappers.
Each wrapper:

- Reads the session id FRESH (C12): `const sessionId = ctx.sessionManager.getSessionId();` — inside the function,
  never cached across calls.
- Increments the per-session counter: `const seq = nextSeq(sessionId);` (runtime.ts — pre-increment, first call → 1).
- Rewind + shrink: `id = randomUUID()` (uuid correlating the marker with its note / for audit). **Turn-metric: NO
  `id`** (spec/04 §5 has none — GOTCHA #4).
- Builds the entry: `{ ...data, schema: "pi-mulligan", v: 1, kind, [id?], seq, ts: Date.now() }` typed as the marker
  interface (the annotation provides contextual typing for the literal `schema`/`v`/`kind`).
- `pi.appendEntry("mulligan:<kind>", entry)` — appends a `CustomEntry` (NOT in LLM context). Returns `void` (C7).
- **Immediately** (same synchronous tick — GOTCHA #5): `return ctx.sessionManager.getLeafId();` (returns `string | null`).
- The WHOLE body is wrapped in `try { ... } catch { return null; }` — never throws (GOTCHA #3).

This subtask does **NOT**: touch `index.ts`/`config.ts`/`log.ts`/`runtime.ts`/`tokens.ts`/`ledger.ts`/`notes.ts`/
`transforms.ts`; implement `leaveNote`/`setCheckpoint` (P1.M4.T1.S2 — APPENDS to this file later); implement any tool
or the filter (P1.M5/P1.M4.T2); wire anything into `index.ts` (P1.M7.T1); mutate `data` (it is spread read-only);
or change the marker shapes beyond the two documented defensive widenings (#4, #6).

### Success Criteria

- [ ] `src/markers.ts` is CREATED and exports `MulliganEnvelope`, `ShrinkTarget`, `RewindMarker`, `ShrinkMarker`,
      `TurnMetric`, `RewindMarkerInput`, `ShrinkMarkerInput`, `TurnMetricInput`, `appendRewindMarker`,
      `appendShrinkMarker`, `appendTurnMetric`.
- [ ] `test/markers.test.ts` is CREATED; `npx vitest run` is all-green (markers + the 7 pre-existing files).
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] **Return type is `string | null` for all three wrappers** (GOTCHA #2 — NOT `string`).
- [ ] **Envelope stamped exactly:** every persisted entry has `schema === "pi-mulligan"`, `v === 1`, and the right
      `kind` (`"rewind"` / `"shrink"` / `"turn-metric"`).
- [ ] **customType correct:** `pi.appendEntry` is called with `"mulligan:rewind"` / `"mulligan:shrink"` /
      `"mulligan:turn-metric"` respectively, exactly once per call.
- [ ] **seq stamped + monotonic per session:** within one session, rewind→1, then a second marker→2, …; a different
      session starts at 1 (the `nextSeq` contract).
- [ ] **id stamped for rewind+shrink (uuid), NOT for turn-metric:** rewind/shrink entries have an `id` (a uuid
      string); the turn-metric entry has NO `id` key (GOTCHA #4).
- [ ] **ts is a number** (`Date.now()`).
- [ ] **C7 ordering (GOTCHA #5):** the call order is `getSessionId` → `appendEntry` → `getLeafId`; the return value
      equals `getLeafId()`'s return; nothing that appends runs between `appendEntry` and `getLeafId`.
- [ ] **`getLeafId()` returns `null` → wrapper returns `null`** (the marker IS still appended; we just can't report
      its id — never a throw).
- [ ] **Never throws (GOTCHA #3):** a throwing `appendEntry`, `getSessionId`, or `getLeafId` → `null`, no exception.
- [ ] **Payload spread faithfully:** the caller's `data` fields appear verbatim on the persisted entry (rewind:
      `granularity`/`options`/`excludeToolCallId`/`note`/`ledger`; shrink: `target`/`replacement`/`reason`;
      turn-metric: `deltaTokens`/`bloatHit`/`bloatHits`/`grewOverThreshold`/`turnIndex`).

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this
> successfully?"_ — **Yes.** The exact `src/markers.ts` to CREATE is given verbatim below (Task 1) and the exact
> `test/markers.test.ts` (Task 2), including the envelope/marker interfaces (quoted from spec/04 §1/§3/§4/§5), the
> three wrappers (algorithm spec-pinned by the item contract + spec/05 §1 step 6 + spec/02 C7), and the test fakes
> (the `looper-smoke` A1.appendEntry capture pattern, verified on disk). `nextSeq`'s contract (pre-increment, per-
> session, runtime.ts) is quoted from the runtime.ts source. The C7 void-return + leaf-capture idiom is quoted from
> api_verification.md §2.1 + spec/02 C7. The baseline (7 files / 264 tests, tsc exit 0) is verified live. Both uuid
> approaches (`import { randomUUID } from "node:crypto"` AND `globalThis.crypto.randomUUID()`) are verified to
> type-check under this tsconfig. No prior knowledge beyond "this is the Pi-Integration write-path module" is required.

### Scope decision (READ BEFORE CODING)

- **CREATE `src/markers.ts` — it does NOT exist.** Pi Integration Layer (spec/11 §2 Step 4; spec/03 §7). This is
  **S1 of the markers.ts build**: ship the envelope + the three marker interfaces + the three payload types + the
  three wrappers. **S2 (`leaveNote` + `setCheckpoint`, P1.M4.T1.S2) APPENDS to this file later** and REUSES the
  `MulliganEnvelope` + marker interfaces + the capture-after-append idiom. Write the file header to acknowledge the
  append plan.
- **CREATE `test/markers.test.ts` — it does NOT exist.** Mirror `test/runtime.test.ts` (the closest sibling: it also
  exercises a module that mutates the shared runtime map) + `test/notes.test.ts` (the interface/`expectTypeOf`
  conventions). Use hand-rolled `pi`/`ctx` fakes — NO real Pi, NO `vi.fn()` magic required (plain objects suffice).
- **Return type is `string | null` (GOTCHA #2).** The item contract writes `): string` as shorthand, but (a)
  `ctx.sessionManager.getLeafId()` returns `string | null` (api_verification.md §4) and (b) the try/catch returns
  `null` on failure (item contract step "Wrap in try/catch returning null on failure"). The faithful, type-honest
  signature is `string | null`. Resolve the ambiguity HERE (like the prior PRPs resolved `number[] | null` vs `Unit`).
- **Turn-metric has NO `id` (GOTCHA #4).** The item contract step (b) shows `id: uuid` and says "Similarly for …
  appendTurnMetric", BUT contract note 1 says "Each marker's data matches its schema in spec/04" — and spec/04 §5
  `TurnMetric` has NO `id` field (only rewind §3 and shrink §4 do). Note 1 OVERRIDES the generic sketch for
  turn-metric: stamp `id` on rewind+shrink, NOT on turn-metric.
- **`deltaTokens` is `number | null` (GOTCHA #6).** spec/04 §5 declares `deltaTokens: number` in the interface but
  the prose says "If the baseline is missing … `deltaTokens` is `null`". Widen to `number | null` to match the
  documented runtime behavior (the turn_end handler owns the null-vs-number decision; markers.ts just persists it).
- **`granularity` uses the `Granularity` type from config.ts (GOTCHA #7).** spec/04 §3 lists only the two relative
  literals, but spec/05 §1 `RewindParams.granularity` + spec/04 §6 (checkpoint targeting) require the three-way
  union. `config.ts` already exports `Granularity = "last_tool_call_group" | "last_turn" | "checkpoint"`; reuse it.
- **Do NOT widen the wrapper signatures.** Keep `(pi: ExtensionAPI, ctx: ExtensionContext, data: <Kind>Input)` —
  the contract pins this. The internal try/catch provides the failure path WITHOUT changing the parameter types.

### Documentation & References

```yaml
# MUST READ — authoritative sources for the wrappers + the marker shapes
- file: spec/04-data-model.md
  section: "§1 Versioning (MulliganEnvelope) + §3 RewindMarker + §4 ShrinkMarker + §5 TurnMetric"
  why: "THE source of the marker interfaces. §1: every persisted CustomEntry data has {schema:'pi-mulligan', v:1, kind}.
        §3: RewindMarker {kind:'rewind', id, granularity, options, excludeToolCallId?, seq, note, ledger, ts}.
        §4: ShrinkMarker {kind:'shrink', id, target, replacement, reason?, seq, ts} + ShrinkTarget union.
        §5: TurnMetric {kind:'turn-metric', seq, ts, deltaTokens, bloatHit, bloatHits, grewOverThreshold, turnIndex}
        — NOTE: NO `id` field (unlike rewind/shrink)."
  critical: "Field names + casing + optionality are load-bearing — the filter casts getEntries() data to these. Two
             documented deviations: turn-metric has no id (#4); deltaTokens widened to number|null (#6)."

- file: spec/02-proven-constraints.md
  section: "C7 (appendEntry returns void) + C1 (ReadonlySessionManager) + C12 (never cache a sessionManager handle)"
  why: "C7: appendEntry<T>(customType, data?): void — to capture a marker's id call ctx.sessionManager.getLeafId()
        IMMEDIATELY AFTER, same synchronous tick, before any other append. C1: sessionManager is read-only (only
        getLeafId/getEntries/getSessionId/etc. — no mutators). C12: read ctx.sessionManager FRESH each call."
  critical: "C7 ordering is THE correctness invariant of these wrappers. getLeafId() returns string|null (api_verification
             §4) — handle null by returning null, never throwing."

- file: spec/05-tools.md
  section: "§1 mulligan_rewind step 6 (Persist) — the exact leaf-capture idiom"
  why: "Quote: 'pi.appendEntry(\"mulligan:rewind\", { schema, v:1, kind:\"rewind\", id, granularity, options,
        excludeToolCallId, seq, note, ledger, ts }); Immediately capture the marker entry id: const markerEntryId =
        ctx.sessionManager.getLeafId();'. This is EXACTLY the wrapper's body (minus sendMessage, which is leaveNote/S2)."
  critical: "The wrapper persists the marker ONLY; the note (sendMessage) is a SEPARATE call (leaveNote, P1.M4.T1.S2).
             appendRewindMarker does NOT sendMessage. seq is incremented in-memory — here via nextSeq(sessionId)."

- file: spec/06-context-filter.md
  section: "§1 The handler (readMarkers + stableSortBySeq)"
  why: "Confirms how markers are READ BACK: readMarkers(ctx) scans getEntries() for type==='custom' &&
        customType.startsWith('mulligan:') and casts data to RewindMarker/ShrinkMarker/TurnMetric; stableSortBySeq
        orders by the persisted `seq`. So the wrapper's stamped seq + customType + envelope are what the filter keys on."
  critical: "The marker shape written here MUST round-trip cleanly into the filter's cast. customType discriminates at
             the Pi level; kind discriminates inside data."

- file: plan/001_2e5baf25fe9f/architecture/api_verification.md
  section: "§2.1 (appendEntry returns void — C7 confirmed) + §4 (ReadonlySessionManager: getLeafId→string|null,
            getSessionId) + §9 (constraint table)"
  why: "The verified .d.ts signatures. appendEntry<T>(customType, data?): void. getLeafId(): string | null.
        getSessionId(): string. ExtensionAPI holds appendEntry; ExtensionContext.sessionManager holds the read methods."
  critical: "getLeafId() CAN return null (e.g. empty session) — the wrapper returns null in that case, never throws."

- file: src/runtime.ts
  section: "nextSeq(sessionId) — the seq source"
  why: "nextSeq does PRE-increment (++rt.seq): first call returns 1. Per-session isolated. Mutates the module-scoped
        runtimes Map (so tests MUST clearAll() before+after each — GOTCHA #8). The returned seq is persisted INTO the
        marker (spec/04 §3)."
  critical: "nextSeq(sessionId) is the ONLY mutation to runtime state these wrappers perform. Call it BEFORE appendEntry
             (seq is a marker field)."

- file: spec/reference/looper-smoke.proto.ts
  section: "A1.appendEntry test (the leaf-capture proof pattern)"
  why: "THE test-pattern source. A1: 'const leafBefore = sm.getLeafId(); pi.appendEntry(\"looper_state\", {hello:\"world\"});
        const leafAfter = sm.getLeafId(); const ce = sm.getLeafEntry(); const isCustom = ce?.type===\"custom\" && ...'.
        The markers.ts unit tests use the SAME idea with hand-rolled fakes (a fake pi capturing appendEntry args + a
        fake ctx.sessionManager returning a scripted leafId)."
  critical: "Do NOT spin up a real `pi -e` for these unit tests. Hand-rolled fakes are sufficient and faster (markers.ts
             has no async, no real session). The integration read-back is filter.ts P1.M4.T2 + the F-* scenarios P1.M7.T2."

# SIBLINGS TO MIRROR (read-only — import the TYPES you need; mirror the conventions)
- file: test/runtime.test.ts
  why: "THE closest test sibling: it ALSO exercises a module that mutates the shared runtime map (via nextSeq). MIRROR:
        beforeEach+afterEach clearAll() (its GOTCHA #7) so seq can't leak across tests; describe/it/expect/expectTypeOf
        house style; the in-place-mutation + session-isolation test idioms."
  pattern: "import { clearAll } from '../src/runtime.js'; beforeEach(()=>clearAll()); afterEach(()=>clearAll());"

- file: test/notes.test.ts
  why: "THE interface + expectTypeOf convention sibling. MIRROR: `import { ..., type X } from '../src/notes.js'`;
        describe blocks grouped by concern; expectTypeOf for type assertions; a defensive never-throws describe block."
  pattern: "expectTypeOf(appendRewindMarker(fakePi, fakeCtx, payload)).toEqualTypeOf<string | null>();"

- file: src/config.ts
  why: "Exports `Granularity` (import type) — the canonical 3-way granularity union used by RewindMarker.granularity
        (#7). Confirms the .js-extension + type-only import conventions under moduleResolution:'Bundler'."

- file: src/notes.ts / src/ledger.ts
  why: "Export `NoteInput` / `FileLedger` (import type) — the shapes referenced by RewindMarker.note / RewindMarker.ledger.
        Read-only; do not modify."

- file: plan/001_2e5baf25fe9f/architecture/system_context.md
  section: "Module layout (markers.ts: appendEntry/setLabel/sendMessage wrappers + id capture) + Decision C7"
  why: "Confirms markers.ts is the Pi-Integration write path (Step 4) and that the leaf-capture idiom is its reason for being."
```

### Current Codebase tree (state at this subtask's start — VERIFIED LIVE)

```bash
pi-mulligan/
├── package.json            # type:'module'; deps @earendil-works/pi-coding-agent *, typebox *; devDeps typescript ^5,
│                           #   vitest ^1, @types/node ^22; scripts.test:'vitest run'
├── tsconfig.json           # strict, noImplicitAny, types:['node'], moduleResolution:'Bundler', include:['src','test']
│                           #   (NO noUnusedParameters/noUnusedLocals; target ES2022). node:crypto + globalThis.crypto both type-check.
├── src/
│   ├── index.ts            # no-op stub importing `type { ExtensionAPI }` — PROVES the Pi type import resolves. DO NOT TOUCH.
│   ├── config.ts           # exports Granularity, MulliganConfig, DEFAULT_CONFIG, getConfig/... DO NOT TOUCH (type import only).
│   ├── log.ts              # fail-open JSONL logger. DO NOT TOUCH.
│   ├── runtime.ts          # exports nextSeq/getRuntime/resetRuntime/clearAll + SessionRuntime/BloatHit/AgentMessage. DO NOT TOUCH (import nextSeq).
│   ├── tokens.ts / ledger.ts / notes.ts   # pure helpers; ledger exports FileLedger, notes exports NoteInput. DO NOT TOUCH (type imports).
│   └── transforms.ts       # pure core (partitionIntoUnits + resolve*). DO NOT TOUCH.
├── test/
│   ├── config/ledger/log/runtime/tokens/notes/transforms .test.ts   # 7 files / 264 tests, all green. Read-only (mirror runtime.test.ts + notes.test.ts).
│   └── (no markers.test.ts yet — this task CREATES it)
└── spec/                   # 04 §1/§3/§4/§5 (shapes) + 02 C7/C1/C12 + 05 §1 step6 (idiom) + 06 §1 (read-back) + 11 §2 Step4.
# VERIFIED BASELINE (run before starting): `npx tsc --noEmit -p tsconfig.json` → exit 0; `npx vitest run` →
#   7 files / 264 tests green (config, ledger, log, notes, runtime, tokens, transforms). This task is pure + additive
#   (2 new files); it cannot regress the baseline.
# NOTE: there is NO eslint/prettier/biome configured (devDeps = typescript + vitest + @types/node only).
#   The type+style gate is `tsc --noEmit` (TS strict). Do NOT invent a lint/format command.
# NOTE: Node is v26.x → `crypto.randomUUID()` available both as `globalThis.crypto.randomUUID()` and via
#   `import { randomUUID } from "node:crypto"`. BOTH verified to type-check under this tsconfig (exit 0).
```

### Desired Codebase tree with files to be CREATED (THIS subtask)

```bash
pi-mulligan/
├── src/
│   └── markers.ts          # CREATED — MulliganEnvelope + ShrinkTarget + RewindMarker/ShrinkMarker/TurnMetric +
│                           #   *Input payload types + appendRewindMarker/appendShrinkMarker/appendTurnMetric.
│                           #   Imports: node:crypto randomUUID; pi ExtensionAPI/ExtensionContext types; runtime nextSeq;
│                           #   config Granularity / ledger FileLedger / notes NoteInput (type-only).
└── test/
    └── markers.test.ts     # CREATED — vitest Tier-1: envelope/seq/id/ts stamping + customType + C7 ordering + leaf-null +
                           #   never-throws + seq isolation + payload-faithful + types. Hand-rolled pi/ctx fakes; clearAll before+after.
# No other files touched. S2 (P1.M4.T1.S2: leaveNote + setCheckpoint) APPENDS to src/markers.ts next.
```

### Known Gotchas of our codebase & Library Quirks

```bash
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #1 (CRITICAL) — This is S1 of a multi-part markers.ts. Ship ONLY the envelope + the three marker interfaces
#   + the three payload types + the three append* wrappers. S2 (leaveNote = pi.sendMessage mulligan:note; setCheckpoint =
#   pi.setLabel) APPENDS to src/markers.ts next and REUSES the MulliganEnvelope + marker interfaces + the capture-after-
#   append idiom. Do NOT implement leaveNote/setCheckpoint here. Do NOT sendMessage or setLabel in these wrappers.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #2 (CRITICAL) — Return type is `string | null`, NOT `string`. The item contract writes `): string` as
#   shorthand, but (a) ctx.sessionManager.getLeafId() returns `string | null` (api_verification §4) and (b) the
#   try/catch returns null on failure (item contract: "Wrap in try/catch returning null on failure"). Type the
#   signatures `: string | null`. Callers (tools) already treat a null return as a soft failure (log + continue).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #3 (CRITICAL) — NEVER throws (markers.ts sits on the tool/event hot path; a throw breaks an agent turn).
#   Wrap the ENTIRE body of each wrapper in try { ... } catch { return null; }. A throwing pi.appendEntry, a throwing
#   getSessionId/getLeafId, OR a getLeafId() that returns null → all yield a null return, never an exception.
#   `expect(() => appendRewindMarker(...)).not.toThrow()` must pass for every failure mode.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #4 (CRITICAL) — TurnMetric has NO `id` field (spec/04 §5), unlike RewindMarker (§3) and ShrinkMarker (§4)
#   which DO have `id`. So: appendRewindMarker + appendShrinkMarker stamp `id: randomUUID()`; appendTurnMetric does
#   NOT stamp an id. Contract note 1 ("Each marker's data matches its schema in spec/04") OVERRIDES the generic
#   step-(b) sketch (`id: uuid`) for turn-metric. Assert in tests: the turn-metric entry has NO `id` key
#   (`expect(entry).not.toHaveProperty('id')`).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #5 (CRITICAL) — C7 ordering: getLeafId() MUST be called IMMEDIATELY after pi.appendEntry, in the SAME
#   synchronous tick, BEFORE any other append/sendMessage. So compute sessionId + seq + id + ts BEFORE appendEntry
#   (nextSeq mutates ONLY the in-memory map — safe; randomUUID/Date.now are pure — safe), then appendEntry, then
#   IMMEDIATELY getLeafId with NOTHING in between. The test asserts call order: getSessionId → appendEntry → getLeafId.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #6 — deltaTokens is `number | null`. spec/04 §5 interface declares `number`, but the prose says "If the
#   baseline is missing … deltaTokens is null". Widen TurnMetric.deltaTokens (and TurnMetricInput.deltaTokens via Omit)
#   to `number | null` to match the documented runtime behavior. The turn_end handler (P1.M6.T2.S1) decides null vs
#   number; markers.ts just persists what it's given.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #7 — RewindMarker.granularity uses the `Granularity` type from config.ts (3-way union incl. "checkpoint"),
#   NOT the 2-way union spec/04 §3 literally lists. Rationale: spec/05 §1 RewindParams.granularity + spec/04 §6
#   (checkpoint targeting) require "checkpoint"; config.ts already exports the canonical union. Reuse it (import type).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #8 (CRITICAL) — nextSeq mutates the SHARED module-scoped runtime map. Tests MUST clearAll() before AND after
#   each test (mirror test/runtime.test.ts GOTCHA #7) or the seq sequence from one test leaks into the next (rewind→1
#   in test A would make shrink→2 in test B). `import { clearAll } from "../src/runtime.js"; beforeEach/afterEach`.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #9 — The id comes from `import { randomUUID } from "node:crypto"` (a real runtime import; markers.ts is the
#   Pi-Integration tier, so runtime imports are allowed — unlike the pure tier). Verified to type-check under tsconfig
#   (exit 0). node:crypto.randomUUID is a uuid v4 string (36 chars, dashes). Tests assert typeof string + uuid shape.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #10 — `pi.appendEntry` is on the `pi` object (ExtensionAPI); `getSessionId`/`getLeafId` are on
#   `ctx.sessionManager` (ReadonlySessionManager, read-only — C1). Do NOT mix them up: writes through `pi`, reads
#   through `ctx.sessionManager`. The wrapper takes BOTH `pi` and `ctx` for exactly this split.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #11 — The test imports from "../src/markers.js" (.js extension, even though the file is markers.ts).
#   moduleResolution:"Bundler" + type:"module" → TS resolves .js to .ts. Established convention (every existing test).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #12 — There is NO lint/format tool configured (devDeps = typescript + vitest + @types/node only). The
#   "Level 1 syntax & style" gate reduces to `tsc --noEmit` (TS strict IS the type+style gate). Do NOT invent a
#   ruff/eslint/prettier command — it would fail "command not found". Validation = tsc + vitest, nothing else.
# ─────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

`src/markers.ts` DEFINES + EXPORTS the versioning envelope, the three marker interfaces (faithful to spec/04 §1/§3/§4/§5),
the shrink-target union, and the three caller-payload types (each the marker MINUS the fields the wrapper stamps):

```ts
// spec/04 §1 — stamped onto EVERY persisted marker's data
export interface MulliganEnvelope { schema: "pi-mulligan"; v: 1; kind: "rewind" | "shrink" | "turn-metric"; }

// spec/04 §3 (rewind) — id present; granularity reuses config.ts Granularity (#7)
export interface RewindMarker extends MulliganEnvelope {
  kind: "rewind"; id: string; granularity: Granularity;
  options: { to_previous_prompt?: boolean; protect?: string[] };
  excludeToolCallId?: string; seq: number; note: NoteInput; ledger: FileLedger; ts: number;
}

// spec/04 §4 (shrink) — ShrinkTarget discriminated union; id present
export type ShrinkTarget =
  | { by_tool_call_id: string }
  | { by_tool_name: string; occurrence: "last" | "first" }
  | { by_content_includes: string };
export interface ShrinkMarker extends MulliganEnvelope {
  kind: "shrink"; id: string; target: ShrinkTarget; replacement: string; reason?: string; seq: number; ts: number;
}

// spec/04 §5 (turn-metric) — NO id (#4); deltaTokens number|null (#6)
export interface TurnMetric extends MulliganEnvelope {
  kind: "turn-metric"; seq: number; ts: number; deltaTokens: number | null; bloatHit: boolean;
  bloatHits: { toolName: string; approxTokens: number }[]; grewOverThreshold: boolean; turnIndex: number;
}

// caller payloads = marker MINUS {schema, v, kind} MINUS {id for rewind/shrink} MINUS {seq, ts}
export type RewindMarkerInput  = Omit<RewindMarker,  "schema" | "v" | "kind" | "id" | "seq" | "ts">;
export type ShrinkMarkerInput  = Omit<ShrinkMarker,  "schema" | "v" | "kind" | "id" | "seq" | "ts">;
export type TurnMetricInput    = Omit<TurnMetric,    "schema" | "v" | "kind" |        "seq" | "ts">; // note: no "id"
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY BASELINE (no edits — run only)
  - RUN: npx tsc --noEmit -p tsconfig.json          # expect exit 0
  - RUN: npx vitest run                              # expect 7 files / 264 tests green
  - RUN: test ! -e src/markers.ts && echo "ok: markers.ts absent (this task CREATES it)"
  - RUN: grep -n "export function nextSeq" src/runtime.ts && grep -n "export interface FileLedger" src/ledger.ts \
        && grep -n "export interface NoteInput" src/notes.ts && grep -n "export type Granularity" src/config.ts
        # confirm the symbols you import exist.

Task 1: CREATE src/markers.ts   (exact content below — copy verbatim)
  - CREATE the file with: the header doc, the node:crypto + Pi + runtime/config/ledger/notes imports, the
    MulliganEnvelope + ShrinkTarget + RewindMarker/ShrinkMarker/TurnMetric interfaces, the three *Input payload
    types, and the three append* wrappers.
  - CONSTRAINTS:
      * Return type string | null for all three wrappers (GOTCHA #2). Whole body in try/catch → null (GOTCHA #3).
      * Turn-metric stamps NO id; rewind+shrink stamp id: randomUUID() (GOTCHA #4).
      * getLeafId() called IMMEDIATELY after appendEntry, nothing in between (GOTCHA #5). seq/id/ts computed BEFORE appendEntry.
      * deltaTokens number|null (GOTCHA #6); granularity = Granularity from config.ts (GOTCHA #7).
      * sessionId read fresh via ctx.sessionManager.getSessionId() inside the function (C12/GOTCHA #10).
      * id via `import { randomUUID } from "node:crypto"` (GOTCHA #9). Writes through pi, reads through ctx.sessionManager (GOTCHA #10).
  - NAMING/PLACEMENT: src/markers.ts. Exported: MulliganEnvelope, ShrinkTarget, RewindMarker, ShrinkMarker, TurnMetric,
    RewindMarkerInput, ShrinkMarkerInput, TurnMetricInput, appendRewindMarker, appendShrinkMarker, appendTurnMetric.

Task 2: CREATE test/markers.test.ts   (exact content below — copy verbatim)
  - CREATE the file with: the vitest import, the markers + runtime imports (../src/*.js — GOTCHA #11), the
    beforeEach/afterEach clearAll() (GOTCHA #8), the makePi/makeCtx fake helpers, the pinned payloads, and the
    describe blocks: envelope+customType+seq stamping; id rules (#4); C7 ordering (#5); leaf-null return; never-
    throws (#3); seq monotonic + per-session isolation; payload-faithful spread; types.
  - CONSTRAINTS: hand-rolled fakes (NO real Pi, NO vi.fn() required). Mirror runtime.test.ts + notes.test.ts.
  - COVERAGE: every success-criteria bullet above has a corresponding assertion.

Task 3: VALIDATE (no edits — run the gates in the Validation Loop)
  - Level 1 (tsc) and Level 2 (vitest). Level 3 N/A (Pi-coupled glue — the real-Pi read-back is filter.ts P1.M4.T2 +
    the F-* integration scenarios P1.M7.T2; unit tests use fakes). Level 4 = the C7-ordering + never-throws assertions.
```

#### Exact content to CREATE — `src/markers.ts` (Task 1 — copy verbatim)

```ts
/**
 * markers.ts — Mulligan's Pi-coupled persistence wrappers (spec/11 §2 Step 4; spec/03 §7).
 * spec/04-data-model.md §1 (MulliganEnvelope), §3 (RewindMarker), §4 (ShrinkMarker), §5 (TurnMetric),
 *   spec/02-proven-constraints.md C7 (appendEntry returns void), C1 (ReadonlySessionManager), C12 (read fresh),
 *   spec/05-tools.md §1 step 6 (the leaf-capture idiom), spec/06-context-filter.md §1 (readMarkers/stableSortBySeq).
 *
 * DESIGN (read GOTCHA #1–#12 in the PRP):
 * - Pi Integration Layer. This is the FIRST module that imports Pi (ExtensionAPI/ExtensionContext) and PERSISTS
 *   markers. It is thin glue: it wraps pi.appendEntry, captures the new marker's entry id immediately after (C7),
 *   and increments the per-session seq via runtime.ts nextSeq(). The pure helpers (transforms/tokens/ledger/notes)
 *   consume NOTHING from here; the consumers are tools/* (P1.M5) and nudges.ts (P1.M6).
 * - Three wrappers: appendRewindMarker, appendShrinkMarker, appendTurnMetric. Each stamps the versioned envelope
 *   {schema:'pi-mulligan', v:1, kind} + a monotonic per-session seq + ts onto the caller's marker payload, appends
 *   it, and returns the NEW marker's entry id (or null). Rewind + shrink also stamp an `id` (uuid); turn-metric
 *   does NOT (spec/04 §5 has no id — GOTCHA #4).
 * - NEVER throws (fail-open discipline; markers.ts sits on the tool/event hot path). Each whole body is wrapped in
 *   try/catch → returns null on ANY failure (appendEntry throws, getLeafId throws/returns null, etc.).
 *
 * NOTE: P1.M4.T1.S2 (leaveNote = pi.sendMessage mulligan:note; setCheckpoint = pi.setLabel) APPENDS to this file
 *   next and REUSES the MulliganEnvelope / marker interfaces + the capture-after-append idiom defined here.
 */
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { nextSeq } from "./runtime.js";
import type { Granularity } from "./config.js";
import type { FileLedger } from "./ledger.js";
import type { NoteInput } from "./notes.js";

// ── Versioning envelope (spec/04-data-model.md §1) ───────────────────────────

/**
 * MulliganEnvelope — the versioning tag stamped into EVERY persisted CustomEntry's `data` (spec/04 §1). `schema`
 * distinguishes Mulligan entries from other extensions' CustomEntries; `v` is the schema version (v1 = this spec);
 * `kind` is the Mulligan-level discriminator inside `data` (distinct from the Pi-level `customType`). EXPORTED so
 * the filter/tools/audit/tests share ONE canonical shape.
 */
export interface MulliganEnvelope {
  schema: "pi-mulligan";
  v: 1;
  kind: "rewind" | "shrink" | "turn-metric";
}

// ── Marker: rewind (spec/04-data-model.md §3) ───────────────────────────────

/**
 * RewindMarker — persisted via pi.appendEntry("mulligan:rewind", data) (spec/04 §3, spec/05 §1 step 6). `kind`
 * narrows to "rewind". `id` (uuid) correlates the marker with its mulligan:note CustomMessage. `granularity` is the
 * targeting spec the filter resolves each inference (the canonical `Granularity` union from config.ts — GOTCHA #7:
 * spec/04 §3 lists only the two relative literals, but spec/05 §1 + §6 require "checkpoint"). `excludeToolCallId`
 * lets the filter skip the rewind's own tool-call group (spec/06 §3). `seq` orders markers reliably even if
 * timestamps tie (filter stableSortBySeq — spec/06 §1). `note`/`ledger` duplicate the structured note for audit.
 * EXPORTED for the filter (readMarkers cast) + tools + audit + tests.
 */
export interface RewindMarker extends MulliganEnvelope {
  kind: "rewind";
  id: string;
  granularity: Granularity;
  options: {
    /** Only for granularity=last_turn. If true, also discard the most recent user message (nuclear). Default false. */
    to_previous_prompt?: boolean;
    /** Role list that must not be crossed (default from config.rewind.protectedRoles). */
    protect?: string[];
  };
  /** toolCallId of THIS rewind's own tool call, so the filter excludes it resolving "last tool-call group" (spec/06 §3). */
  excludeToolCallId?: string;
  /** Monotonic per-session counter (runtime.ts nextSeq); persisted INTO the marker so the filter can order reliably. */
  seq: number;
  /** The structured note (spec/04 §2.1) — duplicated here for self-containment (the rendered note also lives in the
   *  mulligan:note CustomMessage; this is the structured form for audit/debug). */
  note: NoteInput;
  ledger: FileLedger;
  ts: number;
}

/** RewindMarkerInput — the caller-supplied payload for appendRewindMarker (spec/04 §3 MINUS the envelope + id + seq + ts,
 *  which the wrapper stamps on). The mulligan_rewind tool (P1.M5.T1.S1) builds this. */
export type RewindMarkerInput = Omit<RewindMarker, "schema" | "v" | "kind" | "id" | "seq" | "ts">;

// ── Marker: shrink (spec/04-data-model.md §4) ───────────────────────────────

/**
 * ShrinkTarget — how a shrink identifies the message to substitute (spec/04 §4). Discriminated union; the filter
 * (resolveShrinkTarget, P1.M3.T4.S2) resolves it live each inference against event.messages. EXPORTED for the shrink
 * tool's typebox-free type + the filter + tests.
 */
export type ShrinkTarget =
  | { by_tool_call_id: string }
  | { by_tool_name: string; occurrence: "last" | "first" }
  | { by_content_includes: string };

/**
 * ShrinkMarker — persisted via pi.appendEntry("mulligan:shrink", data) (spec/04 §4, spec/05 §2 step 4). `replacement`
 * substitutes the matched ToolResultMessage's content (the filter preserves role/toolCallId/toolName/isError so the
 * tool-pairing invariant holds — spec/06 §2). `seq` orders shrinks relative to rewinds (filter applies shrinks AFTER
 * rewinds, oldest-first by seq — spec/06 §1). EXPORTED for the filter/tools/audit/tests.
 */
export interface ShrinkMarker extends MulliganEnvelope {
  kind: "shrink";
  id: string;
  target: ShrinkTarget;
  /** The compact text that replaces the matched message's content, going forward. */
  replacement: string;
  /** Optional reason, surfaced in audit. */
  reason?: string;
  seq: number;
  ts: number;
}

/** ShrinkMarkerInput — caller payload for appendShrinkMarker (spec/04 §4 MINUS envelope + id + seq + ts). */
export type ShrinkMarkerInput = Omit<ShrinkMarker, "schema" | "v" | "kind" | "id" | "seq" | "ts">;

// ── Marker: turn-metric (spec/04-data-model.md §5) ───────────────────────────

/**
 * TurnMetric — appended at turn_end via pi.appendEntry("mulligan:turn-metric", data) (spec/04 §5). Only the LATEST
 * one on the branch is consulted by the filter (older ones persist but are ignored). NOTE (GOTCHA #4): spec/04 §5
 * has NO `id` field (unlike rewind/shrink) — appendTurnMetric does NOT stamp one. NOTE (GOTCHA #6): deltaTokens is
 * widened to `number | null` to match the §5 prose ("deltaTokens is null when baseline missing"). EXPORTED for the
 * turn_end handler (P1.M6.T2.S1) + the filter + tests.
 */
export interface TurnMetric extends MulliganEnvelope {
  kind: "turn-metric";
  seq: number;
  ts: number;
  /** Signed estimate of how much context grew this turn. null when the baseline is missing (first turn / post-reload). */
  deltaTokens: number | null;
  /** Any tool_result this turn exceeded the bloat threshold. */
  bloatHit: boolean;
  bloatHits: { toolName: string; approxTokens: number }[];
  /** deltaTokens > driftThresholdTokens (config.nudges.driftThresholdTokens). */
  grewOverThreshold: boolean;
  /** The turn index this metric describes (from turn_end event.turnIndex). */
  turnIndex: number;
}

/** TurnMetricInput — caller payload for appendTurnMetric (spec/04 §5 MINUS envelope + seq + ts; NO id — GOTCHA #4). */
export type TurnMetricInput = Omit<TurnMetric, "schema" | "v" | "kind" | "seq" | "ts">;

// ── Wrappers (Pi appendEntry + leaf-id capture + seq stamp) ──────────────────

/**
 * appendRewindMarker — persist a rewind marker, return its new entry id (or null).
 *
 * STEPS (spec/05 §1 step 6; spec/02 C7; the item contract):
 *   1. sessionId = ctx.sessionManager.getSessionId()  — read FRESH each call (C12; GOTCHA #10).
 *   2. seq = nextSeq(sessionId)                        — monotonic per-session counter (runtime.ts; pre-increment → first is 1).
 *   3. Build the entry: { ...data, schema, v:1, kind:"rewind", id: randomUUID(), seq, ts: Date.now() }.
 *   4. pi.appendEntry("mulligan:rewind", entry)        — appends a CustomEntry (NOT in LLM context). Returns void (C7).
 *   5. IMMEDIATELY (same synchronous tick, before any other append — C7/GOTCHA #5): return ctx.sessionManager.getLeafId().
 *
 * NEVER throws: the whole body is wrapped in try/catch → returns null on ANY failure (appendEntry throws,
 * getSessionId/getLeafId throw, or getLeafId returns null). The id+seq+ts stamp BEFORE appendEntry so the persisted
 * marker is always complete even if the leaf capture later fails (we just return null then). Writes through `pi`;
 * reads through `ctx.sessionManager` (C1).
 *
 * @param pi   the Pi ExtensionAPI (appendEntry lives here, not on ctx — spec/02 C1/C9).
 * @param ctx  the Pi ExtensionContext (sessionManager is ReadonlySessionManager — read-only; spec/02 C1).
 * @param data the rewind payload (granularity, options, excludeToolCallId, note, ledger).
 * @returns the new marker's entry id, or null on failure / when the session has no leaf.
 */
export function appendRewindMarker(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  data: RewindMarkerInput,
): string | null {
  try {
    const sessionId = ctx.sessionManager.getSessionId();
    const seq = nextSeq(sessionId);
    const entry: RewindMarker = {
      ...data,
      schema: "pi-mulligan",
      v: 1,
      kind: "rewind",
      id: randomUUID(),
      seq,
      ts: Date.now(),
    };
    pi.appendEntry("mulligan:rewind", entry);
    // C7: appendEntry returns void — capture the new leaf id IMMEDIATELY, before any other append.
    return ctx.sessionManager.getLeafId();
  } catch {
    return null; // never throw on the tool/event hot path
  }
}

/**
 * appendShrinkMarker — persist a shrink marker, return its new entry id (or null). Same shape/contract as
 * appendRewindMarker (kind "shrink", customType "mulligan:shrink", id stamped). Consumed by tools/shrink.ts (P1.M5.T2).
 */
export function appendShrinkMarker(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  data: ShrinkMarkerInput,
): string | null {
  try {
    const sessionId = ctx.sessionManager.getSessionId();
    const seq = nextSeq(sessionId);
    const entry: ShrinkMarker = {
      ...data,
      schema: "pi-mulligan",
      v: 1,
      kind: "shrink",
      id: randomUUID(),
      seq,
      ts: Date.now(),
    };
    pi.appendEntry("mulligan:shrink", entry);
    return ctx.sessionManager.getLeafId();
  } catch {
    return null;
  }
}

/**
 * appendTurnMetric — persist a turn-metric marker, return its new entry id (or null). kind "turn-metric",
 * customType "mulligan:turn-metric". NOTE (GOTCHA #4): spec/04 §5 TurnMetric has NO `id` field, so this wrapper
 * does NOT stamp one (unlike rewind/shrink). Consumed by the nudges.ts turn_end handler (P1.M6.T2.S1).
 */
export function appendTurnMetric(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  data: TurnMetricInput,
): string | null {
  try {
    const sessionId = ctx.sessionManager.getSessionId();
    const seq = nextSeq(sessionId);
    const entry: TurnMetric = {
      ...data,
      schema: "pi-mulligan",
      v: 1,
      kind: "turn-metric",
      seq,
      ts: Date.now(),
    };
    pi.appendEntry("mulligan:turn-metric", entry);
    return ctx.sessionManager.getLeafId();
  } catch {
    return null;
  }
}
```

#### Exact content to CREATE — `test/markers.test.ts` (Task 2 — copy verbatim)

```ts
import { describe, it, expect, expectTypeOf, beforeEach, afterEach } from "vitest";
import {
  appendRewindMarker,
  appendShrinkMarker,
  appendTurnMetric,
  type MulliganEnvelope,
  type RewindMarker,
  type RewindMarkerInput,
  type ShrinkMarker,
  type ShrinkMarkerInput,
  type ShrinkTarget,
  type TurnMetric,
  type TurnMetricInput,
} from "../src/markers.js";
import { clearAll } from "../src/runtime.js";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// GOTCHA #8: nextSeq mutates the SHARED module-scoped runtime map. clearAll() before AND after each test so a
// previous test's seq sequence can't leak in (mirror test/runtime.test.ts GOTCHA #7).
beforeEach(() => clearAll());
afterEach(() => clearAll());

// ── fakes (the looper-smoke A1.appendEntry capture pattern, with hand-rolled objects) ─────────

/** A minimal fake ExtensionAPI capturing appendEntry calls. Set throwOnAppend to simulate a Pi failure. */
function makePi(opts: { throwOnAppend?: boolean } = {}) {
  const appended: { customType: string; data: unknown }[] = [];
  const pi = {
    appendEntry(customType: string, data?: unknown) {
      if (opts.throwOnAppend) throw new Error("appendEntry boom");
      appended.push({ customType, data });
    },
  };
  return { appended, pi: pi as unknown as ExtensionAPI };
}

/**
 * A minimal fake ExtensionContext. Tracks sessionManager method-call ORDER (for the C7 proof) and scripts the leaf
 * id (default "leaf-1"; pass leafId: null to test the null path; throwOn* to simulate failures).
 */
function makeCtx(opts: {
  sessionId?: string;
  leafId?: string | null;
  throwOnGetSessionId?: boolean;
  throwOnGetLeafId?: boolean;
} = {}) {
  const sessionId = opts.sessionId ?? "s1";
  const calls: string[] = [];
  // default to "leaf-1" UNLESS leafId is explicitly passed (incl. null) — lets callers test the null return.
  const scriptedLeafId: string | null = opts.leafId === undefined ? "leaf-1" : opts.leafId;
  const sessionManager = {
    getSessionId() {
      calls.push("getSessionId");
      if (opts.throwOnGetSessionId) throw new Error("getSessionId boom");
      return sessionId;
    },
    getLeafId() {
      calls.push("getLeafId");
      if (opts.throwOnGetLeafId) throw new Error("getLeafId boom");
      return scriptedLeafId;
    },
  };
  return { calls, ctx: { sessionManager } as unknown as ExtensionContext };
}

// ── pinned payloads (spec/04 §3/§4/§5 shapes, minus the wrapper-stamped fields) ─────────────

const REWIND_DATA: RewindMarkerInput = {
  granularity: "last_tool_call_group",
  options: { to_previous_prompt: false },
  excludeToolCallId: "call-rewind-self",
  note: {
    what_happened: "Ran a repo-wide grep that dumped ~38k tokens.",
    avoid: "Don't grep without -l; use the built-in grep tool which truncates.",
    true_current_state: "No files changed on the abandoned span.",
    next: "Re-run as grep -rl auth src/ and read only the 3 relevant files.",
  },
  ledger: { readFiles: ["src/a.ts"], modifiedFiles: [], bashSideEffects: [] },
};

const SHRINK_DATA: ShrinkMarkerInput = {
  target: { by_tool_name: "read", occurrence: "last" },
  replacement: "(shrink) the big log was ~9k tokens; the bug is on line 42.",
  reason: "too big to keep carrying verbatim",
};

const METRIC_DATA: TurnMetricInput = {
  deltaTokens: 4321,
  bloatHit: true,
  bloatHits: [{ toolName: "read", approxTokens: 9412 }],
  grewOverThreshold: true,
  turnIndex: 3,
};

// ── envelope + customType + seq + ts stamping ────────────────────────────────

describe("appendRewindMarker — envelope + customType + seq + ts stamping (spec/04 §1/§3, spec/05 §1 step6)", () => {
  it("calls pi.appendEntry once with customType 'mulligan:rewind' and the full envelope", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    const id = appendRewindMarker(pi, ctx, REWIND_DATA);
    expect(appended).toHaveLength(1);
    expect(appended[0].customType).toBe("mulligan:rewind");
    const entry = appended[0].data as RewindMarker;
    expect(entry.schema).toBe("pi-mulligan");
    expect(entry.v).toBe(1);
    expect(entry.kind).toBe("rewind");
    expect(entry.seq).toBe(1); // first marker this session → seq 1 (nextSeq pre-increment)
    expect(typeof entry.ts).toBe("number");
    expect(entry.ts).toBeLessThanOrEqual(Date.now());
    // returns the leaf id captured after append (C7):
    expect(id).toBe("leaf-1");
  });

  it("spreads the caller payload verbatim (granularity/options/excludeToolCallId/note/ledger)", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    appendRewindMarker(pi, ctx, REWIND_DATA);
    const entry = appended[0].data as RewindMarker;
    expect(entry.granularity).toBe("last_tool_call_group");
    expect(entry.options).toEqual({ to_previous_prompt: false });
    expect(entry.excludeToolCallId).toBe("call-rewind-self");
    expect(entry.note).toEqual(REWIND_DATA.note);
    expect(entry.ledger).toEqual(REWIND_DATA.ledger);
  });
});

describe("appendShrinkMarker — envelope + customType + payload (spec/04 §4, spec/05 §2 step4)", () => {
  it("calls pi.appendEntry once with customType 'mulligan:shrink', kind 'shrink', returns leaf id", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    const id = appendShrinkMarker(pi, ctx, SHRINK_DATA);
    expect(appended).toHaveLength(1);
    expect(appended[0].customType).toBe("mulligan:shrink");
    const entry = appended[0].data as ShrinkMarker;
    expect(entry.schema).toBe("pi-mulligan");
    expect(entry.v).toBe(1);
    expect(entry.kind).toBe("shrink");
    expect(entry.target).toEqual({ by_tool_name: "read", occurrence: "last" });
    expect(entry.replacement).toBe(SHRINK_DATA.replacement);
    expect(entry.reason).toBe("too big to keep carrying verbatim");
    expect(entry.id).toBe(id); // shrink stamps an id (uuid) — see id-rules describe
    expect(id).toBe("leaf-1");
  });
});

describe("appendTurnMetric — envelope + customType + payload (spec/04 §5)", () => {
  it("calls pi.appendEntry once with customType 'mulligan:turn-metric', kind 'turn-metric', returns leaf id", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    const id = appendTurnMetric(pi, ctx, METRIC_DATA);
    expect(appended).toHaveLength(1);
    expect(appended[0].customType).toBe("mulligan:turn-metric");
    const entry = appended[0].data as TurnMetric;
    expect(entry.schema).toBe("pi-mulligan");
    expect(entry.v).toBe(1);
    expect(entry.kind).toBe("turn-metric");
    expect(entry.deltaTokens).toBe(4321);
    expect(entry.bloatHit).toBe(true);
    expect(entry.bloatHits).toEqual([{ toolName: "read", approxTokens: 9412 }]);
    expect(entry.grewOverThreshold).toBe(true);
    expect(entry.turnIndex).toBe(3);
    expect(id).toBe("leaf-1");
  });
});

// ── id rules (GOTCHA #4): rewind+shrink stamp a uuid; turn-metric stamps NONE ─

describe("id stamping — rewind+shrink get a uuid; turn-metric gets NONE (spec/04 §3/§4/§5, GOTCHA #4)", () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  it("appendRewindMarker stamps an `id` that is a uuid string", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    appendRewindMarker(pi, ctx, REWIND_DATA);
    const entry = appended[0].data as RewindMarker;
    expect(typeof entry.id).toBe("string");
    expect(entry.id).toMatch(UUID_RE); // crypto.randomUUID is a v4 uuid
  });

  it("appendShrinkMarker stamps an `id` that is a uuid string", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    appendShrinkMarker(pi, ctx, SHRINK_DATA);
    const entry = appended[0].data as ShrinkMarker;
    expect(typeof entry.id).toBe("string");
    expect(entry.id).toMatch(UUID_RE);
  });

  it("appendTurnMetric does NOT stamp an `id` (spec/04 §5 has no id field)", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    appendTurnMetric(pi, ctx, METRIC_DATA);
    const entry = appended[0].data as Record<string, unknown>;
    expect(entry).not.toHaveProperty("id"); // GOTCHA #4 — the whole point
    expect(entry.kind).toBe("turn-metric");
  });

  it("two rewind markers get DISTINCT ids", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    appendRewindMarker(pi, ctx, REWIND_DATA);
    appendRewindMarker(pi, ctx, REWIND_DATA);
    const a = (appended[0].data as RewindMarker).id;
    const b = (appended[1].data as RewindMarker).id;
    expect(a).not.toBe(b);
  });
});

// ── seq monotonic per session (nextSeq) ──────────────────────────────────────

describe("seq — monotonic per session, stamped before append (spec/04 §3 seq; runtime.ts nextSeq)", () => {
  it("seq increments across marker types within ONE session: rewind 1, shrink 2, turn-metric 3", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ sessionId: "s1" });
    appendRewindMarker(pi, ctx, REWIND_DATA);
    appendShrinkMarker(pi, ctx, SHRINK_DATA);
    appendTurnMetric(pi, ctx, METRIC_DATA);
    expect((appended[0].data as RewindMarker).seq).toBe(1);
    expect((appended[1].data as ShrinkMarker).seq).toBe(2);
    expect((appended[2].data as TurnMetric).seq).toBe(3);
  });

  it("seq is ISOLATED per session — a second session starts at 1 (nextSeq contract)", () => {
    const { pi } = makePi();
    const { ctx: ctxA } = makeCtx({ sessionId: "A" });
    const { ctx: ctxB } = makeCtx({ sessionId: "B" });
    appendRewindMarker(pi, ctxA, REWIND_DATA); // A → 1
    appendRewindMarker(pi, ctxA, REWIND_DATA); // A → 2
    const { appended, pi: piB } = makePi();
    appendRewindMarker(piB, ctxB, REWIND_DATA); // B → 1 (fresh session)
    expect((appended[0].data as RewindMarker).seq).toBe(1);
  });

  it("seq is stamped onto the persisted entry (read back from the appended data)", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    appendRewindMarker(pi, ctx, REWIND_DATA);
    expect(appended[0].data).toHaveProperty("seq", 1);
  });
});

// ── C7 leaf-id capture ordering (GOTCHA #5) ──────────────────────────────────

describe("C7 — leaf id captured IMMEDIATELY after appendEntry, same tick (spec/02 C7, GOTCHA #5)", () => {
  it("call order is getSessionId → appendEntry → getLeafId; return == getLeafId()", () => {
    const order: string[] = [];
    const pi = {
      appendEntry: () => {
        order.push("appendEntry");
      },
    } as unknown as ExtensionAPI;
    const ctx = {
      sessionManager: {
        getSessionId: () => {
          order.push("getSessionId");
          return "s1";
        },
        getLeafId: () => {
          order.push("getLeafId");
          return "leaf-after-append";
        },
      },
    } as unknown as ExtensionContext;
    const id = appendRewindMarker(pi, ctx, REWIND_DATA);
    expect(id).toBe("leaf-after-append");
    expect(order).toEqual(["getSessionId", "appendEntry", "getLeafId"]); // nothing between appendEntry and getLeafId
  });

  it("appendEntry is called exactly once (no double-append, no sendMessage in the wrapper)", () => {
    let appendCount = 0;
    const pi = { appendEntry: () => { appendCount++; } } as unknown as ExtensionAPI;
    const ctx = {
      sessionManager: { getSessionId: () => "s1", getLeafId: () => "leaf-1" },
    } as unknown as ExtensionContext;
    appendRewindMarker(pi, ctx, REWIND_DATA);
    expect(appendCount).toBe(1);
  });
});

// ── leaf-null return + never-throws (GOTCHA #2, #3) ──────────────────────────

describe("leaf-null return — getLeafId() returns null → wrapper returns null (no throw)", () => {
  it("appendRewindMarker returns null when getLeafId() is null (marker still appended)", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ leafId: null });
    const id = appendRewindMarker(pi, ctx, REWIND_DATA);
    expect(id).toBeNull();
    expect(appended).toHaveLength(1); // the marker WAS appended; we just can't report its id
  });

  it("all three wrappers return null when getLeafId() is null", () => {
    const { pi } = makePi();
    expect(appendRewindMarker(pi, makeCtx({ leafId: null }).ctx, REWIND_DATA)).toBeNull();
    expect(appendShrinkMarker(pi, makeCtx({ leafId: null }).ctx, SHRINK_DATA)).toBeNull();
    expect(appendTurnMetric(pi, makeCtx({ leafId: null }).ctx, METRIC_DATA)).toBeNull();
  });
});

describe("never throws — every failure mode yields null (GOTCHA #3)", () => {
  it("a throwing pi.appendEntry → null, no throw", () => {
    const { pi } = makePi({ throwOnAppend: true });
    const { ctx } = makeCtx();
    expect(() => appendRewindMarker(pi, ctx, REWIND_DATA)).not.toThrow();
    expect(appendRewindMarker(pi, ctx, REWIND_DATA)).toBeNull();
  });

  it("a throwing getSessionId → null, no throw", () => {
    const { pi } = makePi();
    const { ctx } = makeCtx({ throwOnGetSessionId: true });
    expect(() => appendShrinkMarker(pi, ctx, SHRINK_DATA)).not.toThrow();
    expect(appendShrinkMarker(pi, ctx, SHRINK_DATA)).toBeNull();
  });

  it("a throwing getLeafId → null, no throw", () => {
    const { pi } = makePi();
    const { ctx } = makeCtx({ throwOnGetLeafId: true });
    expect(() => appendTurnMetric(pi, ctx, METRIC_DATA)).not.toThrow();
    expect(appendTurnMetric(pi, ctx, METRIC_DATA)).toBeNull();
  });

  it("a throwing appendEntry in appendTurnMetric → null, no throw (and no id stamp issue)", () => {
    const { pi } = makePi({ throwOnAppend: true });
    const { ctx } = makeCtx();
    expect(() => appendTurnMetric(pi, ctx, METRIC_DATA)).not.toThrow();
    expect(appendTurnMetric(pi, ctx, METRIC_DATA)).toBeNull();
  });
});

// ── types ────────────────────────────────────────────────────────────────────

describe("types (GOTCHA #2 — string | null)", () => {
  it("all three wrappers return string | null", () => {
    const { pi } = makePi();
    const { ctx } = makeCtx();
    expectTypeOf(appendRewindMarker(pi, ctx, REWIND_DATA)).toEqualTypeOf<string | null>();
    expectTypeOf(appendShrinkMarker(pi, ctx, SHRINK_DATA)).toEqualTypeOf<string | null>();
    expectTypeOf(appendTurnMetric(pi, ctx, METRIC_DATA)).toEqualTypeOf<string | null>();
  });

  it("MulliganEnvelope is { schema:'pi-mulligan'; v:1; kind:'rewind'|'shrink'|'turn-metric' }", () => {
    expectTypeOf<MulliganEnvelope>().toEqualTypeOf<{
      schema: "pi-mulligan";
      v: 1;
      kind: "rewind" | "shrink" | "turn-metric";
    }>();
  });

  it("RewindMarker extends the envelope and narrows kind to 'rewind'", () => {
    const m = {} as RewindMarker;
    expectTypeOf(m.schema).toEqualTypeOf<"pi-mulligan">();
    expectTypeOf(m.kind).toEqualTypeOf<"rewind">();
    expectTypeOf(m.id).toEqualTypeOf<string>();
    expectTypeOf(m.seq).toEqualTypeOf<number>();
    expectTypeOf(m.ts).toEqualTypeOf<number>();
  });

  it("TurnMetric has NO `id` field and deltaTokens is number | null (GOTCHA #4, #6)", () => {
    const m = {} as TurnMetric;
    expectTypeOf(m).not.toHaveProperty("id");
    expectTypeOf(m.deltaTokens).toEqualTypeOf<number | null>();
    expectTypeOf(m.kind).toEqualTypeOf<"turn-metric">();
  });

  it("ShrinkTarget is the 3-arm discriminated union", () => {
    const a: ShrinkTarget = { by_tool_call_id: "x" };
    const b: ShrinkTarget = { by_tool_name: "read", occurrence: "last" };
    const c: ShrinkTarget = { by_content_includes: "substr" };
    expectTypeOf(a).toEqualTypeOf<ShrinkTarget>();
    expectTypeOf(b).toEqualTypeOf<ShrinkTarget>();
    expectTypeOf(c).toEqualTypeOf<ShrinkTarget>();
  });

  it("the *Input types are the marker MINUS the wrapper-stamped fields", () => {
    // RewindMarkerInput omits schema/v/kind/id/seq/ts but keeps granularity/note/ledger/etc.
    const r: RewindMarkerInput = REWIND_DATA;
    expectTypeOf(r.granularity).toEqualTypeOf<RewindMarker["granularity"]>();
    // TurnMetricInput omits schema/v/kind/seq/ts (and has NO id to begin with)
    const t: TurnMetricInput = METRIC_DATA;
    expectTypeOf(t.deltaTokens).toEqualTypeOf<number | null>();
    expectTypeOf(t).not.toHaveProperty("seq");
    const s: ShrinkMarkerInput = SHRINK_DATA;
    expectTypeOf(s.target).toEqualTypeOf<ShrinkTarget>();
  });
});
```

### Implementation Patterns & Key Details

```ts
// PATTERN (each wrapper): compute seq/id/ts BEFORE appendEntry; capture leaf id IMMEDIATELY after (C7/GOTCHA #5).
try {
  const sessionId = ctx.sessionManager.getSessionId(); // read fresh (C12)
  const seq = nextSeq(sessionId);                       // pre-increment; first call → 1
  const entry: RewindMarker = {                         // annotation gives the literal fields their narrow types
    ...data, schema: "pi-mulligan", v: 1, kind: "rewind", id: randomUUID(), seq, ts: Date.now(),
  };
  pi.appendEntry("mulligan:rewind", entry);             // returns void (C7); appends a CustomEntry (not in context)
  return ctx.sessionManager.getLeafId();                // string | null; called same tick, before any other append
} catch {
  return null;                                          // NEVER throw on the hot path (GOTCHA #3)
}

// CRITICAL: turn-metric drops the `id` line (spec/04 §5 has no id — GOTCHA #4):
//   const entry: TurnMetric = { ...data, schema, v:1, kind:"turn-metric", seq, ts: Date.now() };

// CRITICAL: writes go through `pi` (ExtensionAPI.appendEntry); reads through `ctx.sessionManager` (ReadonlySessionManager,
//   C1). The wrapper takes BOTH `pi` and `ctx` for this split (GOTCHA #10).
```

### Integration Points

```yaml
# This task adds NO wiring (no index.ts change). It DEFINES + EXPORTS the write-path surface other tasks consume:

EXPORTS (consumed by downstream tasks):
  - appendRewindMarker  → tools/rewind.ts step 6 (P1.M5.T1.S1).
  - appendShrinkMarker  → tools/shrink.ts step 4 (P1.M5.T2.S1).
  - appendTurnMetric    → nudges.ts turn_end handler (P1.M6.T2.S1).
  - RewindMarker / ShrinkMarker / TurnMetric / MulliganEnvelope / ShrinkTarget
                        → filter.ts readMarkers cast (P1.M4.T2.S1); audit.ts (P1.M5.T4.S1); transforms.ts filterPipeline
                          (P1.M3.T5.S1) may import the marker types or mirror them — these are the canonical shapes.
  - *Input types        → the tools build these payloads from their typebox params + ledger/note helpers.
  - leaveNote / setCheckpoint (S2, P1.M4.T1.S2) APPEND to markers.ts next and REUSE MulliganEnvelope + the capture idiom.

INPUT SOURCES (already specified upstream — no action here):
  - pi / ctx:           handed in by the tool execute(toolCallId, params, signal, onUpdate, ctx) (pi from the factory
                        closure) or by an event handler (event, ctx). The wrapper takes both.
  - seq:                runtime.ts nextSeq(ctx.sessionManager.getSessionId()).
  - id (rewind/shrink): node:crypto randomUUID().
  - data payload:       built by the caller (tool/nudge) from validated params + ledger.ts + notes.ts.

CONFIG / DATABASE / ROUTES: none — markers.ts is write glue. It PERSISTS via pi.appendEntry (CustomEntry, JSONL on
  disk) but owns no schema/migration/route. The marker shapes ARE the persisted schema (spec/04).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Run after creating src/markers.ts (and again after the test file). The type+style gate IS tsc.
npx tsc --noEmit -p tsconfig.json
# Expected: exit 0, zero errors. If errors exist, READ the output and fix before proceeding.
#   Common fixes: a missing type import; a literal not narrowing (add the `: Marker` annotation on the entry const);
#   an `id` on the turn-metric entry (remove it — GOTCHA #4).
# (There is NO eslint/prettier/biome — GOTCHA #12. Do NOT run a lint/format command.)
```

### Level 2: Unit Tests (Component Validation)

```bash
# Test the new markers suite in isolation.
npx vitest run test/markers.test.ts            # Expected: all markers tests pass.

# Full suite — confirm NO regression to the baseline (7 files / 264 tests → 8 files / 264+N).
npx vitest run                                 # Expected: 8 files all green.

# Expected: all tests pass. If failing, debug root cause and fix the implementation (do NOT weaken the tests —
#   the envelope/seq/id/C7/never-throws contract is spec-mandated). The most common failure is a seq leak across
#   tests — confirm beforeEach/afterEach clearAll() (GOTCHA #8).
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for this subtask's UNIT tier. markers.ts is Pi-coupled glue, but it is fully exercised with hand-rolled fakes
# (the looper-smoke A1 pattern) in Level 2 — NO real `pi -e` run is needed here. The REAL end-to-end read-back
# (append a marker → the context filter reads it via getEntries() → resolves it) is validated by:
#   - filter.ts (P1.M4.T2.S1): the F-rewind-core scenario proves a marker written here is read back + applied.
#   - the F-* integration scenarios (P1.M7.T2 / spec/10 §2) against a real `pi -p` run.
# Do NOT spin up `pi -e ./src/index.ts` in this task — the unit fakes are the correct Tier-1 validation surface.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# The domain-specific checks for THIS module are the C7-ordering correctness + the never-throws guarantee + the
# id-rules (rewind/shrink yes, turn-metric no), all encoded as Level-2 assertions. The single highest-value test is
# the C7 ordering proof: assert the call order is getSessionId → appendEntry → getLeafId with NOTHING between
# appendEntry and getLeafId (the `order` array test in the "C7" describe block). No additional tooling required.
```

## Final Validation Checklist

### Technical Validation

- [ ] Level 1 green: `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] Level 2 green: `npx vitest run` → 8 files all pass (no regression to the 264-test baseline).
- [ ] `npx vitest run test/markers.test.ts` → all markers tests pass.
- [ ] No lint/format command invented (none configured — GOTCHA #12).

### Feature Validation

- [ ] **Envelope stamped exactly:** every persisted entry has `schema:"pi-mulligan"`, `v:1`, the right `kind`.
- [ ] **customType correct:** `mulligan:rewind` / `mulligan:shrink` / `mulligan:turn-metric` (one appendEntry each).
- [ ] **seq stamped + monotonic per session + isolated across sessions** (rewind→1, shrink→2, turn-metric→3 in one
      session; a second session starts at 1).
- [ ] **id rules (GOTCHA #4):** rewind+shrink stamp a uuid `id`; turn-metric stamps NO `id` key.
- [ ] **ts is a number** (Date.now()).
- [ ] **C7 ordering (GOTCHA #5):** call order getSessionId → appendEntry → getLeafId; return == getLeafId().
- [ ] **getLeafId() null → null return** (marker still appended); **never throws** on any failure mode (GOTCHA #3).
- [ ] **Payload spread verbatim** (granularity/options/excludeToolCallId/note/ledger; target/replacement/reason;
      deltaTokens/bloatHit/bloatHits/grewOverThreshold/turnIndex).
- [ ] **Return type is `string | null`** for all three wrappers (GOTCHA #2).

### Code Quality Validation

- [ ] Mirrors `runtime.test.ts` (clearAll before+after) + `notes.test.ts` (expectTypeOf) conventions.
- [ ] File placement matches the desired tree (`src/markers.ts`, `test/markers.test.ts`).
- [ ] Wrappers are thin glue (no business logic; no sendMessage/setLabel — those are S2).
- [ ] The marker interfaces are EXPORTED (one canonical shape for writer + reader + tests).
- [ ] Signature is exactly `(pi: ExtensionAPI, ctx: ExtensionContext, data: <Kind>Input): string | null` (not widened).
- [ ] Anti-patterns avoided (see below).

### Documentation & Deployment

- [ ] Module header doc cites the spec sections + the GOTCHA-driven design.
- [ ] Each interface field has a doc-comment mirroring spec/04 (mandated purpose).
- [ ] No new environment variables (uses node:crypto + the existing runtime/config/ledger/notes modules).

---

## Anti-Patterns to Avoid

- ❌ Don't return `string` — the faithful type is `string | null` (getLeafId is `string | null`; try/catch returns null) (GOTCHA #2).
- ❌ Don't stamp an `id` on the turn-metric entry — spec/04 §5 has no `id` field (GOTCHA #4).
- ❌ Don't let anything append between `pi.appendEntry` and `ctx.sessionManager.getLeafId()` — that breaks the C7
  leaf-capture (the id would be wrong). Compute seq/id/ts first; capture leaf id last, same tick (GOTCHA #5).
- ❌ Don't drop the try/catch — markers.ts is on the tool/event hot path; a throw breaks an agent turn (GOTCHA #3).
- ❌ Don't cache `ctx.sessionManager` across calls or store it in the runtime map — read it fresh each call (C12).
- ❌ Don't `sendMessage` or `setLabel` in these wrappers — that's `leaveNote`/`setCheckpoint` (S2, P1.M4.T1.S2) (GOTCHA #1).
- ❌ Don't forget `clearAll()` before+after each test — `nextSeq` mutates the shared runtime map; without it seq leaks
  across tests (GOTCHA #8).
- ❌ Don't invent a lint/format command — none is configured; the gate is `tsc --noEmit` (GOTCHA #12).
- ❌ Don't redefine the marker shapes ad hoc — match spec/04 §1/§3/§4/§5 (with the two documented widenings #4/#6/#7).