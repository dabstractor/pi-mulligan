# PRP — P1.M4.T2.S1: `context` handler — read markers, call pipeline, cache, fail-open

**Work item:** P1.M4.T2.S1 · **Points:** 2 · **Stage:** Pi Integration Layer (spec/11 §2 Step 5 — `filter.ts`, the
"heart of the extension" runtime entry point; spec/03 §2.4 / §7; spec/06 §1).
**Scope:** **CREATE two new files** — `src/filter.ts` (the `context` event handler + `readMarkers` +
`registerFilterHandler` + no-op nudge stubs) and `test/filter.test.ts` (readMarkers / handler /
registration / fail-open). **No other file is touched.** This is the **runtime entry point for ALL
Mulligan transforms**: it fires before every LLM call, reads persisted markers fresh, delegates to the
pure `filterPipeline`, caches the filtered view for `mulligan_audit`, and **fails open** (any error →
logged no-op → pass-through, NEVER a broken agent turn).

> **PREREQUISITE (read first):** This task statically imports `filterPipeline` from `"./transforms.js"`
> (P1.M3.T5.S1). If P1.M3.T5.S1 is NOT yet implemented, `npx tsc --noEmit` fails on that import and
> this task CANNOT be implemented — it MUST be sequenced after P1.M3.T5.S1 (the plan shows P1.M3.T5.S1
> "Planned"; implementation follows dependency order). The `filterPipeline` CONTRACT consumed here is
> specified in the Implementation Blueprint; P1.M3.T5.S1 is expected to honor it. **Verify before
> coding:** `grep -n "export function filterPipeline" src/transforms.ts` — if absent, STOP (P1.M3.T5.S1
> not done) and sequence this task after it.

> **Runs in parallel with P1.M4.T1.S2** (leaveNote/setCheckpoint). Treat P1.M4.T1.S1+S2's
> `src/markers.ts` as a CONTRACT: when this task begins, `markers.ts` exports the marker INTERFACES
> `RewindMarker` / `ShrinkMarker` / `TurnMetric` / `MulliganEnvelope` + the three `append*` wrappers +
> `leaveNote` + `setCheckpoint`. filter.ts imports only the marker **INTERFACES** (type-only — erased at
> runtime; `markers.ts`'s Pi function imports do NOT leak). **Verified live** during research: markers.ts
> is implemented; `npx tsc --noEmit` exits 0.

---

## Goal

**Feature Goal**: Ship Mulligan's **`context` event handler** — the single runtime entry point that
transforms the message copy sent to the model on every inference. Before each LLM call it: reads the
per-session runtime, loads config (pass-through when disabled), reads ALL `mulligan:*` markers FRESH
from `ctx.sessionManager.getEntries()` (C12), reads the branch FRESH, delegates the actual transform
to the pure `filterPipeline`, conditionally injects the per-turn drift nudge, caches the filtered view
into `rt.lastFiltered`/`rt.lastFilterTs` for `mulligan_audit`, and returns `{ messages }`. The ENTIRE
body is wrapped in try/catch — on ANY exception it logs and returns nothing (pass-through), so an
extension bug can NEVER break an agent turn.

**Deliverable** (CREATE two new files):
1. **`src/filter.ts`** — exports:
   - `export interface MarkersBundle { rewinds: RewindMarker[]; shrinks: ShrinkMarker[]; metric: TurnMetric | null }`
     — the readMarkers return shape (also the structural contract for filterPipeline's `markers` param).
   - `export function readMarkers(ctx): MarkersBundle` — scan `ctx.sessionManager.getEntries()` for
     `type==="custom" && customType.startsWith("mulligan:")`; bucket rewinds/shrinks; keep only the
     LATEST turn-metric (highest `seq`). Defensive (never throws); malformed/unknown entries skipped.
   - `export function contextHandler(event: ContextEvent, ctx: ExtensionContext): ContextEventResult | void`
     — the handler logic (a)–(h), wrapped in try/catch (fail-open). Exported (named) so the test suite
     can call it directly with fakes.
   - `export function registerFilterHandler(pi: ExtensionAPI): void` — `pi.on("context", contextHandler)`.
     Consumed by `index.ts` (P1.M7.T1.S1).
   - `export function shouldNudge(metric: TurnMetric, config: MulliganConfig): boolean` — **no-op stub**
     (returns `false`); wired for real in P1.M6.T2.S2.
   - `export function injectNudge(messages: MessageLike[], metric: TurnMetric): MessageLike[]` — **no-op
     stub** (returns `messages` unchanged); wired for real in P1.M6.T2.S2.
2. **`test/filter.test.ts`** — hand-rolled fakes (`makeCtx` with `getSessionId`/`getEntries`/`getBranch`;
   `makePi` capturing `.on`; a `vi.mock("./transforms.js")` controllable `filterPipeline`), with
   describe blocks for readMarkers, contextHandler (disabled → pass-through; enabled → transform +
   cache; fail-open on thrown pipeline / thrown readMarkers; nudge-stub no-op), and registerFilterHandler.

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0** (filter.ts compiles under `strict`; the handler
  signature matches the verified `ExtensionHandler<ContextEvent, ContextEventResult>` overload; the
  `log(sessionId, …)` call matches src/log.ts; the filterPipeline import resolves).
- `npx vitest run test/filter.test.ts` → all filter tests pass.
- `npx vitest run` → **all-green, no regression** (filter.ts adds 2 new files; it touches nothing else).
- **contextHandler returns `undefined` (pass-through) when `config.enabled === false`** AND does not
  touch `rt.lastFiltered`.
- **contextHandler delegates to filterPipeline** with `(event.messages, markers, config, branchEntries)`
  and returns filterPipeline's result as `{ messages }`.
- **contextHandler writes `rt.lastFiltered` + `rt.lastFilterTs`** on every enabled fire (cached for
  mulligan_audit, spec/06 §7).
- **contextHandler reads `ctx.sessionManager` FRESH** each fire (C12) — `getEntries`, `getBranch`,
  `getSessionId` are called inside the handler body, never cached at module scope.
- **contextHandler NEVER throws**: a throwing `filterPipeline` or `readMarkers` or `getSessionId` is
  caught → logged (`log("error", "filter.fire", sessionId, {error})`) → returns `undefined`
  (pass-through). The agent turn is never broken (spec/03 #4, spec/08 E13).
- **readMarkers reads markers FRESH** (no caching), buckets `mulligan:rewind`/`mulligan:shrink`, returns
  only the **latest** `mulligan:turn-metric` (highest `seq`), and **ignores** `custom_message` (notes)
  and `label` (checkpoints) entries.
- **registerFilterHandler calls `pi.on("context", contextHandler)` exactly once.**

---

## User Persona

**Target User**: Two runtime consumers. (1) **`index.ts` (P1.M7.T1.S1)** — the extension factory calls
`registerFilterHandler(pi)` once at startup to arm the transform. (2) **The model/agent loop itself** —
the `context` event fires before EVERY LLM call (verified: api_verification.md §7.1), so the handler is
the single chokepoint through which all Mulligan transforms (rewind removal, shrink substitution, drift
nudge) reach the model. Secondary consumers: `mulligan_audit` (P1.M5.T4.S1) reads `rt.lastFiltered`;
the test suite + the integration smoke harness (P1.M7.T2) exercise the handler end-to-end.

**Use Case**: Mid-session, the agent wasted a turn and called `mulligan_rewind` (which appended a
`mulligan:rewind` marker via markers.ts). On the NEXT inference — which was already going to happen —
the `context` event fires. `contextHandler` runs: config is on; `readMarkers(ctx)` finds the rewind
marker; `getBranch()` is read fresh; `filterPipeline(event.messages, markers, config, branchEntries)`
removes the rewind's target unit (pairing-safe); the filtered view is cached; `{ messages }` is
returned. The model sees `[kept prefix] + [note] + [rewind confirmation]` and resumes — **zero extra
requests** (design principle D3). If anything throws, the agent still gets its turn (pass-through).

**User Journey**:
1. `index.ts` factory: `registerFilterHandler(pi)` → `pi.on("context", contextHandler)` arms it once.
2. Agent loop → before each provider request, Pi deep-copies the active branch into `event.messages`
   and fires `context`.
3. `contextHandler(event, ctx)`: `getRuntime(getSessionId())` → `getConfig()` → (disabled? pass-through)
   → `readMarkers(ctx)` → `getBranch()` → `filterPipeline(...)` → (nudge stub, no-op) → cache →
   `return { messages }`.
4. Pi sends the (possibly transformed) copy to the model. The originals are NEVER mutated (soft-over-
   hard, D2); the session tree is untouched. `mulligan_audit` later reads `rt.lastFiltered` to report
   the filtered view without re-running the pipeline.

**Pain Points Addressed**: (a) The `context` event is the ONE free ride for in-flight transforms
(D3/D4) — without a handler, Mulligan's markers would persist but never affect the model's view. (b)
Pi's `event.messages` is a deep copy safe to mutate/replace, but the transform logic is intricate
(pairing, protected messages, composition); centralizing the orchestration in ONE fail-open handler
keeps the pure pipeline (transforms.ts) free of Pi coupling and guarantees no extension bug can break
a turn. (c) Markers are `custom` entries (NOT in context) while notes are `custom_message` (IN context)
— the handler must read markers from `getEntries()` (the entry stream), not from `event.messages`.

---

## Why

- **This IS the extension's heart (spec/04 architecture: "1 event-driven context filter … the heart of
  the extension — it reads persisted markers and rewrites the message copy sent to the model").** Until
  it ships, `mulligan_rewind`/`mulligan_shrink` markers persist but are inert (the model never sees the
  reduced view). Shipping it unblocks the integration smoke harness (P1.M7.T2) and is the proof that
  the whole "soft rewind, zero extra requests" thesis works (looper-smoke B1 proves the primitive; this
  is the production handler).
- **Clean separation: Pi-coupled glue here, pure correctness in transforms.ts.** The handler owns ONLY
  the Pi-coupled concerns (read markers from `getEntries()`, read branch from `getBranch()`, register
  via `pi.on`, cache into the runtime map, fail-open). The actual transform math stays in the pure,
  Pi-free, unit-tested `filterPipeline` (P1.M3.T5.S1). This mirrors how markers.ts split Pi glue
  (appendEntry) from pure helpers (notes/ledger/tokens).
- **Fail-open is a hard product guarantee (spec/03 #4, spec/08 E13).** The handler sits on the hottest
  path — it fires before EVERY inference. A throw here breaks the agent's turn, which is catastrophic.
  The entire body is one try/catch → log + return (pass-through). readMarkers is defensive for the same
  reason (a malformed marker entry must not poison the whole fire).
- **Caching the filtered view is the audit's only honest source (spec/06 §7, design principle #6
  honest bookkeeping).** `mulligan_audit` must report the FILTERED view (what the model actually saw),
  never Pi's raw `getContextUsage()` (which counts hidden tokens — D5). The handler is the only place
  that computes that view, so it caches `rt.lastFiltered`/`rt.lastFilterTs` each fire.
- **Read markers/branch FRESH (C12).** `ctx.sessionManager` is a read-only snapshot handle that may be
  invalidated across calls (Pi reloads/rebuilds it). The handler reads it fresh inside the body — never
  caches it at module scope or in the runtime map (runtime.ts stores ONLY primitive values + message
  arrays, never a sessionManager handle — verified).

### Interface note — the filterPipeline contract (cross-task; P1.M3.T5.S1 owns the implementation)

`filterPipeline` lives in `transforms.ts` (Pi-FREE — "Imports NOTHING — not Pi"), so it CANNOT take
`ctx: ExtensionContext` (the spec/06 §12 pseudocode `filterPipeline(messages, markers, config, ctx)` is
reference-only and impossible under transforms.ts's Pi-free invariant). The pure pipeline needs the
branch info that `resolveCheckpoint` (spec/06 §6) reads from `getBranch()` — so the HANDLER reads
`ctx.sessionManager.getBranch()` fresh (C12) and passes the plain `SessionEntry[]` as the 4th arg.

**filterPipeline signature this task consumes:**
```ts
filterPipeline(
  messages: MessageLike[],
  markers: { rewinds: RewindMarker[]; shrinks: ShrinkMarker[]; metric: TurnMetric | null },
  config: MulliganConfig,
  branchEntries: SessionEntry[],
): MessageLike[]
```
TS structural typing makes filter.ts's `MarkersBundle` assignable to filterPipeline's `markers` param
with ZERO shared-type coordination (P1.M3.T5.S1 may import the marker interfaces type-only from
markers.js — they are Pi-free). See the type-flow strategy in the Implementation Blueprint.

---

## What

CREATE `src/filter.ts` and `test/filter.test.ts`. The exact code is in the Implementation Blueprint
(copy verbatim). Behavior:

- **`readMarkers(ctx)`** — `const entries = ctx.sessionManager.getEntries();` (FRESH, C12). For each
  entry: skip unless `type === "custom"` and `customType` is a string starting with `"mulligan:"`; read
  `data` (defensive `isRecord`); dispatch on `customType`:
  - `"mulligan:rewind"` + `data.kind === "rewind"` → push into `rewinds`.
  - `"mulligan:shrink"` + `data.kind === "shrink"` → push into `shrinks`.
  - `"mulligan:turn-metric"` + `data.kind === "turn-metric"` → candidate; keep the one with the
    HIGHEST `seq` (defensive on missing/non-number seq → treat as `-Infinity`). Result: `metric`.
  - any other `mulligan:*` custom entry (future) → skip.
  Returns `{ rewinds, shrinks, metric }`. Notes (`custom_message`) and checkpoints (`label`) are
  naturally excluded by the `type === "custom"` filter. NEVER throws.
- **`contextHandler(event, ctx)`** — body in ONE try/catch:
  - `const sessionId = ctx.sessionManager.getSessionId();` (FRESH; read first so the catch can log it).
  - `const config = getConfig(); if (!config.enabled) return;` (master switch off → pass-through; do
    NOT cache `lastFiltered`).
  - `const rt = getRuntime(sessionId);`
  - `const markers = readMarkers(ctx);`
  - `const branchEntries = ctx.sessionManager.getBranch();` (FRESH).
  - `let messages: MessageLike[] = filterPipeline(event.messages, markers, config, branchEntries);`
  - nudge: `if (config.nudges.perTurnDrift && markers.metric && shouldNudge(markers.metric, config))
    messages = injectNudge(messages, markers.metric);` (stubs → no-op).
  - `rt.lastFiltered = messages; rt.lastFilterTs = Date.now();`
  - (optional defensive observability log — see Blueprint; wrapped in its own try/catch.)
  - `return { messages: messages as unknown as NonNullable<ContextEventResult["messages"]> };`
  - `catch (e)`: `log("error", "filter.fire", sessionId, { error: String(e) }); return;`
- **`registerFilterHandler(pi)`** — `pi.on("context", contextHandler);`
- **`shouldNudge` / `injectNudge`** — local no-op stubs (`false` / identity); replace in P1.M6.T2.S2.

This subtask does **NOT**: implement `filterPipeline` or any transform (P1.M3 — pure core); implement
the agent tools (P1.M5); implement the real nudges (P1.M6 — these stubs are placeholders); wire anything
into `index.ts` (P1.M7.T1); mutate `event.messages` in place (return a NEW array reference); cache a
`sessionManager` handle (C12); or touch any existing file.

### Success Criteria

- [ ] `src/filter.ts` EXISTS and EXPORTS `MarkersBundle`, `readMarkers`, `contextHandler`,
      `registerFilterHandler`, `shouldNudge`, `injectNudge`.
- [ ] `test/filter.test.ts` EXISTS and is all-green; `npx vitest run` is all-green (no regression).
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] **`registerFilterHandler` calls `pi.on("context", contextHandler)` exactly once.**
- [ ] **`contextHandler` returns `undefined` when `config.enabled === false`** and does not write
      `rt.lastFiltered`.
- [ ] **`contextHandler` calls `filterPipeline(event.messages, markers, config, branchEntries)`** and
      returns its result as `{ messages }`.
- [ ] **`contextHandler` writes `rt.lastFiltered` + `rt.lastFilterTs`** on every enabled fire.
- [ ] **`contextHandler` reads `ctx.sessionManager` FRESH** (getSessionId/getEntries/getBranch inside
      the body; no module-scope cache).
- [ ] **`contextHandler` NEVER throws** — a thrown `filterPipeline` / `readMarkers` / `getSessionId` is
      caught, logged via `log("error", "filter.fire", sessionId, …)`, and returns `undefined`.
- [ ] **`readMarkers` returns `{rewinds:[], shrinks:[], metric:null}` for an empty entry stream.**
- [ ] **`readMarkers` buckets `mulligan:rewind`/`mulligan:shrink` and returns only the LATEST
      `mulligan:turn-metric` (highest `seq`).**
- [ ] **`readMarkers` ignores `custom_message` (notes) and `label` (checkpoints) entries** and skips
      malformed/unknown `mulligan:*` entries without throwing.
- [ ] **`shouldNudge` returns `false`** and **`injectNudge` returns its `messages` argument unchanged**
      (no-op stubs).

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this
> successfully?"_ — **Yes.** The exact code for `src/filter.ts` is given verbatim in the Implementation
> Blueprint (Task 1), and the exact fakes + describe blocks for `test/filter.test.ts` are given verbatim
> (Task 2). Every Pi signature (`ContextEvent`/`ContextEventResult`/`ExtensionHandler`/`on("context")`
> from `dist/core/extensions/types.d.ts`; `getEntries`/`getBranch`/`getSessionId` from
`session-manager.d.ts`) is quoted from the **verified installed `.d.ts`** (research/api-and-contract-
verified.md §1, §3). The verified gotchas — `AgentMessage` is NOT exported (use runtime.ts's opaque
alias + the documented cast strategy); `log()` takes `sessionId` not `ctx` (spec/06 §1 pseudocode is
WRONG here) — are called out in the Gotchas. The filterPipeline cross-task contract is specified (§
"Why"). No prior knowledge beyond "create the context handler as thin Pi glue over the pure pipeline"
is required.

### Scope decision (READ BEFORE CODING)

- **CREATE `src/filter.ts` (NEW file) — it does NOT exist.** (Confirmed: `ls src/` shows index/config/
  log/runtime/tokens/ledger/notes/transforms/markers — no filter.ts.) Two new files only; APPEND
  nothing to existing files.
- **PREREQUISITE: P1.M3.T5.S1 (filterPipeline) MUST be implemented first.** filter.ts statically
  imports `filterPipeline` from `"./transforms.js"`. Verify `grep -n "export function filterPipeline"
  src/transforms.ts`; if absent, STOP and sequence after P1.M3.T5.S1. (The `vi.mock("./transforms.js")`
  in the test provides a runtime fake, but `tsc` still needs the real export to resolve the import in
  filter.ts.)
- **`log()` takes `sessionId`, NOT `ctx`** (verified: src/log.ts line 61). The handler already reads
  `sessionId` first, so the catch and any log line use `log(level, event, sessionId, data)`. Do NOT
  copy the spec/06 §1 `log("error","filter.fire",ctx,…)` pseudocode verbatim — it will not type-check
  (ctx is not a string).
- **`AgentMessage` is NOT exported** from the package (verified). Reuse runtime.ts's opaque alias
  (`import type { AgentMessage } from "./runtime.js"`) for the `rt.lastFiltered` cache. Normalize the
  in-flight `messages` to transforms.ts's `MessageLike` and cast ONCE at the return boundary (see the
  type-flow strategy in the Blueprint). Do NOT try to `import type { AgentMessage } from
  "@earendil-works/pi-coding-agent"` — it does not exist.
- **shouldNudge / injectNudge are LOCAL no-op stubs.** Do NOT import from a not-yet-existing
  `nudges.ts` (would break the build). Define them in filter.ts with a clear comment that P1.M6.T2.S2
  will replace them. They are EXPORTED so the test can assert the no-op and so P1.M6 can find them.
- **readMarkers is defensive + never throws.** A malformed marker entry (non-record data, wrong kind,
  unknown customType) is SKIPPED, not thrown — fail-open at the marker level too (spec/08 E13). The
  whole contextHandler body is ALSO wrapped in try/catch as defense-in-depth.
- **Read `ctx.sessionManager` FRESH inside the body** (C12). Do not hoist `const sm = ctx.sessionManager`
  to module scope; do not store it in the runtime map. Call `getSessionId()`/`getEntries()`/`getBranch()`
  inline.
- **There is NO lint/format tool** (devDeps = typescript + vitest + @types/node only). The type+style
  gate is `tsc --noEmit` (TS strict IS the gate). Do NOT invent eslint/prettier.

### Documentation & References

```yaml
# MUST READ — authoritative sources for the context handler
- file: spec/06-context-filter.md
  section: "§1 (the handler glue — read markers, call pipeline, cache, fail-open) + §7 (cache filtered
            view for audit) + §12 (filterPipeline pseudocode — reference-only; ctx param is impossible
            under transforms.ts Pi-free invariant, see Why)"
  why: "THE filter spec. §1 is the literal handler this task implements. §7 mandates rt.lastFiltered/
        lastFilterTs caching. §12 shows filterPipeline's composition (rewinds oldest-first, then shrinks,
        then nudge) — filterPipeline owns that; the handler just calls it."
  critical: "§1 pseudocode passes `ctx` to filterPipeline AND to log() — BOTH are wrong for our codebase:
             filterPipeline is Pi-free (takes branchEntries instead) and log() takes sessionId (not ctx).
             Follow the verified signatures, not the pseudocode verbatim."

- file: plan/001_2e5baf25fe9f/architecture/api_verification.md
  section: "§7.1 (ContextEvent/ContextEventResult/handler type) + §5 (CustomEntry shape — readMarkers
            scans type==='custom') + §4 (getEntries/getBranch/getSessionId signatures) + §9 (C4/C12) +
            §10 discrepancy #2 (getLeafId string|null)"
  why: "THE verified .d.ts source. §7.1: handler is (event, ctx) => ContextEventResult | void; messages
        optional → void = pass-through (C4). §5: markers found by type==='custom' &&
        customType.startsWith('mulligan:'); entry.data is the FULL marker (envelope stamped by markers.ts).
        §4: getEntries(): SessionEntry[] (all branches); getBranch(): SessionEntry[] (leaf→root);
        getSessionId(): string."
  critical: "ContextEvent.messages is AgentMessage[] but AgentMessage is NOT exported (§6) → use runtime.ts
             opaque alias. log() is NOT in api_verification (it's our log.ts) — see research note §4."

- file: spec/03-architecture.md
  section: "§2.4 (Fail open — every handler wrapped so an exception becomes a logged no-op) + §7 (filter.ts
            // context handler: read markers, call pipeline, cache, fail-open)"
  why: "§2.4 is THE fail-open mandate (design principle #4). §7 names filter.ts and its responsibility
        exactly. The whole handler body is ONE try/catch → log + return (pass-through)."

- file: spec/07-preventive-and-nudges.md
  section: "§2 (Nudge B — shouldNudge = grewOverThreshold || bloatHit; injectNudge appends an ephemeral
            mulligan:nudge CustomMessage; the filter reads the LATEST turn-metric)"
  why: "Defines the shouldNudge/injectNudge contract this task STUBS. shouldNudge(metric, config): boolean.
        injectNudge(messages, metric): messages. P1.M6.T2.S2 implements them; this task ships no-ops so the
        wiring compiles. The 'latest turn-metric' rule is also why readMarkers keeps only the highest-seq
        metric."
  critical: "The stubs return false / identity NOW. The handler's nudge gate
             (config.nudges.perTurnDrift && markers.metric && shouldNudge(...)) is written so it will light
             up automatically once P1.M6.T2.S2 replaces the stubs."

- file: spec/08-edge-cases.md
  section: "E13 (fail-open: handler never throws) + E8 (no-op when nothing to rewind)"
  why: "E13 is the explicit fail-open edge case. E8 justifies why a marker that resolves to nothing is a
        harmless no-op (filterPipeline returns messages unchanged; handler still caches + returns it)."

# THE MODULES filter.ts CONSUMES (read-only — treat as contracts)
- file: src/runtime.ts
  section: "getRuntime(sessionId): SessionRuntime; SessionRuntime.lastFiltered/lastFilterTs;
            AgentMessage (local opaque alias = Record<string, unknown>)"
  why: "filter.ts calls getRuntime(sessionId) and writes rt.lastFiltered/lastFilterTs. Reuse the opaque
        AgentMessage alias for the cache type (the real Pi AgentMessage is NOT exportable)."

- file: src/config.ts
  section: "getConfig(): MulliganConfig (defensive copy); MulliganConfig.enabled + .nudges.perTurnDrift"
  why: "The handler calls getConfig() each fire and short-circuits when !enabled. getConfig never throws
        (returns defaults on any error)."

- file: src/log.ts
  section: "log(level, event, sessionId, data?) — VERIFIED takes sessionId (NOT ctx); never throws"
  why: "The fail-open catch + optional observability log call log(). Pass sessionId (already read)."

- file: src/markers.ts
  section: "RewindMarker / ShrinkMarker / TurnMetric interfaces (type-only import — Pi-free interfaces)"
  why: "readMarkers casts entry.data to these types. markers.ts stamps the envelope {schema,v,kind,id/seq,ts}
        INTO entry.data, so entry.data IS a complete marker. Import the INTERFACES only (no runtime dep on
        markers.ts's Pi functions)."

- file: src/transforms.ts
  section: "MessageLike (exported structural type) + filterPipeline (P1.M3.T5.S1 — PREREQUISITE)"
  why: "filter.ts imports MessageLike (to type the in-flight messages) and filterPipeline (the pure
        transform). The handler reads branch fresh and passes branchEntries because filterPipeline is
        Pi-free and cannot take ctx."

- file: src/tokens.ts
  section: "estimateTokens(messages): {tokens, confidence} — never throws (optional observability use)"
  why: "OPTIONAL: a defensive log line reporting the before/after token delta (honors design principle #6,
        honest bookkeeping). NOT in the explicit LOGIC (a)–(h); wrapped in its own try/catch; safe to omit."

# PROOF PATTERNS
- file: spec/reference/looper-smoke.proto.ts
  section: "pi.on('context', async (event, ctx) => { ... ctx.sessionManager.getEntries(); ...
             return { messages: filtered }; })  (the B1 ephemeral-filter proof)"
  why: "PROVES the primitive this handler productionizes: event.messages is the deep-copied array;
        getEntries() returns custom entries; returning {messages} transforms; returning nothing passes
        through. The unit-test fakes mirror this with hand-rolled objects."

# DOWNSTREAM CONSUMERS
- file: plan/001_2e5baf25fe9f/P1M4T1S1/PRP.md + P1M4T1S2/PRP.md
  section: "markers.ts contract (the marker interfaces + append wrappers)"
  why: "Confirms markers.ts exports the interfaces filter.ts casts to, and stamps the envelope into
        entry.data. Confirms the never-throws discipline filter.ts must match."
- file: plan/001_2e5baf25fe9f/architecture/system_context.md
  section: "Module layout (filter.ts: context handler — read markers, call pipeline, cache, fail-open)"
  why: "Confirms filter.ts is THE Pi-Integration read/orchestrate module owning the context event."
```

### Current Codebase tree (state at this subtask's start — VERIFIED LIVE)

```bash
pi-mulligan/
├── package.json            # type:'module'; deps @earendil-works/pi-coding-agent *, typebox *; devDeps
│                           #   typescript ^5, vitest ^1, @types/node ^22; scripts.test:'vitest run'.
├── tsconfig.json           # strict, noImplicitAny, types:['node'], moduleResolution:'Bundler',
│                           #   include:['src','test'], target ES2022. exit 0 verified.
├── src/
│   ├── index.ts            # no-op stub (registerFilterHandler wired in P1.M7.T1). DO NOT TOUCH.
│   ├── config.ts           # getConfig, MulliganConfig. DO NOT TOUCH.
│   ├── log.ts              # log(level,event,sessionId,data?) — VERIFIED sessionId arg. DO NOT TOUCH.
│   ├── runtime.ts          # getRuntime, SessionRuntime, AgentMessage (opaque alias). DO NOT TOUCH.
│   ├── tokens.ts           # estimateTokens (optional observability). DO NOT TOUCH.
│   ├── ledger.ts / notes.ts            # pure helpers. DO NOT TOUCH.
│   ├── transforms.ts       # MessageLike + partitionIntoUnits + resolveLastToolCallGroup. filterPipeline
│   │                       #   added by P1.M3.T5.S1 (PREREQUISITE — grep before coding). DO NOT TOUCH.
│   └── markers.ts          # RewindMarker/ShrinkMarker/TurnMetric interfaces + append*/leaveNote/
│                           #   setCheckpoint wrappers (envelope stamped into entry.data). DO NOT TOUCH.
├── test/
│   └── (8 *.test.ts files, all green)   # Read-only. filter.test.ts is a NEW 9th file.
└── spec/                   # 03 §2.4/§7 + 06 §1/§7 + 07 §2 + 08 E13 + 10 (testing) + 11 §2 Step5.
# VERIFIED BASELINE: `npx tsc --noEmit -p tsconfig.json` → exit 0; `npx vitest run` → 8 files all-green.
# NOTE: NO eslint/prettier/biome configured. The type+style gate is `tsc --noEmit` (TS strict).
# NOTE: test imports use "../src/<name>.js" (.js resolves to .ts under Bundler) — established convention.
# NOTE: vitest vi.mock IS available (vitest ^1); the "hand-rolled, no vi.fn()" convention in markers.test.ts
#   is about Pi OBJECTS (clarity), not a ban on vi.mock for internal pure modules.
```

### Desired Codebase tree with files to be CREATED (THIS subtask — 2 new files only)

```bash
pi-mulligan/
├── src/
│   └── filter.ts           # NEW: MarkersBundle + readMarkers + contextHandler + registerFilterHandler +
│                           #   shouldNudge/injectNudge no-op stubs. Imports: ContextEvent/ContextEventResult/
│                           #   ExtensionAPI/ExtensionContext/SessionEntry (type) from pi package; filterPipeline
│                           #   + MessageLike (type) from transforms.js; getRuntime + AgentMessage(type) from
│                           #   runtime.js; getConfig + MulliganConfig(type) from config.js; log from log.js;
│                           #   estimateTokens from tokens.js (optional); RewindMarker/ShrinkMarker/TurnMetric
│                           #   (type) from markers.js. (Stub injectNudge is typed with MessageLike.)
└── test/
    └── filter.test.ts      # NEW: hand-rolled makeCtx (getSessionId/getEntries/getBranch) + makePi (captures
                            #   .on) + vi.mock("./transforms.js") controllable filterPipeline; describe blocks
                            #   for readMarkers / contextHandler / registerFilterHandler / stubs.
# No other files touched. No APPENDs to existing files.
```

### Known Gotchas of our codebase & Library Quirks

```bash
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #1 (CRITICAL, PREREQUISITE) — filter.ts imports `filterPipeline` from "./transforms.js" (P1.M3.T5.S1).
#   If P1.M3.T5.S1 is NOT yet implemented, `npx tsc --noEmit` FAILS on that import and this task cannot ship.
#   VERIFY FIRST: `grep -n "export function filterPipeline" src/transforms.ts`. If absent → STOP, sequence
#   after P1.M3.T5.S1. The vi.mock in the test fakes the RUNTIME export, but tsc still needs the real export
#   to resolve filter.ts's import. (Dependency order is correct: P1.M3 pure core precedes P1.M4 Pi glue.)
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #2 (CRITICAL) — `AgentMessage` is NOT exported from @earendil-works/pi-coding-agent (verified:
#   grep dist/index.d.ts → no match). You CANNOT name the element type of event.messages. REUSE runtime.ts's
#   opaque alias `import type { AgentMessage } from "./runtime.js"` (= Record<string, unknown>) for the
#   rt.lastFiltered cache. Normalize the in-flight messages to transforms.ts's MessageLike and cast ONCE at
#   the return boundary (see the type-flow strategy in the Blueprint). Do NOT write `import type { AgentMessage }
#   from "@earendil-works/pi-coding-agent"` — it will not resolve.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #3 (CRITICAL) — `log()` takes `sessionId: string`, NOT `ctx` (src/log.ts line 61, VERIFIED).
#   signature: log(level: "debug"|"info"|"warn"|"error", event: string, sessionId: string, data?: unknown).
#   The spec/06 §1 pseudocode `log("error","filter.fire",ctx,{...})` is WRONG for this codebase and will NOT
#   type-check (ctx is ExtensionContext, not string). The handler reads sessionId FIRST (right after the
#   try{) so both the catch log and any observability log have it. log() never throws (its own try/catch),
#   so wrapping it is belt-and-suspenders.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #4 (CRITICAL) — filterPipeline is Pi-FREE (transforms.ts "Imports NOTHING — not Pi"). It CANNOT take
#   `ctx: ExtensionContext`. The handler reads `ctx.sessionManager.getBranch()` FRESH (C12) and passes the
#   plain `SessionEntry[]` as the 4th arg. The spec/06 §12 pseudocode `filterPipeline(messages,markers,config,ctx)`
#   is reference-only and impossible under transforms.ts's invariant.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #5 (CRITICAL) — the ENTIRE contextHandler body is ONE try/catch (fail-open, spec/03 #4 / spec/08 E13).
#   On ANY throw (filterPipeline, readMarkers, getSessionId, getBranch), log + `return;` (void = pass-through,
#   C4). An extension bug must NEVER break an agent turn. readMarkers is ALSO defensive (skips malformed
#   entries) as defense-in-depth, but the outer try/catch is the hard guarantee.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #6 (CRITICAL) — read `ctx.sessionManager` FRESH inside the handler body (C12). Do NOT hoist a
#   `const sm = ctx.sessionManager` to module scope; do NOT store it in the runtime map (runtime.ts stores
#   ONLY primitives + message arrays). Call getSessionId()/getEntries()/getBranch() inline, each fire.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #7 — `config.enabled === false` returns `undefined` (pass-through) AND does NOT write rt.lastFiltered
#   (a disabled extension leaves the cache untouched — do not pollute the audit view with an unfiltered set).
#   Read config AFTER sessionId (so the catch can log) but BEFORE the expensive readMarkers/getBranch.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #8 — readMarkers reads from getEntries() (ALL branches' custom entries), NOT from event.messages.
#   Markers are `custom` entries (NOT in LLM context). event.messages is the deep-copied active branch (which
#   does NOT contain markers — it contains messages + notes/custom_messages). The type==='custom' filter
#   naturally excludes `custom_message` (notes, IN context) and `label` (checkpoints). The latest turn-metric
#   is the one with the HIGHEST `seq` (monotonic per-session counter stamped by markers.ts).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #9 — shouldNudge / injectNudge are LOCAL no-op stubs in filter.ts (do NOT import from nudges.ts —
#   that module does not exist yet and would break the build). shouldNudge → false; injectNudge → identity.
#   They are EXPORTED so the test asserts the no-op AND so P1.M6.T2.S2 can find/replace them. The handler's
#   nudge gate (config.nudges.perTurnDrift && markers.metric && shouldNudge(...)) is written now so it lights
#   up automatically once the stubs are replaced with the real imports.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #10 — `let messages: MessageLike[] = filterPipeline(...)`. The EXPLICIT `: MessageLike[]` annotation
#   normalizes the type whether filterPipeline is generic <M>(...):M[] or returns MessageLike[]: in both cases
#   the assignment type-checks (PiAgentMessage[] downcasts to MessageLike[]; or identity). This AVOIDS a
#   generic/non-generic branch in the handler. ONE cast remains — at the RETURN boundary (MessageLike[] →
#   Pi's AgentMessage[] via `as unknown as NonNullable<ContextEventResult["messages"]>`). rt.lastFiltered =
#   messages needs NO cast (MessageLike has [key:string]:unknown → assignable to Record<string,unknown>).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #11 — the test imports from "../src/filter.js" (.js extension; resolves to .ts under Bundler).
#   Established convention (every existing test). filter.test.ts is a NEW file; do not modify other tests.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #12 — there is NO lint/format tool (devDeps = typescript + vitest + @types/node only). The "Level 1
#   syntax & style" gate reduces to `tsc --noEmit` (TS strict IS the type+style gate). Do NOT invent
#   eslint/prettier/biome — "command not found".
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #13 — vitest vi.mock("./transforms.js", ...) is the idiomatic way to isolate the handler from the
#   pure filterPipeline for a UNIT test. The "hand-rolled, no vi.fn()" convention (markers.test.ts) is about
#   Pi OBJECTS (clarity); it does NOT forbid vi.mock for an internal pure module. The mock factory provides a
#   controllable fake filterPipeline (a plain function + a captured-calls array) so the test asserts the
#   handler delegates with the right args. (If you prefer, you MAY instead set up markers/messages that the
#   real filterPipeline transforms observably — but vi.mock is cleaner for isolating the glue.)
# ─────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

filter.ts defines ONE exported interface (the readMarkers return / filterPipeline param shape) and
reuses existing types everywhere else:

```ts
// The marker bundle readMarkers produces and filterPipeline consumes. TS structural typing makes this
// assignable to filterPipeline's `markers` param with ZERO shared-type coordination. EXPORTED so the
// test + audit + future callers share ONE shape.
export interface MarkersBundle {
  rewinds: RewindMarker[];
  shrinks: ShrinkMarker[];
  /** The LATEST turn-metric on the branch (highest seq), or null when none exists. */
  metric: TurnMetric | null;
}
```

`RewindMarker` / `ShrinkMarker` / `TurnMetric` are imported type-only from `./markers.js`.
`MessageLike` from `./transforms.js`; `AgentMessage` (opaque) + `SessionRuntime`/`getRuntime` from
`./runtime.js`; `MulliganConfig`/`getConfig` from `./config.js`; `log` from `./log.js`;
`ContextEvent`/`ContextEventResult`/`ExtensionAPI`/`ExtensionContext`/`SessionEntry` from the pi package.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY PREREQUISITE + BASELINE (no edits — run only)
  - RUN: grep -n "export function filterPipeline" src/transforms.ts   # MUST print a line. If empty → STOP
        # (P1.M3.T5.S1 not implemented; sequence this task after it).
  - RUN: npx tsc --noEmit -p tsconfig.json          # expect exit 0
  - RUN: npx vitest run                              # expect 8 files all-green (baseline).
  - RUN: grep -n "export function getRuntime\|export type AgentMessage" src/runtime.ts   # confirm deps exist.
  - RUN: grep -n "export function log" src/log.ts    # confirm log(level,event,sessionId,data?) signature.

Task 1: CREATE src/filter.ts   (exact content below — copy verbatim)
  - IMPLEMENT: module-private isRecord/readOwn (defensive; mirror transforms.ts/notes.ts convention),
    MarkersBundle interface, readMarkers(ctx), contextHandler(event,ctx), registerFilterHandler(pi),
    shouldNudge/injectNudge no-op stubs.
  - CONSTRAINTS:
      * contextHandler: ONE try/catch over the whole body. Steps: sessionId (fresh) → getConfig →
        (!enabled return) → getRuntime → readMarkers → getBranch (fresh) → filterPipeline → nudge gate
        (stub no-op) → rt.lastFiltered/lastFilterTs → return {messages} (cast). catch → log + return.
      * readMarkers: scan getEntries() (fresh), filter type==='custom' && customType.startsWith('mulligan:');
        bucket rewinds/shrinks; latest turn-metric by seq. Defensive isRecord on data; skip malformed;
        never throw.
      * log() called with sessionId (NOT ctx) — GOTCHA #3.
      * `let messages: MessageLike[] = filterPipeline(...)` — explicit annotation (GOTCHA #10).
      * Read ctx.sessionManager FRESH inside the body (C12 — GOTCHA #6).
      * shouldNudge → false; injectNudge → identity (local stubs — GOTCHA #9).
      * optional estimateTokens log line wrapped in its own try/catch (never breaks the turn).
  - NAMING/PLACEMENT: new file src/filter.ts. Exports: MarkersBundle, readMarkers, contextHandler,
    registerFilterHandler, shouldNudge, injectNudge.

Task 2: CREATE test/filter.test.ts   (exact content below — copy verbatim)
  - IMPLEMENT: vi.mock("./transforms.js") with a controllable fake filterPipeline; hand-rolled makeCtx
    (getSessionId/getEntries/getBranch) + makePi (captures .on); describe blocks for readMarkers,
    contextHandler (disabled pass-through; enabled transform+cache; fail-open on thrown pipeline /
    readMarkers / getSessionId; nudge-stub no-op; fresh-read), registerFilterHandler, and the stubs.
  - CONSTRAINTS: hand-rolled fakes for Pi objects (no vi.fn for ctx/pi). clearAll() before/afterEach
    (runtime map reset — mirror test/runtime.test.ts). Reuse the markers.ts envelope shapes to build
    realistic marker entries.
  - COVERAGE: every success-criteria bullet has an assertion.

Task 3: VALIDATE (no edits — run the gates in the Validation Loop)
  - Level 1 (tsc) and Level 2 (vitest). Level 3 N/A for the unit suite (Pi-coupled glue; the real
    end-to-end is the integration smoke harness P1.M7.T2). Level 4 = the fail-open + pass-through +
    fresh-read assertions.
```

### Type-flow strategy (READ — this is why the handler compiles in all cases)

```ts
import type { MessageLike } from "./transforms.js";
import type { AgentMessage } from "./runtime.js";          // opaque alias (Record<string, unknown>)
import type { ContextEvent, ContextEventResult } from "@earendil-works/pi-coding-agent";

// Inside contextHandler:
let messages: MessageLike[] = filterPipeline(event.messages, markers, config, branchEntries);
//   ^^^^^^^^^^^ explicit annotation normalizes the type:
//     • if filterPipeline returns MessageLike[]   → identity
//     • if filterPipeline is generic <M>(...):M[] → PiAgentMessage[] downcasts to MessageLike[] (OK)
//   event.messages (Pi's AgentMessage[]) → filterPipeline's MessageLike[] param: assignable (transforms.ts
//   documents "a real Pi AgentMessage[] assigns in with NO cast").
if (config.nudges.perTurnDrift && markers.metric && shouldNudge(markers.metric, config)) {
  messages = injectNudge(messages, markers.metric);   // stub: MessageLike[] -> MessageLike[]
}
rt.lastFiltered = messages;
//   ^^^ NO cast: MessageLike has [key:string]:unknown → assignable to Record<string,unknown> (runtime's AgentMessage).
return { messages: messages as unknown as NonNullable<ContextEventResult["messages"]> };
//     ^^^ ONE cast at the return boundary (MessageLike[] -> Pi's AgentMessage[]). Bulletproof: works whether
//         filterPipeline is generic or not.
```

#### Exact content to CREATE — `src/filter.ts` (Task 1 — copy verbatim)

```ts
/**
 * filter.ts — Mulligan's `context` event handler (the runtime entry point for ALL transforms).
 * spec/03-architecture.md §2.4 (fail open) + §7 (filter.ts // context handler), spec/06-context-filter.md
 *   §1 (the handler glue) + §7 (cache filtered view for audit), spec/07-preventive-and-nudges.md §2 (nudge
 *   stubs), spec/08-edge-cases.md E13 (handler never throws), api_verification.md §7.1 (ContextEvent/
 *   ContextEventResult/ExtensionHandler) + §5 (CustomEntry) + §4 (getEntries/getBranch/getSessionId),
 *   spec/02-proven-constraints.md C4 (void = pass-through) + C12 (read sessionManager fresh).
 *
 * DESIGN (read GOTCHA #1–#13 in the PRP):
 * - Pi Integration Layer (the read/orchestrate half; markers.ts is the write half). This module is the
 *   ONLY place that subscribes to the `context` event. It is THIN GLUE over the pure `filterPipeline`
 *   (transforms.ts): read markers fresh, read the branch fresh, delegate the transform, cache the result
 *   for mulligan_audit, fail-open. The actual transform math (rewind removal, shrink substitution, nudge
 *   injection) lives in transforms.ts — fully unit-tested without Pi.
 * - The `context` event fires BEFORE every LLM call (verified: api_verification §7.1). `event.messages` is
 *   a deep copy of the active branch, safe to mutate/replace. Returning `{ messages }` transforms what the
 *   model sees; returning nothing (void) passes the original through unchanged (C4). The session tree is
 *   NEVER mutated (soft-over-hard, D2) — only the in-flight copy is rewritten.
 * - NEVER throws (spec/03 #4, spec/08 E13). The ENTIRE handler body is ONE try/catch → log + return
 *   (pass-through). readMarkers is ALSO defensive (skips malformed marker entries) as defense-in-depth.
 *   An extension bug can NEVER break an agent turn.
 * - Reads `ctx.sessionManager` FRESH inside the body every fire (C12) — never caches the handle at module
 *   scope or in the runtime map.
 *
 * PREREQUISITE: statically imports `filterPipeline` from "./transforms.js" (P1.M3.T5.S1). If that export is
 *   absent, tsc fails — this task is sequenced after P1.M3.T5.S1.
 *
 * NOTE: P1.M6.T2.S2 will REPLACE the local shouldNudge/injectNudge stubs with real imports from nudges.ts.
 *   They are EXPORTED so the swap is a find/replace and the test can assert the current no-op behavior.
 */
import type {
  ContextEvent,
  ContextEventResult,
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { filterPipeline } from "./transforms.js";
import type { MessageLike } from "./transforms.js";
import { getRuntime } from "./runtime.js";
import type { AgentMessage } from "./runtime.js"; // local opaque alias (Pi's AgentMessage is NOT exported)
import { getConfig } from "./config.js";
import type { MulliganConfig } from "./config.js";
import { log } from "./log.js";
import { estimateTokens } from "./tokens.js";
import type { RewindMarker, ShrinkMarker, TurnMetric } from "./markers.js";

// ── module-private defensive helpers (mirror transforms.ts/notes.ts — never throw) ───

/** True for plain records (and Object.create(null)); false for null, primitives, and arrays. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read an own property without throwing (a Proxy get-trap may throw); undefined if absent/unreadable. */
function readOwn(obj: unknown, key: string): unknown {
  if (!isRecord(obj)) return undefined;
  try {
    return obj[key];
  } catch {
    return undefined;
  }
}

// ── MarkersBundle — readMarkers return + the structural contract for filterPipeline's `markers` param ──

/**
 * MarkersBundle — the markers read fresh from the session each context fire, bucketed for the pure
 * filterPipeline. `metric` is the LATEST turn-metric on the branch (highest seq) or null. EXPORTED so the
 * test + audit share ONE shape. TS structural typing makes this assignable to filterPipeline's `markers`
 * param with zero shared-type coordination (P1.M3.T5.S1 may import the marker interfaces type-only).
 */
export interface MarkersBundle {
  rewinds: RewindMarker[];
  shrinks: ShrinkMarker[];
  metric: TurnMetric | null;
}

/**
 * readMarkers — scan the session's custom entries FRESH and bucket the Mulligan markers (spec/06 §1;
 * api_verification §5). Markers are `custom` entries (NOT in LLM context); notes are `custom_message`
 * (IN context) and checkpoints are `label` — both are naturally excluded by the `type === "custom"`
 * filter. `data` IS the complete marker: markers.ts stamps the envelope {schema,v,kind,id/seq,ts} INTO
 * entry.data via appendEntry, so we cast it directly.
 *
 * The turn-metric is the LATEST one on the branch (spec/07 §2): among all `mulligan:turn-metric`
 * entries, keep the one with the highest `seq` (the monotonic per-session counter). Older metrics
 * persist on disk but are ignored. Defensive on a missing/non-number `seq` (treat as -Infinity).
 *
 * NEVER throws: malformed entries (non-record data, wrong kind, unknown customType) are SKIPPED, not
 * thrown — fail-open at the marker level (spec/08 E13). The whole readOwn/isRecord layer swallows
 * Proxy-trap throws too.
 *
 * @param ctx the Pi ExtensionContext (sessionManager.getEntries read FRESH — C12)
 * @returns { rewinds, shrinks, metric } — metric is the latest turn-metric or null
 */
export function readMarkers(ctx: ExtensionContext): MarkersBundle {
  const rewinds: RewindMarker[] = [];
  const shrinks: ShrinkMarker[] = [];
  let metric: TurnMetric | null = null;

  let entries: SessionEntry[];
  try {
    entries = ctx.sessionManager.getEntries(); // read FRESH (C12)
  } catch {
    return { rewinds, shrinks, metric }; // a throwing getEntries → empty bundle (fail-open)
  }

  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    if (readOwn(entry, "type") !== "custom") continue; // notes=custom_message, checkpoints=label → excluded
    const customType = readOwn(entry, "customType");
    if (typeof customType !== "string" || !customType.startsWith("mulligan:")) continue;

    const data = readOwn(entry, "data");
    if (!isRecord(data)) continue; // malformed marker → skip (fail-open)
    const kind = readOwn(data, "kind");

    if (customType === "mulligan:rewind" && kind === "rewind") {
      rewinds.push(data as unknown as RewindMarker);
    } else if (customType === "mulligan:shrink" && kind === "shrink") {
      shrinks.push(data as unknown as ShrinkMarker);
    } else if (customType === "mulligan:turn-metric" && kind === "turn-metric") {
      const candidate = data as unknown as TurnMetric;
      const cSeq = typeof candidate.seq === "number" ? candidate.seq : -Infinity;
      const mSeq = metric && typeof metric.seq === "number" ? metric.seq : -Infinity;
      if (metric === null || cSeq > mSeq) metric = candidate; // keep the LATEST (highest seq)
    }
    // else: future/unknown mulligan:* custom entry → skip defensively (forward-compat)
  }

  return { rewinds, shrinks, metric };
}

// ── Nudge stubs (P1.M6.T2.S2 replaces these with real imports from nudges.ts) ────────────────

/**
 * shouldNudge — STUB. The real rule (spec/07 §2): `metric.grewOverThreshold || metric.bloatHit`. Returns
 * false now so the v1 handler does not inject (nudges ship in P1.M6). P1.M6.T2.S2 will delete this stub
 * and `import { shouldNudge } from "./nudges.js"`. EXPORTED so the test asserts the no-op + the swap is
 * a find/replace. Signature matches the eventual real one.
 */
export function shouldNudge(_metric: TurnMetric, _config: MulliganConfig): boolean {
  return false; // no-op stub — wired in P1.M6.T2.S2
}

/**
 * injectNudge — STUB. The real impl (spec/07 §2) appends an ephemeral `mulligan:nudge` CustomMessage to
 * the copy (never persisted). Returns `messages` unchanged now. P1.M6.T2.S2 will replace this with the
 * real import. EXPORTED for the test + the swap. Typed with transforms.ts's MessageLike (the in-flight
 * copy type) so it composes with filterPipeline without Pi's AgentMessage.
 */
export function injectNudge(messages: MessageLike[], _metric: TurnMetric): MessageLike[] {
  return messages; // no-op stub — wired in P1.M6.T2.S2
}

// ── contextHandler — the heart of the extension (spec/03 §7, spec/06 §1) ─────────────────────

/**
 * contextHandler — the `context` event handler. Fires before EVERY LLM call; reads persisted markers
 * fresh, delegates the transform to the pure filterPipeline, conditionally injects the drift nudge,
 * caches the filtered view for mulligan_audit, and returns `{ messages }`. The ENTIRE body is wrapped in
 * try/catch — on ANY exception it logs and returns nothing (pass-through), so an extension bug can NEVER
 * break an agent turn (spec/03 #4 fail-open, spec/08 E13).
 *
 * EXPORTED (named) so the test suite can call it directly with hand-rolled fakes; registerFilterHandler
 * is the production registration seam.
 *
 * @param event { type:"context"; messages: AgentMessage[] } — a deep copy of the active branch, safe to
 *        mutate/replace (api_verification §7.1).
 * @param ctx  the Pi ExtensionContext (sessionManager read FRESH — C12).
 * @returns `{ messages }` to transform, or void/undefined to pass the original through (C4).
 */
export function contextHandler(event: ContextEvent, ctx: ExtensionContext): ContextEventResult | void {
  let sessionId = "unknown";
  try {
    sessionId = ctx.sessionManager.getSessionId(); // read FRESH (C12); first so the catch can log it

    const config = getConfig();
    if (!config.enabled) return; // master switch off → pass-through (do NOT pollute the audit cache)

    const rt = getRuntime(sessionId);
    const markers = readMarkers(ctx); // fresh markers each fire (C12)
    const branchEntries = ctx.sessionManager.getBranch(); // read FRESH (C12); passed to the Pi-free pipeline

    // Delegate the transform to the pure filterPipeline. Explicit `: MessageLike[]` normalizes the type
    // whether filterPipeline is generic <M> or returns MessageLike[] (GOTCHA #10).
    let messages: MessageLike[] = filterPipeline(event.messages, markers, config, branchEntries);

    // Per-turn drift nudge (spec/07 §2). shouldNudge/injectNudge are no-op stubs for now (P1.M6.T2 wires
    // them); the gate is written so it lights up automatically once the stubs are replaced.
    if (config.nudges.perTurnDrift && markers.metric && shouldNudge(markers.metric, config)) {
      messages = injectNudge(messages, markers.metric);
    }

    // Cache the filtered view for mulligan_audit (spec/06 §7). MessageLike[] is assignable to runtime's
    // opaque AgentMessage[] (Record<string,unknown>[]) — no cast needed (GOTCHA #10).
    rt.lastFiltered = messages as unknown as AgentMessage[];
    rt.lastFilterTs = Date.now();

    // Defensive observability: log the token reduction (honors design principle #6, honest bookkeeping).
    // estimateTokens NEVER throws; the whole line is belt-and-suspenders in its own try/catch so a logging
    // failure can never break the turn. Safe to omit — NOT in the explicit LOGIC (a)–(h).
    try {
      const after = estimateTokens(messages).tokens;
      const before = estimateTokens(event.messages as unknown as MessageLike[]).tokens;
      log("info", "filter.fire", sessionId, { before, after, rewinds: markers.rewinds.length,
        shrinks: markers.shrinks.length, hasMetric: markers.metric !== null });
    } catch {
      /* observability only — never break the turn */
    }

    // ONE cast at the return boundary: MessageLike[] -> Pi's AgentMessage[] (ContextEventResult.messages).
    return { messages: messages as unknown as NonNullable<ContextEventResult["messages"]> };
  } catch (e) {
    // FAIL-OPEN (spec/03 #4, spec/08 E13): log + return nothing (pass-through). Never break the turn.
    try {
      log("error", "filter.fire", sessionId, { error: e instanceof Error ? e.message : String(e) });
    } catch {
      /* log() never throws, but be safe */
    }
    return; // void → pass-through (C4)
  }
}

// ── registerFilterHandler — the production registration seam (consumed by index.ts, P1.M7.T1) ──

/**
 * registerFilterHandler — arm the `context` transform. Called once from the extension factory
 * (index.ts, P1.M7.T1.S1): `registerFilterHandler(pi)`. Delegates to `pi.on("context", contextHandler)`.
 *
 * @param pi the Pi ExtensionAPI (on() lives here).
 */
export function registerFilterHandler(pi: ExtensionAPI): void {
  pi.on("context", contextHandler);
}
```

#### Exact content to CREATE — `test/filter.test.ts` (Task 2 — copy verbatim)

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// vi.mock transforms.js BEFORE importing filter.js so filter.ts's `import { filterPipeline }` resolves to
// the fake. The factory returns a controllable fake + a captured-calls array (GOTCHA #13: vi.mock for an
// internal pure module is idiomatic; the "hand-rolled" convention is about Pi OBJECTS).
const pipelineCalls: {
  messages: unknown[];
  markers: unknown;
  config: unknown;
  branchEntries: unknown[];
}[] = [];
let pipelineReturn: unknown[] | ((...args: unknown[]) => unknown[]) = [];
vi.mock("../src/transforms.js", () => ({
  filterPipeline: (messages: unknown[], markers: unknown, config: unknown, branchEntries: unknown[]) => {
    pipelineCalls.push({ messages, markers, config, branchEntries });
    return typeof pipelineReturn === "function"
      ? pipelineReturn(messages, markers, config, branchEntries)
      : pipelineReturn;
  },
}));

import { setConfig } from "../src/config.js";
import {
  readMarkers,
  contextHandler,
  registerFilterHandler,
  shouldNudge,
  injectNudge,
  type MarkersBundle,
} from "../src/filter.js";
import { getRuntime, clearAll } from "../src/runtime.js";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

// runtime map reset between tests (mirror test/runtime.test.ts GOTCHA #7). Also reset the pipeline mock.
beforeEach(() => {
  clearAll();
  pipelineCalls.length = 0;
  pipelineReturn = [];
});
afterEach(() => {
  clearAll();
  pipelineCalls.length = 0;
  pipelineReturn = [];
});

// ── fakes (hand-rolled, no vi.fn for Pi objects — mirror markers.test.ts) ────────────────────

/** Build a rewind marker `data` payload matching markers.ts's envelope (kind 'rewind'). */
function rewindData(seq: number, id = `rw-${seq}`): Record<string, unknown> {
  return { schema: "pi-mulligan", v: 1, kind: "rewind", id, granularity: "last_tool_call_group",
    options: {}, seq, note: { problem: "p", hypothesis: "h", nextStep: "n", evidence: "e" }, ledger: {}, ts: 1 };
}
function shrinkData(seq: number, id = `sh-${seq}`): Record<string, unknown> {
  return { schema: "pi-mulligan", v: 1, kind: "shrink", id, target: { by_tool_call_id: "c1" },
    replacement: "<shrunk>", seq, ts: 1 };
}
function metricData(seq: number, grew = false, bloat = false): Record<string, unknown> {
  return { schema: "pi-mulligan", v: 1, kind: "turn-metric", seq, ts: 1, deltaTokens: grew ? 5000 : 100,
    bloatHit: bloat, bloatHits: [], grewOverThreshold: grew, turnIndex: seq };
}
/** A custom entry (marker). type 'custom' → NOT in context. */
function customEntry(customType: string, data: unknown): SessionEntry {
  return { type: "custom", id: `e-${customType}-${Math.random()}`, parentId: null,
    timestamp: new Date().toISOString(), customType, data } as unknown as SessionEntry;
}

/** Minimal fake ExtensionContext: scripts getSessionId + getEntries + getBranch (all read FRESH — C12). */
function makeCtx(opts: {
  sessionId?: string;
  entries?: SessionEntry[];
  branch?: SessionEntry[];
  throwOnGetEntries?: boolean;
  throwOnGetBranch?: boolean;
  throwOnGetSessionId?: boolean;
} = {}) {
  const sessionId = opts.sessionId ?? "s1";
  const sessionManager = {
    getSessionId() {
      if (opts.throwOnGetSessionId) throw new Error("getSessionId boom");
      return sessionId;
    },
    getEntries() {
      if (opts.throwOnGetEntries) throw new Error("getEntries boom");
      return opts.entries ?? [];
    },
    getBranch() {
      if (opts.throwOnGetBranch) throw new Error("getBranch boom");
      return opts.branch ?? [];
    },
  };
  return { sessionManager: sessionManager as unknown as ExtensionContext["sessionManager"] } as ExtensionContext;
}

/** Minimal fake ExtensionAPI capturing `.on` registrations. */
function makePi() {
  const handlers: Record<string, ((...a: unknown[]) => unknown) | undefined> = {};
  const pi = {
    on(event: string, handler: (...a: unknown[]) => unknown) {
      handlers[event] = handler;
    },
  };
  return { handlers, pi: pi as unknown as ExtensionAPI };
}

// ── readMarkers ─────────────────────────────────────────────────────────────────────────────

describe("readMarkers — fresh read, bucket, latest metric (spec/06 §1, api_verification §5)", () => {
  it("returns an empty bundle for an empty entry stream", () => {
    const bundle = readMarkers(makeCtx({ entries: [] }));
    expect(bundle.rewinds).toEqual([]);
    expect(bundle.shrinks).toEqual([]);
    expect(bundle.metric).toBeNull();
  });

  it("buckets mulligan:rewind and mulligan:shrink custom entries", () => {
    const entries = [customEntry("mulligan:rewind", rewindData(1)), customEntry("mulligan:shrink", shrinkData(2))];
    const bundle = readMarkers(makeCtx({ entries }));
    expect(bundle.rewinds).toHaveLength(1);
    expect(bundle.shrinks).toHaveLength(1);
    expect((bundle.rewinds[0] as { seq: number }).seq).toBe(1);
    expect((bundle.shrinks[0] as { seq: number }).seq).toBe(2);
  });

  it("keeps only the LATEST turn-metric (highest seq)", () => {
    const entries = [
      customEntry("mulligan:turn-metric", metricData(1)),
      customEntry("mulligan:turn-metric", metricData(3, true)),
      customEntry("mulligan:turn-metric", metricData(2)),
    ];
    const bundle = readMarkers(makeCtx({ entries }));
    expect(bundle.metric).not.toBeNull();
    expect((bundle.metric as { seq: number }).seq).toBe(3);
  });

  it("ignores custom_message (notes) and label (checkpoints) — type!=='custom'", () => {
    const entries = [
      { type: "custom_message", customType: "mulligan:note", content: "NOTE", display: true,
        details: {}, id: "n1", parentId: null, timestamp: "" } as unknown as SessionEntry,
      { type: "label", label: "mulligan:checkpoint:x", targetId: "t", id: "l1", parentId: null,
        timestamp: "" } as unknown as SessionEntry,
    ];
    const bundle = readMarkers(makeCtx({ entries }));
    expect(bundle.rewinds).toEqual([]);
    expect(bundle.shrinks).toEqual([]);
    expect(bundle.metric).toBeNull();
  });

  it("skips malformed/unknown mulligan:* entries without throwing", () => {
    const entries = [
      customEntry("mulligan:rewind", { kind: "shrink" }),        // wrong kind → skip
      customEntry("mulligan:future", { kind: "x" }),             // unknown customType → skip
      customEntry("mulligan:rewind", null),                       // non-record data → skip
      customEntry("mulligan:rewind", rewindData(5)),             // valid → kept
      { type: "other", customType: "mulligan:rewind", id: "x", parentId: null, timestamp: "" } as unknown as SessionEntry,
    ];
    expect(() => readMarkers(makeCtx({ entries }))).not.toThrow();
    const bundle = readMarkers(makeCtx({ entries }));
    expect(bundle.rewinds).toHaveLength(1);
    expect((bundle.rewinds[0] as { seq: number }).seq).toBe(5);
  });

  it("never throws when getEntries throws (fail-open → empty bundle)", () => {
    expect(() => readMarkers(makeCtx({ throwOnGetEntries: true }))).not.toThrow();
    const bundle = readMarkers(makeCtx({ throwOnGetEntries: true }));
    expect(bundle.rewinds).toEqual([]);
    expect(bundle.metric).toBeNull();
  });
});

// ── contextHandler ──────────────────────────────────────────────────────────────────────────

describe("contextHandler — disabled pass-through, transform+cache, fail-open (spec/06 §1, §03 #4)", () => {
  it("returns undefined (pass-through) and does NOT cache when config.enabled is false", () => {
    // getConfig reads the cached config; default is enabled:true. Force-disable via setConfig (top-level import).
    setConfig({ enabled: false });
    const ctx = makeCtx({ sessionId: "dis" });
    const event = { type: "context" as const, messages: [{ role: "user", content: "hi" }] };
    const result = contextHandler(event, ctx);
    expect(result).toBeUndefined(); // void = pass-through (C4)
    expect(getRuntime("dis").lastFiltered).toBeNull(); // cache untouched
    setConfig({ enabled: true }); // restore default
  });

  it("delegates to filterPipeline with (messages, markers, config, branchEntries) and returns {messages}", () => {
    const filtered = [{ role: "user", content: "FILTERED" }];
    pipelineReturn = filtered;
    const branch = [{ type: "message", id: "b1", parentId: null, timestamp: "" } as unknown as SessionEntry];
    const ctx = makeCtx({ sessionId: "s2", entries: [customEntry("mulligan:rewind", rewindData(1))], branch });
    const event = { type: "context" as const, messages: [{ role: "user", content: "orig" }] };

    const result = contextHandler(event, ctx) as { messages: unknown[] };

    expect(pipelineCalls).toHaveLength(1);
    expect(pipelineCalls[0].messages).toBe(event.messages);          // passes event.messages
    expect((pipelineCalls[0].markers as MarkersBundle).rewinds).toHaveLength(1); // readMarkers result
    expect(pipelineCalls[0].branchEntries).toBe(branch);            // passes getBranch() fresh
    expect(result.messages).toBe(filtered);                          // returns filterPipeline's result
  });

  it("caches the filtered view in rt.lastFiltered + sets lastFilterTs (spec/06 §7)", () => {
    pipelineReturn = [{ role: "user", content: "F" }];
    const ctx = makeCtx({ sessionId: "s3" });
    contextHandler({ type: "context", messages: [] }, ctx);
    const rt = getRuntime("s3");
    expect(rt.lastFiltered).toEqual([{ role: "user", content: "F" }]);
    expect(rt.lastFilterTs).not.toBeNull();
  });

  it("reads ctx.sessionManager FRESH each fire (no module-scope cache)", () => {
    pipelineReturn = [];
    // Mutable live arrays the fake reads on EACH call — proves the handler does not cache the handle.
    const live: { entries: SessionEntry[]; branch: SessionEntry[] } = { entries: [], branch: [] };
    const ctx = {
      sessionManager: {
        getSessionId: () => "s4",
        getEntries: () => live.entries,
        getBranch: () => live.branch,
      },
    } as unknown as ExtensionContext;

    // Fire 1: empty markers + empty branch.
    contextHandler({ type: "context", messages: [] }, ctx);
    expect(pipelineCalls[0].branchEntries).toEqual([]);
    expect((pipelineCalls[0].markers as MarkersBundle).rewinds).toHaveLength(0);

    // Fire 2: mutate the LIVE arrays — the handler must see the new data (fresh read).
    live.entries = [customEntry("mulligan:rewind", rewindData(9))];
    live.branch = [{ type: "message", id: "x", parentId: null, timestamp: "" } as unknown as SessionEntry];
    contextHandler({ type: "context", messages: [] }, ctx);
    expect((pipelineCalls[1].markers as MarkersBundle).rewinds).toHaveLength(1); // saw the NEW marker
    expect(pipelineCalls[1].branchEntries).toHaveLength(1);                      // saw the NEW branch
  });

  it("does NOT inject the nudge (stub no-op) even when perTurnDrift + a metric exist", () => {
    pipelineReturn = [{ role: "user", content: "P" }];
    const ctx = makeCtx({ sessionId: "s5", entries: [customEntry("mulligan:turn-metric", metricData(1, true))] });
    const result = contextHandler({ type: "context", messages: [] }, ctx) as { messages: unknown[] };
    // injectNudge stub returns messages unchanged → result equals filterPipeline's output exactly.
    expect(result.messages).toEqual([{ role: "user", content: "P" }]);
  });

  it("fail-open: a throwing filterPipeline is caught, logged, and returns undefined (pass-through)", () => {
    pipelineReturn = () => { throw new Error("pipeline boom"); };
    const ctx = makeCtx({ sessionId: "s6", entries: [customEntry("mulligan:rewind", rewindData(1))] });
    expect(() => contextHandler({ type: "context", messages: [] }, ctx)).not.toThrow();
    expect(contextHandler({ type: "context", messages: [] }, ctx)).toBeUndefined();
  });

  it("fail-open: a throwing getSessionId is caught and returns undefined", () => {
    pipelineReturn = [];
    const ctx = makeCtx({ sessionId: "s7", throwOnGetSessionId: true });
    expect(() => contextHandler({ type: "context", messages: [] }, ctx)).not.toThrow();
    expect(contextHandler({ type: "context", messages: [] }, ctx)).toBeUndefined();
  });
});

// ── registerFilterHandler ───────────────────────────────────────────────────────────────────

describe("registerFilterHandler — arms pi.on('context', contextHandler)", () => {
  it("calls pi.on('context', <function>) exactly once", () => {
    const { handlers, pi } = makePi();
    registerFilterHandler(pi);
    expect(typeof handlers["context"]).toBe("function");
  });

  it("the registered handler is contextHandler (delegates to filterPipeline)", () => {
    pipelineReturn = [{ role: "user", content: "Z" }];
    const { handlers, pi } = makePi();
    registerFilterHandler(pi);
    const ctx = makeCtx({ sessionId: "s8", entries: [customEntry("mulligan:rewind", rewindData(1))] });
    const result = (handlers["context"] as (e: unknown, c: unknown) => unknown)(
      { type: "context", messages: [] }, ctx,
    ) as { messages: unknown[] };
    expect(result.messages).toEqual([{ role: "user", content: "Z" }]);
    expect(pipelineCalls).toHaveLength(1);
  });
});

// ── nudge stubs ─────────────────────────────────────────────────────────────────────────────

describe("shouldNudge / injectNudge — no-op stubs (wired in P1.M6.T2.S2)", () => {
  it("shouldNudge always returns false", () => {
    expect(shouldNudge({} as never, {} as never)).toBe(false);
  });
  it("injectNudge returns the messages array unchanged", () => {
    const msgs = [{ role: "user", content: "x" }];
    expect(injectNudge(msgs, {} as never)).toBe(msgs);
  });
});
```

> **Test note:** the "disabled" test imports `setConfig` from `../src/config.js` at the top of the file
> (a static import — cleaner than a dynamic `await import` inside the `it` callback). `setConfig({ enabled:
> false })` forces the disabled path; it is restored to the default (`enabled: true`) at the end of the test.

### Implementation Patterns & Key Details

```ts
// PATTERN: the fail-open handler shell (spec/03 #4, spec/08 E13). ONE try/catch over the whole body.
export function contextHandler(event: ContextEvent, ctx: ExtensionContext): ContextEventResult | void {
  let sessionId = "unknown";
  try {
    sessionId = ctx.sessionManager.getSessionId(); // read FIRST so the catch can log it (C12: fresh)
    const config = getConfig();
    if (!config.enabled) return;                   // C4: void = pass-through; do NOT cache
    const rt = getRuntime(sessionId);
    const markers = readMarkers(ctx);              // fresh markers (C12)
    const branchEntries = ctx.sessionManager.getBranch(); // fresh branch (C12); Pi-free pipeline needs it
    let messages: MessageLike[] = filterPipeline(event.messages, markers, config, branchEntries);
    if (config.nudges.perTurnDrift && markers.metric && shouldNudge(markers.metric, config)) {
      messages = injectNudge(messages, markers.metric); // stub no-op now
    }
    rt.lastFiltered = messages as unknown as AgentMessage[]; // cache for audit (spec/06 §7)
    rt.lastFilterTs = Date.now();
    return { messages: messages as unknown as NonNullable<ContextEventResult["messages"]> };
  } catch (e) {
    log("error", "filter.fire", sessionId, { error: e instanceof Error ? e.message : String(e) }); // sessionId, NOT ctx
    return;                                        // fail-open: pass-through
  }
}

// PATTERN: readMarkers — defensive bucket scan (never throws; malformed entries skipped).
//   Markers are 'custom' entries; notes='custom_message' and checkpoints='label' are excluded by the type
//   filter. entry.data IS the complete marker (markers.ts stamps the envelope into it). Latest metric = highest seq.
```

### Integration Points

```yaml
EVENT REGISTRATION (index.ts, P1.M7.T1.S1):
  - add to: src/index.ts (the extension factory)
  - pattern: "import { registerFilterHandler } from './filter.js'; ... registerFilterHandler(pi);"
  - WHEN: once at factory startup (the handler then fires before every LLM call).

PURE PIPELINE (transforms.ts, P1.M3.T5.S1 — PREREQUISITE):
  - consumes: filterPipeline(messages, markers, config, branchEntries): MessageLike[]
  - contract: filter.ts reads branch FRESH and passes the plain SessionEntry[] (filterPipeline is Pi-free).
  - markers param: structurally compatible with MarkersBundle (no shared-type coordination needed).

RUNTIME CACHE (runtime.ts — already shipped):
  - writes: rt.lastFiltered (opaque AgentMessage[]), rt.lastFilterTs (number)
  - read by: mulligan_audit (P1.M5.T4.S1) for the filtered view.

NUDGES (nudges.ts, P1.M6.T2.S2 — FUTURE):
  - replaces: the local shouldNudge/injectNudge stubs with `import { shouldNudge, injectNudge } from "./nudges.js"`
  - no handler change: the gate (config.nudges.perTurnDrift && markers.metric && shouldNudge(...)) already
    exists; swapping the stubs lights it up.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Run after creating src/filter.ts — fix before proceeding.
npx tsc --noEmit -p tsconfig.json
# Project-wide type gate (TS strict IS the type+style gate — NO eslint/prettier configured).
# Expected: exit 0. If errors exist, READ the output. Common: filterPipeline import unresolved
#   (P1.M3.T5.S1 not done → STOP), AgentMessage import from pi package (doesn't exist → use runtime.js),
#   log() called with ctx instead of sessionId.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Test the new component.
npx vitest run test/filter.test.ts -v
# Full suite for regression (filter.ts adds 2 new files; it touches nothing else).
npx vitest run
# Expected: all pass. If failing, debug root cause. The fail-open + pass-through + fresh-read tests are
#   the highest-signal (they prove the handler can never break a turn).
```

### Level 3: Integration Testing (deferred to P1.M7.T2)

```bash
# Unit tests use hand-rolled fakes (no real Pi). The REAL end-to-end — markers persisted by a tool →
# context handler rewrites event.messages → model sees the reduced set — is the integration smoke harness
# (P1.M7.T2, scenarios F-rewind-core / F-shrink / F-nudge). This task's unit tests prove the GLUE
# (read markers, call pipeline, cache, fail-open) in isolation; the pipeline's correctness is proven by
# transforms.ts tests (P1.M3). Do NOT spin up a real `pi -e` for these unit tests.
```

### Level 4: Creative & Domain-Specific Validation (fail-open guarantees)

```bash
# The domain-specific "validation" for this task is the fail-open + zero-extra-requests invariants,
#   asserted by the unit tests above:
#   • contextHandler never throws (thrown pipeline/readMarkers/getSessionId → undefined pass-through).
#   • config.enabled===false → pass-through (no cache pollution).
#   • readMarkers never throws (malformed/throwing getEntries → empty bundle).
#   • ctx.sessionManager read fresh each fire (two fires see different data).
#   • registerFilterHandler arms pi.on('context', contextHandler) exactly once.
# (No perf/security/load gates apply to this pure-glue handler.)
```

## Final Validation Checklist

### Technical Validation

- [ ] Level 1 passed: `npx tsc --noEmit -p tsconfig.json` → exit 0.
- [ ] Level 2 passed: `npx vitest run test/filter.test.ts -v` → all green; `npx vitest run` → no regression.
- [ ] filterPipeline import resolves (P1.M3.T5.S1 implemented — GOTCHA #1 prerequisite cleared).

### Feature Validation

- [ ] All success criteria from "What" section met.
- [ ] `contextHandler` returns `{ messages }` when enabled; `undefined` when disabled or on error.
- [ ] `rt.lastFiltered` / `rt.lastFilterTs` written on every enabled fire; untouched when disabled/error.
- [ ] `readMarkers` buckets rewinds/shrinks, keeps the latest turn-metric, ignores notes/checkpoints.
- [ ] `registerFilterHandler` arms `pi.on("context", contextHandler)`.
- [ ] shouldNudge/injectNudge are no-op stubs.

### Code Quality Validation

- [ ] Follows existing codebase patterns (markers.ts hand-rolled-fake test style; transforms.ts
      isRecord/readOwn defensive style; runtime.ts opaque-AgentMessage-alias convention).
- [ ] File placement matches the desired tree (2 new files; no existing file touched).
- [ ] Anti-patterns avoided (see below).
- [ ] Dependencies properly managed (type-only marker imports; Pi-free filterPipeline via branchEntries).

### Documentation & Deployment

- [ ] Code is self-documenting (JSDoc on readMarkers/contextHandler/registerFilterHandler/stubs; header-doc
      referencing the spec sections).
- [ ] Fail-open + fresh-read + nudge-stub intent documented in comments (P1.M6 swap seam called out).
- [ ] No new environment variables (config is via getConfig, already shipped).

---

## Anti-Patterns to Avoid

- ❌ Don't copy the spec/06 §1 pseudocode verbatim — it passes `ctx` to `filterPipeline` (impossible:
  transforms.ts is Pi-free) AND to `log()` (wrong: log takes sessionId). Follow the verified signatures.
- ❌ Don't try to `import type { AgentMessage } from "@earendil-works/pi-coding-agent"` — it is NOT exported.
  Reuse runtime.ts's opaque alias.
- ❌ Don't cache `ctx.sessionManager` at module scope or in the runtime map (C12). Read it fresh each fire.
- ❌ Don't skip the outer try/catch "because readMarkers is defensive" — the outer try/catch is the hard
  fail-open guarantee (spec/03 #4); readMarkers defensive is defense-in-depth, not a replacement.
- ❌ Don't write `rt.lastFiltered` when `config.enabled === false` (pollutes the audit cache).
- ❌ Don't import shouldNudge/injectNudge from a not-yet-existing nudges.ts (build break). Local stubs now.
- ❌ Don't mutate `event.messages` in place — return a NEW array reference (`filterPipeline` already returns
  a new array; the handler just passes it through). The originals are never mutated (soft-over-hard, D2).
- ❌ Don't catch all exceptions silently without logging — log("error", "filter.fire", sessionId, …) so the
  failure is observable (the JSONL log is the primary observability surface in non-TUI modes).