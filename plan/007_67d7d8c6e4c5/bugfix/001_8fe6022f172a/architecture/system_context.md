# System Context — pi-mulligan v1.1 PRD Divergence Remediation

## Project Overview

**pi-mulligan** is a Pi coding-agent extension (`pi-extension`) that provides autonomous,
token-cheap context self-rewind. It lets an agent shed context produced by mistake and redo
a turn with a self-authored note. The core mechanisms: `mulligan_rewind` (hide recent output),
`mulligan_shrink` (compact a specific result), `mulligan_cancel` (retract a marker),
`mulligan_audit` (see what's carried), and `mulligan_checkpoint` (user-set rewind target).

- **Language/Runtime**: TypeScript, ESM (`"type": "module"`), Node ≥22.19.
- **Test framework**: Vitest (`vitest run`). Current suite: **1042 tests, all passing**.
- **Type checking**: `tsc --noEmit`.
- **Key peer dependency**: `@earendil-works/pi-coding-agent` (the Pi SDK).
- **No build step** — source `.ts` files are consumed directly (Pi resolves TypeScript natively).

## Source Layout

```
src/
  config.ts          — MulliganConfig type + DEFAULT_CONFIG + getConfig()/setConfig() (lazy cache)
  nudges.ts          — shouldNudge, shouldHighWater, renderDriftNudge, renderHighWaterNudge, inject* helpers
  filter.ts          — readMarkers (cancelledIds mechanism), filterPipeline, contextHandler
  tokens.ts          — token estimation utilities
  transforms.ts      — message-list transforms (applyRewind, applyShrink, MessageLike type)
  markers.ts         — marker persistence (appendRewindMarker, appendShrinkMarker, appendCancelMarker)
  ledger.ts          — file-ledger extraction (read/modified/bash side effects)
  banner.ts          — active-checkpoint banner reconciliation
  commands.ts        — slash commands (/mulligan_audit, /mulligan_checkpoint, etc.)
  runtime.ts         — SessionRuntime (per-session state: aboveHighWater, lastFiltered, etc.)
  settings.ts        — Pi settings extraction → setConfig
  notes.ts           — note validation + rendering
  log.ts             — structured logging
  tools/
    rewind.ts        — mulligan_rewind tool: countRewindMarkers, countRetriesAtLatestPrompt, checkpointExists, execute
    shrink.ts        — mulligan_shrink tool
    cancel.ts        — mulligan_cancel tool
    audit.ts         — mulligan_audit tool: renderAuditReport, listCheckpoints, entriesToMessages
    checkpoint.ts    — (removed in v1.1 — checkpoints are user-only via slash commands)
```

## Critical Codebase Patterns

### 1. Fail-Open Discipline (E13)
Every tool and handler wraps its logic in try/catch. On ANY internal error, the handler
degrades to a logged no-op (returns false / empty / defaults) — NEVER throws or breaks the
agent turn. This is load-bearing: the agent's turn must never be blocked by a Mulligan error.

### 2. Soft-Delete Model
Rewinds and shrinks NEVER delete data. They persist markers (custom entries) that the filter
applies at context-fire time to hide specific messages from the model's view. The raw session
JSONL retains everything; Pi's `/tree` shows the full history.

### 3. Cancel-Retirement (E21 / BUG-005 pattern)
A `mulligan:cancel` entry retires a marker by its uuid `id` (stored in `data.targetId`).
The filter's `readMarkers` (src/filter.ts) collects all cancel `targetId`s into a `cancelledIds`
Set, then drops any marker whose `data.id` is in that Set. This is **order-independent**:
the full entry list is scanned for cancels first, then markers are filtered.

The sibling `countRetriesAtLatestPrompt` (src/tools/rewind.ts) mirrors this pattern (the
BUG-005 fix): it scans the post-prompt slice for `mulligan:cancel` entries, collects their
`data.targetId`, and skips cancelled rewinds in its count.

**BUG-004**: `countRewindMarkers` (the cumulative depth guard) does NOT yet mirror this
pattern — it counts ALL rewind entries including cancelled ones. The fix is to add the same
cancel-exclusion logic.

### 4. Config Defaults (spec/09)
`DEFAULT_CONFIG` in src/config.ts is the zero-config baseline. `getConfig()` returns a
deep-merged, deep-cloned copy. The config is validated on first access (lazy). The test
`config.test.ts` asserts `DEFAULT_CONFIG` matches spec/09 §2 exactly (field-by-field deep
equality).

### 5. Nudge Injection (Zero-Extra-Requests)
Both the drift nudge and high-water nudge are injected into the in-flight filtered message
copy at `context` fire time. They are **ephemeral** — never persisted to the session. Each
context fire gets a fresh copy, so nudges never stack.

## The Four PRD Divergences (Summary)

| ID | Severity | Area | File:Line | One-line Description |
|----|----------|------|-----------|---------------------|
| BUG-001 | Major | Config default | `src/config.ts:168` | `driftThresholdTokens` default; code & spec both already at 4000 (PRD's "6000" claim is stale); remaining issue is spec/07 §5.1 text still says `>` vs code's `>=` |
| BUG-002 | Major | Nudge text | `src/nudges.ts:534-543` | `renderHighWaterNudge` prescribes rewind/shrink; PRD §5.2 v1.1 note requires "pure awareness, not rewind/shrink" |
| BUG-003 | Minor | Audit report | `src/tools/audit.ts:448-454` | Checkpoint clause omits required `(user-set)` annotation; count not singularized |
| BUG-004 | Minor | Depth guard | `src/tools/rewind.ts:204-220` | `countRewindMarkers` counts cancelled markers; spec/05 §1 step 4 says "count active" |

See `bug_analysis.md` for the full per-bug analysis with exact code, spec, and test references.