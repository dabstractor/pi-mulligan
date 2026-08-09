# Bug Analysis — Root Causes and Fix Approaches

## BUG-001 (Major): Audit tool bloat threshold inconsistency

### Root Cause
`auditExecute` in `src/tools/audit.ts` uses a single global threshold for all messages:
```ts
const threshold = config.nudges.bloatThresholdBytes;  // line ~520 — GLOBAL ONLY
// ...
bloaty: messageBytes(msg) > threshold,  // line ~529 — single threshold for ALL rows
```
`renderAuditReport` takes a single `thresholdBytes` arg and renders all flagged rows with the same KB:
```ts
const kb = Math.round(args.thresholdBytes / 1024);  // single KB for ALL rows
```

### Fix Approach (3 changes in audit.ts)
1. **Import**: Add `import { bloatThresholdFor } from "../nudges.js";`
2. **AuditRow**: Add `thresholdBytes: number` field (the resolved per-row threshold)
3. **auditExecute**: Resolve per-row threshold via `bloatThresholdFor(readStr(msg, "toolName"), config)`:
   ```ts
   const rows: AuditRow[] = ranked.map(({ tokens, msg }) => {
     const toolName = readStr(msg, "toolName");
     const rowThreshold = bloatThresholdFor(toolName, config);
     return {
       tokens,
       role: readStr(msg, "role") ?? "?",
       label: describeMessage(msg, callLookup),
       bloaty: messageBytes(msg) > rowThreshold,
       thresholdBytes: rowThreshold,
     };
   });
   ```
4. **renderAuditReport**: Remove `thresholdBytes` from args; render each row's KB from `r.thresholdBytes`:
   ```ts
   const flag = r.bloaty ? `  ⚠ above bloat threshold (${Math.round(r.thresholdBytes / 1024)} KB)` : "";
   ```
5. Remove the now-unused `threshold` variable and the `thresholdBytes` pass-through to `renderAuditReport`.

### Test Impact
- **Existing test "flags a toolResult"** (`test/tools/audit.test.ts` section e): uses `toolResult("call-A", "read", kbText(20))` → 20480 bytes = read threshold exactly → NOT > threshold → bloaty=false. **WILL FAIL.** Must update to use a size that exceeds the CORRECT per-tool threshold (e.g., 21 KB read, or 17 KB generic tool).
- **Existing renderAuditReport tests**: pass `thresholdBytes` in args. Must update to remove this arg and add `thresholdBytes` to each AuditRow.
- **New tests needed**: bash 20000B → NOT bloated; bash 40000B → bloated with "(32 KB)"; read 18000B → NOT bloated; read 21000B → bloated with "(20 KB)"; generic tool 17000B → bloated with "(16 KB)".

### Key Consideration: Strict Inequality
The bloat flag uses `>` (strictly greater), matching `bloatReminderHandler`'s `if (bytes < threshold) return;` (i.e., `bytes >= threshold` fires). At exactly `bytes === threshold`, the nudge fires (not `< threshold`) but the audit uses `>` (NOT bloated at exactly threshold). This is the EXISTING convention; the fix preserves it.

---

## BUG-002 (Minor): Broken F-shrink-preventive scenario in scenarios.md

### Root Cause
`test/integration/scenarios.md` lines 147-165:
- Line 148: "the bloat reminder fires on a >8KB tool result" — stale (P2 raised global to 16384, bash to 32768, read to 20480)
- Line 160-164: Model-driven path claims "Call mulligan_smoke_big" triggers the bloat reminder → WRONG because `bloatReminderHandler` SKIPS all `mulligan_*` tools (nudges.ts GOTCHA #3)

### Fix Approach (reframe, not add new tool)
Rewrite the model-driven path description to:
1. Acknowledge that `mulligan_smoke_big` is a `mulligan_*` tool → always skipped by `bloatReminderHandler`
2. Note that bloatHit:true requires a NON-mulligan model tool whose result exceeds its resolved per-tool threshold
3. Either provide an alternative model-driven command (e.g., "Read a large file with the read tool") or mark the path as unachievable in the smoke harness (matching what smoke.ts already documents at lines 14-17, 139-141, 205-211)
4. Update the ">8KB" figure to the correct per-tool thresholds

### File: `test/integration/scenarios.md` (lines ~147-165)

---

## BUG-003 (Minor): Stale spec/05-tools.md audit example and clause

### Root Cause
`spec/05-tools.md` was not updated when P2 introduced per-tool thresholds:
- Line 196: audit example shows `(8 KB)` — old default
- Line 208: clause 4 states "any message above config.nudges.bloatThresholdBytes is flagged" — global-only definition

### Fix Approach
- Line 196: Change `(8 KB)` to a per-tool appropriate value (e.g., `(32 KB)` for a bash result, or show multiple rows with different thresholds)
- Line 208: Update clause to: "any toolResult above its resolved per-tool bloat threshold (via bloatThresholdFor) is flagged"

### File: `spec/05-tools.md` (lines ~196, ~208)

---

## BUG-004 (Minor): Stale "8 KB default" test comments

### Root Cause
After P2 raised the global default from 8192 to 16384, three test comments were left referencing 8192/"8 KB" as "the default." The test CODE is correct (passes 8192 as explicit args to pure helpers), but the COMMENTS are factually wrong.

### Affected Sites
1. `test/tokens.test.ts:334`: `// the default bloatThresholdBytes → ~2k tokens` next to `approxTokens(8192)` — 8192 is no longer the default
2. `test/notes.test.ts:411`: test title "8 KB result at the 8 KB default threshold" — 8 KB is no longer the default
3. `test/notes.test.ts:474`: test title "representative 30 KB read at the 8 KB default threshold" — same

### Note on PRD discrepancy
PRD references "test/notes.ts:474" but the actual file is `test/notes.test.ts:474` (there is no `test/notes.ts`; `src/notes.ts` is the source).

### Fix Approach
Update comments/titles to remove the "default" claim (they test the pure helpers with an explicit 8192 arg, which is valid). Change to language like "8 KB result at an 8 KB threshold" (dropping "default") or "at an explicit 8 KB threshold."

### Files: `test/tokens.test.ts`, `test/notes.test.ts`

---

## Additional Observation (not a hard bug)
`spec/09-configuration.md:77` says: "Non-object → discard entirely (use global only)" for `bloatThresholdBytesByTool`. But `coerceBloatThresholdByTool` returns the DEFAULT MAP `{bash:32768, read:20480}` for non-object input (it falls back to the cloned default). The implementation's invalid→default behavior is consistent with every other config field and is tested. The spec wording should be reconciled but this is low priority.