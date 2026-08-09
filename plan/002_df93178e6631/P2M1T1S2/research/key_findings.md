# Research Notes — P2.M1.T1.S2 (bloatThresholdBytesByTool coercion)

Source files read directly: `src/config.ts`, `test/config.test.ts`, `plan/.../architecture/config_validation_design.md`,
`plan/.../P2M1T1S1/PRP.md` (the parallel S1 contract), `spec/09-configuration.md` §4, `package.json`.

## 1. CRITICAL tsc gotcha — the optional field breaks a literal required-`fallback` signature

S1's contract makes the interface field **optional**: `bloatThresholdBytesByTool?: Record<string, number>;`.
Therefore at the wiring site, `cfg.nudges.bloatThresholdBytesByTool` has TypeScript type
`Record<string, number> | undefined` (NOT a bare `Record<string, number>`).

The item description sketches the coerce signature with a **required** `fallback: Record<string, number>`.
If implemented literally and called as `coerceBloatThresholdByTool(v, cfg.nudges.bloatThresholdBytesByTool)`,
**`npx tsc --noEmit` FAILS**: `Argument of type 'Record<string,number> | undefined' is not assignable to parameter of type 'Record<string, number>'`.

This is invisible at runtime (validateConfig clones DEFAULT_CONFIG which always carries the field), so it
only surfaces as a type error. The architecture-design sketch has the same latent bug.

**Resolution chosen**: make `fallback` **optional with default `{}`**:
```ts
function coerceBloatThresholdByTool(value: unknown, fallback?: Record<string, number>): Record<string, number> { ... }
```
- Type-checks (optional param accepts `| undefined`).
- Preserves merge semantics at runtime (fallback is always the default map from the clone).
- Matches S1's stated philosophy: "callers can read config.nudges.bloatThresholdBytesByTool without a guard".
Use `fallback ?? {}` at both return sites inside the function. This is the #1 thing an implementer must get
right or the S2 type gate fails.

## 2. Merge semantics — confirmed (fallback IS the default map)

validateConfig starts from `structuredClone(DEFAULT_CONFIG)`. So by the time we reach the wiring line,
`cfg.nudges.bloatThresholdBytesByTool` already deep-equals `{ bash: 32768, read: 20480 }` (S1's default).
Passing it as `fallback` and doing `{ ...fallback }` then applying valid user entries gives correct merge:
`{ bash: 99999 }` → `{ bash: 99999, read: 20480 }`. ✅

Invalid-entry case `{ bash: -1, read: 20480 }`: start `{ bash: 32768, read: 20480 }`, bash(-1) dropped+warned
(keeps default 32768), read(20480) valid → `{ bash: 32768, read: 20480 }` + exactly 1 warn. ✅

## 3. spec/09 §4 vs item description — resolved in favor of item/architecture

spec §4 says: "Non-object → discard entirely (use global only)." The item description is more specific:
"Non-object map discarded → **default map used**, one warn emitted." The architecture-design merge model
confirms: on non-record, `return fallback` where fallback = the cloned default map. So "use global only"
is realized as "the default per-tool map stands" (downstream `bloatThresholdFor` in T2.S1 resolves
per-tool → global, so carrying the default map is correct). **Follow the item description + architecture doc.**

## 4. S1/S2 scope boundary — do NOT duplicate S1's literal test edits

The S2 item description lists two updates that S1's PRP **already owns**:
- "Update existing 'validates numbers' test: 8192→16384" → **S1 Task 4** (5 literals).
- "Update existing getConfig/setConfig cache test: setConfig(... -5) expects 16384" → **S1 Task 6**.

Because S2 runs AFTER S1 is merged, those literals are ALREADY `16384` when S2 begins. S2 must NOT re-edit
them (no-op + risk). S2 only ADDS the new coercion tests + the function + the wiring. The S2 gate is
`npx vitest run test/config.test.ts` green; a `grep -n "8192" test/config.test.ts` should return ONLY the
`"8192"` string-input line (no-coercion test), which S1 leaves as-is.

## 5. Pattern reference (in-repo, no external research needed)

`coerceProtectedRoles` (config.ts, module-local, after `coerceNumber`) is the exact analog: collection
coercer, per-entry drop-with-warn, whole-collection fallback+warn on wrong type. Place
`coerceBloatThresholdByTool` immediately after it. Helpers available & reused verbatim: `isRecord`,
`safeGet`, `warnConfig`, `Number.isFinite`, plus spread-merge for the new map logic.

## 6. Validation commands (verified from package.json)

- `npx tsc --noEmit` — type gate (catches gotcha #1).
- `npx vitest run test/config.test.ts` — the S2 gate.
- `npm test` (= `vitest run`) — full suite; EXPECTS downstream RED in nudges/audit/smoke (T2.S2/T2.S3 scope).