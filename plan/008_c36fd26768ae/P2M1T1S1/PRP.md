---
name: "P2.M1.T1.S1 — SnapshotStore interface + types + AsyncMutex (src/snapshot/store.ts)"
description: "CREATE `src/snapshot/store.ts` (NEW file) EXPORTING four symbols: the `SnapshotStore` interface (6 sync methods, verbatim from spec/14 §2), `RestoreOpts`, `RestoreResult` (verbatim shapes), and a `class AsyncMutex` with `acquire(): Promise<() => void>` (promise-chain mutex that serializes concurrent async operations). The interface is the contract BOTH backends (git.ts P2.M2.T1, cas.ts P2.M3.T1) implement; the AsyncMutex is the serialization primitive each backend's constructor will use so capture/dirtyCheck/restore/retire never overlap (spec/14 §4.3). Write `test/store.test.ts` (NEW) — vitest — with AsyncMutex serialization unit tests (concurrent `acquire()` execute sequentially, never overlap; FIFO order) + lightweight `expectTypeOf` type tests pinning the interface/type shapes. [Mode A] JSDoc on SnapshotStore, every method, RestoreOpts, RestoreResult, and AsyncMutex citing `@14-working-tree-revert.md §2` (and §4.3 for the mutex). store.ts has ZERO runtime imports (pure TS + a promise chain) — mirroring the Pi-free discipline of the sibling `paths.ts`."
---

## Goal

**Feature Goal**: Stand up the central contract + concurrency primitive of the v1.2 snapshot subsystem in a single NEW self-contained module (`src/snapshot/store.ts`): (1) the `SnapshotStore` interface — the backend-pluggable abstraction both `GitBackend` (P2.M2.T1) and `CasBackend` (P2.M3.T1) implement, and that `rewindExecute` (P4.M2.T1) orchestrates WITHOUT knowing which backend ran; (2) the `RestoreOpts` / `RestoreResult` types that carry the per-call revert flags and the five-bucket restore outcome; (3) the `AsyncMutex` class — a promise-chain mutex that serializes ALL store operations on a given instance so concurrent capture/restore/retire/GC can never interleave (spec/14 §4.3).

**Deliverable**: Two NEW files.
1. `src/snapshot/store.ts` — exports `SnapshotStore`, `RestoreOpts`, `RestoreResult`, `AsyncMutex`. No runtime imports (pure TypeScript types + a promise-chain class). Leaves clean room for the `detectAndCreate()` factory that the FOLLOWING task (P2.M1.T1.S2) ADDS to this same file (do NOT implement the factory here).
2. `test/store.test.ts` — vitest. Behavior tests for `AsyncMutex` (serialization: concurrent `acquire()` calls never overlap, run FIFO) + `expectTypeOf` type tests pinning `SnapshotStore`/`RestoreOpts`/`RestoreResult`/`AsyncMutex.acquire` shapes.

**Success Definition**:
- `npm run typecheck` (`tsc --noEmit`, strict) passes — proves all four exports are well-formed and the interface types resolve (RestoreOpts/RestoreResult are self-contained; SnapshotStore references only them + primitives).
- `npm test` (`vitest run`) passes — the new `test/store.test.ts` is green (AsyncMutex serialization + type tests) and EVERY existing suite stays green (zero cross-file impact: a brand-new import-free module).
- `store.ts` exports exactly `{ SnapshotStore, RestoreOpts, RestoreResult, AsyncMutex }` and NOTHING else (no `detectAndCreate` — that is S2; no backend implementations — those are P2.M2/P2.M3).
- The `SnapshotStore` interface method signatures are byte-for-byte the spec/14 §2 + work-item contract (see "Data models" — they are SYNCHRONOUS, e.g. `capture(label: string): string | null`, NOT Promise-returning).
- `AsyncMutex.acquire()` returns `Promise<() => void>`; calling the returned function releases the lock. Concurrent `acquire()` calls serialize strictly (verified by a test asserting `maxActive === 1` and FIFO start/end interleaving).
- [Mode A] JSDoc rides with the work: the `SnapshotStore` interface, each of its 6 methods, `RestoreOpts`, `RestoreResult`, and `AsyncMutex` each carry a JSDoc block citing `@14-working-tree-revert.md §2` (mutex also cites §4.3) — matching the JSDoc density of the sibling `paths.ts` / `markers.ts`.

## User Persona

**Target User**: Downstream implementation tasks that IMPLEMENT or CONSUME the contract — `GitBackend` (P2.M2.T1) and `CasBackend` (P2.M3.T1) `implements SnapshotStore` and construct an `AsyncMutex` in their constructor; `rewindExecute` (P4.M2.T1.S2) imports `RestoreOpts`/`RestoreResult` to build opts and fold `RestoreResult` into the marker; `index.ts` (P3.M1.T2) imports the `SnapshotStore` type to type the threaded store + the `detectAndCreate()` factory return (S2).

**Use Case**: The rewind tool calls `store.dirtyCheck(afterRef, affected)` → if clean, `store.restore(beforeRef, opts): RestoreResult` → folds `{reverted, deleted, failed, skipped, refused}` into success text + the marker. Meanwhile a concurrent `turn_start` capture hook calls `store.capture("turn")` — the per-backend `AsyncMutex` guarantees capture and restore never touch the shadow index / CAS store simultaneously.

**Pain Points Addressed**: There is currently NO backend-agnostic contract for working-tree snapshots, and NO serialization primitive for the concurrent-event hazard (spec/14 §4.3: "Pi preflights sibling `tool_call`s sequentially then runs them concurrently"). This task provides both — the interface the rewind tool is mode-agnostic against, and the mutex that makes every backend race-free by construction.

## Why

- **Unblocks BOTH backends AND the rewind integration.** P2.M2.T1 (git) and P2.M3.T1 (cas) `implements SnapshotStore`; P4.M2.T1 (rewind step 6b) consumes `RestoreOpts`/`RestoreResult`. This task is the type contract they all build on — without it, those tasks cannot type-check.
- **Follows the spec's placement tree verbatim.** spec/14 §2 line 73 and `architecture/system_context.md` both place "the SnapshotStore interface + detectAndCreate() factory + the AsyncMutex" in `src/snapshot/store.ts`. This task owns the interface + types + mutex; S2 owns the factory. Splitting them keeps each PRP tightly scoped (the factory does git-detection I/O; the interface/types/mutex are pure).
- **Zero runtime risk / zero coupling.** store.ts imports NOTHING at runtime (pure TS interfaces + a promise-chain class — the sibling `paths.ts` discipline). It is fully unit-testable in isolation, adds no module-loading coupling, and cannot regress any existing file (it is brand-new).
- **The AsyncMutex is the load-bearing safety primitive.** spec/14 §4.3 makes it non-optional: "a single mutex per store serializes ALL store operations (`capture`/`dirtyCheck`/`restore`/`retire`/`gc`)… the prompt-boundary GC pass ALSO acquires the mutex, so a `git gc` / CAS mark-sweep can never overlap an in-flight `capture`/`restore`/`retire` straddling a turn boundary." Getting it correct + tested here (serialization + FIFO) de-risks every backend.

## What

A new, pure, self-contained module `src/snapshot/store.ts` plus its unit test. Developer-invisible plumbing (no user-facing surface; no config/marker/runtime changes).

1. `src/snapshot/store.ts` — file-level header JSDoc (mirroring `paths.ts`'s header: cites spec/14 §2 placement, §4.3 mutex, the snapshot-subsystem DESIGN notes: Pi-free, project-module-free, pure TS).
2. `export interface SnapshotStore` — the 6-method contract (verbatim from spec/14 §2 — see "Data models"), each method with a multi-line JSDoc citing `@14-working-tree-revert.md §2` (+ §3/§4/§6 where a method's semantics are detailed).
3. `export interface RestoreOpts { revertFileChanges: boolean; deleteCreatedFiles: boolean; }` — verbatim from spec/14 §2 (+ work-item contract). JSDoc cites §1 (three-layer opt-in: these are layer 2 — the per-call flags) and §6 (how restore consumes them).
4. `export interface RestoreResult { reverted: string[]; deleted: string[]; failed: string[]; skipped: string[]; refused: string[]; }` — verbatim. JSDoc cites §6 (the 5-bucket restore outcome) + maps each bucket to its spec meaning (reverted/deleted = success; failed = E27 best-effort; skipped = E29 caps; refused = E30 dirty guard).
5. `export class AsyncMutex` with `acquire(): Promise<() => void>` — promise-chain implementation (see "Implementation Patterns"). JSDoc cites `@14-working-tree-revert.md §4.3` (the serialization contract) and names the consumers (backend constructors, P2.M2/P2.M3) + the GC pass.
6. `test/store.test.ts` — vitest. `import { AsyncMutex, type SnapshotStore, type RestoreOpts, type RestoreResult } from "../src/snapshot/store.js";`. AsyncMutex serialization behavior tests + `expectTypeOf` type tests.

### Success Criteria

- [ ] `src/snapshot/store.ts` exists and exports exactly `{ SnapshotStore, RestoreOpts, RestoreResult, AsyncMutex }`.
- [ ] `SnapshotStore` has all 6 methods with SYNCHRONOUS signatures verbatim from spec/14 §2: `describe()`, `capture(label)`, `dirtyCheck(afterRef, paths)`, `restore(beforeRef, opts)`, `has(ref)`, `retire(ref)`.
- [ ] `RestoreOpts` = `{ revertFileChanges: boolean; deleteCreatedFiles: boolean }`; `RestoreResult` = `{ reverted, deleted, failed, skipped, refused }: string[]` each.
- [ ] `AsyncMutex.acquire()` returns `Promise<() => void>`; the returned function releases the lock; a second `acquire()` blocks until the first holder calls its release fn.
- [ ] Concurrent `acquire()` calls NEVER overlap (test asserts a shared `active` counter never exceeds 1) and run FIFO (test asserts exact start/end interleaving).
- [ ] store.ts has ZERO `import` statements (pure — verify with `grep -c "^import\|^export.*from" src/snapshot/store.ts` → 0).
- [ ] store.ts does NOT define `detectAndCreate` (that is P2.M1.T1.S2) and does NOT define any backend (those are P2.M2/P2.M3).
- [ ] [Mode A] JSDoc present on the interface, every method, both type-interfaces, and the class — each citing `@14-working-tree-revert.md §2` (mutex also §4.3).
- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes (new `test/store.test.ts` green; all existing suites green).

## All Needed Context

### Context Completeness Check
_Passes "No Prior Knowledge":_ the implementing agent needs only `spec/14-working-tree-revert.md §2` (the verbatim interface — quoted below), §4.3 (the mutex contract — quoted below), §6 (restore semantics — for method JSDoc), the sibling `src/snapshot/paths.ts` (header-JSDoc style + Pi-free discipline to mirror), `test/paths.test.ts` (the vitest test pattern to mirror), and the four verbatim shapes in "Data models". Every method signature, type field, and the mutex algorithm are specified exactly. No external/library research is needed — store.ts is pure TS (types + a promise chain); it imports nothing.

### Documentation & References

```yaml
# MUST READ — the normative interface (copy signatures byte-for-byte; they are SYNCHRONOUS)
- docfile: spec/14-working-tree-revert.md
  section: "## 2. Architecture — the SnapshotStore"
  why: "Source of truth for the SnapshotStore interface (6 methods), RestoreOpts, RestoreResult. The `interface SnapshotStore { … }` + `interface RestoreOpts` + `interface RestoreResult` code blocks are NORMATIVE — reproduce them exactly."
  critical: "The method signatures are SYNCHRONOUS (e.g. `capture(label: string): string | null`), NOT Promise-returning. This is deliberate and matches the work-item contract. Do NOT 'fix' them to async — see GOTCHA #1 (sync interface + standalone async mutex are decoupled). `describe()` returns `backend: 'git'|'cas'|'none'` (3-valued) — contrast RevertCheckpoint.backend which is 2-valued (a checkpoint exists only when a real backend captured)."

- docfile: spec/14-working-tree-revert.md
  section: "### 4.3 Cross-cutting implementation requirements … AsyncMutex"
  why: "Source of truth for the AsyncMutex contract: 'a single mutex per store serializes ALL store operations (capture/dirtyCheck/restore/retire/gc). Pi preflights sibling tool_calls sequentially then runs them concurrently; the mutex makes capture/restore race-free regardless. The prompt-boundary GC pass ALSO acquires the mutex.'"
  critical: "The mutex is PER-STORE-INSTANCE (constructed in each backend's constructor — P2.M2/P2.M3), not module-global. It serializes the BACKENDS' operations, NOT the interface definition. store.ts EXPORTS the class; it does not use it. The interface stays sync; the mutex is a separately-exported async utility the backends opt into. (GOTCHA #1.)"

- docfile: spec/14-working-tree-revert.md
  section: "## 5. Capture lifecycle & retention"   # for capture()/retire()/has() method JSDoc accuracy
  why: "Explains what a ref IS (a protected shadow ref `refs/mulligan/snapshots/<label>/<sha>` for git; a manifest ref for CAS), why `retire()` exists (drop a protected ref so its objects can be GC'd), and the turn/checkpoint namespaces (turn/* deleted at prompt-boundary GC; checkpoint/* exempt). Makes capture()/retire()/has() JSDoc truthful."
  critical: "capture() returns an OPAQUE ref string (the backend chooses the representation — commit SHA for git, manifest hash for CAS). store.ts defines the contract, not the representation. `null` return = capture failed (caps exceeded, I/O error); rewind treats null as 'revert unavailable, proceed without'."

- docfile: spec/14-working-tree-revert.md
  section: "## 6. Restore semantics — refuse-on-dirty, then restore"   # for restore()/dirtyCheck() + RestoreResult JSDoc
  why: "Defines the 5-bucket RestoreResult semantics and the dirty guard. dirtyCheck(afterRef, paths) = paths whose CURRENT content differs from the after-snapshot (post-turn drift by a human/other process). restore(beforeRef, opts) writes working-tree files FROM the before-snapshot; refuses the WHOLE revert if any affected path is dirty."
  critical: "RestoreResult buckets: reverted = files written back to beforeRef content; deleted = span-created files removed (only when BOTH deleteCreatedFiles AND config.revert.allowDeleteCreatedFiles); failed = E27 best-effort I/O failure (never throws); skipped = E29 caps/partial-snapshot degrade; refused = E30 dirty-guard refuse (the WHOLE revert refused, not per-path). rewind folds all five into the marker + success text."

- docfile: plan/008_c36fd26768ae/architecture/system_context.md
  section: "## New Subsystem: src/snapshot/ (4 files)"
  why: "Confirms the placement: store.ts = 'SnapshotStore interface + detectAndCreate factory + AsyncMutex'. This task (S1) owns interface + types + AsyncMutex; S2 owns detectAndCreate. Confirms store.ts is a NEW file (only paths.ts exists today)."
  critical: "Do NOT implement detectAndCreate in S1 — it does git-detection I/O (git rev-parse) and belongs to S2 (P2.M1.T1.S2). S1's store.ts leaves clean room for it (S2 will append the function)."

# CONTRACT from the (parallel/just-complete) sibling — RevertCheckpoint, the INPUT type store.ts is informed by
- docfile: plan/008_c36fd26768ae/P1M2T2S1/PRP.md
  section: "Implementation Blueprint > Data models"   # the export interface RevertCheckpoint block
  why: "Defines RevertCheckpoint EXACTLY. store.ts does NOT import it (the SnapshotStore interface returns opaque string refs, not RevertCheckpoint), but the refs capture()/restore() exchange BECOME RevertCheckpoint.beforeRef/afterRef in SessionRuntime. Understanding it makes the method JSDoc truthful (a ref == a beforeRef/afterRef value)."
  critical: "RevertCheckpoint { label; backend:'git'|'cas' (2-valued, NO 'none'); beforeRef; afterRef?; turnIndex; ts } — exported from src/markers.ts. SnapshotStore.describe() returns backend:'git'|'cas'|'none' (3-valued) — a DIFFERENT union (a store can be 'none' = unavailable; a checkpoint never is). Keep the two unions distinct."

# PATTERN guides (read-only — do NOT edit)
- file: src/snapshot/paths.ts
  why: "The sibling file in the SAME subsystem + dir. Mirror its header-JSDoc structure (file-level `/** … */` citing spec/14 sections + the snapshot DESIGN notes + the consumer list) and its Pi-free/project-module-free discipline. Its closing 'Consumers:' line is the pattern for naming who imports each export."
  pattern: "Header JSDoc → `import { … } from "node:path"` (store.ts has NO import line — skip) → exports each with their own JSDoc. JSDoc cites spec/14 §X inline. Pure, deterministic, lexical-only DESIGN bullets."

- file: test/paths.test.ts
  why: "The sibling TEST file. Mirror its vitest style: `import { describe, it, expect, expectTypeOf } from "vitest";`, flat `test/<basename>.test.ts` location (NOT test/snapshot/), `../src/snapshot/<module>.js` import path with `.js` extension, per-`describe` spec-citation header comment, `expectTypeOf` for type assertions."
  pattern: "`describe("<symbol> — spec/14 §X", () => { it("(a) …", () => { … }); });` + `expectTypeOf(x).toEqualTypeOf<T>()`. No beforeEach needed for stateless modules."

- file: src/markers.ts
  why: "Reference for JSDoc density on EXPORTED types (each export's JSDoc cites spec sections + 'EXPORTED so X/Y/Z share ONE canonical shape'). Mirror that for SnapshotStore/RestoreOpts/RestoreResult (name their consumers: git.ts/cas.ts/rewind.ts/index.ts)."
  pattern: "Multi-line JSDoc: one-line summary → spec citations → who-writes/who-reads or who-implements/who-consumes → gotcha note if any."
```

### Current Codebase tree (relevant slice)

```
src/snapshot/
  paths.ts           # sibling P1.M2.T1.S1 (COMPLETE) — pure path-safety helpers. Mirror its header-JSDoc style.
  store.ts           # ← THIS TASK CREATES IT (NEW). interface + types + AsyncMutex.
src/markers.ts       # exports RevertCheckpoint (P1.M2.T2.S1, COMPLETE) — INPUT type store.ts is informed by (does NOT import).
src/config.ts        # config.revert.* (P1.M1.T1.S1, COMPLETE) — INPUT (RestoreOpts mirrors its per-call flag names).
src/runtime.ts       # SessionRuntime.snapshots (P1.M2.T2.S2) — stores RevertCheckpoints; store.ts does not touch it.
test/
  paths.test.ts      # sibling test — mirror vitest style + flat location.
  store.test.ts      # ← THIS TASK CREATES IT (NEW). AsyncMutex serialization + type tests.
spec/
  14-working-tree-revert.md  # §2 (interface, verbatim), §4.3 (mutex contract), §5 (capture lifecycle), §6 (restore semantics)
plan/008_c36fd26768ae/architecture/
  system_context.md          # confirms placement + the 4-file snapshot subsystem
```

### Desired Codebase tree (what changes)

```
src/snapshot/store.ts   # NEW — export SnapshotStore, RestoreOpts, RestoreResult, AsyncMutex (NO factory, NO backends)
test/store.test.ts      # NEW — AsyncMutex serialization behavior tests + expectTypeOf type tests
```
No edits to any existing file. No new dependencies. No config/marker/runtime changes.

### Known Gotchas of our codebase & Library Quirks

```ts
// GOTCHA #1 (CRITICAL) — the interface is SYNCHRONOUS; the AsyncMutex is ASYNC. They are DECOUPLED exports.
// spec/14 §2 + the work-item contract specify SYNCHRONOUS method signatures: `capture(label: string): string | null`,
// `restore(beforeRef, opts): RestoreResult`, etc. (NOT Promise<…>). The AsyncMutex (spec §4.3) serializes the BACKENDS'
// operations — each backend (P2.M2/P2.M3) constructs its own AsyncMutex in its constructor and wraps its method bodies.
// store.ts EXPORTS both the sync interface AND the async mutex; it does NOT make the interface async, and it does NOT
// use the mutex itself. DO NOT "harmonize" the interface to Promise-returning — that would ripple into rewind.ts/index.ts
// (P4.M2/P3.M1.T2, out of scope) and violate the explicit work-item contract. The decoupling is intentional and correct:
// the interface is a pure type contract; the mutex is an opt-in utility for backends that have async hazards (concurrent
// tool calls, prompt-boundary GC straddling a turn). If you are tempted to write `async capture(…): Promise<string|null>`,
// STOP — re-read the contract: it is `capture(label: string): string | null`.

// GOTCHA #2 (CRITICAL) — store.ts has ZERO imports. Pure TS types + a promise chain.
// Unlike paths.ts (which imports node:path), store.ts imports NOTHING. SnapshotStore/RestoreOpts/RestoreResult are
// self-contained interfaces (fields are primitives + the other two interfaces). AsyncMutex is a promise-chain class
// (uses only the global Promise + a private field — no node: import). Verify: `grep -nE "^import|from \"" src/snapshot/store.ts`
// must return NOTHING. This keeps store.ts Pi-free, project-module-free, and fully unit-testable in isolation (the same
// discipline as paths.ts). DO NOT import RevertCheckpoint from markers.js — the SnapshotStore interface returns opaque
// `string` refs, NOT RevertCheckpoint; the two types meet in SessionRuntime (P1.M2.T2.S2), not in store.ts.

// GOTCHA #3 — leave clean room for detectAndCreate() (that is P2.M1.T1.S2, the NEXT task).
// system_context.md and spec/14 §2 both say store.ts contains "the SnapshotStore interface + detectAndCreate() factory +
// the AsyncMutex". This task (S1) owns ONLY interface + types + AsyncMutex. S2 (P2.M1.T1.S2) will APPEND the
// `detectAndCreate(config, cwd): SnapshotStore` factory to this same file (it does git-detection I/O via `child_process`).
// DO NOT implement detectAndCreate here (it would pull in config + git + cas deps, breaking the zero-import purity and
// over-reaching into S2's scope). Just place the four exports cleanly so S2 can append below them.

// GOTCHA #4 — the AsyncMutex MUST be FIFO and NEVER let two holders overlap.
// The promise-chain algorithm (see "Implementation Patterns") guarantees both: each caller chains onto the CURRENT
// tail's release-promise (`_tail`), so callers wake in arrival order (JS microtask queue is FIFO), and each caller
// `await`s the previous holder's release before proceeding, so `active` can never exceed 1. The test MUST assert BOTH
// (maxActive === 1 AND the exact start:a/end:a/start:b/end:b/… interleaving). A buggy non-chaining implementation
// (e.g. a boolean flag flipped without awaiting) would fail the overlap test; a buggy LIFO/pool implementation would
// fail the FIFO test. Double-release (calling the returned fn twice) must be a safe no-op (Promise settle-once).

// GOTCHA #5 — AsyncMutex.acquire() returns Promise<() => void>, where () => void is the RELEASE function.
// The release closure is captured at acquire() time and handed to the caller after the await resolves. The caller MUST
// call it (typically in a finally). A forgotten release deadlocks all subsequent acquire()s — that is expected behavior
// (the contract is manual acquire/release, like a lock; backends wrap their method bodies in try/finally). Do NOT add an
// auto-release `run(fn)`/`withLock` helper in S1 — the work-item contract specifies only `acquire(): Promise<() => void>`;
// ergonomic helpers are out of scope (and backends may prefer explicit control for the §4.3 GC-pass + step-6b patterns).

// GOTCHA #6 — backend union differs across the snapshot subsystem (3-valued vs 2-valued). Don't conflate.
// SnapshotStore.describe().backend is `"git" | "cas" | "none"` (3-valued — a store can report "none" = revert
// unavailable / CAS unwritable, spec §2 "Detection"). RevertCheckpoint.backend (markers.ts) is `"git" | "cas"` ONLY
// (2-valued — a checkpoint exists ONLY when a real backend captured; "none" stores never create checkpoints). store.ts
// defines the 3-valued describe() return; it does NOT define RevertCheckpoint. Keep them distinct in JSDoc.

// GOTCHA #7 — ESM + tsc output convention: source/test imports use the `.js` extension.
// `import { AsyncMutex, type SnapshotStore } from "../src/snapshot/store.js"` in the test (NOT ".ts"). store.ts itself
// has no imports (GOTCHA #2), so this only applies to the test file. tsconfig is `module:ESNext, moduleResolution:Bundler,
// strict:true`. The `type` modifier on type-only imports (`type SnapshotStore`) is the codebase convention (markers/runtime).

// GOTCHA #8 — describe() reason?: string is OPTIONAL and only for "none"/degraded.
// `describe()` returns `{ backend, reason? }`. reason is populated when backend is "none" (E28: no git AND CAS
// unwritable) or a backend is degraded — a human-readable one-liner for the log/notice ("revert unavailable: …").
// For healthy "git"/"cas" backends reason is omitted. Document this in the describe() JSDoc (the backend impls fill it).
```

## Implementation Blueprint

### Data models and structure

store.ts defines THREE interfaces and ONE class. All four shapes are NORMATIVE (spec/14 §2 + the work-item contract) — reproduce EXACTLY (field names, optionality, union members). Add the JSDoc specified under each.

```ts
// ── SnapshotStore (spec/14 §2, verbatim; method signatures SYNCHRONOUS per contract — GOTCHA #1) ──
/**
 * The backend-pluggable working-tree snapshot abstraction. BOTH backends implement this:
 * `GitBackend` (src/snapshot/git.ts, P2.M2.T1 — external shadow repository) and `CasBackend`
 * (src/snapshot/cas.ts, P2.M3.T1 — content-addressed store + explicit-paths mode). The rewind tool
 * (rewindExecute, P4.M2.T1) orchestrates `dirtyCheck` + `restore` and NEVER knows which backend ran
 * (mode-agnostic — spec/14 §2). `index.ts` (P3.M1.T2) creates ONE store via the `detectAndCreate()`
 * factory (P2.M1.T1.S2) and threads it into the rewind tool + capture hooks.
 *
 * METHOD SIGNATURES ARE SYNCHRONOUS (spec/14 §2 + the work-item contract) — e.g. `capture()` returns
 * `string | null`, NOT `Promise<string | null>`. Each backend constructs its own `AsyncMutex` (below)
 * in its constructor and serializes its operations internally (spec §4.3); the interface itself is a
 * pure type contract, decoupled from the mutex. See `@14-working-tree-revert.md` §2 (architecture),
 * §3 (GitBackend), §4 (CasBackend), §5 (capture lifecycle), §6 (restore semantics).
 */
export interface SnapshotStore {
  /**
   * Report which backend is active (for logging / the rewind notice). backend is 3-valued: `"git"` |
   * `"cas"` | `"none"`. `"none"` = revert unavailable (no git AND CAS unwritable — E28; the rewind
   * proceeds without file revert). `reason?` is a human-readable one-liner, populated for `"none"` /
   * degraded backends (omitted for healthy git/cas). spec/14 §2 ("Detection"). IMPLEMENTED BY:
   * GitBackend/CasBackend (P2.M2/P2.M3).
   */
  describe(): { backend: "git" | "cas" | "none"; reason?: string };

  /**
   * Snapshot the working set NOW and return an OPAQUE ref string (a commit SHA for the GitBackend's
   * shadow repo; a manifest hash for the CasBackend). `null` = capture failed (caps exceeded — E29,
   * I/O error) → the rewind treats the boundary as "revert unavailable, proceed without". The ref is
   * stored as `RevertCheckpoint.beforeRef` (turn_start / checkpoint-set) or `.afterRef` (agent_end).
   * `label` is the capture-namespace key (`"turn"` | `"turn-after"` | `"ckpt:<name>"`) — governs the
   * ref's retention namespace (turn/* GC'd at prompt-boundary; checkpoint/* exempt — spec §5).
   * spec/14 §2, §5. IMPLEMENTED BY: GitBackend/CasBackend.
   */
  capture(label: string): string | null;

  /**
   * Return the subset of `paths` whose CURRENT work-tree content differs from the `afterRef` snapshot
   * — i.e. files that drifted AFTER the agent's turn (a human/other-process edit since `agent_end`).
   * The restore dirty-guard (spec §6 step 3) calls this BEFORE restore: if ANY affected path is dirty,
   * the WHOLE file-revert is REFUSED (not silently clobbered — E30). Compare is content-equality (git
   * diff against the afterRef tree / CAS hash equality). spec/14 §2, §6. IMPLEMENTED BY: git/cas.
   */
  dirtyCheck(afterRef: string, paths: string[]): string[];

  /**
   * Write working-tree files FROM the `beforeRef` snapshot (restore the pre-span file state). `opts`
   * gates the two actions: revert modified files (revertFileChanges) and delete span-created files
   * (deleteCreatedFiles — honored only when BOTH the per-call flag AND config.revert.allowDeleteCreatedFiles,
   * spec §1 layer 3). Returns a RestoreResult (5 buckets). The op NEVER throws — per-path failures land
   * in `failed[]` (E27, best-effort); the dirty-guard refuse lands in `refused[]` (E30); uncaptured-due-
   * to-caps files land in `skipped[]` (E29). Working-tree ONLY — never touches the source git index/refs.
   * spec/14 §2, §6. CONSUMED BY: rewindExecute step 6b (P4.M2.T1.S2). IMPLEMENTED BY: git/cas.
   */
  restore(beforeRef: string, opts: RestoreOpts): RestoreResult;

  /**
   * Does a snapshot ref still exist (resolvable) in the backend's store? Used by the capture lifecycle
   * / cross-reload (E32) to decide whether a persisted RevertCheckpoint's refs are still honored.
   * spec/14 §2. IMPLEMENTED BY: git/cas.
   */
  has(ref: string): boolean;

  /**
   * Drop a protected ref so its underlying objects can be reclaimed by the next GC pass (git shadow-repo
   * `update-ref -d` / CAS manifest delete). Called when a checkpoint is revoked/consumed (spec §5
   * "Checkpoints are exempt… held until revoked or consumed"). The prompt-boundary GC pass (spec §5)
   * retires turn/* refs en masse. spec/14 §2, §5. IMPLEMENTED BY: git/cas.
   */
  retire(ref: string): void;
}

// ── RestoreOpts (spec/14 §2 + work-item contract, verbatim) ──
/**
 * Per-call revert flags passed to `SnapshotStore.restore()` — consent layer 2 of the three-layer opt-in
 * (spec/14 §1: config.enabled (layer 1) → these per-call flags (layer 2) → allowDeleteCreatedFiles
 * (layer 3, delete-only)). The agent MUST set at least one; they are NEVER inferred. Mirrors the
 * `mulligan_rewind` tool params `revert_file_changes` / `delete_created_files` (P4.M1.T1.S1).
 * CONSUMED BY: rewindExecute builds this from the tool params (P4.M2.T1.S2). spec/14 §1, §6.
 */
export interface RestoreOpts {
  /** Restore modified files to their beforeRef content. (spec §1, §6 step 4) */
  revertFileChanges: boolean;
  /** Delete files the span newly created (honored only when ALSO config.revert.allowDeleteCreatedFiles). (spec §1, §6) */
  deleteCreatedFiles: boolean;
}

// ── RestoreResult (spec/14 §2 + work-item contract, verbatim) ──
/**
 * The five-bucket outcome of `SnapshotStore.restore()`. rewindExecute (P4.M2.T1.S2) folds these into the
 * rewind success text ("Reverted <X> file(s), deleted <Y>; <Z> skipped/failed, <W> refused") AND the
 * rewind marker's `revert` block (P1.M2.T2.S1: {revertedFiles, deletedFiles, failedFiles, refusedFiles,
 * skipped, backend}) for auditability. Every bucket is a workspace-relative POSIX path list. spec/14 §6.
 *  - reverted: files written back to beforeRef content (success).
 *  - deleted:  span-created files removed (success; only when deleteCreatedFiles + allowDeleteCreatedFiles).
 *  - failed:   E27 — best-effort I/O failure (locked file, permission); the op NEVER throws.
 *  - skipped:  E29 — file uncaptured because a cap (maxFileBytes/maxTotalBytes/maxSnapshotsPerTurn) was hit.
 *  - refused:  E30 — dirty-guard refuse; the WHOLE file-revert refused (paths that drifted since agent_end).
 */
export interface RestoreResult {
  reverted: string[];
  deleted: string[];
  failed: string[];
  skipped: string[];
  refused: string[];
}

// ── AsyncMutex (spec/14 §4.3; promise-chain algorithm — GOTCHA #4) ──
/**
 * A promise-chain mutex that serializes async operations on a single store instance. spec/14 §4.3:
 * "a single mutex per store serializes ALL store operations (capture/dirtyCheck/restore/retire/gc). Pi
 * preflights sibling tool_calls sequentially then runs them concurrently; the mutex makes capture/restore
 * race-free regardless. The prompt-boundary GC pass ALSO acquires the mutex, so a git gc / CAS mark-sweep
 * can never overlap an in-flight capture/restore/retire straddling a turn boundary."
 *
 * USAGE: each backend (GitBackend P2.M2.T1, CasBackend P2.M3.T1) constructs `new AsyncMutex()` in its
 * constructor and wraps each serialized method body as:
 *     const release = await this.mutex.acquire();
 *     try { …do the op… } finally { release(); }
 * FIFO + strict mutual exclusion are guaranteed by the promise-chain: each acquire() awaits the previous
 * holder's release-promise, so holders never overlap and wake in arrival order. CONSUMERS: git.ts/cas.ts
 * constructors. spec/14 §4.3. (Decoupled from the synchronous SnapshotStore interface — see that interface's
 * JSDoc + GOTCHA #1.)
 */
export class AsyncMutex {
  /** The release-promise of the CURRENT holder (resolved on the next). Starts resolved (unlocked). */
  private _tail: Promise<void> = Promise.resolve();

  /**
   * Acquire the lock. Resolves (in arrival/FIFO order) once all prior holders have released; the resolved
   * value is THIS caller's release function. The caller MUST call it (typically in a `finally`) — a
   * forgotten release deadlocks all later acquire()s (expected; the contract is manual acquire/release).
   * Double-release is a safe no-op (a Promise settles once). spec/14 §4.3.
   */
  acquire(): Promise<() => void> {
    let release!: () => void;
    const prev = this._tail;                         // the current holder's release-promise
    this._tail = new Promise<void>((resolve) => {    // this caller becomes the new tail
      release = resolve;
    });
    return prev.then(() => release);                 // wait for the prev holder, then hand back our release
  }
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/snapshot/store.ts — file header JSDoc
  - WRITE a file-level header JSDoc (mirror src/snapshot/paths.ts's header structure). Cite: spec/14 §2
    (placement: "src/snapshot/store.ts // the SnapshotStore interface + detectAndCreate() factory + the
    AsyncMutex"), §4.3 (the mutex contract). DESIGN bullets (mirror paths.ts): "Pi-FREE + project-module-
    FREE — imports NOTHING (pure TS types + a promise chain); fully unit-testable in isolation" /
    "Defines the BACKEND-AGNOSTIC contract both backends (git.ts/cas.ts) implement + the serialization
    primitive (AsyncMutex) each backend's constructor uses" / "CONSUMERS: git.ts (P2.M2.T1), cas.ts
    (P2.M3.T1), rewind.ts (P4.M2.T1), index.ts (P3.M1.T2)".
  - FOLLOW pattern: src/snapshot/paths.ts header JSDoc (the `/** Workspace path-safety helpers … */` block).
  - CRITICAL: NO `import` lines follow the header (GOTCHA #2 — store.ts imports nothing). State that
    explicitly in a DESIGN bullet ("imports NOTHING" — contrast paths.ts which imports node:path).

Task 2: CREATE src/snapshot/store.ts — SnapshotStore interface (+ per-method JSDoc)
  - WRITE `export interface SnapshotStore { … }` with the 6 methods EXACTLY as in "Data models" (verbatim
    from spec/14 §2 + the work-item contract). SYNCHRONOUS signatures (GOTCHA #1).
  - METHODS (exact signatures): `describe(): { backend: "git" | "cas" | "none"; reason?: string };` |
    `capture(label: string): string | null;` | `dirtyCheck(afterRef: string, paths: string[]): string[];`
    | `restore(beforeRef: string, opts: RestoreOpts): RestoreResult;` | `has(ref: string): boolean;` |
    `retire(ref: string): void;`.
  - EACH method gets the multi-line JSDoc from "Data models" (cites spec/14 §2 + the relevant §3/§4/§5/§6
    section; names IMPLEMENTED-BY: git/cas and, for restore, CONSUMED-BY: rewindExecute).
  - CRITICAL: `opts: RestoreOpts` and the `: RestoreResult` return reference the interfaces defined in
    Task 3/4 — order the interfaces so tsc resolves forward references (TS interfaces are hoisted, so
    order is flexible, but place SnapshotStore FIRST, then RestoreOpts/RestoreResult for readability).

Task 3: CREATE src/snapshot/store.ts — RestoreOpts interface
  - WRITE `export interface RestoreOpts { revertFileChanges: boolean; deleteCreatedFiles: boolean; }`
    (verbatim — field names EXACT; these mirror the mulligan_rewind param names in camelCase).
  - JSDoc: cite spec/14 §1 (three-layer opt-in — this is layer 2) + §6; name CONSUMED-BY: rewindExecute
    (P4.M2.T1.S2 builds it from the tool params).

Task 4: CREATE src/snapshot/store.ts — RestoreResult interface
  - WRITE `export interface RestoreResult { reverted: string[]; deleted: string[]; failed: string[];
    skipped: string[]; refused: string[]; }` (verbatim — 5 buckets, each string[], order as listed).
  - JSDoc: cite spec/14 §6 (the 5-bucket outcome) + map each bucket (reverted/deleted = success; failed =
    E27; skipped = E29; refused = E30); name CONSUMED-BY: rewindExecute folds into success text + marker.

Task 5: CREATE src/snapshot/store.ts — AsyncMutex class
  - WRITE `export class AsyncMutex` with `private _tail: Promise<void> = Promise.resolve();` and
    `acquire(): Promise<() => void> { … }` EXACTLY as in "Data models" (the promise-chain algorithm).
  - CRITICAL (GOTCHA #4): the algorithm is `let release!; const prev = this._tail; this._tail = new
    Promise(r => release = r); return prev.then(() => release);`. Do NOT use a boolean flag (would allow
    overlap). Do NOT use a simple queue that resolves all waiters at once (would break exclusion). The
    CHAIN (`_tail` reassignment per acquire + awaiting `prev`) is what gives FIFO + mutual exclusion.
  - GOTCHA #5: return `Promise<() => void>` — the release closure. Do NOT add a `run()`/`withLock()`
    helper (out of scope; contract specifies acquire() only).
  - JSDoc: cite spec/14 §4.3 verbatim ("a single mutex per store serializes ALL store operations…");
    show the backend usage snippet (`const release = await this.mutex.acquire(); try{…}finally{release();}`);
    name CONSUMERS: git.ts/cas.ts constructors.

Task 6: CREATE test/store.test.ts — vitest setup + AsyncMutex serialization behavior tests
  - WRITE `import { describe, it, expect, expectTypeOf } from "vitest";` and
    `import { AsyncMutex, type SnapshotStore, type RestoreOpts, type RestoreResult } from "../src/snapshot/store.js";`
    (.js extension — GOTCHA #7; `type` modifier on type-only imports — codebase convention).
  - File header comment (mirror test/paths.test.ts): cite spec/14 §2 (interface), §4.3 (mutex), §10 Tier 1
    (pure-helper unit-test tier), task P2.M1.T1.S1.
  - ADD `describe("AsyncMutex — spec/14 §4.3 serialization contract", () => { … })` with AT LEAST:
      (a) it("acquire() returns a release function; a lone acquire/release pair completes", …) — sanity.
      (b) it("serializes concurrent acquire(): holders NEVER overlap (maxActive === 1)", …) — fire 3-5
          concurrent tasks each doing `const release = await mutex.acquire(); active++; (track maxActive);
          await microDelay(); active--; release();` inside `Promise.all([...])`; assert maxActive === 1.
      (c) it("is FIFO: concurrent acquire() wake in arrival order (no overlap)", …) — assert the start/end
          log is exactly `["start:a","end:a","start:b","end:b","start:c","end:c", …]` (proves both no-overlap
          AND arrival-order fairness).
      (d) it("re-acquire works after release (the mutex is reusable)", …) — acquire/release, then acquire/
          release again, both succeed.
      (e) it("double-release is a safe no-op (does not corrupt subsequent serialization)", …) — release()
          twice then a fresh acquire still serializes.
  - HELPER: a `microDelay()` = `new Promise(r => setTimeout(r, 0))` (or `await Promise.resolve()` queued a
    few times) to YIELD the event loop so concurrent tasks actually race for the lock (without a yield, a
    fully-sync body would hold the lock across no await and the overlap could not be observed). Use
    `setTimeout(r,0)` to be safe across microtask/macrotask ordering.
  - FOLLOW pattern: test/paths.test.ts (describe/it/expect + per-describe spec-citation comment).

Task 7: CREATE test/store.test.ts — expectTypeOf type tests (pin the exported shapes)
  - ADD `describe("SnapshotStore / RestoreOpts / RestoreResult / AsyncMutex — type shapes (spec/14 §2)", …)`
    with expectTypeOf assertions (mirror test/paths.test.ts / test/runtime.test.ts expectTypeOf style):
      (a) `expectTypeOf<SnapshotStore["capture"]>().parameters.toEqualTypeOf<[string]>()` — capture takes
          one string (the label).
      (b) `expectTypeOf<SnapshotStore["capture"]>().returns.toEqualTypeOf<string | null>()` — SYNC return
          (pins GOTCHA #1: NOT Promise<string|null>).
      (c) `expectTypeOf<SnapshotStore["restore"]>().returns.toEqualTypeOf<RestoreResult>()`.
      (d) `expectTypeOf<SnapshotStore["describe"]>().returns.toEqualTypeOf<{ backend: "git"|"cas"|"none"; reason?: string }>()`.
      (e) `expectTypeOf<RestoreOpts>().toEqualTypeOf<{ revertFileChanges: boolean; deleteCreatedFiles: boolean }>()`.
      (f) `expectTypeOf<RestoreResult>().toEqualTypeOf<{ reverted: string[]; deleted: string[]; failed: string[]; skipped: string[]; refused: string[] }>()`.
      (g) `expectTypeOf<AsyncMutex["acquire"]>().returns.toEqualTypeOf<Promise<() => void>>()`.
  - WHY: these pin the contract so a downstream agent (or a careless edit) cannot silently change a sync
    signature to async or drop a RestoreResult bucket without a test failing.
```

### Implementation Patterns & Key Details

```ts
// CRITICAL — the AsyncMutex promise-chain (the load-bearing algorithm; do NOT deviate — GOTCHA #4):
export class AsyncMutex {
  private _tail: Promise<void> = Promise.resolve();
  acquire(): Promise<() => void> {
    let release!: () => void;            // assigned synchronously inside the Promise executor
    const prev = this._tail;             // snapshot the CURRENT tail (previous holder's release-promise)
    this._tail = new Promise<void>((resolve) => {
      release = resolve;                 // THIS caller's release fn = resolve its own tail promise
    });
    return prev.then(() => release);     // await the prev holder, then hand back our release fn
  }
}
// WHY it serializes + is FIFO: each acquire() chains onto the then-current `_tail` and REPLACES `_tail`
// with its own (unresolved) release-promise. So caller B (arriving after A) awaits A's release-promise;
// when A calls release(), A's promise resolves → B's `.then` wakes → B proceeds. A and B can never both
// be past their `await` at once (mutual exclusion); B always wakes after A (FIFO — JS microtask queue).

// CRITICAL — the serialization TEST must YIELD the event loop or the overlap is unobservable:
async function microDelay() { return new Promise<void>((r) => setTimeout(r, 0)); }
it("never overlaps (maxActive === 1)", async () => {
  const mutex = new AsyncMutex();
  let active = 0, maxActive = 0;
  const log: string[] = [];
  async function task(name: string) {
    const release = await mutex.acquire();
    active++; maxActive = Math.max(maxActive, active); log.push(`start:${name}`);
    await microDelay();                  // ← yield so sibling tasks get a chance to (incorrectly) overlap
    log.push(`end:${name}`); active--; release();
  }
  await Promise.all([task("a"), task("b"), task("c"), task("d")]);
  expect(maxActive).toBe(1);             // no two holders ever overlapped
  expect(log).toEqual(["start:a","end:a","start:b","end:b","start:c","end:c","start:d","end:d"]); // FIFO
});

// NOTE on the sync interface + async mutex decoupling (GOTCHA #1) — the interface is a pure TYPE; it has
// no `async`. The backends (P2.M2/P2.M3) wrap their method bodies with the mutex. store.ts does NOT do:
//   ❌ async capture(label: string): Promise<string | null>   // WRONG — contract is sync
// It DOES export the standalone mutex the backends opt into. This is correct and intentional.
```

### Integration Points

```yaml
TYPES (the deliverable — exported from src/snapshot/store.ts):
  - SnapshotStore      → IMPLEMENTED BY git.ts (P2.M2.T1), cas.ts (P2.M3.T1); TYPE-USED-BY index.ts (P3.M1.T2, the threaded store + detectAndCreate return).
  - RestoreOpts        → CONSUMED BY rewind.ts (P4.M2.T1.S2 builds it from tool params).
  - RestoreResult      → CONSUMED BY rewind.ts (P4.M2.T1.S2 folds buckets into success text + marker.revert).
  - AsyncMutex         → CONSUMED BY git.ts + cas.ts CONSTRUCTORS (P2.M2.T1 / P2.M3.T1 — `this.mutex = new AsyncMutex()`).
NO DATABASE: none.
NO CONFIG: config.revert.* already exists (P1.M1.T1.S1 — COMPLETE); store.ts does NOT read it (the factory
  detectAndCreate in S2 + the backends do). store.ts imports nothing.
NO MARKERS/RUNTIME CHANGES: RevertCheckpoint (markers.ts, COMPLETE) + SessionRuntime.snapshots (P1.M2.T2.S2)
  are INPUTS store.ts is informed by; store.ts does NOT import or edit either.
NO ROUTES: none.
NO package.json / tsconfig CHANGES: none (a brand-new import-free module + test, both already covered by
  the existing tsc/vitest config).
NO detectAndCreate: that is P2.M1.T1.S2 (the NEXT task). Leave clean room — do NOT implement it here.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# TypeScript (strict) is the ONLY compiler here. (NO ruff/mypy/eslint/uv — this is a TS project.)
npm run typecheck        # = tsc --noEmit
# Expected: zero errors. This is the PRIMARY gate — proves:
#   - the 4 exports are well-formed; SnapshotStore references ResolveOpts/RestoreResult which resolve.
#   - AsyncMutex._tail / acquire() type-check (Promise<() => void> return).
#   - the test file's type-only imports + expectTypeOf assertions type-check.
# If errors: READ tsc output. Likely causes: a typo in a union member ("git"|"cas"|"none"), a wrong
# field name, or an async signature mistakenly introduced (GOTCHA #1). Fix the signature to match §2.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run the new test file in isolation first (fast feedback on AsyncMutex serialization + type tests):
npm test -- test/store.test.ts
# Expected: all green. Pay special attention to:
#   - "serializes concurrent acquire(): maxActive === 1" (if this FAILS, the mutex allows overlap — the
#     algorithm is wrong; re-check the promise-chain per "Implementation Patterns").
#   - "is FIFO" (if the log is out of order or interleaved like start:a/start:b, the chain is wrong).
#   - the expectTypeOf type tests (a failure here means a signature drifted from the contract).

# Then the full suite (proves zero cross-file regression — store.ts is brand-new + import-free, so this
# is a formality, but run it to catch any accidental edit to an existing file):
npm test
# Expected: all green (new test/store.test.ts + every existing suite).
```

### Level 3: Integration Testing (System Validation)

This task is pure type/contract + a pure-TS mutex (no I/O, no Pi, no fs, no subprocess). There is no
service to start / endpoint to hit / DB to inspect. The integration proof is that downstream consumers
(git.ts/cas.ts/rewind.ts) will type-check against these exports once written (P2.M2/P2.M3/P4.M2). As a
lightweight manual confirmation that the exports + purity are correct:

```bash
# Confirm the 4 exports are present and named exactly:
grep -nE "^export (interface SnapshotStore|interface RestoreOpts|interface RestoreResult|class AsyncMutex)" src/snapshot/store.ts
# Expected: 4 matches (one per export), in that order.

# Confirm store.ts is import-free (GOTCHA #2):
grep -nE '^(import|export .+ from ")' src/snapshot/store.ts
# Expected: NO output (zero import lines; zero re-exports).

# Confirm detectAndCreate is NOT here (it is S2):
grep -n "detectAndCreate" src/snapshot/store.ts
# Expected: NO output (only a header-JSDoc MENTION is acceptable if you cite it as S2's scope; no definition).

# Confirm the SYNCHRONOUS signatures (GOTCHA #1 — must NOT be Promise-returning):
grep -nE "capture\(label: string\): string \| null" src/snapshot/store.ts
grep -nE "restore\(beforeRef: string, opts: RestoreOpts\): RestoreResult" src/snapshot/store.ts
# Expected: each returns exactly ONE match with the sync return type (no `Promise<` wrapping).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# (Optional) A stress test of the mutex under higher concurrency — proves the serialization holds beyond
# the 3-4-task default. Add to test/store.test.ts if desired:
#   await Promise.all(Array.from({length: 50}, (_, i) => task(`t${i}`)));
#   expect(maxActive).toBe(1);
# Not required by the work-item contract (which says "concurrent calls execute sequentially") but a cheap
# confidence boost. The 4-task test in Task 6 is sufficient for the Success Criteria.
```

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` passes (zero errors)
- [ ] `npm test` passes (new test/store.test.ts green; all existing suites green)
- [ ] `grep -nE "^export (interface SnapshotStore|interface RestoreOpts|interface RestoreResult|class AsyncMutex)" src/snapshot/store.ts` → 4 matches
- [ ] `grep -nE '^(import|export .+ from ")' src/snapshot/store.ts` → no output (import-free, GOTCHA #2)

### Feature Validation
- [ ] `SnapshotStore` has all 6 methods with SYNCHRONOUS signatures verbatim from spec/14 §2 (`capture(label): string | null`, etc.)
- [ ] `describe()` returns `{ backend: "git"|"cas"|"none"; reason?: string }` (3-valued backend — GOTCHA #6)
- [ ] `RestoreOpts` = `{ revertFileChanges: boolean; deleteCreatedFiles: boolean }`; `RestoreResult` = 5 string[] buckets (`reverted, deleted, failed, skipped, refused`)
- [ ] `AsyncMutex.acquire()` returns `Promise<() => void>`; the returned fn releases the lock; double-release is a safe no-op
- [ ] Concurrent `acquire()` never overlap (test asserts `maxActive === 1`) and run FIFO (exact start/end interleaving)
- [ ] `detectAndCreate` is NOT defined here (it is P2.M1.T1.S2 — GOTCHA #3)
- [ ] [Mode A] JSDoc on the interface + every method + both type-interfaces + the class, each citing `@14-working-tree-revert.md §2` (mutex also §4.3)

### Code Quality Validation
- [ ] JSDoc density matches the sibling `src/snapshot/paths.ts` + `src/markers.ts` (spec citations + EXPORTED-so-X-consumes pattern)
- [ ] store.ts header JSDoc mirrors paths.ts (DESIGN bullets: Pi-free, project-module-free, pure; + Consumers list)
- [ ] Test file mirrors test/paths.test.ts (vitest `describe/it/expect/expectTypeOf`, flat `test/store.test.ts` location, `../src/snapshot/store.js` import with `.js`, per-describe spec-citation comment)
- [ ] The AsyncMutex uses the promise-chain algorithm (not a boolean flag, not a resolve-all queue) — GOTCHA #4
- [ ] No new files beyond `src/snapshot/store.ts` + `test/store.test.ts`; no dependency/config/marker/runtime changes

### Scope Guardrails (did NOT over-reach)
- [ ] Did NOT implement `detectAndCreate()` (P2.M1.T1.S2 — the factory does git-detection I/O)
- [ ] Did NOT implement `GitBackend`/`CasBackend` (P2.M2.T1 / P2.M3.T1)
- [ ] Did NOT change the interface signatures to async (GOTCHA #1 — they are sync per the contract; async would ripple into rewind.ts/index.ts)
- [ ] Did NOT import RevertCheckpoint from markers.js (the interface uses opaque string refs; the two types meet in SessionRuntime, not store.ts)
- [ ] Did NOT add a `run()`/`withLock()` helper to AsyncMutex (out of scope; contract specifies `acquire()` only)
- [ ] Did NOT touch `src/markers.ts`, `src/config.ts`, `src/runtime.ts`, `src/snapshot/paths.ts` (all complete siblings/inputs)
- [ ] Did NOT modify any `spec/*.md` or plan files

---

## Anti-Patterns to Avoid

- ❌ Don't make the interface methods async (`Promise<string | null>`) — the contract is SYNCHRONOUS (spec/14 §2 + work-item). The AsyncMutex is a SEPARATELY-EXPORTED utility the backends opt into; the interface is a pure type decoupled from it (GOTCHA #1).
- ❌ Don't implement the mutex with a boolean flag (`locked = true/false`) — that cannot serialize ASYNC bodies (a flag flip + an await lets a sibling slip in). Use the promise-chain (`_tail` reassignment + `prev.then(() => release)`) — GOTCHA #4.
- ❌ Don't resolve all waiters at once (a shared `resolveAll()` queue) — that breaks mutual exclusion. Each caller must chain onto the PREVIOUS holder's release-promise individually.
- ❌ Don't add ANY `import` to store.ts — it is pure TS types + a promise chain (GOTCHA #2). RevertCheckpoint is an INPUT the interface is informed by, NOT an import (opaque string refs).
- ❌ Don't implement `detectAndCreate()` in S1 — it is the NEXT task (P2.M1.T1.S2); it pulls in config + git + cas deps and breaks the import-free purity (GOTCHA #3).
- ❌ Don't conflate the 3-valued `describe().backend` ("git"|"cas"|"none") with the 2-valued `RevertCheckpoint.backend` ("git"|"cas") — they are different unions (GOTCHA #6).
- ❌ Don't drop the `.js` extension on the test import, and don't use `.ts` — ESM + tsc output convention (GOTCHA #7).
- ❌ Don't skip the `maxActive === 1` OR the FIFO assertion in the mutex test — both are required to prove correct serialization (overlap test catches a flag-based bug; FIFO test catches a resolve-all bug).
- ❌ Don't write the mutex test without a `microDelay()`/yield — without yielding the event loop, a sync test body holds the lock across no await and the overlap cannot be observed (false green).
- ❌ Don't run `ruff`/`mypy`/`eslint`/`uv` — this is a TypeScript project; those are no-ops. The gates are `npm run typecheck` + `npm test`.

---

## Confidence Score: 9/10

**Why 9, not 10:** The task is small, fully-specified, and import-free — four verbatim shapes (interface + 2 type-interfaces + a promise-chain class) in a NEW file, plus a focused mutex-serialization test. Every signature/field is normative (spec/14 §2 + the work-item contract), the algorithm is a textbook promise-chain mutex, and the test pattern (vitest `describe/it/expect/expectTypeOf`, flat location, `.js` imports) is directly mirrored from the sibling `test/paths.test.ts`. The only residual risk is a subtle mutex-algorithm bug (e.g. resolving all waiters at once, or a microtask-ordering quirk in the FIFO test) — mitigated by asserting BOTH `maxActive === 1` AND the exact start/end interleaving, and by the `microDelay()` yield that makes the overlap observable. The sync-interface/async-mutex decoupling (GOTCHA #1) is the one place an agent might "helpfully" make the interface async and break the contract; the PRP flags it loudly with an ❌ anti-pattern + a grep gate + an expectTypeOf assertion pinning the sync return.

**Parallel-execution / dependency note:** This PRP consumes (does not import) the `RevertCheckpoint` type from the just-complete P1.M2.T2.S1 (markers.ts) and the `config.revert.*` block from P1.M1.T1.S1 (config.ts) — both are INPUTS that inform store.ts's method/type JSDoc; store.ts imports NEITHER (opaque string refs + zero-import purity). It touches a brand-new file (`src/snapshot/store.ts` + `test/store.test.ts`), so there is NO merge conflict with any in-flight sibling. The DOWNSTREAM consumers are git.ts (P2.M2.T1), cas.ts (P2.M3.T1), rewind.ts (P4.M2.T1), index.ts (P3.M1.T2), and the factory `detectAndCreate` is added to THIS SAME file by the immediately-following task P2.M1.T1.S2 — so leave the four exports cleanly placed at the top of store.ts for S2 to append below.