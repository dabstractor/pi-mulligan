# Research Notes — P1.M2.T1.S1: Rewrite F-shrink-preventive model-driven path in scenarios.md (BUG-002)

> Documentation-only (Mode A) edit to ONE file: `test/integration/scenarios.md`, F-shrink-preventive
> scenario (lines 146–170). No code, no tests, no build.

## 1. The two defects (verified verbatim)

### Defect (a) — stale threshold, line 148
Current:
```
**Tests:** the bloat reminder fires on a >8KB tool result; a turn-metric with `bloatHit:true` is recorded.
```
Why stale: P2 raised the global default from 8192 → 16384 and added per-tool overrides. ">8KB" no longer
matches any threshold.

### Defect (b) — wrong model-driven claim, lines 159–164
Current:
```
**Run (model-driven — the authoritative bloatHit proof):**
```bash
pi -e ./src/index.ts -e ./test/integration/smoke.ts \
  -p "Call mulligan_smoke_big and tell me what it returned."
```
The >8KB result triggers the `[mulligan]` bloat reminder; the turn-metric records `bloatHit:true`.
```
Why WRONG: `mulligan_smoke_big` is a `mulligan_*` tool → `bloatReminderHandler` SKIPS it → its result
NEVER triggers the bloat reminder and NEVER sets `bloatHit:true`. This contradicts smoke.ts itself.

## 2. Source-of-truth facts (verified directly)

### Per-tool bloat thresholds — `spec/09-configuration.md` (lines 35–38, 66–67) + shipped code
- **Global default:** `16384` bytes = **16 KB** (`nudges.bloatThresholdBytes`)
- **bash:** `32768` bytes = **32 KB**
- **read:** `20480` bytes = **20 KB**
- All other tools → global 16 KB fallback.

### `bloatThresholdFor` — `src/nudges.ts` lines 86–91 (pure resolver)
```ts
export function bloatThresholdFor(toolName, config): number {
  const global = config.nudges.bloatThresholdBytes;   // 16384
  if (!toolName) return global;                        // non-toolResult messages → global
  const byTool = config.nudges.bloatThresholdBytesByTool ?? {};
  return byTool[toolName] ?? global;                   // bash→32768, read→20480, else global
}
```

### The mulligan_* skip — `src/nudges.ts` line 118 (GOTCHA #3)
```ts
if (event.toolName.startsWith("mulligan_")) return; // skip our own tools (GOTCHA #3)
```
→ ANY tool whose name starts with `mulligan_` is skipped BEFORE measurement. `mulligan_smoke_big` matches.

### `bloatReminderHandler` gate logic — `src/nudges.ts` lines 114–124
```ts
if (!config.enabled || !config.nudges.bloatReminder) return;   // GOTCHA #8: both gates first
if (event.toolName.startsWith("mulligan_")) return;            // GOTCHA #3: skip our own tools
const bytes = resultBytes(...);
const threshold = bloatThresholdFor(event.toolName, config);
if (bytes < threshold) return;                                 // under threshold → no record
```
Fires the reminder + pushes a bloat hit ONLY for a non-`mulligan_*` result whose size ≥ threshold.

### smoke.ts documents this EXACTLY (the harness's own source of truth for the scenario)
- **Lines 14–17** (factory header): "`bloatReminderHandler` SKIPS `mulligan_*` tools (src/nudges.ts
  GOTCHA #3), so this tool never triggers the bloat reminder regardless of size; its role is as a shrink
  target (RESULT_CANARY). New defaults: global bloatThresholdBytes=16384, bloatThresholdBytesByTool=
  {bash:32768, read:20480}."
- **Lines 139–141** (bigResult() comment): "`mulligan_smoke_big` is a `mulligan_*` tool →
  `bloatReminderHandler` SKIPS it (src/nudges.ts GOTCHA #3), so size never triggers the reminder.
  Defaults now: global 16384; per-tool bash 32768, read 20480."
- **Lines 204–211** (F-shrink-preventive command case): "The bloat reminder fires on the `tool_result`
  EVENT when a NON-`mulligan_*` result exceeds its resolved threshold (global 16384; per-tool bash 32768,
  read 20480). `mulligan_smoke_big` is a `mulligan_*` tool → `bloatReminderHandler` SKIPS it → it can NEVER
  fire here… A real bloatHit:true proof would require a NON-`mulligan_*` tool whose result exceeds its
  resolved threshold (bash >32768, read >20480, other >16384) — model-driven; see scenarios.md."

### Deterministic path (lines 150–157) is CORRECT — preserve it
The deterministic block already correctly states: "the deterministic path cannot trigger the bloat reminder
(a local `bigResult()` call does not go through Pi's `tool_result` event, so Mulligan's
`bloatReminderHandler` never sees it). It asserts only that a turn-metric exists." Keep as-is.

## 3. Cross-references for the PRP
- `plan/.../architecture/bug_analysis.md` BUG-002 — root cause + fix approach (reframe, not new tool).
- `plan/.../P1M1T2S1/PRP.md` — parallel spec/05 edit; cites same thresholds (32/20/16 KB). No file conflict
  (this PRP touches only `test/integration/scenarios.md`).
- PRD h2.5 recommendation: "rewrite the F-shrink-preventive model-driven path — either register a
  NON-mulligan tool that returns a >threshold result, OR reframe the scenario to acknowledge bloatHit:true
  is only achievable via a real model tool call (as smoke.ts already documents)."

## 4. Decision: reframe (primary) + illustrative alternative command
The harness registers NO non-mulligan tool that can produce a >threshold result, and the test environment
does not guarantee a >20 KB file exists. Therefore the most accurate, smoke.ts-consistent fix is to
**reframe** the model-driven path to honestly state bloatHit:true is unprovable in this harness, while
illustrating what a genuine proof requires (a non-`mulligan_*` tool call exceeding its per-tool threshold).
This matches smoke.ts lines 14–17 / 205–211 verbatim in spirit and wording.

## 5. Scope discipline (do NOT touch)
- spec/05-tools.md, spec/07, spec/09 → other subtasks / read-only.
- src/*, test/*.test.ts, test/integration/smoke.ts → code, owned elsewhere / out of scope.
- Other scenarios in scenarios.md (F-rewind-core, F-shrink-persist, F-nudge-drift, E7/E11/E12/E15/E20).
- This PRP edits ONLY `test/integration/scenarios.md`, lines ~148, ~159–164, and (consistency) ~170.