# P4.M1.T3.S1 — Research Findings (verified against HEAD, tests green: 866 passing)

This is a **TEST-ONLY** work item. Inputs are the implemented guards from P4.M1.T2.S1 (retry budget)
+ P4.M1.T2.S2 (context-fraction) + config knobs from P4.M1.T1.S1. Output: new tests in
`test/tools/rewind.test.ts` + `test/config.test.ts` + a note in `test/integration/scenarios.md`.

---

## 1. The two guards under test (src/tools/rewind.ts — DO NOT modify, only test)

### Guard order in `rewindExecute` (FIRST refusal wins):
(1) E14 master-disabled → (2) rewind.enabled → (3) E9 note validation → (3') checkpoint name+E10 →
(4) E4 maxDepth (`countRewindMarkers`) → **(4b) retry budget** (`countRetriesAtLatestPrompt`) →
**(4c) context-fraction** (`computeFilteredTotal`) → (5) read-only preview → … → success.

### (4b) `countRetriesAtLatestPrompt(ctx)` — verified logic:
- Scans `ctx.sessionManager.getEntries()`. `Array.isArray` guard. Defensive: try/catch → returns **0**.
- Finds INDEX of the LAST entry where `type === "message" && message.role === "user"` (−1 if none → return 0).
- Counts entries at `i > latestPromptIndex` where `type === "custom" && customType === "mulligan:rewind"`.
- Guard: `if (count >= config.rewind.maxRetriesPerPrompt) return refusal(...)`.
- **Does NOT inspect `hideEntryIds`** → a zero-hide rewind marker counts the same as any other. (basis for test b)
- **OVER-APPROXIMATION**: also counts `last_tool_call_group`/`checkpoint` rewind markers appended this turn
  whose target was a prior turn — acceptable (the PRD explicitly wants those counted).

### (4c) context-fraction — verified logic:
- `const { totalTokens, windowTokens } = computeFilteredTotal(ctx);`
- `if (windowTokens > 0 && totalTokens / windowTokens >= config.rewind.abortContextFraction) return refusal(...)`
- `windowTokens > 0` IS the fail-open (no model / undefined / throwing → SKIP the guard). (basis for test f)

### EXACT refusal reason strings (assert these substrings):
- **retry budget**: `hit the per-prompt retry budget (${retries}/${config.rewind.maxRetriesPerPrompt} rewinds re-landing at this prompt). Commit to the current state, ask the human, or use mulligan_shrink instead of rewinding again`
  → after `refusal()` wrapper: `Mulligan: refused — hit the per-prompt retry budget (3/3 rewinds re-landing at this prompt)...`
  → assert substrings: `"per-prompt retry budget"` AND `"3/3"`.
- **context-fraction**: `context is at ${pct}% of the window; rewinding will not help. Run mulligan_audit and shrink the largest result`
  (pct = `Math.round(totalTokens / windowTokens * 100)`)
  → assert substrings: `"context is at"` AND `"% of the window"`.

`refusal(reason, gran)` returns `{content:[{type:"text", text:`Mulligan: refused — ${reason}.`}], details:{granularity}}`.
So callers pass the BARE reason (no prefix, no trailing dot). The text block is always `type:"text"` (E13).

---

## 2. `computeFilteredTotal(ctx)` — src/tools/audit.ts (EXPORTED, shared with rewind)
```ts
export function computeFilteredTotal(ctx): { totalTokens, windowTokens } {
  try {
    const rt = getRuntime(ctx.sessionManager.getSessionId());
    const filtered = Array.isArray(rt.lastFiltered) ? rt.lastFiltered
                                                   : entriesToMessages(ctx.sessionManager.buildContextEntries());
    const totalTokens = estimateTokens(filtered).tokens;
    const usage = ctx.getContextUsage?.();                 // <-- reads ctx.getContextUsage() (NOT sessionManager)
    const windowTokens = usage?.contextWindow ?? 0;        // D5: .contextWindow (SIZE) permitted
    return { totalTokens, windowTokens };
  } catch { return { totalTokens: 0, windowTokens: 0 }; }  // fail-open sentinel → guard SKIPS
}
```
**For test (e)**: `windowTokens` comes from `ctx.getContextUsage().contextWindow`; `totalTokens` from
`rt.lastFiltered` (preferred) else `buildContextEntries()`. So test (e) must:
  1. ADD a `contextUsage:{contextWindow:N}` opt to `makeCtx` that attaches `getContextUsage` to the **ctx** object.
  2. Either set `getRuntime("s1").lastFiltered = [<big message array>]` OR seed `contextEntries`/buildContextEntries.
  Setting `rt.lastFiltered` is the PRIMARY path and matches how drift_nudge/filter tests drive token math.

---

## 3. test/tools/rewind.test.ts — fakes & helpers (verified)

### `makePi(opts)` → `{appended, sent, labels, pi}`. opts: `throwOnAppend/throwOnSendMessage/throwOnSetLabel`.
`appended` captures `{customType,data}` per `appendEntry`. **Refusals → `appended.length === 0`** (no marker persisted).

### `makeCtx(opts)` — THE function test (e) must EXTEND (verified lines 104–143):
Current opts: `sessionId?, leafId?, entries?, branch?, contextEntries?, throwOnGetEntries?, throwOnGetBranch?, throwOnBuildContext?, throwOnGetLeafId?`.
Builds `sessionManager = {getSessionId, getLeafId, getEntries, getBranch, buildContextEntries}`.
Returns `{ ctx: { sessionManager } as unknown as ExtensionContext }`.
**Does NOT currently script `getContextUsage`** → add `contextUsage?: { contextWindow: number }` opt that attaches
`getContextUsage: () => contextUsage` to the **ctx** object (alongside `sessionManager`), NOT to sessionManager.

### `run(pi, ctx, params, toolCallId="call-1")` → `makeRewindTool(pi).execute(toolCallId, params, undefined, undefined, ctx)`.
### `firstText(res)` → the first content block's `.text` (narrows `type==="text"` first).
### Entry helpers:
- `rewindEntry(seq=1)` → `{type:"custom", customType:"mulligan:rewind", data:{seq}}` ← what countRetriesAtLatestPrompt counts.
- `msgEntry(message)` → `{type:"message", id:"e-<rand>", message}`; `msgEntryId(id,message)` → deterministic id.
- `user(text)` → `{role:"user", content:text}` (content is a STRING, not an array). Use `msgEntry(user("..."))`.
- `asst(...callIds)`, `result(toolCallId)`, `asstWrite/asstBash`, `checkpointLabelEntry(name,targetId)`.
### `VALID_NOTE` (const, line 51) — the 4 valid note fields.
### beforeEach/afterEach: `clearAll()` + `setConfig(undefined)` (cache-poisoning guard, ~line 39).
  → For tests (a)–(e), call `setConfig({rewind:{...}})` at the START of each `it` to set the specific knobs.

### Existing describe blocks (DO NOT duplicate): registration metadata; refusal config-disabled(E14);
refusal invalid-note(E9); refusal checkpoint-existence(E10); depth-guard(E4); success persisted-contract;
checkpoint success; success text K/K=0; mutation warning(E5); best-effort ledger(E8/E13); leaveNote rewindId;
never-throws(E13); result-shape; types; renderNote; hideEntryIds capture.
**`getRuntime` is NOT yet imported** in this file — add it to the existing `import { clearAll } from "../../src/runtime.js";`.

---

## 4. test/config.test.ts — validation patterns (verified)

### Imports: `{DEFAULT_CONFIG, getConfig, setConfig, validateConfig, type MulliganConfig, ...}` from `../src/config.js`.
### `validateConfig(raw)` is PURE — test directly. Absent field → default (NO warn). Invalid → default + 1 `console.warn`.
### Dedicated-describe style to mirror (P3.M2.T1.S1 block, line 233):
```ts
describe("rewind.maxRetriesPerPrompt & rewind.abortContextFraction (P4.M1.T3.S1 / spec/09 §4, spec/08 E22)", () => {
  it("(a) ...", () => { ... });
  it("(b) ...", () => { const warn = vi.spyOn(console, "warn").mockImplementation(()=>{}); try {...} finally {warn.mockRestore();} });
});
```
### DEFAULTS already asserted (lines 20–21, 78): maxRetriesPerPrompt=5, abortContextFraction=0.9.
  → Task (g) adds the VALIDATION-LOGIC tests (defaults already covered, but re-assert explicitly for clarity).

### Verified validation outcomes (the exact assertions for Task g):
| input | maxRetriesPerPrompt | abortContextFraction |
|---|---|---|
| `{rewind:{maxRetriesPerPrompt:3, abortContextFraction:0.8}}` | 3 | 0.8 |
| `{}` (absent) | 5 | 0.9 |
| `abortContextFraction: 0` | — | 0.9 |
| `abortContextFraction: 1.5` | — | 0.9 |
| `abortContextFraction: -0.5` | — | 0.9 |
| `abortContextFraction: NaN` | — | 0.9 |
| `maxRetriesPerPrompt: 0` | 5 | — |
| `maxRetriesPerPrompt: 2.7` | 2 (Math.floor) | — |
| `maxRetriesPerPrompt: "x"` | 5 | — |
| new knobs added; old rewind knobs | unchanged (enabled/protectedRoles/maxDepth=5/requireMutationWarning) | unchanged |

---

## 5. test/integration/scenarios.md — F-maxdepth EXISTS (line 229); F-retrycap / F-abortfraction DO NOT.
Add two short sections mirroring F-maxdepth's format (drive command + pass criteria), marked "deterministic
path documented, not auto-run" (these are Tier-2 integration smoke scenarios; the unit tests in (a)–(g) are
the deterministic coverage). spec/10 §2.1 table already names F-retrycap + F-abortfraction pass criteria.

---

## 6. Risk / gotchas for the implementer
- **makeCtx change is additive + optional**: when `contextUsage` is omitted, no `getContextUsage` is attached →
  `computeFilteredTotal` returns `windowTokens:0` → (4c) skipped (same as today). **No regression** to the 866 existing tests.
- **Guard ordering in test (e)**: to make (4c) fire INSTEAD of (4b), set `maxRetriesPerPrompt` HIGH (e.g. 100) so
  countRetries (which may be ≥0) never hits the budget, AND `abortContextFraction` low (e.g. 0.9) AND ensure
  windowTokens>0 + totalTokens/windowTokens ≥ fraction.
- **Test (e) token sizing**: `estimateTokens` is ~chars/4. To guarantee `totalTokens ≥ 0.9*contextWindow` with
  `contextWindow:10000` (threshold 9000), seed `rt.lastFiltered` with one message whose text is ≥ ~40000 chars
  (oversize generously, e.g. 50000, so the ratio is safely above 0.9 regardless of the exact tokenizer ratio).
- **Test (d)**: import `makeShrinkTool` from `../../src/tools/shrink.js`; mirror `test/tools/shrink.test.ts` for the
  valid shrink call. Shrink does NOT consult the retry budget → it must return a non-refusal result even when the
  rewind budget is exhausted. Keep it minimal (one call, assert non-refusal).
- **Test (f)**: `throwOnGetEntries:true` makes BOTH `countRewindMarkers` and `countRetriesAtLatestPrompt` return 0
  (both defensive) → rewind proceeds past (4b); a throwing `getContextUsage`/`buildContextEntries` makes
  `computeFilteredTotal` return `{0,0}` → (4c) skipped. Assert NO throw + `content:[{type:"text"}]`.