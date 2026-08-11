# BUG-007 Research: Add getConfig().enabled gate to checkpointExecute

## The bug
`mulligan_checkpoint` (`src/tools/checkpoint.ts`) has NO `config.enabled` gate. The other four tools
(rewind, shrink, audit, cancel) all refuse cleanly when `getConfig().enabled === false` per spec/08 E14
("tools refuse with 'Mulligan is disabled.' The extension is a no-op."). With `enabled:false`, the context
filter is pass-through and the other four tools refuse, yet checkpoint STILL writes a `mulligan:checkpoint:`
label — a mutation by an extension the operator believes is fully disabled.

## Root cause
`checkpointExecute` (checkpoint.ts:96-130) jumps straight to name-format validation; no `getConfig()` call,
no `config.enabled` check. The file header (lines 27-30) explicitly documents this as intentional:
"NO config gate here (GOTCHA #4)". checkpoint.ts does NOT import `getConfig` from `../config.js`.

## The four reference tools' gate pattern (verified by reading each file)

| tool | site | code | emitted text |
|------|------|------|--------------|
| rewind.ts:511 | inside try, step 1 | `if (!config.enabled) return refuse("Mulligan is disabled", granularity);` | `Mulligan: refused — Mulligan is disabled.` |
| shrink.ts:286 | inside try, step 1 | `if (!config.enabled) return refusal("Mulligan is disabled");` | `Mulligan: refused — Mulligan is disabled.` |
| audit.ts:584 | inside try, step 0 | `if (!config.enabled) return refusal("Mulligan is disabled");` | `Mulligan: refused — Mulligan is disabled.` |
| cancel.ts:350 | inside try, step 1 | `if (!getConfig().enabled) return refusal("Mulligan is disabled");` | `Mulligan: refused — Mulligan is disabled.` |

ALL FOUR emit the SAME final string: **`Mulligan: refused — Mulligan is disabled.`** (prefix + reason +
trailing period). The reason passed is always the dotless `"Mulligan is disabled"`; each tool's `refusal()`
helper adds the `"."`. Pinned by `cancel.test.ts:412`:
`expect(firstText(res)).toBe("Mulligan: refused — Mulligan is disabled.");`

Placement in ALL four: gate is the FIRST check inside the execute try block, BEFORE any param validation
(config gate is step 1; param validation is step 2+). So an invalid name still gets the disabled refusal when
the master switch is off (rewind.test.ts:326-331 + shrink.test.ts:213-225 pin this ordering).

## CRITICAL GOTCHA: checkpoint's refusal() helper is dotless (the odd one out)

checkpoint.ts refusal() (lines 84-89):
```ts
function refusal(reason: string, name: string): AgentToolResult<CheckpointDetails> {
  return {
    content: [{ type: "text", text: `Mulligan: refused — ${reason}` }],   // <-- NO trailing "."
    details: { name },
  };
}
```

The other four helpers ALL append a `.`:
- shrink.ts:140 → `text: \`Mulligan: refused — ${reason}.\``
- audit.ts:160 → `text: \`Mulligan: refused — ${reason}.\``
- rewind.ts:179 → `text: \`Mulligan: refused — ${reason}.\``
- cancel.ts:178 → `text: \`Mulligan: refused — ${reason}.\``

So calling checkpoint's existing `refusal("Mulligan is disabled", name)` would produce
`"Mulligan: refused — Mulligan is disabled"` (DOTLESS) — diverging from the other four tools' dotted text.

### Design decision (resolves the architecture-doc vs work-item-contract tension)
- **architecture/system_context.md:197-199** suggests: `refusal("Mulligan is disabled")` (reuse helper).
  Applied to checkpoint's 2-arg helper → `refusal("Mulligan is disabled", name)` → DOTLESS text.
- **work-item contract #3** says: "Match the exact disabled-text pattern used by the other four tools ...
  use the same wording." → requires DOTTED text for byte-parity.

The work-item "match exact text" directive WINS (a reviewer compares the five tools' disabled text). To
achieve byte-parity WITHOUT disturbing checkpoint's refusal() helper (which other callers depend on, and
whose reasons inconsistently include/exclude trailing dots — touching it risks double-periods / scope creep),
**inline the disabled-refusal result** with the exact dotted text. This is a clean 5-line block, zero blast
radius on existing callers/tests, byte-exact parity.

Alternative considered & rejected: updating checkpoint's refusal() to add the dot + stripping the invalid-name
reason's trailing dot. Cleaner long-term but 3 edits + changes unrelated refusal texts → scope creep for a
0.5-point task. Documented as an optional future cleanup, NOT part of this PRP.

## getConfig() / config.ts facts
- `getConfig()` (config.ts): lazy-cached, returns a fresh `structuredClone` on every call (never throws;
  falls back to validated DEFAULT_CONFIG on any error). DEFAULT_CONFIG.enabled === true.
- `setConfig(raw)` (config.ts): validate + cache. `setConfig(undefined)` → DEFAULT_CONFIG (enabled:true).
  Used by tests to simulate disabled: `setConfig({ enabled: false })`.
- checkpoint.ts currently imports only `{ setCheckpoint } from "../markers.js"` — must ADD
  `import { getConfig } from "../config.js";` (note the `.js` ESM extension — GOTCHA #2 convention).

## checkpoint.test.ts structure (the test to ADD)
- Idiom: vitest, hand-rolled `makePi()`/`makeCtx()` fakes (no vi.fn()), `.js` imports, `clearAll()` reset.
- Current global setup: `beforeEach(() => clearAll()); afterEach(() => clearAll());` — does NOT touch config
  (checkpoint had no gate). MUST add `setConfig(undefined)` reset (so a disabled test never bleeds).
- `run(pi, ctx, name)` helper invokes `tool.execute("call-1", { name }, undefined, undefined, ctx)`.
- `firstText(res)` extracts `.content[0].text` with a type guard.
- `makePi()` returns `{ labels, pi }` where `labels` captures setLabel calls. `makeCtx({ branch })` scripts
  `getBranch()`. `branchEndingInMsg(id)` builds a ROOT→LEAF branch ending in a message with the given id.
- Sibling precedent for the disabled test: cancel.test.ts:401-413 (describe + per-describe
  beforeEach/afterEach setConfig + exact-text assertion).

## Header comment to replace (checkpoint.ts:27-30)
Current:
```
 * NO config gate here (GOTCHA #4): there is no `config.checkpoint.enabled` switch (spec/09 has no checkpoint
 * config section); checkpoints are inert labels, there is nothing to disable. This item does NOT modify
 * src/index.ts (wiring is P1.M7.T1.S1).
```
Replace with: gate is now present per E14; checkpoints respect the master switch like all other tools; no
config.checkpoint sub-knob (spec/09 has no checkpoint section) — master switch only (like cancel).

## Scope / parallel-safety
- Files touched: `src/tools/checkpoint.ts` + `test/tools/checkpoint.test.ts` ONLY (architecture doc
  "Files Touched" confirms).
- Parallel sibling P1.M2.T3.S1 edits `src/tools/cancel.ts` + `test/tools/cancel.test.ts` — ZERO file overlap.
  Both run in parallel; full-suite gate validates both.
- OUT OF SCOPE: spec/*, README.md, VERIFICATION.md (P1.M3), src/index.ts, markers.ts, other tools.