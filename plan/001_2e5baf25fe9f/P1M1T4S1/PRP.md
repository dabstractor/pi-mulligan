# PRP — P1.M1.T4.S1: Per-session runtime state map (`src/runtime.ts` + `test/runtime.test.ts`)

**Work item:** P1.M1.T4.S1 · **Points:** 1 · **Stage:** Foundation & Infrastructure → Per-Session Runtime State Map
**Scope:** **CREATE** two new files only — `src/runtime.ts` (the runtime store) and `test/runtime.test.ts`
(its unit suite).
**Do NOT modify** `src/index.ts`, `src/config.ts`, `src/log.ts`, or anything else (see *Scope decision* below).

---

## Goal

**Feature Goal**: Ship Mulligan's per-session **in-memory (non-persisted) control-state store** as a
**self-contained, dependency-free, Pi-free** module (`src/runtime.ts`) — a module-scoped `Map<string,
SessionRuntime>` keyed by `sessionId`, exposing `getRuntime` (lazy-create, returns a live mutable reference),
`nextSeq` (monotonic pre-increment marker counter), `resetRuntime` (session_start re-init), and `clearAll`
(shutdown teardown). It is the shared mutable state backing every Pi-coupled module that comes later
(`markers.ts`, `filter.ts`, `nudges.ts`, `tools/audit.ts`).

**Deliverable** (two new files):
1. `src/runtime.ts` exporting:
   - `interface SessionRuntime` — the **7-field** shape (see *Why 7 fields* below).
   - `interface BloatHit { toolName: string; approxTokens: number }` — reusable (mirrors `TurnMetric.bloatHits[*]`).
   - `type AgentMessage = Record<string, unknown>` — a **local opaque alias** (see *The AgentMessage decision*).
   - `function getRuntime(sessionId: string): SessionRuntime` — existing-or-fresh, returns a live mutable ref.
   - `function nextSeq(sessionId: string): number` — pre-increment; first call returns **1**.
   - `function resetRuntime(sessionId: string): void` — deletes the entry (no-op if absent; never throws).
   - `function clearAll(): void` — wipes the map (never throws).
2. `test/runtime.test.ts` — a vitest suite asserting fresh defaults, idempotent same-ref, **per-session
   isolation**, `nextSeq` monotonicity, `resetRuntime`/`clearAll` semantics, the **in-place mutation contract**
   (filter/turn_end/nudges-style writes persist), and the exported types.

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0** (the new module + test are type-sound under `strict`).
- `npx vitest run` is **all-green** — the new `runtime` suite **and** the pre-existing `config` suite (and
  `log` once P1.M1.T3.S1 lands — this is a pure, import-free module; it cannot regress either).
- `src/runtime.ts` has **zero imports** — no Pi, no config, no log (`grep -cE '^import|^from' src/runtime.ts`
  → **0**). It is foundation-tier and fully unit-testable in isolation.
- Per-session isolation holds: incrementing/`reset`ting/mutating session A never affects session B.

---

## User Persona

**Target User**: The implementing AI agents for **every downstream Pi-coupled module**:
- `markers.ts` (P1.M4.T1.S1): calls `nextSeq(sessionId)` to stamp each rewind/shrink/turn-metric marker with a
  monotonic `seq` (spec/04 §3).
- `filter.ts` (P1.M4.T2.S1): writes `rt.lastFiltered` / `rt.lastFilterTs` each `context.fire`, so
  `tools/audit.ts` can report the *filtered* view without re-running the pipeline (spec/06 §7).
- `nudges.ts` (P1.M6.T1.S1): pushes bloated tool results into `rt.pendingBloatHits` across a turn, snapshotted
  into the `TurnMetric` at `turn_end` and cleared (spec/04 §5, spec/07).
- `tools/audit.ts` (P1.M5.T4.S1): reads `rt.lastFiltered` (honoring D5 — never `getContextUsage()`).
- `index.ts` (P1.M7.T1): calls `resetRuntime(sessionId)` on `session_start` and `clearAll()` on shutdown/reload.

**Use Case**: At runtime, a handler does `const rt = getRuntime(ctx.sessionManager.getSessionId());` once, then
mutates fields in place (`rt.tokenBaseline = n; rt.lastFiltered = transformed; rt.pendingBloatHits.push(hit)`).
The same `sessionId` always resolves to the same live object for the life of the session; `session_start`
resets it cleanly.

**User Journey**:
1. Pi loads the extension; `index.ts` (P1.M7.T1) registers `pi.on("session_start", (e, ctx) =>
   resetRuntime(ctx.sessionManager.getSessionId()))`.
2. Any handler calls `getRuntime(sessionId)` → the runtime is created lazily on first access (fresh defaults),
   or returned live thereafter.
3. Markers call `nextSeq(sessionId)` → get 1, 2, 3, … stamped into persisted markers.
4. On a session re-open/resume, `session_start` fires again → `resetRuntime` drops the stale runtime → the next
   `getRuntime` builds a clean one (seq 0, null baseline, empty bloat hits). Stale references are abandoned
   (C12 discipline).

**Pain Points Addressed**: Without a per-session runtime map, every consumer would re-derive `seq`, the token
baseline, and the filtered-view cache ad hoc — and would be tempted to cache a `sessionManager` handle across
turns, which goes stale after session replacement (C12). The map centralizes this state keyed by a **primitive**
sessionId string, never a handle.

---

## Why

- **Unblocks every Pi-coupled module.** `seq`, `tokenBaseline`, `lastFiltered`, and `pendingBloatHits` are read
  or written by 5 later subtasks. Shipping the store now (foundation tier, alongside `config.ts` + `log.ts`
  per spec/11 §2 Step 1) lets those tasks focus on their own logic.
- **Makes C12-compliance a structural guarantee.** spec/02 §C12: captured `sessionManager` handles go stale
  after session replacement; "the audit and filter code must always read fresh … never cache a session handle
  across turns." By keying the map on the **primitive** `sessionId` string and storing only primitive values +
  message arrays, runtime.ts is C12-clean by construction — there is no handle to go stale.
- **Foundation-tier & Pi-free (like config.ts / log.ts).** runtime.ts imports **nothing**. This keeps it a
  pure, fast, isolated unit-test target and honors the work-item contract ("No prior code dependencies beyond
  P1.M1.T1.S1"). It also sidesteps a real resolution hazard (see *The AgentMessage decision*).
- **7 fields, not spec/04 §8's 4.** The work-item contract **expands** spec/04 §8's minimal
  `{sessionId, seq, tokenBaseline, lastTurnIndex}` with `lastFiltered` / `lastFilterTs` (spec/06 §7, the audit
  cache) and `pendingBloatHits` (mirrors `TurnMetric.bloatHits[*]`, spec/04 §5). Implementing the full shape
  now means the consumers don't have to extend the interface later.

---

## What

Create `src/runtime.ts` (exact content in *Implementation Blueprint → Task 1*) and `test/runtime.test.ts`
(exact content in *Task 2*). The module:

- Holds module-level `const runtimes = new Map<string, SessionRuntime>();` (the singleton store).
- `freshRuntime(sessionId)` is a **private** factory that returns a brand-new object literal with a **new**
  `pendingBloatHits: []` each call (never a shared module-level array).
- `getRuntime(sessionId)`: `get` → if absent, `freshRuntime` + `set` → return the **live reference**.
- `nextSeq(sessionId)`: `return ++getRuntime(sessionId).seq;` (pre-increment → first call is 1).
- `resetRuntime(sessionId)`: `runtimes.delete(sessionId);` (no-op if absent; never throws).
- `clearAll()`: `runtimes.clear();` (never throws).
- Exports `SessionRuntime`, `BloatHit`, `AgentMessage` (type/interface) + the 4 functions.

This subtask does **NOT**: touch `index.ts` (the `session_start`→`resetRuntime` and `shutdown`→`clearAll`
wiring is **P1.M7.T1**), touch `config.ts`/`log.ts`, build `markers.ts`/`filter.ts`/`nudges.ts`/`tools/*`
(later), or persist anything (this state is in-memory only — markers/notes/labels are persisted by other
modules via `pi.*`).

### Success Criteria

- [ ] `src/runtime.ts` is **created** and exports exactly `SessionRuntime`, `BloatHit`, `AgentMessage`,
      `getRuntime`, `nextSeq`, `resetRuntime`, `clearAll`.
- [ ] `test/runtime.test.ts` is **created** and is all-green.
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0 (with the new files).
- [ ] `npx vitest run` is all-green (new `runtime` suite **and** pre-existing suites).
- [ ] `src/runtime.ts` has **zero imports** (`grep -cE '^import|^from' src/runtime.ts` → 0).
- [ ] `getRuntime(id) === getRuntime(id)` (same live reference) until `resetRuntime`/`clearAll`.
- [ ] `nextSeq` returns 1, 2, 3, … for one session; is **independent** across sessions (A's increments never
      affect B's counter).
- [ ] `resetRuntime(id)` makes the next `getRuntime(id)` a **fresh** object (seq 0, all nulls, empty
      `pendingBloatHits`) that is `!==` the pre-reset reference; a no-op for an absent session.
- [ ] `clearAll()` wipes every session; a no-op when empty.
- [ ] Each fresh runtime gets its **own** `pendingBloatHits` array (no cross-session sharing).
- [ ] In-place mutation persists: writes to `tokenBaseline`/`lastTurnIndex`/`lastFiltered`/`lastFilterTs` and
      pushes to `pendingBloatHits` are visible on the next `getRuntime`.

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this
> successfully?"_ — **Yes.** The exact `src/runtime.ts` and `test/runtime.test.ts` content is given verbatim
> below (Task 1 / Task 2). The authoritative `SessionRuntime` shape is reconciled from spec/04 §8 + spec/06 §7
> + the work-item contract (the **contract's 7-field shape wins** — flagged). The required public API is
> verbatim from the work-item contract. The test convention (vitest, `../src/runtime.js` import, `describe`/
> `it`/`beforeEach`/`expectTypeOf`) is reproduced from the live `test/config.test.ts`. The single non-obvious
> decision — *why a local `AgentMessage` alias instead of importing the Pi type* — is documented with verified
> evidence (the real type is unresolvable from this repo). No prior knowledge beyond "the S1 scaffold +
> `src/config.ts` exist and pass `tsc`/`vitest`" is required.

### Scope decision (READ BEFORE CODING)

- **Do NOT modify `src/index.ts`.** It is the S2-era no-op stub. The `pi.on("session_start", …)` →
  `resetRuntime(id)` and the `session_shutdown` → `clearAll()` wiring is **P1.M7.T1**. runtime.ts only
  *provides* the functions.
- **Do NOT import `log.ts` (in-flight, P1.M1.T3.S1) or `config.ts`** into runtime.ts. The work-item contract
  says "No prior code dependencies beyond P1.M1.T1.S1"; runtime.ts imports **nothing**. Any runtime-event
  logging is the caller's job (handlers call `logInfo(...)` themselves).
- **Do NOT "correct" the SessionRuntime shape down to spec/04 §8's 4 fields.** The work-item contract
  **expands** it to 7 (adds `lastFiltered`, `lastFilterTs`, `pendingBloatHits`). The contract is authoritative
  here; spec/04 §8 is the minimal subset. (See *Why 7 fields*.)

### The AgentMessage decision (the one non-obvious call — read this)

The work-item contract writes `lastFiltered: AgentMessage[] | null`. The real Pi `AgentMessage` union lives in
`@earendil-works/pi-agent-core`. **It is NOT importable from this repo** — verified live:
- It is **not re-exported** by `@earendil-works/pi-coding-agent` (the only declared Pi dependency;
  `grep AgentMessage …/dist/index.d.ts` → absent).
- `@earendil-works/pi-agent-core` is **not hoisted** into `node_modules` (transitive dep only), and
  `import type { AgentMessage } from "@earendil-works/pi-agent-core"` → **`TS2307: Cannot find module`** under
  the real project tsconfig.

**Therefore** runtime.ts defines a **local exported opaque alias** `export type AgentMessage = Record<string,
unknown>;` and uses it to type `lastFiltered`. This is correct and sufficient because:
- runtime.ts only **stores and returns** message arrays — it **never introspects** them. An opaque element
  type is honest.
- It keeps runtime.ts foundation-tier & Pi-free (like `config.ts`/`log.ts`), fully unit-testable, with zero
  imports.
- C12 is honored: only primitive values + message arrays are stored; no Pi handle.
- **Write side** (filter.ts, P1.M4.T2.S1): a real `PiAgentMessage[]` is assignable INTO
  `Record<string, unknown>[]` (object types → index signature; array covariance) — **no cast needed**.
- **Read side** (audit.ts, P1.M5.T4.S1): reading back as the real `PiAgentMessage[]` narrows a supertype → an
  explicit cast there (the objects ARE real messages; the type is just opaque *here*). Documented for that task.

This mirrors the log.ts PRP's philosophy: be faithful to the contract's field name while keeping the
foundation module dependency-free.

### Why 7 fields (contract expands spec/04 §8)

| Field | spec/04 §8 | spec/06 §7 | contract | written by |
|---|---|---|---|---|
| `sessionId: string` | ✅ | | ✅ | creation |
| `seq: number` | ✅ | | ✅ | `nextSeq` (markers.ts) |
| `tokenBaseline: number \| null` | ✅ | | ✅ | turn_end (nudges.ts) |
| `lastTurnIndex: number \| null` | ✅ | | ✅ | turn_end (nudges.ts) |
| `lastFiltered: AgentMessage[] \| null` | — | ✅ | ✅ | filter.ts each fire |
| `lastFilterTs: number \| null` | — | ✅ | ✅ | filter.ts each fire |
| `pendingBloatHits: BloatHit[]` | — | — | ✅ | tool_result (nudges.ts) |

Implement the **7-field** shape. `BloatHit = { toolName: string; approxTokens: number }` mirrors
`TurnMetric.bloatHits[*]` (spec/04 §5) — export it so nudges.ts/markers.ts reuse it.

### Documentation & References

```yaml
# MUST READ — authoritative sources for this module
- file: spec/04-data-model.md
  section: "§8 In-memory (non-persisted) state"
  why: "THE source of the core SessionRuntime shape { sessionId, seq, tokenBaseline, lastTurnIndex }. Held in
        a Map<string, SessionRuntime> keyed by ctx.sessionManager.getSessionId(); reset/created on
        session_start; NEVER cache a sessionManager handle (C12) — only primitive values."
  critical: "§8 is the MINIMAL 4-field subset. The work-item contract EXPANDS it to 7 fields (adds
        lastFiltered/lastFilterTs from spec/06 §7 + pendingBloatHits). The contract wins — do not trim."

- file: spec/06-context-filter.md
  section: "§7 Caching the filtered view for mulligan_audit"
  why: "Defines lastFiltered: AgentMessage[] | null (written by the filter each fire) and lastFilterTs.
        mulligan_audit reads rt.lastFiltered; if null, it falls back to building from buildContextEntries().
        Never use ctx.getContextUsage() for the total (D5)."
  critical: "runtime.ts only STORES lastFiltered opaquely; it never computes or inspects it. The local
        AgentMessage alias (Record<string, unknown>) is assignable-in from real event.messages with no cast."

- file: spec/04-data-model.md
  section: "§3 Marker: rewind (seq field) and §5 Turn metric (bloatHits)"
  why: "§3: seq is a 'monotonic per-session counter, persisted INTO each marker' — that is nextSeq()'s job
        (pre-increment → 1-based). §5: TurnMetric.bloatHits is {toolName, approxTokens}[] — that is the
        BloatHit shape reused by pendingBloatHits."

- file: spec/02-proven-constraints.md
  section: "§C12 The session rebinds after certain operations — captured references go stale"
  why: "'Mulligan does not trigger any rebind operation … but the audit and filter code must always read fresh
        from ctx.sessionManager.getEntries() inside the handler on each invocation — never cache a session
        handle across turns.' The runtime map keys on a PRIMITIVE sessionId string and stores only primitive
        values + arrays — there is no handle to go stale. resetRuntime deletes the entry so stale references
        are abandoned (the C12-safe pattern)."

- file: spec/11-build-order.md
  section: "§1 Repository layout → 'runtime.ts // per-session runtime map (seq, baseline, lastFiltered)' and
            §2 Step 1 (config.ts + log.ts + runtime.ts grouped as foundation)"
  why: "Confirms runtime.ts is a standalone foundation file in src/, co-tier with config.ts/log.ts, and is
        'created on session_start'. Step 1 verify: 'Implement runtime(ctx) returning the per-session
        SessionRuntime' — this task ships that store (the ctx→sessionId extraction happens in index.ts)."

- file: src/config.ts          # READ-ONLY sibling — the Pi-free foundation-tier pattern to mirror
  why: "Establishes the foundation-module style this repo expects: Pi-free, module-level mutable state
        (cachedConfig) reset in tests via beforeEach, exported interface + helpers, defensive copies / no
        shared mutable singletons across instances. runtime.ts mirrors this discipline (its Map is reset via
        clearAll() in beforeEach)."
  pattern: "Mirror the JSDoc-on-every-export, module-level-state-with-test-reset discipline."

- file: test/config.test.ts     # the test convention to mirror
  why: "Establishes: vitest; import from '../src/<file>.js' (note .js for ESM+Bundler); top-level
        describe/it; beforeEach to reset module state; expectTypeOf for type-level assertions."
  pattern: "Mirror its import style and describe/it structure for test/runtime.test.ts."

- file: plan/001_2e5baf25fe9f/P1M1T3S1/PRP.md   # the parallel log.ts PRP — read-only contract
  why: "Defines log.ts (logInfo/…). runtime.ts must NOT import it (zero-imports gate). Any logging of runtime
        events is the caller's job. Treat as the sibling foundation module being built in parallel."

- file: plan/001_2e5baf25fe9f/P1M1T4S1/research/codebase_recon.md
  why: "First-hand recon: baseline tsc/vitest state, the THREE SessionRuntime sources reconciled (contract's
        7 fields wins), the verified finding that AgentMessage is NOT importable (→ local alias), C12 analysis,
        exact API surface, cross-task boundaries."
- file: plan/001_2e5baf25fe9f/P1M1T4S1/research/external_best_practices.md
  why: "Verified language facts: ES-module singleton Map; Map SameValueZero key isolation; getRuntime returns a
        live ref (not a copy); pre-increment → 1-based seq; delete (not reset-in-place) aligns with C12;
        Record<string,unknown> assignability; vitest module-state reset; ../src/X.js ESM import."

# AUTHORITATIVE SessionRuntime (contract, 7 fields — implement EXACTLY this; the BloatHit element mirrors
# spec/04 §5 TurnMetric.bloatHits[*]):
#   interface SessionRuntime {
#     sessionId: string;
#     seq: number;                       // monotonic; 0 = no markers yet; nextSeq pre-increments → 1,2,3
#     tokenBaseline: number | null;      // turn metric delta baseline (spec/04 §5); null until first turn_end
#     lastTurnIndex: number | null;      // from turn_end event.turnIndex; null until first turn_end
#     lastFiltered: AgentMessage[] | null; // cached filtered view (spec/06 §7); null until first context.fire
#     lastFilterTs: number | null;       // Date.now() of last context.fire that wrote lastFiltered
#     pendingBloatHits: BloatHit[];      // bloated results THIS turn (spec/04 §5 shape); cleared at turn_end
#   }
#   interface BloatHit { toolName: string; approxTokens: number }
#   type AgentMessage = Record<string, unknown>   // LOCAL opaque alias (real Pi type unresolvable; see above)
```

### Current Codebase tree (state at this subtask's start — verified live)

```bash
pi-mulligan/
├── package.json            # type:'module'; main:'src/index.ts'; pi.extensions:['./src/index.ts'];
│                           # devDeps: typescript ^5, vitest ^1, @types/node ^22; scripts.test:'vitest run'
├── tsconfig.json           # strict, noImplicitAny, types:['node'], moduleResolution:'Bundler', include:['src','test']
├── node_modules/           # @earendil-works/pi-coding-agent, typebox, @types/node 22.20.1, vitest 1.6.1, tsc 5.9.3
│                           # NOTE: @earendil-works/pi-agent-core is NOT hoisted here (transitive only) → AgentMessage unimportable
├── src/
│   ├── index.ts            # S2-era no-op stub (pi.on("session_start", ()=>{})). DO NOT TOUCH (P1.M7.T1 owns wiring).
│   ├── config.ts           # S1+S2 present (MulliganConfig, getConfig/setConfig/validateConfig). Pi-free. Read-only.
│   └── (log.ts may appear mid-session — created by the parallel P1.M1.T3.S1 task; runtime.ts must NOT import it)
├── test/
│   ├── config.test.ts      # the test convention to mirror (vitest, '../src/config.js', describe/it/expectTypeOf)
│   └── integration/        # empty
└── spec/                   # 12-doc spec (read-only); 04 §8 + 06 §7 + 02 §C12 are authoritative here
# VERIFIED BASELINE (run before starting): `npx tsc --noEmit -p tsconfig.json` → exit 0;
#                                            `npx vitest run` → all green (config suite).
# No vitest config file exists → vitest uses defaults + tsconfig.include.
```

### Desired Codebase tree with files to be added (THIS subtask)

```bash
pi-mulligan/
├── src/
│   └── runtime.ts          # NEW — the per-session runtime store (SessionRuntime, BloatHit, AgentMessage,
│                           #       getRuntime, nextSeq, resetRuntime, clearAll). ZERO imports.
└── test/
    └── runtime.test.ts     # NEW — vitest suite (defaults, isolation, nextSeq, reset, clearAll, mutation, types)
# No other files are created or modified.
```

### Known Gotchas of our codebase & Library Quirks

```bash
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #1 (CRITICAL) — The real Pi `AgentMessage` type is NOT importable from this repo.
# It lives in @earendil-works/pi-agent-core (NOT a declared dependency; NOT hoisted into node_modules) and is
# NOT re-exported by @earendil-works/pi-coding-agent. Verified: `import type { AgentMessage } from
# "@earendil-works/pi-agent-core"` → TS2307 under the real tsconfig. SOLUTION: define a LOCAL exported alias
# `export type AgentMessage = Record<string, unknown>;` in runtime.ts. runtime.ts never inspects message
# contents (it only stores/returns arrays), so an opaque element type is sufficient + honest. Real messages
# are assignable INTO lastFiltered (no cast); audit.ts narrows on read. Keeps runtime.ts Pi-free.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #2 — runtime.ts imports NOTHING. Foundation-tier (spec/11 §2 Step 1 groups it with config.ts + log.ts).
# No Pi, no config, no log. Grep gate: `grep -cE '^import|^from' src/runtime.ts` → 0. This keeps it a pure,
# isolated unit-test target and honors the contract ("No prior code dependencies beyond P1.M1.T1.S1").
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #3 — getRuntime returns a LIVE MUTABLE reference, NOT a copy. Consumers mutate fields in place
# (rt.tokenBaseline = n; rt.lastFiltered = msgs; rt.pendingBloatHits.push(hit)). So never defensive-clone on
# get. The same sessionId always resolves to the same object until resetRuntime/clearAll. Verified: writes
# persist and are read back via the next getRuntime(id).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #4 — nextSeq uses PRE-increment (++rt.seq). Fresh seq=0 → first nextSeq returns 1. Markers thus get
# seq 1,2,3,… (spec/04 §3: "monotonic per-session counter, persisted INTO each marker"); 0 means "no markers".
# Post-increment (rt.seq++) would return 0 for the first marker — classic off-by-one; do not use it.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #5 — Each fresh runtime MUST get its OWN new pendingBloatHits: []. NEVER share a module-level empty
# array (e.g. a DEFAULT constant reused via spread) — a shared array would let session B see session A's bloat
# hits. The freshRuntime factory returns a fresh object literal (with a fresh []) every call. Test this.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #6 — resetRuntime DELETES the entry (runtimes.delete), it does NOT mutate the existing object in
# place. The next getRuntime builds a fresh one; the pre-reset reference is abandoned. This aligns with C12:
# stale references must not keep mutating live state. Map.delete on an absent key is a no-op (returns false),
# never throws. Test: pre-reset ref !== post-reset ref.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #7 — The module-scoped Map is NOT reset between vitest tests. Put clearAll() in beforeEach AND
# afterEach so a previous test's session state can't leak into the next (same discipline as config.ts GOTCHA #9
# / log.ts GOTCHA #6). Without this, nextSeq from test N inflates the value seen in test N+1.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #8 — Per-session isolation is automatic (Map SameValueZero keys), but WRITE A TEST FOR IT. "s-A" and
# "s-B" are independent entries; incrementing/resetting/mutating A never touches B. This is the single most
# important correctness property (multi-session correctness) and the contract explicitly demands it.
# ─────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

```ts
// LOCAL opaque alias — the real Pi AgentMessage union is NOT importable here (GOTCHA #1). runtime.ts never
// inspects message contents; it only stores/returns arrays. Real messages are assignable INTO lastFiltered.
export type AgentMessage = Record<string, unknown>;

// Mirrors TurnMetric.bloatHits[*] (spec/04-data-model.md §5) — reused by nudges.ts (push) + markers.ts (snapshot).
export interface BloatHit {
  toolName: string;
  approxTokens: number;
}

// 7-field shape — the work-item contract EXPANDS spec/04 §8's 4 fields (see "Why 7 fields"). Fields are
// MUTABLE by design; callers obtain the live runtime via getRuntime() and mutate in place. C12: only
// primitive values + message arrays — never a sessionManager handle.
export interface SessionRuntime {
  sessionId: string;
  seq: number;                       // monotonic; 0 = no markers yet; nextSeq pre-increments → 1,2,3
  tokenBaseline: number | null;      // turn-metric delta baseline (spec/04 §5); null until first turn_end
  lastTurnIndex: number | null;      // from turn_end event.turnIndex; null until first turn_end
  lastFiltered: AgentMessage[] | null; // cached filtered view (spec/06 §7); null until first context.fire
  lastFilterTs: number | null;       // Date.now() of the last context.fire that wrote lastFiltered
  pendingBloatHits: BloatHit[];      // bloated results THIS turn; cleared at turn_end after snapshotting
}

// The singleton store. Module-scoped; one process-wide Map. Tests reset via clearAll() (GOTCHA #7).
const runtimes = new Map<string, SessionRuntime>();
```

No Pi types, no config types, no log types — the module is self-contained and import-free.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY BASELINE (no edits — run only)
  - RUN: npx tsc --noEmit -p tsconfig.json            # expect exit 0
  - RUN: npx vitest run                                # expect all green (config suite)
  - RUN: test ! -f src/runtime.ts && echo "ok: src/runtime.ts absent"   # we are CREATING, not clobbering

Task 1: CREATE src/runtime.ts   (exact content below — copy verbatim)
  - IMPLEMENT: AgentMessage alias, BloatHit, SessionRuntime, module-level `runtimes` Map, private
    freshRuntime factory, getRuntime, nextSeq, resetRuntime, clearAll.
  - FOLLOW pattern: the Pi-free / module-level-state-with-test-reset style of src/config.ts (S2).
  - CONSTRAINTS:
      * ZERO imports (GOTCHA #2). No Pi, no config, no log. grep gate = 0.
      * getRuntime returns the LIVE stored reference (no clone) (GOTCHA #3).
      * nextSeq: pre-increment `++rt.seq` (GOTCHA #4).
      * freshRuntime returns a NEW object literal with a NEW `pendingBloatHits: []` each call (GOTCHA #5).
      * resetRuntime: `runtimes.delete(sessionId)` (GOTCHA #6); clearAll: `runtimes.clear()`.
      * AgentMessage is a LOCAL alias `Record<string, unknown>` (GOTCHA #1) — do NOT try to import the Pi type.
  - NAMING/PLACEMENT: file at repo-root src/runtime.ts; exports are the 7 names in Success Criteria.

Task 2: CREATE test/runtime.test.ts   (exact content below — copy verbatim)
  - IMPLEMENT: vitest suite mirroring test/config.test.ts conventions (GOTCHA #7/#8).
  - COVERAGE (each group a `describe`): fresh defaults (exact shape; idempotent same-ref; per-runtime OWN
    pendingBloatHits array); nextSeq (first call 1; 1,2,3; persists on live object); session isolation (A/B seq
    independent; field-mutation isolated; distinct objects); resetRuntime (fresh shape after reset; NEW
    reference; no-op on absent; only targeted session; nextSeq restarts at 1); clearAll (wipes all; no-op when
    empty); in-place mutation contract (filter/turn_end/nudges-style writes persist); types (exported + field
    types).
  - RESET: beforeEach AND afterEach call clearAll() (GOTCHA #7).

Task 3: VALIDATE (no edits — run the gates in the Validation Loop)
  - Level 1 (tsc + zero-imports grep gate) and Level 2 (vitest). Levels 3/4 are N/A (pure module, no Pi runtime).
```

#### Exact content to CREATE — `src/runtime.ts` (Task 1 — copy verbatim)

```ts
/**
 * Per-session runtime state map — Mulligan's in-memory (non-persisted) control state.
 * spec/04-data-model.md §8 (SessionRuntime core four fields), spec/06-context-filter.md §7
 * (lastFiltered/lastFilterTs, cached for mulligan_audit), spec/04-data-model.md §5 (BloatHit shape mirrors
 * TurnMetric.bloatHits[*]), spec/02-proven-constraints.md §C12 (never cache a sessionManager handle),
 * spec/11-build-order.md §1/§2 Step 1 ("runtime.ts // per-session runtime map").
 *
 * DESIGN (read GOTCHA #1–#8 in the PRP):
 * - Foundation-tier and Pi-FREE. Imports NOTHING — not Pi, not config, not log. This keeps it a pure, fast,
 *   isolated unit-test target and honors the work-item contract ("No prior code dependencies beyond
 *   P1.M1.T1.S1").
 * - The real Pi `AgentMessage` union lives in @earendil-works/pi-agent-core, which is NOT a resolvable
 *   dependency of this repo (not hoisted; not re-exported by @earendil-works/pi-coding-agent). So a LOCAL
 *   opaque `AgentMessage` alias is defined here (GOTCHA #1). runtime.ts only STORES/RETURNS message arrays —
 *   it never introspects them — so an opaque element type is sufficient and faithful.
 * - State lives in a module-scoped Map<string, SessionRuntime> keyed by sessionId. resetRuntime clears the
 *   entry on session_start (wired in index.ts, P1.M7.T1); clearAll wipes it on shutdown/reload. NEVER caches a
 *   sessionManager handle (C12) — only primitive values and arrays are stored.
 */

/**
 * AgentMessage — LOCAL opaque alias for the elements of a Pi message list.
 *
 * The authoritative Pi `AgentMessage` union (user | assistant | toolResult | bashExecution | custom | …) is
 * defined in @earendil-works/pi-agent-core and is NOT resolvable from this repo (neither hoisted into
 * node_modules nor re-exported by @earendil-works/pi-coding-agent). Foundation-tier runtime.ts is deliberately
 * Pi-free, so it mirrors the element opaquely: a message is a record. runtime.ts never inspects message
 * contents — it only stores `event.messages` deep copies (filter.ts) and returns them (audit.ts).
 *
 * Assignability: a real Pi `AgentMessage[]` is assignable INTO `lastFiltered` (every message variant is a
 * record). Consumers reading `lastFiltered` back should narrow/cast to the real Pi type they obtain from the
 * `context` event (audit.ts, P1.M5.T4.S1) — the objects ARE real messages; the type is just opaque here.
 */
export type AgentMessage = Record<string, unknown>;

/**
 * BloatHit — one bloated tool result observed in a turn. Mirrors `TurnMetric.bloatHits[*]`
 * (spec/04-data-model.md §5) so the bloat annotator (nudges.ts) and the turn metric (markers.ts) can share the
 * shape. Accumulated in `SessionRuntime.pendingBloatHits` across a turn, then snapshotted into the TurnMetric
 * at turn_end and cleared.
 */
export interface BloatHit {
  /** Name of the tool whose result exceeded the bloat threshold (e.g. "read", "bash"). */
  toolName: string;
  /** Approximate in-context token cost of the bloated result (an estimate, not exact). */
  approxTokens: number;
}

/**
 * SessionRuntime — per-session in-memory state (NOT persisted). The work-item contract's 7-field shape: the
 * core four from spec/04-data-model.md §8 (sessionId, seq, tokenBaseline, lastTurnIndex) plus the audit cache
 * from spec/06-context-filter.md §7 (lastFiltered, lastFilterTs) plus the bloat accumulator (pendingBloatHits).
 *
 * Held in a module-scoped Map keyed by sessionId. Fields are MUTABLE by design: callers obtain the live runtime
 * via getRuntime() and mutate fields in place (filter.ts writes lastFiltered; turn_end writes
 * tokenBaseline/lastTurnIndex; nudges.ts pushes pendingBloatHits; markers.ts increments seq via nextSeq).
 * C12: only primitive values + message arrays are stored — never a sessionManager handle.
 */
export interface SessionRuntime {
  /** The Pi session id this runtime belongs to (ctx.sessionManager.getSessionId()). */
  sessionId: string;
  /** Monotonic per-session marker counter; persisted INTO each marker (spec/04 §3). 0 = no markers yet.
   *  Incremented via nextSeq(); first marker gets seq 1 (pre-increment). */
  seq: number;
  /** Token count at the start of the current turn (or last turn_end), for the turn-metric delta (spec/04 §5).
   *  null until the first estimate is captured (first turn / post-reload). */
  tokenBaseline: number | null;
  /** The turn index this runtime last saw (from turn_end event.turnIndex). null until first turn_end. */
  lastTurnIndex: number | null;
  /** The most recent filtered message list (what the model actually saw on the last inference), cached so
   *  mulligan_audit can report the filtered view without re-running the pipeline (spec/06 §7). null until the
   *  first context.fire. Written by filter.ts each fire. */
  lastFiltered: AgentMessage[] | null;
  /** Date.now() of the last context.fire that wrote lastFiltered. For audit freshness checks. null until first fire. */
  lastFilterTs: number | null;
  /** Bloated tool results observed THIS turn (since last turn_end), snapshotted into the TurnMetric at
   *  turn_end and cleared. Each fresh runtime gets its OWN new empty array (GOTCHA #5). */
  pendingBloatHits: BloatHit[];
}

/**
 * The module-scoped per-session runtime map. Keyed by ctx.sessionManager.getSessionId(). One process-wide
 * singleton (ES modules are evaluated once). NEVER caches a sessionManager handle (C12) — only primitive
 * values and arrays live in each SessionRuntime. Tests MUST reset this via clearAll() (GOTCHA #7).
 */
const runtimes = new Map<string, SessionRuntime>();

/**
 * freshRuntime — construct a brand-new SessionRuntime with all defaults. Called on first access for a session
 * and again after resetRuntime. Returns a NEW object with a NEW pendingBloatHits array every time (GOTCHA #5 —
 * never a shared module-level array, which would leak bloat hits across sessions).
 */
function freshRuntime(sessionId: string): SessionRuntime {
  return {
    sessionId,
    seq: 0,
    tokenBaseline: null,
    lastTurnIndex: null,
    lastFiltered: null,
    lastFilterTs: null,
    pendingBloatHits: [],
  };
}

/**
 * getRuntime — return the live per-session runtime, creating a fresh one on first access.
 *
 * Returns a MUTABLE reference (NOT a copy): callers mutate fields in place (e.g. `rt.tokenBaseline = n`).
 * The same sessionId always resolves to the same live object until resetRuntime/clearAll. Never throws.
 *
 * @param sessionId the Pi session id (ctx.sessionManager.getSessionId())
 */
export function getRuntime(sessionId: string): SessionRuntime {
  let rt = runtimes.get(sessionId);
  if (rt === undefined) {
    rt = freshRuntime(sessionId);
    runtimes.set(sessionId, rt);
  }
  return rt;
}

/**
 * nextSeq — atomically increment and return the per-session monotonic marker counter.
 *
 * Pre-increment: the first call returns 1 (fresh seq is 0). The returned value is persisted INTO the marker
 * (spec/04-data-model.md §3 "seq") so the filter can order markers reliably even if timestamps tie. Per-session
 * isolated: incrementing session A never touches session B.
 *
 * @returns the post-increment seq value for this session (1, 2, 3, …)
 */
export function nextSeq(sessionId: string): number {
  const rt = getRuntime(sessionId);
  return ++rt.seq;
}

/**
 * resetRuntime — clear this session's runtime entry. Called on `session_start` (index.ts, P1.M7.T1) so a
 * reopened/resumed session starts from a clean runtime (seq 0, null baseline, empty bloat hits, no stale
 * filtered view). The NEXT getRuntime(sessionId) creates a fresh one. A no-op if the session had no runtime.
 * Never throws.
 *
 * Deletes (rather than mutating in place) so any reference a caller still holds is abandoned — the C12-safe
 * pattern (stale references must not keep mutating live state).
 */
export function resetRuntime(sessionId: string): void {
  runtimes.delete(sessionId);
}

/**
 * clearAll — wipe ALL per-session runtimes. Provided for `session_shutdown` / process-exit / `/reload` cleanup
 * (index.ts, P1.M7.T1) so no session's state leaks across a full teardown. Never throws.
 */
export function clearAll(): void {
  runtimes.clear();
}
```

#### Exact content to CREATE — `test/runtime.test.ts` (Task 2 — copy verbatim)

```ts
import { describe, it, expect, expectTypeOf, beforeEach, afterEach } from "vitest";
import {
  getRuntime,
  nextSeq,
  resetRuntime,
  clearAll,
  type SessionRuntime,
  type BloatHit,
  type AgentMessage,
} from "../src/runtime.js";

// GOTCHA #7: the runtime Map is module-scoped and is NOT reset between tests. Clear it before AND after each
// test so a previous test's session state can't leak in (or out).
beforeEach(() => {
  clearAll();
});

afterEach(() => {
  clearAll();
});

describe("fresh runtime defaults (spec/04 §8 + spec/06 §7)", () => {
  it("getRuntime creates a runtime with the exact default shape on first access", () => {
    const rt = getRuntime("s1");
    expect(rt).toEqual({
      sessionId: "s1",
      seq: 0,
      tokenBaseline: null,
      lastTurnIndex: null,
      lastFiltered: null,
      lastFilterTs: null,
      pendingBloatHits: [],
    });
  });

  it("getRuntime is idempotent: the same sessionId returns the SAME live reference (GOTCHA #3)", () => {
    const a = getRuntime("s1");
    const b = getRuntime("s1");
    expect(a).toBe(b); // reference equality — callers mutate the shared object
  });

  it("each fresh runtime gets its OWN pendingBloatHits array — no cross-session sharing (GOTCHA #5)", () => {
    const a = getRuntime("s1");
    const b = getRuntime("s2");
    expect(a.pendingBloatHits).not.toBe(b.pendingBloatHits);
    a.pendingBloatHits.push({ toolName: "read", approxTokens: 9000 });
    expect(b.pendingBloatHits).toHaveLength(0); // b unaffected
  });
});

describe("nextSeq — monotonic per-session marker counter (GOTCHA #4)", () => {
  it("first call returns 1 (pre-increment from the fresh seq 0 baseline)", () => {
    expect(nextSeq("s1")).toBe(1);
  });

  it("increments monotonically: 1, 2, 3, …", () => {
    expect(nextSeq("s1")).toBe(1);
    expect(nextSeq("s1")).toBe(2);
    expect(nextSeq("s1")).toBe(3);
  });

  it("persists the incremented seq on the live runtime (read back via getRuntime)", () => {
    nextSeq("s1");
    nextSeq("s1");
    expect(getRuntime("s1").seq).toBe(2);
  });
});

describe("session isolation (independent runtimes per sessionId — GOTCHA #8)", () => {
  it("nextSeq is isolated per session — A's increments never affect B", () => {
    expect(nextSeq("A")).toBe(1);
    expect(nextSeq("A")).toBe(2);
    expect(nextSeq("B")).toBe(1); // B starts fresh at 1
    expect(nextSeq("A")).toBe(3); // A continues its own sequence
    expect(nextSeq("B")).toBe(2);
  });

  it("mutating one session's fields never touches another", () => {
    const a = getRuntime("A");
    const b = getRuntime("B");
    a.tokenBaseline = 12345;
    a.lastTurnIndex = 7;
    a.lastFiltered = [{ role: "user", content: "hi" }];
    a.lastFilterTs = 9_999;
    expect(b.tokenBaseline).toBeNull();
    expect(b.lastTurnIndex).toBeNull();
    expect(b.lastFiltered).toBeNull();
    expect(b.lastFilterTs).toBeNull();
  });

  it("getRuntime returns distinct objects for distinct ids", () => {
    expect(getRuntime("A")).not.toBe(getRuntime("B"));
  });
});

describe("resetRuntime — session_start re-initialization (GOTCHA #6)", () => {
  it("clears the entry so the next getRuntime returns a FRESH runtime", () => {
    nextSeq("s1");
    nextSeq("s1");
    getRuntime("s1").tokenBaseline = 999;
    resetRuntime("s1");
    const rt = getRuntime("s1");
    expect(rt.seq).toBe(0);
    expect(rt.tokenBaseline).toBeNull();
    expect(rt).toEqual({
      sessionId: "s1",
      seq: 0,
      tokenBaseline: null,
      lastTurnIndex: null,
      lastFiltered: null,
      lastFilterTs: null,
      pendingBloatHits: [],
    });
  });

  it("returns a NEW reference after reset (stale references are abandoned — C12 discipline)", () => {
    const before = getRuntime("s1");
    resetRuntime("s1");
    const after = getRuntime("s1");
    expect(after).not.toBe(before);
  });

  it("is a no-op (never throws) for a session that had no runtime", () => {
    expect(() => resetRuntime("never-existed")).not.toThrow();
  });

  it("does not affect OTHER sessions' runtimes", () => {
    nextSeq("A");
    nextSeq("B");
    resetRuntime("A");
    expect(getRuntime("B").seq).toBe(2); // B untouched
    expect(getRuntime("A").seq).toBe(0); // A reset to fresh
  });

  it("nextSeq restarts at 1 after a reset (seq is per-session-runtime, not global)", () => {
    expect(nextSeq("s1")).toBe(1);
    expect(nextSeq("s1")).toBe(2);
    resetRuntime("s1");
    expect(nextSeq("s1")).toBe(1);
  });
});

describe("clearAll — shutdown cleanup", () => {
  it("wipes every session's runtime", () => {
    nextSeq("A");
    nextSeq("B");
    getRuntime("A").tokenBaseline = 5;
    clearAll();
    // every session is now fresh again:
    expect(getRuntime("A").seq).toBe(0);
    expect(getRuntime("B").seq).toBe(0);
    expect(getRuntime("A").tokenBaseline).toBeNull();
  });

  it("is a no-op (never throws) when the map is already empty", () => {
    expect(() => clearAll()).not.toThrow();
  });
});

describe("in-place mutation contract (consumers mutate the live object)", () => {
  it("filter.ts-style writes to lastFiltered/lastFilterTs persist and are read back via getRuntime", () => {
    const rt = getRuntime("s1");
    const msgs: AgentMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: [] },
    ];
    rt.lastFiltered = msgs;
    rt.lastFilterTs = 1234;
    expect(getRuntime("s1").lastFiltered).toBe(msgs); // same array reference (no defensive copy)
    expect(getRuntime("s1").lastFilterTs).toBe(1234);
  });

  it("nudges.ts-style pushes to pendingBloatHits accumulate, then turn_end clears them", () => {
    const hit: BloatHit = { toolName: "bash", approxTokens: 12000 };
    getRuntime("s1").pendingBloatHits.push(hit);
    expect(getRuntime("s1").pendingBloatHits).toEqual([hit]);
    getRuntime("s1").pendingBloatHits.length = 0; // turn_end clears the array
    expect(getRuntime("s1").pendingBloatHits).toEqual([]);
  });

  it("turn_end-style writes to tokenBaseline/lastTurnIndex persist", () => {
    const rt = getRuntime("s1");
    rt.tokenBaseline = 2048;
    rt.lastTurnIndex = 3;
    expect(getRuntime("s1").tokenBaseline).toBe(2048);
    expect(getRuntime("s1").lastTurnIndex).toBe(3);
  });
});

describe("types", () => {
  it("exports SessionRuntime / BloatHit / AgentMessage with the correct field types", () => {
    const rt: SessionRuntime = {} as SessionRuntime;
    expectTypeOf(rt.sessionId).toEqualTypeOf<string>();
    expectTypeOf(rt.seq).toEqualTypeOf<number>();
    expectTypeOf(rt.tokenBaseline).toEqualTypeOf<number | null>();
    expectTypeOf(rt.lastTurnIndex).toEqualTypeOf<number | null>();
    expectTypeOf(rt.lastFiltered).toEqualTypeOf<AgentMessage[] | null>();
    expectTypeOf(rt.lastFilterTs).toEqualTypeOf<number | null>();
    expectTypeOf(rt.pendingBloatHits).toEqualTypeOf<BloatHit[]>();
    expectTypeOf<BloatHit>().toEqualTypeOf<{ toolName: string; approxTokens: number }>();
  });
});
```

### Implementation Patterns & Key Details

```ts
// PATTERN: lazy create + live reference (GOTCHA #3). Never defensive-clone on get — consumers mutate in place.
export function getRuntime(sessionId: string): SessionRuntime {
  let rt = runtimes.get(sessionId);
  if (rt === undefined) {
    rt = freshRuntime(sessionId);   // fresh object + fresh [] every time (GOTCHA #5)
    runtimes.set(sessionId, rt);
  }
  return rt;                        // the LIVE stored reference
}

// PATTERN: pre-increment counter (GOTCHA #4). First marker gets seq 1; 0 = "no markers yet".
export function nextSeq(sessionId: string): number {
  return ++getRuntime(sessionId).seq;
}

// PATTERN: delete (not mutate-in-place) on reset — C12-safe (GOTCHA #6). delete on absent key is a no-op.
export function resetRuntime(sessionId: string): void {
  runtimes.delete(sessionId);
}

// PATTERN: factory returns a fresh literal each call (GOTCHA #5 — never a shared module-level array).
function freshRuntime(sessionId: string): SessionRuntime {
  return { sessionId, seq: 0, tokenBaseline: null, lastTurnIndex: null,
           lastFiltered: null, lastFilterTs: null, pendingBloatHits: [] };
}

// GOTCHA #1: the real Pi AgentMessage is unimportable here → local opaque alias. runtime.ts never inspects
// message contents, so Record<string, unknown> is sufficient + faithful. Real messages assign IN with no cast.
export type AgentMessage = Record<string, unknown>;
```

### Integration Points

```yaml
LIFECYCLE WIRING (future — NOT this subtask; owned by P1.M7.T1, index.ts):
  - session_start:  resetRuntime(ctx.sessionManager.getSessionId())   // fresh runtime on (re)open/resume
  - session_shutdown / reload: clearAll()                             // no cross-teardown leakage
  - NOTE: runtime.ts only PROVIDES these functions; it does not register any pi.on handler itself.

DOWNSTREAM CONSUMERS (all later subtasks — none import runtime.ts yet):
  - markers.ts (P1.M4.T1.S1):  const seq = nextSeq(sessionId);  // stamp seq INTO each marker (spec/04 §3)
  - filter.ts  (P1.M4.T2.S1):  rt.lastFiltered = transformed; rt.lastFilterTs = Date.now();  // each context.fire
  - nudges.ts  (P1.M6.T1.S1):  rt.pendingBloatHits.push({toolName, approxTokens});           // tool_result
                                rt.tokenBaseline = estimate; rt.lastTurnIndex = turnIndex;    // turn_end
  - tools/audit.ts (P1.M5.T4.S1): read rt.lastFiltered (cast to real Pi AgentMessage[] — narrowing; D5 honored)
  - index.ts   (P1.M7.T1):      resetRuntime(sessionId) on session_start; clearAll() on shutdown

NO DATABASE / NO ROUTES / NO NEW DEPS — runtime.ts imports nothing; the Map is a plain JS builtin. Nothing is
added to package.json. State is purely in-memory (nothing persisted by this module).
```

---

## Validation Loop

### Level 1: Type-safety & scope gates (run after Task 1)

```bash
# Type-check the new module + test (include:["src","test"] already covers them):
npx tsc --noEmit -p tsconfig.json          # MUST exit 0

# Scope gate — runtime.ts is import-free (GOTCHA #2): no Pi, no config, no log.
test "$(grep -cE '^import|^from' src/runtime.ts)" = "0"   # expect 0
# Confirm the 7 exports exist (3 types/interfaces + 4 functions):
grep -cE 'export (function|type|interface) (SessionRuntime|BloatHit|AgentMessage|getRuntime|nextSeq|resetRuntime|clearAll)\b' src/runtime.ts  # expect 7

# Expected: tsc exit 0; both grep gates pass. If tsc errors, READ the output and fix before proceeding.
```

### Level 2: Unit tests (run after Task 2)

```bash
# The new runtime suite in isolation:
npx vitest run test/runtime.test.ts       # MUST be all-green

# Full suite — must NOT regress config (this is a pure, independent, import-free module):
npx vitest run                             # MUST be all-green (runtime + config; + log once P1.M1.T3.S1 lands)

# Expected: every test green. If any fail, debug the ROOT CAUSE and fix the implementation — do not weaken asserts.
# Particular attention: the session-isolation group (nextSeq A/B independent; field-mutation isolated) and the
# resetRuntime group (fresh shape + NEW reference + only-targeted-session + nextSeq restarts at 1).
```

### Level 3: Integration / runtime (N/A for this pure module)

`runtime.ts` has **no Pi dependency and no lifecycle wiring** — it is an in-memory Map fully covered by the
Level 2 unit suite. Real Pi integration (`session_start` → `resetRuntime`, `shutdown` → `clearAll`) arrives in
**P1.M7.T1**; the consumers (markers/filter/nudges/audit) arrive in M4–M6. Nothing to run here.

### Level 4: Creative / domain-specific validation (optional sanity check)

```bash
# Optional hand-proof that two sessions are truly isolated and reset abandons the old object:
node --input-type=module -e "
import { getRuntime, nextSeq, resetRuntime, clearAll } from './src/runtime.ts';
console.log('A1', nextSeq('A'), 'A2', nextSeq('A'), 'B1', nextSeq('B'));   // A1 1 A2 2 B1 1
const oldA = getRuntime('A'); oldA.tokenBaseline = 111;
resetRuntime('A');
console.log('A.seq after reset', getRuntime('A').seq, 'baseline', getRuntime('A').tokenBaseline); // 0 null
console.log('old ref abandoned?', oldA.tokenBaseline);                    // 111 (detached, not live)
console.log('B untouched', getRuntime('B').seq);                          // 1
clearAll();
console.log('after clearAll A.seq', getRuntime('A').seq);                 // 0
"
# Expected:
#   A1 1 A2 2 B1 1
#   A.seq after reset 0 baseline null
#   old ref abandoned? 111
#   B untouched 1
#   after clearAll A.seq 0
```

---

## Final Validation Checklist

### Technical Validation

- [ ] Level 1 passed: `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] Level 1 passed: the zero-imports grep gate (0) and the 7-exports grep gate.
- [ ] Level 2 passed: `npx vitest run` is all-green (runtime suite + config suite).
- [ ] No test was weakened to go green — every assert in `test/runtime.test.ts` is meaningful.

### Feature Validation

- [ ] `getRuntime(id) === getRuntime(id)` (live reference) until `resetRuntime`/`clearAll`.
- [ ] Fresh runtime matches the 7-field default shape exactly.
- [ ] `nextSeq` returns 1, 2, 3, … and is **independent across sessions**.
- [ ] `resetRuntime(id)` yields a **fresh** object (seq 0, all nulls, empty `pendingBloatHits`) that `!==` the
      pre-reset reference; a no-op for an absent session; leaves other sessions untouched.
- [ ] `clearAll()` wipes every session; a no-op when empty.
- [ ] Each fresh runtime gets its **own** `pendingBloatHits` array.
- [ ] In-place mutation persists (filter/turn_end/nudges-style writes).

### Code Quality Validation

- [ ] Follows the existing foundation-module style (Pi-free, import-free, module-level state + test reset) —
      mirrors `src/config.ts`.
- [ ] File placement matches the desired tree (`src/runtime.ts`, `test/runtime.test.ts`); **no other file touched**.
- [ ] Anti-patterns avoided (see below): no Pi import, no shared default array, no post-increment, no
      defensive-clone on get, no mutate-in-place reset.
- [ ] No new dependencies added to `package.json` (the `Map` is a JS builtin).
- [ ] JSDoc on every export; the AgentMessage-alias and C12 reasoning are documented inline for downstream readers.

### Documentation & Deployment

- [ ] Exports are self-documenting (clear names + JSDoc); each field cites its spec section.
- [ ] The `AgentMessage` local-alias decision and its assignability note are documented so audit.ts knows to cast.
- [ ] No new env vars; no config (runtime.ts is config-free).

---

## Anti-Patterns to Avoid

- ❌ **Don't import the real Pi `AgentMessage`.** It is unresolvable from this repo (not hoisted; not
  re-exported). Use the local `Record<string, unknown>` alias. runtime.ts must have **zero imports**.
- ❌ **Don't return a defensive copy from `getRuntime`.** Consumers mutate the live object in place
  (`rt.tokenBaseline = n`). A copy would silently drop those mutations.
- ❌ **Don't use post-increment (`rt.seq++`) in `nextSeq`.** It returns 0 for the first marker. Use `++rt.seq`
  so the first marker gets seq 1.
- ❌ **Don't share a module-level `pendingBloatHits: []` across runtimes** (e.g. via a `DEFAULT` constant +
  spread). Each `freshRuntime` must allocate its own `[]` or bloat hits leak across sessions.
- ❌ **Don't `resetRuntime` by mutating the existing object in place.** `delete` the entry so stale references
  are abandoned (C12-safe); the next `getRuntime` builds a fresh object.
- ❌ **Don't forget `clearAll()` in `beforeEach`/`afterEach`.** The module-scoped Map is not reset between tests.
- ❌ **Don't trim the shape to spec/04 §8's 4 fields.** The contract expands it to 7 — `lastFiltered`,
  `lastFilterTs`, and `pendingBloatHits` are required.
- ❌ **Don't cache a `sessionManager` handle anywhere.** Key the map on the primitive `sessionId` string only (C12).
- ❌ **Don't wire `pi.on("session_start", …)` here.** That is P1.M7.T1. This task only ships the store + tests.

---

## Confidence Score

**9/10** — one-pass success is highly likely. The module is small (≈120 LOC) and fully specified: the 7-field
shape is reconciled from spec/04 §8 + spec/06 §7 + the work-item contract (the contract's expanded shape wins,
flagged), the public API is verbatim from the contract, and the exact `src/runtime.ts` + `test/runtime.test.ts`
content is given above. The single non-obvious decision — *why a local `AgentMessage` alias* — is documented
with **verified** evidence (the real Pi type is unresolvable: not re-exported by `pi-coding-agent`, and
`pi-agent-core` is neither hoisted nor a declared dependency → `TS2307` under the real tsconfig). Every behavior
the code relies on (ES-module singleton Map, `Map` SameValueZero key isolation, `delete`/`clear` no-op-on-absent
semantics, pre-increment counter, `Record<string,unknown>` assignability, vitest module-state non-reset) was
verified first-hand or against authoritative docs. The only residual risk is collision with the parallel
`log.ts` task — explicitly fenced off by the *zero-imports* grep gate (runtime.ts imports nothing, not even
log.ts) and the *Scope decision*.