# Validation Report — pi-mulligan (P2 "Per-Tool Bloat Threshold" changeset)

**Validator scope:** Deep analysis of the P2 changeset described in the PRD (per-tool
`bloatThresholdBytesByTool`, global default raise to 16384, and the three bug-hunt findings
BUG-001/002/003), end-to-end validation against the shipped code, and a sweep for any *new*
issues not covered by the PRD.

**Date:** 2025-08-08
**Head commit:** `818193df` — "Add doc-sweep PRP and mark bugfix 002 tasks complete"
**Working tree:** clean (`git status` — nothing to commit)

---

## Executive Summary

| Dimension | Result |
|---|---|
| `tsc --noEmit` (strict) | ✅ clean |
| Unit tests (vitest) | ✅ **743 / 743** passed (18 files) |
| Integration smoke | ✅ **14 / 14** scenarios passed |
| Smoke idempotency (back-to-back run #2) | ✅ **14 / 14** passed |
| Per-tool bloat regression (real handler) | ✅ read/bash/grep thresholds + BUG-001 prototype keys |
| PRD bugs (BUG-001 / BUG-002 / BUG-003) | ✅ **all three FIXED and verified** |
| New issues found | ✅ **none** |

**Verdict: PASS — zero issues.** Every bug the PRD describes has already been fixed (commits
`02e3fb1c`, `b4ec887e`, `de7e0f48`, `53ed95dd`), the fix is correct at the unit *and*
end-to-end level, and a comprehensive sweep for new defects found nothing actionable.

---

## Validation Method

### Step 0 — Real user workflows
Read `README.md` (Usage / Quickstart / How-It-Works / the 12-knob config table + JSON
example), `test/integration/scenarios.md` (the 9 `F-*` + 5 `E*` integration scenarios — the
authoritative integration playbook), and `VERIFICATION.md` (prior verification pass). The
product is a **Pi coding-agent extension** (`pi -e ./src/index.ts`) that provides four
agent-callable tools (`mulligan_rewind` / `mulligan_shrink` / `mulligan_checkpoint` /
`mulligan_audit`) plus three event-driven handlers (context filter, bloat reminder Nudge A,
per-turn drift Nudge B). The P2 changeset is confined to the bloat-reminder subsystem.

### Step 1 — Deep codebase analysis
Inspected the full `src/` tree (`config.ts`, `nudges.ts`, `tools/audit.ts`, `index.ts`,
…), the `test/` tree, the `spec/` omnibus (01–12), and `package.json`. Confirmed the
project's quality surface is: strict `tsc --noEmit`, `vitest run`, and the custom
`npm run smoke` harness. **No linter / formatter is configured** (no eslint/biome/prettier,
no config files) — `tsc` strict is the static-analysis gate; `validate.sh` records Phases 1
& 3 as N/A for honesty.

### Step 2–3 — Validation script + execution
`./validate.sh` runs 6 phases: type-check, unit tests, smoke (run #1), smoke idempotency
(run #2), and a targeted per-tool bloat regression that drives the **real**
`bloatReminderHandler` with DEFAULT config across `read`/`bash`/`grep`/prototype-colliding
tool names. **All phases PASS** (exit 0).

---

## Verification of each PRD-described bug (all FIXED)

The PRD documents three *minor* findings. None remain in the code.

### BUG-001 — `bloatThresholdFor` leaks `Object.prototype` members → NaN threshold, always-fires reminder
**Status: ✅ FIXED** (commit `02e3fb1c`). `src/nudges.ts:91–94` now reads:

```ts
export function bloatThresholdFor(toolName: string | undefined, config: MulliganConfig): number {
  const global = config.nudges.bloatThresholdBytes;
  if (!toolName) return global;
  const byTool = config.nudges.bloatThresholdBytesByTool ?? {};
  return Object.prototype.hasOwnProperty.call(byTool, toolName) ? byTool[toolName] : global;
}
```

The `Object.prototype.hasOwnProperty.call` own-property guard (rather than the bare
`byTool[toolName] ?? global`) means a tool whose name collides with a prototype member
correctly resolves to the global threshold. **Verified directly** (temp script,
`bloatThresholdFor('constructor'|'toString'|'valueOf'|'hasOwnProperty'|'isPrototypeOf'|'toLocaleString'|'__proto__', getConfig())`
→ `type=number finite=true value=16384` for all seven — previously these returned the
inherited function). The same fix transitively covers `src/tools/audit.ts` (which calls
`bloatThresholdFor` per-row at line 528), so the audit can no longer render
`(threshold NaN KB)`. An end-to-end regression through the real `bloatReminderHandler`
confirms a 1 KB result from `constructor` does **not** fire the reminder (it resolves to a
finite 16384, under threshold → pass-through). A dedicated unit test
(`test/nudges.test.ts:185`) locks in the own-property semantics.

### BUG-002 — Stale data-model config schema in `spec/04-data-model.md`
**Status: ✅ FIXED** (commit `b4ec887e`). `spec/04-data-model.md:243` now reads:

```
bloatThresholdBytes: number;     // default 16384 (in-context bytes of a single result; 16 KB)
bloatThresholdBytesByTool?: Record<string, number>; // per-tool overrides; default { bash: 32768, read: 20480 }
```

Consistent with `src/config.ts` (`DEFAULT_CONFIG`: 16384 + `{ bash: 32768, read: 20480 }`),
`spec/07:52`, and `spec/09:66`.

### BUG-003 — Stale "8 KB" prose in `spec/10-testing.md` and `spec/01-pi-context-internals.md`
**Status: ✅ FIXED** (commits `de7e0f48` + `53ed95dd`).
- `spec/10-testing.md:67` — the F-shrink-preventive row now reads
  `tool_result hook annotates a >16KB result` (was `>8KB`).
- `spec/01-pi-context-internals.md:197` — the rationale now reads
  `(e.g. 16 KB in-context)` (was `8 KB`).

---

## Sweep for NEW issues (none found)

A deliberate pass beyond the PRD found no actionable defect. Findings recorded below as
"investigated + cleared" so the reasoning is auditable:

1. **Per-tool resolution bypass check — CLEAR.** The PRD claims "no code bypasses per-tool
   resolution." Confirmed: every direct `bloatThresholdBytes` read in `src/` is either the
   interface field definition, `validateConfig`'s coercion, the global fallback *inside*
   `bloatThresholdFor`, or a JSDoc comment. The two runtime consumers
   (`bloatReminderHandler` and the audit's per-row flagging) both go through
   `bloatThresholdFor`.

2. **Merge-semantics correctness — CLEAR.** `coerceBloatThresholdByTool`
   (`src/config.ts`) spreads the fallback map then merges user entries, so partial
   overrides preserve unmentioned defaults, invalid entries are dropped + warned, and a
   non-record value reverts to the default map. All four behaviors are unit-tested
   (`test/config.test.ts:106–132`).

3. **Repo-wide "8 KB"/`8192` sweep — CLEAR.** Every remaining occurrence is legitimate:
   intentional historical rationale ("raised from 8 KB") in spec/07 + spec/09; pure
   byte→token math examples (`8 KB ≈ 2k tokens`) in `tokens.ts`/`notes.ts`; pure
   render-test mock input (`thresholdBytes: 8192` passed to the pure `renderAuditReport`/
   `renderBloatReminder` formatters in `test/notes.test.ts` + `test/tools/audit.test.ts` —
   these test the formatter with arbitrary values, *not* the default config). No stale
   default survives in any shipped source or spec.

4. **README config table — CLEAR.** The 12-knob table, the JSON example, and the
   How-It-Works bloat bullet all show `bloatThresholdBytes: 16384` +
   `bloatThresholdBytesByTool: { "bash": 32768, "read": 20480 }`, matching `DEFAULT_CONFIG`.

5. **Untracked stale artifacts — NOT an issue.** `.pi-subagents/artifacts/*` contain a
   stale `bloatThresholdBytes: 8192` in cached subagent output, but these files are
   **not tracked by git** (`git ls-files .pi-subagents/` → 0) and are transient
   regenerable cache, not shipped product.

6. **Smoke idempotency — CLEAR.** A prior verification pass documented an
   F-protected flake from reused `--session-id`s; this is fixed in `run-smoke.mjs`
   (run-scoped `RUN_ID = process.pid-<ts>` per invocation). Back-to-back
   `npm run smoke` both yield **14/14**.

7. **No unfinished work in the bloat/config/nudge area** — no `TODO`/`FIXME`/`XXX` markers
   in `src/` touch this surface.

---

## E2E / workflow confidence

The per-tool bloat subsystem was exercised end-to-end through the **real**
`bloatReminderHandler` with shipped `DEFAULT_CONFIG`:

| tool | result size | resolved threshold | reminder |
|---|---|---|---|
| `read` | 18 KB | 20 KB | does not fire ✅ |
| `read` | 21 KB | 20 KB | fires ✅ |
| `bash` | 30 KB | 32 KB | does not fire ✅ |
| `bash` | 33 KB | 32 KB | fires ✅ |
| `grep` | 15 KB | 16 KB (global) | does not fire ✅ |
| `grep` | 17 KB | 16 KB (global) | fires ✅ |
| `constructor` | 1 KB | 16 KB (global, BUG-001) | does not fire ✅ |

Per-tool resolution behaves exactly as specified in PRD §7, and the BUG-001 fix holds
through the live handler (no `NaN`, no always-fires). Combined with the 14/14 deterministic
smoke scenarios (which drive the real `pi` process + real session JSONL for rewind/shrink/
checkpoint/audit/nudge/reload/fail-open), the product behaves correctly under realistic
user workflows.

---

## Recommendations

No fixes required. For ongoing health only (not validation findings):
- The project has **no linter/formatter**; adopting one is optional polish (out of scope for
  this changeset and not a defect).
- A future iteration could add an *integration*-tier test asserting `bloatHit:true` for a
  real non-`mulligan_*` tool result — the deterministic smoke harness notes this is
  currently unprovable inside the harness (a `mulligan_*` tool is skipped by design), so it
  is covered by the unit tier + the per-tool regression above instead.

---

## Bug Tracker

| ID | Severity | Status | Summary |
|---|---|---|---|
| — | — | — | No open issues. All PRD findings (BUG-001/002/003) are fixed & verified; no new issues found. |

**Total open issues: 0** (critical 0, major 0, minor 0).