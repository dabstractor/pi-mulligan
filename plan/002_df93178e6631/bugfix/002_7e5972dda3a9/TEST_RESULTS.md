# Bug Fix Requirements

## Overview
Hunted the P2 (Per-Tool Bloat Threshold) changeset against PRD §6/§7. The core implementation is correct and complete: config.ts raises the global default to 16384 and adds bloatThresholdBytesByTool {bash:32768, read:20480} with merge-semantics coercion (validateConfig never throws, partial overrides preserve unmentioned defaults, invalid entries dropped+warned); nudges.ts exports a pure bloatThresholdFor(toolName, config) helper and wires it into bloatReminderHandler; audit.ts uses the same helper for per-row flagging; README config table, JSON example, and How-It-Works bullet are all updated; smoke.ts comments and the F-shrink-preventive scenario correctly reflect per-tool thresholds. The full suite passes (742/742 tests) and `tsc --noEmit` is clean. No code bypasses per-tool resolution (the only direct bloatThresholdBytes reads are the field definition, validation, the bloatThresholdFor global fallback, and JSDoc). I found 3 real-but-minor issues: (1) a latent prototype-key leak in bloatThresholdFor — a tool named 'constructor'/'toString'/etc. returns the inherited Object.prototype function instead of the global threshold, which makes the reminder fire on every result and render '(threshold NaN KB)' (no built-in Pi tool triggers it, but it is a genuine lookup defect affecting both the nudge handler and the audit tool); and (2)+(3) three companion spec docs (spec/04-data-model.md:243, spec/10-testing.md:67, spec/01-pi-context-internals.md:197) that the per-tool spec sync missed — they still cite the old 8 KB default / old config shape, contradicting the updated spec/07+spec/09 and PRD §7. None are critical or major; all are minor.


## Critical Issues (Must Fix)
Issues that prevent core functionality from working.

None.


## Major Issues (Should Fix)
Issues that significantly impact user experience or functionality.

None.


## Minor Issues (Nice to Fix)
Small improvements or polish items.

### Issue 1: bloatThresholdFor leaks Object.prototype members for tools named 'constructor'/'toString'/etc. (NaN threshold, always-fires reminder)
**Severity**: Minor
**ID**: BUG-001
**Location**: src/nudges.ts:90 (return byTool[toolName] ?? global;); also affects src/tools/audit.ts which calls bloatThresholdFor

**Description**:
The per-tool lookup `byTool[toolName] ?? global` in src/nudges.ts:90 does not guard against inherited Object.prototype properties. For a tool whose name collides with a prototype member (e.g. "constructor", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf", "toLocaleString"), `byTool[toolName]` returns the inherited function instead of `undefined`, so `?? global` does NOT fall back to the global number. bloatThresholdFor then returns a non-number. Downstream consequences (verified by running bloatThresholdFor('constructor', getConfig())): (1) in bloatReminderHandler (src/nudges.ts) the gate `if (bytes < threshold) return;` evaluates `number < function` which is always `false`, so the reminder fires on EVERY result from such a tool regardless of size — defeating the 'advisory nudge' intent and PRD §2.5/§6; (2) renderBloatReminder computes `Math.round(threshold/1024)` = `NaN`, producing a malformed reminder text '... (threshold NaN KB)'; (3) the same defect reaches the audit tool (src/tools/audit.ts uses bloatThresholdFor per-row), so a toolResult message whose toolName is such a string renders '(threshold NaN KB)' in mulligan_audit output. This violates PRD §3 design principle #6 'Honest bookkeeping' (garbage value reported) and the spirit of #4 'Fail open' (produces malformed output rather than failing safe to the global). Real-world impact is low because no built-in Pi tool (read/bash/grep/lsp_*) collides with Object.prototype, but a user-registered custom tool (registerTool) could be named 'constructor', and the defect is a genuine latent lookup bug. Fix: guard with Object.prototype.hasOwnProperty.call(byTool, toolName) before reading the value.

**Steps to Reproduce**:
1. From the repo: `npx tsx -e "import {getConfig} from './src/config.js'; import {bloatThresholdFor} from './src/nudges.js'; const t=bloatThresholdFor('constructor',getConfig()); console.log(typeof t, Number.isFinite(t));"` -> prints 'function false' (returns the Object constructor, not the global 16384). 2. `100 < t` -> false (handler never early-returns, so reminder fires on every result). 3. `Math.round(t/1024)` -> NaN (renders '(threshold NaN KB)'). Same for 'toString', 'valueOf', 'hasOwnProperty'.

### Issue 2: Stale data-model config schema in spec/04-data-model.md still shows bloatThresholdBytes default 8192 and the old nudges shape (no per-tool map)
**Severity**: Minor
**ID**: BUG-002
**Location**: spec/04-data-model.md:243

**Description**:
The P2 spec-doc sync updated spec/07-preventive-and-nudges.md (line 52: 'Default bloatThresholdBytes = 16384' + per-tool resolution) and spec/09-configuration.md (line 66-67: 16384 default + bloatThresholdBytesByTool {bash:32768, read:20480}), but MISSED spec/04-data-model.md. The MulliganConfig schema there (spec/04-data-model.md:243) still reads `bloatThresholdBytes: number; // default 8192 (in-context bytes of a single result)` and its nudges block has NO `bloatThresholdBytesByTool` field at all. Per PRD §0 the companion spec files concatenate into the omnibus specification, so this directly contradicts both the shipped config (src/config.ts:109-110: 16384 + {bash:32768, read:20480}) and PRD §7 ('bloatThresholdBytes = 16384/16 KB, with bash at 32 KB and read at 20 KB out of the box'). git log shows spec/04 was last touched by the 'pinning mechanism' sync, not the per-tool-threshold sync. A developer (or a future build agent) reading the data-model spec would reconstruct the wrong config shape and default.

**Steps to Reproduce**:
Inspect spec/04-data-model.md:243 — the line reads `bloatThresholdBytes: number;     // default 8192 (in-context bytes of a single result)` and the surrounding nudges block omits bloatThresholdBytesByTool. Compare to spec/07:52 / spec/09:66-67 / src/config.ts:109-110 / DEFAULT_CONFIG (16384 + map), which all disagree.

### Issue 3: Stale '8 KB' bloat-threshold prose in spec/10-testing.md and spec/01-pi-context-internals.md after the per-tool raise
**Severity**: Minor
**ID**: BUG-003
**Location**: spec/10-testing.md:67 and spec/01-pi-context-internals.md:197

**Description**:
Two more companion spec docs retained pre-P2 threshold figures that the per-tool sync should have updated (same incomplete-sync root cause as BUG-002). (a) spec/10-testing.md:67 — the F-shrink-preventive scenario table row still says 'tool_result hook annotates a >8KB result'; with per-tool resolution the reminder now fires at 16 KB (global) / 20 KB (read) / 32 KB (bash), so '>8KB' is wrong and the scenario description is misleading. There was a commit 'Fix F-shrink-preventive bloatHit docs (BUG-002)' but this particular line was left stale. (b) spec/01-pi-context-internals.md:197 — the design-rationale sentence still says "Mulligan's bloat threshold should default comfortably below the built-in 50 KB cap (e.g. 8 KB in-context)", presenting 8 KB as the default example, contradicting the actual 16 KB default (+ per-tool map) documented in spec/07/spec/09 and PRD §7. Both are documentation-only and do not affect runtime, but they contradict the shipped behavior and the other (correctly updated) spec files.

**Steps to Reproduce**:
spec/10-testing.md:67 reads '| **F-shrink-preventive** | `tool_result` hook annotates a >8KB result | ...'. spec/01-pi-context-internals.md:197 reads '... (e.g. 8 KB in-context) so it catches meaningful-but-not-catastrophic bloat.' Cross-check against spec/07:52 / spec/09:66 (16 KB + per-tool) — they disagree.

## Testing Summary
- Total bugs found: 3
- Critical: 0
- Major: 0
- Minor: 3

## Recommendations
- Guard the per-tool lookup with Object.prototype.hasOwnProperty.call(byTool, toolName) before reading the value, so inherited prototype members cannot masquerade as a threshold (fixes BUG-001 in both nudges.ts and, transitively, audit.ts).
- Run a repo-wide sweep to bring spec/04-data-model.md:243 (data-model schema), spec/10-testing.md:67 (F-shrink-preventive), and spec/01-pi-context-internals.md:197 (rationale) in line with the already-updated spec/07 and spec/09 (16 KB global + {bash:32768, read:20480} per-tool).
- Consider adding a regression unit test asserting bloatThresholdFor('constructor'|'toString'|'valueOf', config) === global, to lock in the own-property semantics once fixed.
