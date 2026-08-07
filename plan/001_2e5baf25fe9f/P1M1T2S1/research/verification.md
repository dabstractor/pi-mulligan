# Research Notes — P1.M1.T2.S1: Define MulliganConfig + DEFAULT_CONFIG

## Task nature
This is a **pure TypeScript type + constant definition** subtask. It creates `src/config.ts`
containing ONLY: two type aliases (`Granularity`, `EstimateConfidence`), one interface
(`MulliganConfig`, with Mode-A JSDoc), and one runtime constant (`DEFAULT_CONFIG`). It does **not**
implement `getConfig()` (that is **S2**), does **not** read Pi settings, and has **ZERO runtime
dependency** on `@earendil-works/pi-coding-agent` (the types are module-local). The primary
validation gate is therefore deterministic: `npx tsc --noEmit -p tsconfig.json` exits 0.

## Authoritative sources (all read first-hand)
| Source | What it pins |
|---|---|
| `spec/09-configuration.md` §2 | The authoritative schema + defaults (JSONC block). |
| `spec/09-configuration.md` §3 | Per-knob rationale (drives JSDoc wording). |
| `spec/09-configuration.md` §4 | Validation rules (S2's job, but confirms field types/shapes). |
| `spec/04-data-model.md` §7 | Co-located TS interface `MulliganConfig` (summary form). |
| `spec/04-data-model.md` §3 | `RewindMarker.granularity: "last_tool_call_group" \| "last_turn"` (narrower, 2 values). |
| `spec/05-tools.md` §1 | `RewindParams.granularity` schema = 3-value union incl. `"checkpoint"`. |
| `spec/12-glossary.md` line 18 | "Granularity — last_tool_call_group, last_turn, or checkpoint" (3 values). |
| Item description | Resolves the `protectedRoles` ambiguity → `["first:user","latest:user"]`; pins the 3-value Granularity and 3-value EstimateConfidence. |

## The exact DEFAULT_CONFIG (derived from spec/09 §2, the authoritative config source)
```
enabled: true
rewind.enabled: true
rewind.protectedRoles: ["first:user", "latest:user"]
rewind.maxDepth: 5
rewind.requireMutationWarning: true
shrink.enabled: true            // NOTE: shrink.autoOnBloat is RESERVED, NOT v1
nudges.bloatReminder: true
nudges.perTurnDrift: true
nudges.bloatThresholdBytes: 8192
nudges.driftThresholdTokens: 3000
audit.estimateConfidence: "medium"
log.file: null
```

## Granularity type — 3 values (NOT 2)
- Item description: `'last_tool_call_group' | 'last_turn' | 'checkpoint'`.
- Glossary (spec/12 §18): the unit a rewind targets = all three.
- Tool schema (spec/05 §1 RewindParams): 3-value union.
- Persisted `RewindMarker.granularity` (spec/04 §3) is NARROWER (2 values, no checkpoint —
  checkpoints are resolved differently, never stored as a rewind granularity). That narrower type
  belongs to markers.ts (P1.M4.T1), where it can be written as
  `Exclude<Granularity, "checkpoint">`. **This subtask exports the full 3-value `Granularity`
  (the tool-facing superset) as the single source of truth.**

## EstimateConfidence type — 3 values
- `spec/09 §2` audit.estimateConfidence default = `"medium"`.
- `spec/04 §7` audit.estimateConfidence: `"low" | "medium" | "high"`.
- Consumed in THIS file by `MulliganConfig.audit.estimateConfidence: EstimateConfidence`.

## Completeness cross-check (grep across ALL 12 spec docs)
`grep -rnoE "config\.[a-zA-Z.]+" spec/*.md` → every downstream `config.*` reference resolves to a
spec/09 §2 field EXCEPT ONE:
- `config.shrink.autoOnBloat` (spec/07 line 61) → **explicitly "not in v1"** ("Auto-shrink is a
  future opt-in mode (config.shrink.autoOnBloat, **not in v1**)").

**Conclusion: the interface is COMPLETE for v1. Do NOT add `autoOnBloat`.** Top-level keys are
exactly: `enabled, rewind, shrink, nudges, audit, log` — confirmed by grepping the spec/09 §2 JSONC.
No field referenced anywhere in spec/04–08 is missing from the §2 schema.

## protectedRoles discrepancy — RESOLVED
- `spec/04 §7` comment says default `["user" (first), "user" (latest)]` (loose prose).
- `spec/09 §2` JSONC says default `["first:user", "latest:user"]` (authoritative, exact strings).
- Item description says `protectedRoles:['first:user','latest:user']`.
- **Decision: DEFAULT_CONFIG.rewind.protectedRoles = `["first:user", "latest:user"]`.** (spec/09 §2
  is the authoritative config source; the §7 comment is illustrative prose about the *roles* those
  selectors denote.) spec/09 §4 confirms the known selectors are exactly `"first:user"` and
  `"latest:user"`.

## Pi `Settings` type — closed interface (S2 concern, not S1 — but recorded)
Read `node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.d.ts`:
- `export interface Settings { ... }` is a **fixed, closed interface with NO index signature**.
- It does NOT list a `mulligan` key.
- `ExtensionContext` (api_verification.md §3.1) has NO `getSettings()`/`settings` accessor — only
  `sessionManager`, `model`, `getContextUsage()`, etc.

**Implication for S1 (this subtask): NONE.** S1 only defines MulliganConfig + DEFAULT_CONFIG; it does
not read Pi settings. **Implication for S2:** `getConfig()` will read `settings.mulligan` via an
`unknown`/`Partial<MulliganConfig>` cast (e.g. `(settings as any).mulligan as
Partial<MulliganConfig>`) since Pi's Settings type cannot be augmented cleanly. This is recorded
here so the S1 PRP can note the interface must be JSON-serializable & that the default must merge
against an arbitrary `unknown` input — but S1 itself stays clean.

## Type-assignability of DEFAULT_CONFIG
`DEFAULT_CONFIG` should be declared `export const DEFAULT_CONFIG: MulliganConfig = { ... }`.
- Explicit annotation makes `tsc` VERIFY the literal matches the interface (catches typos / wrong
  defaults at compile time — a strong, deterministic gate).
- Do NOT use `as const` alone: it narrows field types (e.g. `maxDepth: 5` literal) which would NOT
  be assignable to `MulliganConfig` (`maxDepth: number`). Plain `: MulliganConfig` annotation is
  correct and matches the spec interface (non-readonly fields).

## Immutability (forward-looking note for S2)
`DEFAULT_CONFIG` is a module singleton. S2's `getConfig()` must NOT hand out references to it or to
its nested objects directly when merging user overrides, or a caller could mutate the shared default.
S2 should deep-clone (`structuredClone` or per-field spread) before merging. S1 need not freeze, but
JSDoc on DEFAULT_CONFIG should mark it "constant; do not mutate — getConfig returns a merged copy."

## Validation gates (verified executable in this env)
- `npx tsc --noEmit -p tsconfig.json` → exit 0 (deterministic, no model). This is the primary gate.
  (With S1's scaffold + S2's stub, `src/` is non-empty, so TS18003 is gone — adding config.ts keeps
  the gate green.)
- Optional `vitest run` test asserting DEFAULT_CONFIG deep-equals the spec defaults (locks against
  default drift; S2 will EXTEND the same `test/config.test.ts` with getConfig tests).
- `pi -e ./src/index.ts -p "hi"` still exits 0 (config.ts is not imported by the stub yet, so this
  is a no-op regression check — optional).

## Files touched
- CREATE `src/config.ts` (the ONE contract deliverable).
- OPTIONAL/RECOMMENDED `test/config.test.ts` (default-shape regression test; S2 extends it).
- No changes to index.ts, package.json, tsconfig.json, or anything in plan/ or spec/.