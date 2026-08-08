# config.enabled=false no-op analysis (DoD #4 proof)

> Companion to `verification-gates.md` §6. Line-level proof that `config.enabled=false` makes the
> extension a **pure no-op** (no context transform; nudges pass through; rewind+shrink tools refuse
> cleanly), satisfying spec/11 §3 DoD #4. All line numbers verified live against current `src/`.

---

## The master switch gates (every entry point)

| Entry point | File:line | Gate (when `config.enabled === false`) | Effect |
|---|---|---|---|
| `context` handler (the filter) | `src/filter.ts:180` | `if (!config.enabled) return;` | **Pass-through** (void = no `{messages}` → Pi uses the original; C4). Critically returns BEFORE caching `rt.lastFiltered` → the audit cache is NOT polluted with an unfiltered view. |
| `mulligan_rewind` tool | `src/tools/rewind.ts:322` | `if (!config.enabled) return refusal("Mulligan is disabled", granularity);` | **Refusal** text "Mulligan: refused — Mulligan is disabled …" (E14 fix LANDED). No marker persisted. |
| `mulligan_shrink` tool | `src/tools/shrink.ts:235` | `if (!config.enabled) return refusal("Mulligan is disabled");` | **Refusal** (E14 fix LANDED). No marker persisted. |
| `tool_result` bloat nudge (Nudge A) | `src/nudges.ts:98` | `if (!config.enabled || !config.nudges.bloatReminder) return;` | **No-op** — result delivered unchanged (no reminder appended). |
| `turn_end` metric (Nudge B Phase 1) | `src/nudges.ts:176` | `if (!config.enabled || !config.nudges.perTurnDrift) return;` | **No-op** — no turn-metric appended, no baseline rollover. |

**Both gates short-circuit BEFORE any measurement/recording** (nudges.ts GOTCHA #8) — so disabling
the master switch also suppresses the drift nudge even if `perTurnDrift:true`.

---

## Intentionally NON-gated entry points (NOT a bug — do not "fix")

| Entry point | File | Why no gate | Source |
|---|---|---|---|
| `mulligan_audit` tool | `src/tools/audit.ts` (GOTCHA #4, lines 22-23) | Audit is **always-on read-only diagnostics** — it only reads `rt.lastFiltered` + renders; persists nothing, mutates nothing. Disabling diagnostics would hide the very tool you'd use to debug a misbehaving agent. | audit.ts:22-23 |
| `mulligan_checkpoint` tool | `src/tools/checkpoint.ts` (GOTCHA #4, lines 27-28) | A checkpoint is a **harmless label** on the leaf (no transform). spec/09 has NO `checkpoint.enabled` knob. | checkpoint.ts:27-28 |

> **Verification note:** when asserting DoD #4, the no-op claim applies to the 5 gated entry points
> above. Audit + checkpoint being always-on is the INTENDED design (documented in both files). If a
> reviewer flags "audit doesn't check enabled," point them at audit.ts:22-23 GOTCHA #4 — it is
> correct. Do NOT add a gate to audit/checkpoint.

---

## How DoD #4 is verified in v1 (settings-driven disable is v1.1)

**v1 reality:** `src/index.ts:29` calls `setConfig(undefined)` at load → `DEFAULT_CONFIG`
(`enabled:true`). The factory does NOT read real `settings.mulligan` (index.ts:28 comment:
"reading real settings.mulligan is v1.1"). So at runtime, `enabled` is ALWAYS true via Pi settings.

**Therefore DoD #4 ("config.enabled=false → pure no-op") is verified at the UNIT level**, by
directly setting the config cache and asserting each entry point's disabled behavior:

```bash
# The unit tests that prove DoD #4 (run them explicitly as gate (c)):
npx vitest run test/config.test.ts test/filter.test.ts test/tools/rewind.test.ts test/tools/shrink.test.ts
```

| Unit test | File:line | Asserts |
|---|---|---|
| "returns undefined (pass-through) and does NOT cache when config.enabled is false" | `test/filter.test.ts:171` | contextHandler returns undefined + `rt.lastFiltered` untouched |
| enabled:false round-trips through validateConfig | `test/config.test.ts:64-74` | setConfig({enabled:false}) → getConfig().enabled === false |
| E14 refusal path (config-disabled) | `test/tools/rewind.test.ts` (the "4 refusal paths: config-disabled (E14)" per rewind.test.ts:10) | makeRewindTool returns "Mulligan: refused — … disabled" text |
| shrink config-disabled refusal | `test/tools/shrink.test.ts` | makeShrinkTool returns the disabled refusal |

**The verification protocol for gate (c):**
1. `grep -n '!config.enabled\|!cfg.enabled' src/*.ts src/tools/*.ts` → confirm the 5 gates exist
   (filter:180, rewind:322, shrink:235, nudges:98, nudges:176).
2. `grep -rn "Mulligan is disabled" src/tools/` → confirm present in rewind.ts + shrink.ts (E14 LANDED).
3. Run the 4 unit-test files above → all green (the disabled code paths are exercised).
4. (Read-only) confirm audit.ts:22-23 + checkpoint.ts:27-28 GOTCHA #4 explain the intentional no-gate.

If steps 1-3 are green, DoD #4 is MET for v1. (A live `settings.json`-driven disable test is a
v1.1 concern, out of scope — index.ts does not read settings in v1.)