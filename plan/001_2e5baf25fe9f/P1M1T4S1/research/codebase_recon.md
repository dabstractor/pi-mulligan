# Codebase recon — P1.M1.T4.S1 (runtime.ts)

First-hand investigation of the repo state, the spec sources, and the **one decisive
problem** for this task: how to type `SessionRuntime.lastFiltered`.

---

## 1. Baseline (verified live, before any edit)

```bash
npx tsc --noEmit -p tsconfig.json   # exit 0  ✓
npx vitest run                       # config.test.ts green  ✓
```

Current `src/`:
- `src/index.ts` — S2-era no-op stub (`import type { ExtensionAPI }`; `pi.on("session_start", () => {})`).
  **Do NOT touch** — wiring session_start → resetRuntime is **P1.M7.T1**.
- `src/config.ts` — S1+S2 (MulliganConfig, getConfig/setConfig/validateConfig). Pi-free. Read-only here.
- (no `src/log.ts`, no `src/runtime.ts` yet — both are being created in parallel by P1.M1.T3.S1 / this task.)

`test/config.test.ts` establishes the test convention (mirrored by the log.ts PRP):
- vitest; `import { describe, it, expect, expectTypeOf, beforeEach, afterEach, vi } from "vitest";`
- import the module under test as `"../src/<file>.js"` (**`.js`** — required for ESM + `moduleResolution: Bundler`).
- top-level `describe`/`it`; `beforeEach` resets module-level state.

`tsconfig.json`: `strict`, `noImplicitAny`, `target ES2022`, `module ESNext`, `moduleResolution Bundler`,
`types: ["node"]`, `skipLibCheck: true`, `include: ["src","test"]`. No vitest config file → vitest uses
defaults + tsconfig.include.

---

## 2. The SessionRuntime shape — THREE sources, contract wins

| Field | spec/04 §8 (core) | spec/06 §7 (audit cache) | contract (this task) |
|---|---|---|---|
| `sessionId: string` | ✅ | | ✅ |
| `seq: number` | ✅ | | ✅ |
| `tokenBaseline: number \| null` | ✅ | | ✅ |
| `lastTurnIndex: number \| null` | ✅ | | ✅ |
| `lastFiltered: AgentMessage[] \| null` | — | ✅ | ✅ |
| `lastFilterTs: number \| null` | — | ✅ | ✅ |
| `pendingBloatHits: {toolName, approxTokens}[]` | — | — | ✅ |

**Decision:** implement the FULL expanded shape from the **work-item contract**. spec/04 §8 is the minimal
subset; the contract is the authoritative forward-looking definition (the extra fields are consumed by
filter.ts P1.M4.T2.S1, tools/audit.ts P1.M5.T4.S1, and nudges.ts P1.M6.T1.S1). Flag the discrepancy in the PRP
so the implementer doesn't "fix" the shape down to spec/04 §8.

`pendingBloatHits` element shape mirrors `TurnMetric.bloatHits[*]` (spec/04 §5) → export a `BloatHit` interface
for reuse by nudges.ts/markers.ts later.

---

## 3. THE decisive finding: `AgentMessage` is NOT importable

The contract writes `lastFiltered: AgentMessage[] | null`. Investigated whether the real Pi type can be used:

1. **Re-exported from `@earendil-works/pi-coding-agent`?**
   `grep AgentMessage node_modules/@earendil-works/pi-coding-agent/dist/index.d.ts` → **NOT present.**
   (The public entry only re-exports `ExtensionAPI`, `ExtensionContext`, `Tool`, etc.)
2. **Importable from `@earendil-works/pi-agent-core`?**
   - `node_modules/@earendil-works/pi-agent-core` → **NOT hoisted to top level** (transitive dep only).
   - `import type { AgentMessage } from "@earendil-works/pi-agent-core"` under the REAL project tsconfig →
     **`error TS2307: Cannot find module '@earendil-works/pi-agent-core'`** (verified live).
   - The type is defined in `pi-agent-core/dist/.../messages`-ish and imported *internally* by
     `pi-coding-agent/dist/core/messages.ts` (`import type { AgentMessage } from "@earendil-works/pi-agent-core"`),
     but that package is **not a declared dependency of this extension repo** (spec/11 §1.1 only declares
     `@earendil-works/pi-coding-agent` + `typebox`).

**Decision:** runtime.ts must be **foundation-tier and Pi-free** (exactly like `config.ts` and `log.ts`, which
are grouped with it in spec/11 §2 Step 1). It defines a **LOCAL exported `AgentMessage` opaque alias** and uses
it to type `lastFiltered`. Rationale:

- runtime.ts only **stores and returns** message arrays — it **never introspects** message contents. So an
  opaque element type is both sufficient and honest.
- Constraint **C12** (spec/02): "Never cache a sessionManager handle — only primitive values and message
  arrays." A type alias over a record is precisely "message arrays"; no Pi coupling is introduced.
- Keeps runtime.ts a pure, fast, isolated unit-test target with **zero imports**.

Local alias chosen: `export type AgentMessage = Record<string, unknown>;`

**Assignability verified by reasoning (TS structural rules):**
- **Write (filter.ts, P1.M4.T2.S1):** `rt.lastFiltered = event.messages` where `event.messages: PiAgentMessage[]`
  and `rt.lastFiltered: Record<string,unknown>[] | null`. Each `PiAgentMessage` variant is an object type →
  assignable to `Record<string, unknown>` (index signature). ✅ Array covariance → assignable. **No cast needed.**
- **Read (audit.ts, P1.M5.T4.S1):** reading `rt.lastFiltered` back as the real `PiAgentMessage[]` is a
  *narrowing* (supertype → subtype) → needs an explicit cast/assertion in audit.ts. The objects ARE real
  messages; the type is just opaque *here*. Documented for that task.

This is the same "be faithful to the contract's field name while staying foundation-tier Pi-free" trade-off the
log.ts PRP made (it kept `data?: unknown` and held its own `logFile` rather than importing config).

---

## 4. C12 — never cache a sessionManager handle

spec/02 §C12: after session-replacement flows, captured `ctx.sessionManager` handles go stale. Implication:
"the audit and filter code must always read fresh from `ctx.sessionManager.getEntries()` INSIDE the handler on
each invocation — never cache a session handle across turns."

For runtime.ts this means: **the Map stores ONLY the sessionId string + primitive values + message arrays.**
It never holds a `sessionManager` reference. Callers pass the `sessionId` (a primitive string) in; runtime.ts
keys on it. ✅ The module is C12-clean by construction.

`resetRuntime(sessionId)` (called on `session_start`, in index.ts P1.M7.T1) deletes the entry; the next
`getRuntime` creates a fresh one. Stale references to the old object are simply abandoned — exactly the
discipline C12 prescribes.

---

## 5. API surface (verbatim from the work-item contract)

Exported from `src/runtime.ts`:
- `interface SessionRuntime` (the 7-field shape)
- `interface BloatHit { toolName: string; approxTokens: number }` (reusable; mirrors TurnMetric.bloatHits[*])
- `type AgentMessage = Record<string, unknown>` (local opaque alias — see §3)
- `function getRuntime(sessionId: string): SessionRuntime` — existing or fresh (returns live MUTABLE ref)
- `function nextSeq(sessionId: string): number` — **pre-increment** → first call returns 1
- `function resetRuntime(sessionId: string): void` — deletes the entry (no-op if absent; never throws)
- `function clearAll(): void` — wipes the Map (shutdown/reload cleanup; never throws)

Fresh defaults: `{ sessionId, seq:0, tokenBaseline:null, lastTurnIndex:null, lastFiltered:null,
lastFilterTs:null, pendingBloatHits:[] }`.

**Not in scope (later tasks):** the `pi.on("session_start", () => resetRuntime(id))` wiring (P1.M7.T1), and
any logging of runtime events (callers use log.ts themselves). runtime.ts imports **nothing**.

---

## 6. Test plan (mirrors test/config.test.ts + log.ts PRP)

`test/runtime.test.ts`, vitest, `import { … } from "../src/runtime.js"`. Groups:
1. **fresh defaults** — exact shape; idempotent same-ref; per-runtime OWN `pendingBloatHits` array (no sharing).
2. **nextSeq** — first call 1; 1,2,3 monotonic; persists on the live object.
3. **session isolation** — A/B seqs independent; field mutation isolated; distinct objects per id.
4. **resetRuntime** — fresh-after-reset shape; NEW reference (stale abandoned, C12); no-op on absent session;
   only the targeted session reset; nextSeq restarts at 1.
5. **clearAll** — wipes all; no-op when empty.
6. **in-place mutation contract** — filter-style lastFiltered write persists; nudges-style pendingBloatHits push
   + clear; turn_end-style tokenBaseline/lastTurnIndex write persists.
7. **types** — SessionRuntime/BloatHit/AgentMessage exported; field types correct.

`beforeEach`/`afterEach` call `clearAll()` — the Map is module-scoped and NOT reset between tests (same
discipline as config.ts GOTCHA #9 / log.ts GOTCHA #6).

---

## 7. Cross-task boundaries (do NOT collide)

- **P1.M1.T3.S1 (log.ts, in-flight):** creates `src/log.ts`. runtime.ts must NOT import it ("No prior code
  dependencies beyond P1.M1.T1.S1"). Any runtime-event logging is the caller's job. ✅ zero imports.
- **config.ts:** runtime.ts does NOT read config. ✅ zero imports.
- **index.ts:** runtime.ts provides the functions only; the `session_start`→`resetRuntime` and
  `session_shutdown`→`clearAll` wiring is **P1.M7.T1**. Do NOT modify index.ts here.
- **markers.ts/filter.ts/nudges.ts/tools/audit.ts (later):** they are the CONSUMERS of these exports. They read
  markers' seq via nextSeq, write lastFiltered, etc. This task only ships the store.