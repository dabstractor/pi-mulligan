# PRP — P1.M1.T1.S1: Per-tool bloat threshold resolution in `mulligan_audit` (BUG-001 fix)

---

## Goal

**Feature Goal**: Make the `mulligan_audit` tool's bloat flag and KB rendering **consistent with the per-tool bloat reminder** (Nudge A) introduced by P2. The audit — the SECOND consumer of the bloat threshold — currently uses a single global `config.nudges.bloatThresholdBytes` for ALL messages; it must resolve the threshold PER ROW via the already-exported pure helper `bloatThresholdFor(toolName, config)`, carrying each row's own `thresholdBytes`, and render each flagged row with its own KB value.

**Deliverable**: A modified `src/tools/audit.ts` where (a) `AuditRow` carries a `thresholdBytes: number` field, (b) `auditExecute` resolves the threshold per row using `bloatThresholdFor`, (c) `renderAuditReport` renders each flagged row's KB from `r.thresholdBytes` (the single `thresholdBytes` arg is removed), and (d) updated JSDoc on `AuditRow.bloaty`, `messageBytes`, and `renderAuditReport`. Plus updated + new tests in `test/tools/audit.test.ts` (existing tests that break under per-tool resolution, plus per-tool discrimination tests).

**Success Definition**: 
- `npx vitest run test/tools/audit.test.ts` — all pass.
- `npx vitest run` — full suite passes (733 tests baseline).
- `npx tsc --noEmit` — no type errors (the removed `thresholdBytes` arg must not leave dangling references).
- A 20000-byte bash result is NOT flagged; a 40000-byte bash result IS flagged with "(32 KB)"; an 18000-byte read result is NOT flagged; a 21000-byte read result IS flagged with "(20 KB)"; a 17000-byte generic-tool result IS flagged with "(16 KB)".

## User Persona (if applicable)

**Target User**: The coding agent (LLM) running the `mulligan_audit` tool, and by extension the developer relying on honest context diagnostics.

**Use Case**: The agent runs `mulligan_audit` to see a token breakdown and learn which messages are bloated, so it can decide whether to call `mulligan_shrink`.

**User Journey**: Agent runs `mulligan_audit` → report flags each genuinely bloated result with its CORRECT per-tool KB threshold → agent shrinks only results the bloat reminder would actually fire on.

**Pain Points Addressed**: Today the audit falsely flags a 20000-byte bash result as "⚠ above bloat threshold (16 KB)" and even suggests `mulligan_shrink`, while the bloat reminder NEVER fires on it (20000 < bash's 32768). This misleads the agent into shrinking results that are not, by the system's own per-tool rule, bloated — a direct violation of PRD design principle #6 ("Honest bookkeeping").

## Why

- **Business value / user impact**: Restores honesty between the two bloat-threshold consumers. The audit and the reminder now agree, so the agent's diagnostic view matches its preventive nudge behavior. Eliminates false-positive shrink suggestions.
- **Integration with existing features**: This closes the integration gap left by P2, which propagated per-tool resolution to `bloatReminderHandler` (`src/nudges.ts:124`) but NOT to the audit tool (`src/tools/audit.ts:520/529`). `bloatThresholdFor` is ALREADY exported and pure — this item wires the second consumer to it.
- **Problems this solves and for whom**: BUG-001 (Major). For the agent and the developer: no more misleading "(16 KB)" flags on bash/read results whose real thresholds are 32 KB / 20 KB.

## What

User-visible behavior: the audit report's bloat flag and the parenthesized KB value now reflect each tool's own resolved threshold (bash: 32 KB, read: 20 KB, others: 16 KB global). The `AuditRow` type gains a public `thresholdBytes: number` field.

### Success Criteria

- [ ] `bloatThresholdFor` is imported into `src/tools/audit.ts` from `"../nudges.js"`.
- [ ] `AuditRow` has a `thresholdBytes: number` field; its `bloaty` JSDoc references `bloatThresholdFor`.
- [ ] `auditExecute` resolves each row's threshold via `bloatThresholdFor(readStr(msg, "toolName"), config)`; the single `const threshold` line is removed.
- [ ] `renderAuditReport` no longer takes a `thresholdBytes` arg; each flagged row renders `(${Math.round(r.thresholdBytes / 1024)} KB)`.
- [ ] `messageBytes` and `renderAuditReport` JSDoc reflect per-tool resolution.
- [ ] The existing test at `test/tools/audit.test.ts:419` (which uses `kbText(20)` for read = exactly the read threshold) is updated to a size that correctly crosses the per-tool threshold.
- [ ] All `renderAuditReport` unit tests are updated: `thresholdBytes` removed from args, added to each `AuditRow` fixture, expected-output strings adjusted.
- [ ] New per-tool discrimination tests added (bash NOT flagged @ 20000B; bash flagged @ 40000B with "(32 KB)"; read NOT flagged @ 18000B; read flagged @ 21000B with "(20 KB)"; generic tool flagged @ 17000B with "(16 KB)").
- [ ] `npx vitest run test/tools/audit.test.ts`, `npx vitest run`, and `npx tsc --noEmit` all pass.

## All Needed Context

### Context Completeness Check

_Before writing this PRP, validate: "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"_ — **YES.** This PRP contains the exact line numbers, the exact current code, the exact target code, the helper signature, the config defaults, the strict-inequality convention, and the exact test changes. No external docs are required.

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: src/nudges.ts
  why: bloatThresholdFor (lines 85-91) is the ALREADY-EXPORTED pure helper to import and call. bloatReminderHandler (line 124) shows the canonical per-tool usage pattern to mirror: `const threshold = bloatThresholdFor(event.toolName, config);`.
  pattern: "export function bloatThresholdFor(toolName: string | undefined, config: MulliganConfig): number — two reads + fallback, pure, no I/O."
  critical: "It is PURE (no pi, no I/O) — safe to call in the auditExecute hot path. A falsy/undefined toolName returns the GLOBAL. The `?? {}` defensive fallback already handles a hand-built config; do NOT re-implement this logic."

- file: src/tools/audit.ts
  why: THE file being modified. All edits are here (import, AuditRow, messageBytes JSDoc, auditExecute rows, renderAuditReport).
  pattern: "module-private readStr(msg, 'toolName') helper (lines ~75-77) already reads toolName defensively — same helper describeMessage uses. getConfig() is already called at the top of auditExecute."
  gotcha: "GOTCHA #3: imports use `.js` ESM/Bundler extensions (e.g. '../nudges.js'). auditTool is a PLAIN export const with NO pi factory — every read goes through ctx or pure helpers. Never throws (whole body in one try/catch). `details` is REQUIRED on every return path."

- file: src/config.ts
  why: "Confirms the DEFAULT_CONFIG thresholds the fix relies on (lines 109-110): bloatThresholdBytes = 16384 (global); bloatThresholdBytesByTool = { bash: 32768, read: 20480 }. setConfig({}) in tests yields exactly these defaults."
  pattern: "setConfig({}) → validateConfig fills defaults → bloatThresholdFor('bash', cfg) === 32768, ('read', cfg) === 20480, (undefined, cfg) === 16384."
  critical: "The interface field bloatThresholdBytesByTool is OPTIONAL (?:) but validateConfig always populates it. The helper's `?? {}` is belt-and-suspenders."

- file: test/tools/audit.test.ts
  why: "THE test file to update. Hand-rolled makeCtx() fake (no vi.fn()), `.js` imports, clearAll() in beforeEach/afterEach (GOTCHA #6: getRuntime is a module-scoped Map — leaks across tests unless cleared)."
  pattern: "kbText(kb) = 'x'.repeat(kb*1024) → exact ASCII byte count. toolResult(toolCallId, toolName, text) fixture. run(ctx, params) calls auditTool.execute directly."
  gotcha: "Section (e) line 419 test uses kbText(20) for read = 20480 bytes = read threshold EXACTLY → 20480 > 20480 is false → bloaty=false AFTER the fix (currently asserts true + '(16 KB)'). MUST be updated. The renderAuditReport tests (lines 670-740) pass thresholdBytes: 8192 in args — MUST move that to each AuditRow and drop the arg."

- file: plan/002_df93178e6631/bugfix/001_4ac005217ade/architecture/bug_analysis.md
  why: "Root-cause analysis + exact fix approach + test impact. Confirms the strict-inequality convention: audit uses `>` (strictly greater), nudge uses `bytes < threshold` to skip (fires at >= threshold). At bytes === threshold the nudge FIRES but the audit says NOT bloated — this EXISTING asymmetry is PRESERVED, do not 'fix' it."
  critical: "This item touches ONLY src/tools/audit.ts and test/tools/audit.test.ts. It does NOT modify src/nudges.ts (bloatThresholdFor is already correct/exported), src/config.ts, spec files, or other test files — those are separate work items (P1.M1.T2, P1.M2.*)."

- file: plan/002_df93178e6631/bugfix/001_4ac005217ade/architecture/system_context.md
  why: "Architecture invariants to preserve (never throws, details REQUIRED, never persists, filtered view total, bloatThresholdFor is pure). File dependency graph."
  critical: "Invariant #1: auditTool stays a PLAIN export const — do NOT introduce a pi factory. Invariant #3: details is REQUIRED on every return path (including catch) — this edit does not touch return shapes."
```

### Current Codebase tree (run `tree` in the root of the project) to get an overview of the codebase

```bash
src/
  tools/
    audit.ts      # ← MAIN FIX TARGET (import + AuditRow + messageBytes JSDoc + auditExecute + renderAuditReport)
    checkpoint.ts
    rewind.ts
    shrink.ts
  nudges.ts        # ← exports bloatThresholdFor (ALREADY DONE — import from here, do NOT modify)
  config.ts        # ← DEFAULT_CONFIG thresholds (read-only reference)
  ...
test/
  tools/
    audit.test.ts  # ← TEST UPDATES + NEW per-tool discrimination tests
    ...
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This item MODIFIES exactly two existing files:
src/tools/audit.ts        # 5 code/JSDoc edits (import, AuditRow, messageBytes JSDoc, auditExecute rows, renderAuditReport)
test/tools/audit.test.ts  # update 2 existing tests + 3 renderAuditReport tests; ADD per-tool discrimination tests
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1: imports in src/tools/*.ts use `.js` ESM/Bundler extensions.
//   The new import MUST be: import { bloatThresholdFor } from "../nudges.js";
//   (NOT "../nudges"). The existing imports at audit.ts:47-52 all follow this.

// CRITICAL GOTCHA #2: bloatThresholdFor takes (toolName, config). The audit already has
//   `config` from `getConfig()` (called at the top of auditExecute) and can read each
//   message's toolName via the module-private `readStr(msg, "toolName")` helper — the
//   SAME helper describeMessage uses (~line 262). Do NOT invent a new reader.

// CRITICAL GOTCHA #3: strict-inequality asymmetry is INTENTIONAL and PRESERVED.
//   audit uses `messageBytes(msg) > threshold`  → at bytes===threshold: NOT bloated.
//   nudge uses `if (bytes < threshold) return`   → at bytes===threshold: FIRES.
//   So kbText(20) for read (20480 === read threshold) is NOT bloated by the audit.
//   This is why the existing line-419 test breaks and must change.

// CRITICAL GOTCHA #4: renderAuditReport is EXPORTED and unit-tested with hand-built
//   AuditRow[] fixtures. Removing `thresholdBytes` from its args type is a BREAKING
//   type change — EVERY call site (auditExecute + all 3 test fixtures) must be updated
//   in the same change, or tsc --noEmit fails. Each AuditRow fixture needs thresholdBytes.

// CRITICAL GOTCHA #5: bloatThresholdFor returns the GLOBAL for a falsy toolName
//   (undefined for non-toolResult messages like user/assistant). A 17 KB user string
//   → toolName undefined → global 16384 → 17000 > 16384 → bloaty=true, "(16 KB)". This
//   is correct: the bloat flag applies to ALL messages, with the global fallback.

// CRITICAL GOTCHA #6 (test isolation): getRuntime() is a module-scoped Map keyed by
//   sessionId. test/tools/audit.test.ts already does clearAll() in beforeEach/afterEach.
//   Do NOT remove that. New tests follow the same makeCtx()/getRuntime("s1").lastFiltered pattern.
```

## Implementation Blueprint

### Data models and structure

The ONLY type change is adding one field to `AuditRow` in `src/tools/audit.ts` (lines 88-97):

```typescript
// CURRENT (audit.ts:88-97):
export interface AuditRow {
  /** Per-message token estimate (estimateTokens([msg]).tokens). */
  tokens: number;
  /** The message role (user | assistant | toolResult | custom | …); "?" if unreadable. */
  role: string;
  /** A best-effort human label (describeMessage): e.g. `read src/big.log`, `user "snippet…"`. */
  label: string;
  /** true when the message's in-context bytes exceed config.nudges.bloatThresholdBytes. */
  bloaty: boolean;
}

// TARGET:
export interface AuditRow {
  /** Per-message token estimate (estimateTokens([msg]).tokens). */
  tokens: number;
  /** The message role (user | assistant | toolResult | custom | …); "?" if unreadable. */
  role: string;
  /** A best-effort human label (describeMessage): e.g. `read src/big.log`, `user "snippet…"`. */
  label: string;
  /** true when the message's in-context bytes exceed the resolved per-tool bloat threshold (bloatThresholdFor). */
  bloaty: boolean;
  /** The resolved per-tool bloat threshold (bytes) used to compute `bloaty` and render the KB flag. */
  thresholdBytes: number;
}
```

No other data models change. `AuditDetails` (which embeds `top: AuditRow[]`) picks up the new field automatically.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/tools/audit.ts — ADD the import (after line 49, with the other local imports)
  - EDIT: insert `import { bloatThresholdFor } from "../nudges.js"; // per-tool bloat threshold (Nudge A / spec/07 §1)`
    among the existing local imports (lines 47-52). Place it after the `getConfig` import (line 49) or after
    the `readMarkers` import (line 51) — keep it grouped with the `../` (local) imports, NOT the typebox/pi imports.
  - NAMING: the imported binding is exactly `bloatThresholdFor` (already exported from src/nudges.ts:85).
  - GOTCHA: MUST use the `.js` extension (GOTCHA #1).

Task 2: MODIFY src/tools/audit.ts — ADD `thresholdBytes: number` to AuditRow + fix the bloaty JSDoc (lines 95-96)
  - EDIT the AuditRow interface: after the `bloaty: boolean;` line, add:
      /** The resolved per-tool bloat threshold (bytes) used to compute `bloaty` and render the KB flag. */
      thresholdBytes: number;
  - EDIT the JSDoc on `bloaty` (line 95): change
      `/** true when the message's in-context bytes exceed config.nudges.bloatThresholdBytes. */`
    to
      `/** true when the message's in-context bytes exceed the resolved per-tool bloat threshold (bloatThresholdFor). */`
  - DEPENDENCIES: none (interface only).

Task 3: MODIFY src/tools/audit.ts — fix messageBytes JSDoc (lines ~300-301)
  - EDIT the messageBytes JSDoc: change
      `* \`config.nudges.bloatThresholdBytes\` (default 16384 = 16 KB).`
    to
      `* the resolved per-tool threshold via \`bloatThresholdFor\`.`
    (the preceding sentence "The bloat flag compares this to" stays).
  - DEPENDENCIES: none.

Task 4: MODIFY src/tools/audit.ts — auditExecute rows resolve per-row threshold (lines 520-531)
  - REMOVE line 520: `const threshold = config.nudges.bloatThresholdBytes;`
  - EDIT the rows construction (currently lines 528-531):
      CURRENT:
        const rows: AuditRow[] = ranked.map(({ tokens, msg }) => ({
          tokens,
          role: readStr(msg, "role") ?? "?",
          label: describeMessage(msg, callLookup),
          bloaty: messageBytes(msg) > threshold,
        }));
      TARGET:
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
  - NAMING: `toolName`, `rowThreshold` (local to the map callback).
  - GOTCHA: `config` is already in scope (getConfig() called at the top of auditExecute's try block).
    `readStr` and `messageBytes` and `describeMessage` are all already in scope. `bloatThresholdFor` comes from Task 1.
  - DEPENDENCIES: Task 1 (import). This is the core behavior change.

Task 5: MODIFY src/tools/audit.ts — renderAuditReport args + per-row KB (lines 387, 416-418)
  - REMOVE line 387: `thresholdBytes: number;` from the renderAuditReport args object type.
  - REMOVE line 416: `const kb = Math.round(args.thresholdBytes / 1024);`
  - EDIT the flag rendering (line 417): change
      `const flag = r.bloaty ? \`  ⚠ above bloat threshold (${kb} KB)\` : "";`
    to
      `const flag = r.bloaty ? \`  ⚠ above bloat threshold (${Math.round(r.thresholdBytes / 1024)} KB)\` : "";`
  - EDIT the renderAuditReport JSDoc (the `Top messages by size:` example block): update the example flag line
      `*    9412  toolResult  read src/big.log  ⚠ above bloat threshold (16 KB)`
    to reflect per-tool resolution, e.g. show the read threshold:
      `*    9412  toolResult  read src/big.log  ⚠ above bloat threshold (20 KB)`
    and add a one-line note to the "Notes:" list: each flagged row renders its OWN resolved per-tool threshold.
  - DEPENDENCIES: Task 2 (AuditRow.thresholdBytes exists, so r.thresholdBytes is typed).

Task 6: MODIFY src/tools/audit.ts — drop the thresholdBytes pass-through arg (line 545)
  - REMOVE line 545: `thresholdBytes: threshold,` from the renderAuditReport({...}) call in auditExecute.
    (The `threshold` variable no longer exists after Task 4; leaving it is a tsc error.)
  - DEPENDENCIES: Task 4 + Task 5.

Task 7: MODIFY test/tools/audit.test.ts — fix the breaking section-(e) test (lines 419-427)
  - CURRENT (line 419-427): title "flags a toolResult whose bytes exceed config.nudges.bloatThresholdBytes";
    body uses `toolResult("call-A", "read", kbText(20))` → 20480 bytes = read threshold EXACTLY → bloaty=false AFTER fix;
    asserts `bloaty === true` and `"⚠ above bloat threshold (16 KB)"`. BOTH assertions now wrong.
  - TARGET: change the fixture to a size that EXCEEDS the read threshold. Use `kbText(21)` for read → 21504 bytes
    > 20480 → bloaty=true, and the flag renders Math.round(20480/1024) = "(20 KB)". Update:
      - title → "flags a read toolResult whose bytes exceed the resolved read threshold"
      - fixture → `toolResult("call-A", "read", kbText(21))` with an updated comment "21 KB > read's 20 KB threshold → bloaty"
      - `expect(res.details.top[0].bloaty).toBe(true);` (unchanged)
      - `expect(firstText(res)).toContain("⚠ above bloat threshold (20 KB)");` (was "(16 KB)")
      - ADD: `expect(res.details.top[0].thresholdBytes).toBe(20480);`
  - KEEP the existing "does NOT flag a small toolResult" test (line 429) — `toolResult("call-A", "read", "tiny")` is far
    below any threshold, still bloaty=false. ADD `expect(res.details.top[0].thresholdBytes).toBe(20480);` there too
    (read's threshold, even though not flagged).
  - DEPENDENCIES: Tasks 1-6 (impl must be in place).

Task 8: MODIFY test/tools/audit.test.ts — update the 3 renderAuditReport unit tests (lines 670-740)
  - In EACH of the 3 `renderAuditReport({...})` calls (lines 677, 707, 727): REMOVE the `thresholdBytes: 8192,` arg
    (it is no longer a valid arg after Task 5).
  - In EACH AuditRow[] fixture: ADD `thresholdBytes: <num>` to every row.
  - For the FIRST test (line 670-703): rows[0] (the bloaty read row) needs `thresholdBytes: 8192` to keep the
    expected `lines[6]` string "⚠ above bloat threshold (8 KB)" unchanged (Math.round(8192/1024)=8). The other two
    rows are not bloaty so their thresholdBytes value is arbitrary for the assertion, but set it to 8192 for
    consistency. So all three rows get `thresholdBytes: 8192` and `lines[6]` stays "(8 KB)".
  - For the SECOND test (line 707, empty filtered): rows:[] is empty — no AuditRow fields to add. Just remove the arg.
  - For the THIRD test (line 727, empty checkpoints): the single row `{ tokens:5, role:"user", label:'user "hi"', bloaty:false }`
    gets `thresholdBytes: 8192` added; it's not bloaty so no flag assertion changes.
  - DEPENDENCIES: Task 5 (renderAuditReport arg type changed).

Task 9: ADD per-tool discrimination tests to test/tools/audit.test.ts (new describe block in section (e))
  - ADD a describe block "mulligan_audit — per-tool bloat thresholds (BUG-001 fix)" with `beforeEach(() => setConfig({}))`.
  - ADD these 5 `it(...)` tests, each seeding `getRuntime("s1").lastFiltered` and asserting `res.details.top[0].bloaty`
    + (when bloaty) the rendered KB string + `thresholdBytes`:
      (1) bash 20000B → NOT flagged:
            `toolResult("call-A", "bash", "x".repeat(20000))` → bloaty=false (20000 < 32768),
            thresholdBytes===32768, report does NOT contain "⚠ above bloat threshold".
      (2) bash 40000B → flagged "(32 KB)":
            `toolResult("call-A", "bash", "x".repeat(40000))` → bloaty=true (40000 > 32768),
            thresholdBytes===32764? NO — 32768. Math.round(32768/1024)=32 → report contains "(32 KB)".
      (3) read 18000B → NOT flagged:
            `toolResult("call-A", "read", "x".repeat(18000))` → bloaty=false (18000 < 20480),
            thresholdBytes===20480.
      (4) read 21000B → flagged "(20 KB)":
            `toolResult("call-A", "read", "x".repeat(21000))` → bloaty=true (21000 > 20480),
            thresholdBytes===20480, report contains "(20 KB)".
      (5) generic tool 17000B (e.g. toolName "grep") → flagged "(16 KB)" (global fallback):
            `toolResult("call-A", "grep", "x".repeat(17000))` → bloaty=true (17000 > 16384 global),
            thresholdBytes===16384, report contains "(16 KB)".
  - OPTIONAL 6th (non-toolResult message uses global): a `userMsg("x".repeat(17000))` (role user, no toolName)
            → bloatThresholdFor(undefined, cfg)===16384 → bloaty=true (17000 > 16384), report contains "(16 KB)",
            thresholdBytes===16384. (This guards the falsy-toolName branch of bloatThresholdFor.)
  - NAMING: describe each test title with the tool name + byte size, e.g.
            "bash 20000B is NOT flagged (bash threshold 32 KB)".
  - DEPENDENCIES: Tasks 1-6.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN (Task 4): per-row threshold resolution inside the existing ranked.map.
// `config`, `readStr`, `messageBytes`, `describeMessage` are all already in scope.
const rows: AuditRow[] = ranked.map(({ tokens, msg }) => {
  const toolName = readStr(msg, "toolName");           // falsy for non-toolResult → global fallback
  const rowThreshold = bloatThresholdFor(toolName, config); // PURE, two reads + fallback
  return {
    tokens,
    role: readStr(msg, "role") ?? "?",
    label: describeMessage(msg, callLookup),
    bloaty: messageBytes(msg) > rowThreshold,           // PRESERVE strict `>` (GOTCHA #3)
    thresholdBytes: rowThreshold,                        // NEW — carries the resolved threshold for rendering
  };
});

// PATTERN (Task 5): per-row KB in renderAuditReport — NO single kb var, NO thresholdBytes arg.
for (const r of args.rows) {
  const flag = r.bloaty ? `  ⚠ above bloat threshold (${Math.round(r.thresholdBytes / 1024)} KB)` : "";
  L.push(`  ${String(r.tokens).padStart(6)}  ${r.role.padEnd(11)} ${r.label}${flag}`);
}

// GOTCHA: renderAuditReport's args type LOSES `thresholdBytes: number;` (Task 5) AND the call site in
// auditExecute LOSES `thresholdBytes: threshold,` (Task 6). Both must change together or tsc fails.
// The `const threshold = config.nudges.bloatThresholdBytes;` line (520) is DELETED entirely.
```

### Integration Points

```yaml
IMPORTS:
  - add to: src/tools/audit.ts (top, local-import group lines 47-52)
  - pattern: "import { bloatThresholdFor } from \"../nudges.js\";"

TYPES:
  - modify: AuditRow interface in src/tools/audit.ts (add thresholdBytes: number)
  - ripple: AuditDetails.top: AuditRow[] picks it up automatically; no other code reads AuditRow by hand
    except renderAuditReport (which we update) and the test fixtures (which we update).

CONFIG:
  - none. config.ts is READ-ONLY for this item. The defaults (bash:32768, read:20480, global:16384) already exist.

ROUTES / DATABASE / REGISTRATION:
  - none. auditTool is already registered in src/index.ts; this item changes only internal behavior + a type field.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After all edits to src/tools/audit.ts:
npx tsc --noEmit
# Expected: ZERO errors. If you see "'threshold' is not defined" or "Property 'thresholdBytes' does not exist
# on type ...", you missed a call site (Task 6) or a renderAuditReport arg (Task 5). Fix before proceeding.

# (No eslint/ruff — this is a TypeScript/vitest project. tsc --noEmit is the type gate; vitest is the test gate.)
```

### Level 2: Unit Tests (Component Validation)

```bash
# The audit test file in isolation — FAST feedback on the per-tool logic.
npx vitest run test/tools/audit.test.ts
# Expected: ALL pass. Specifically:
#   - section (e) updated test (read 21 KB) → bloaty=true, "(20 KB)"
#   - renderAuditReport tests → "(8 KB)" unchanged (rows carry thresholdBytes:8192)
#   - NEW per-tool discrimination tests (bash/read/grep/user) → correct flag + KB each
# If failing: READ the output. Most likely cause = a renderAuditReport call still passing thresholdBytes
# (Task 8 incomplete) or an AuditRow fixture missing thresholdBytes.
```

### Level 3: Integration Testing (System Validation)

```bash
# Full suite — confirm no other consumer of renderAuditReport / AuditRow broke, and the 733-test baseline holds.
npx vitest run
# Expected: all pass (baseline was 733 passed; this item adds ~6 tests → ~739).
# Note: BUG-004's stale comments (test/tokens.test.ts, test/notes.test.ts) are a SEPARATE work item
# (P1.M2.T2) and are NOT touched here — they remain passing as today.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Manual reproduction of the BUG-001 scenario (optional but recommended — proves the two consumers now agree):
#   After the fix, a 20000-byte bash result must be NOT flagged by the audit (matching the nudge pass-through).
# This is exactly what the new per-tool discrimination tests assert programmatically, so Level 2 covers it.
# No additional manual curl/browser validation applies (this is a headless TypeScript tool, no HTTP server).
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit` — zero type errors (no dangling `threshold` var, no `thresholdBytes` arg on renderAuditReport).
- [ ] `npx vitest run test/tools/audit.test.ts` — all pass.
- [ ] `npx vitest run` — full suite passes (~739 tests).
- [ ] No new lint issues (tsc is the project's static gate).

### Feature Validation

- [ ] `bloatThresholdFor` imported from `"../nudges.js"` in src/tools/audit.ts.
- [ ] `AuditRow.thresholdBytes: number` field present; `AuditRow.bloaty` JSDoc references `bloatThresholdFor`.
- [ ] `auditExecute` resolves threshold per row (`readStr(msg,"toolName")` → `bloatThresholdFor`); `const threshold` line removed.
- [ ] `renderAuditReport` renders `(${Math.round(r.thresholdBytes / 1024)} KB)`; `thresholdBytes` arg + `const kb` removed.
- [ ] `messageBytes` + `renderAuditReport` JSDoc updated for per-tool resolution.
- [ ] bash 20000B NOT flagged; bash 40000B flagged "(32 KB)"; read 18000B NOT flagged; read 21000B flagged "(20 KB)"; generic 17000B flagged "(16 KB)" — all asserted by new tests.
- [ ] The existing line-419 test updated to a correctly-crossing size (read 21 KB).
- [ ] All 3 renderAuditReport unit tests updated (arg removed, AuditRow fixtures carry thresholdBytes).
- [ ] Architecture invariants preserved: `auditTool` still a plain `export const` (no pi factory); never throws; `details` on every return path; never persists; total from filtered view.

### Code Quality Validation

- [ ] Follows existing codebase patterns (readStr helper, getConfig() already in scope, `.js` imports, hand-rolled test fakes).
- [ ] Only `src/tools/audit.ts` and `test/tools/audit.test.ts` modified — NO changes to nudges.ts, config.ts, spec/, or other test files (those are sibling work items P1.M1.T2 / P1.M2.*).
- [ ] Strict `>` inequality preserved (GOTCHA #3) — NOT changed to `>=`.
- [ ] Per-row `Math.round(r.thresholdBytes / 1024)` matches the old `Math.round(args.thresholdBytes / 1024)` formatting exactly (same rounding).

### Documentation & Deployment

- [ ] JSDoc on `AuditRow.bloaty`, `messageBytes`, and `renderAuditReport` reflect per-tool resolution (Mode A — rides with the code change).
- [ ] No separate README/overview doc sweep here — that is P1.M2.T3.S1 (final Mode B doc-sync task).

---

## Anti-Patterns to Avoid

- ❌ Don't re-implement the per-tool threshold logic inline — CALL the existing pure `bloatThresholdFor(toolName, config)`. Duplicating its two-reads-and-fallback would re-introduce the exact drift this fix removes.
- ❌ Don't change the strict `>` to `>=` to "match the nudge" — the strict-inequality asymmetry is an EXISTING, intentional convention (GOTCHA #3); changing it is out of scope and would silently alter bloaty flags at exact-threshold sizes across other tests.
- ❌ Don't touch `src/nudges.ts`, `src/config.ts`, spec files, or other test files — `bloatThresholdFor` is already correct/exported; the spec alignment is P1.M1.T2; the stale-comment fixes are P1.M2.T2; the README sweep is P1.M2.T3. Scope creep here breaks the plan's task boundaries.
- ❌ Don't leave the `const threshold` line or the `thresholdBytes: threshold,` arg in place after switching to per-row resolution — `tsc --noEmit` will fail on the undefined `threshold`.
- ❌ Don't forget the 3 renderAuditReport unit-test call sites when removing the `thresholdBytes` arg — it's an EXPORTED function with a changed arg type; every call must update in the same change.
- ❌ Don't skip `clearAll()` in the new test block's beforeEach/afterEach — getRuntime() is a module-scoped Map (GOTCHA #6); a prior test's `lastFiltered` leaks in.