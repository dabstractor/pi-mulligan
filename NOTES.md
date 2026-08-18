# NOTES — rewrite budget

## v2 addendum — "cap at one moment"

### What changed, in user-visible terms

v1 shipped a per-session cap of **2 marker-creating operations** (shrinks + rewinds combined).
The bench then showed the cap almost never engaged: real sessions rarely exceed 2 *operations*,
because the model batches parallel tool calls into a single turn. The counting unit was wrong.

What actually predicts cost is the **rewrite moment** — a distinct point in time where the
outgoing history changes. Each moment invalidates the provider's prompt cache from the edit
point onward and re-bills the rest of the session at full price. Measured: sessions with
exactly ONE moment ran 2–13% *cheaper* than identical no-tool sessions; sessions with TWO OR
MORE moments ran 16–37% more expensive. There is a cliff between one and two. (Under a forced
heavy-rewriting arm, the v1 cap mechanism still saved 20.6% where uncapped versions lose ~50% —
the mechanism protects cost when it binds; v2 fixes the counting unit so it binds.)

v2 therefore caps **moments**, not operations, and defaults to **1**:

- A *moment* = a turn in which at least one marker becomes active. Five parallel
  `mulligan_shrink` calls in one turn are five operations but **one** moment — they all
  activate together, so the cache breaks once.
- Every rewind/shrink op is now **queued first** (inert: no marker, no context change — the
  tool result says so honestly: "queued — the content stays fully visible … applies at the next
  free moment"). Nothing is persisted until a trigger spends a moment and flushes the whole
  queue at once.
- **Spending the moment** (while unspent) happens when:
  1. the queued estimated shed volume **reaches** `flushShedTokens` (default 4000 tokens —
     don't waste the only moment on a tiny shed), or
  2. a **second op arrives in the same turn** (natural batching — the whole batch activates
     together), or
  3. the model calls **`mulligan_audit`** (it is asking about context — the honest moment to
     apply; the audit report lists what flushed).
- **After the moment is spent**, further ops only queue and ride **free breaks**: a context
  **compaction** by the provider (the cache is already destroyed there — detected and applied
  by the context filter) or an audit call. Volume alone never opens a second moment.
- **Safety valve**: if the queued volume strictly exceeds `safetyValveTokens` (default 16000),
  one *extra* moment is spent anyway — pathological sessions must still be able to shed. The
  valve is an exception, not a path; the default makes it rare.
- Queued ops are never auto-flushed at shutdown (pointless cost — the session is over).

Telemetry (JSONL `log.file`): `mulligan:rewrite-queued` fires when an op queues (inert);
`mulligan:rewrite-flush` `{count, estimatedTokens, trigger, momentsSpent}` fires on every real
activation — the only path where markers become active. The marker/activation events
(`mulligan:shrink` / `mulligan:rewind` markers, notes) only ever land on real activation.
"Matched: no" target-resolution wording is unchanged.

### New settings (`mulligan.rewrites` in Pi `settings.json`)

| Setting | Default | Meaning |
|---|---|---|
| `maxMoments` | `1` | Max turns-with-activation per session. `0` = never create markers (ops refuse; audit/cancel still work). Integer ≥ 0; fractions floor; invalid values fall back to the default (fail-open). |
| `flushShedTokens` | `4000` | Pre-spend trigger: the queue activates once its estimated shed volume **reaches** this. `0` = flush every op immediately (the aggressive off-position — closest to pre-budget behavior). |
| `safetyValveTokens` | `16000` | Post-spend exception: queue strictly ABOVE this spends one extra moment. |

**Retired v1 keys**: `maxPerSession` and `batching` no longer exist and are silently ignored
(the fail-open unknown-key policy), so old settings files keep working and get the v2 defaults.

### Decisions I had to make (spec ambiguities)

1. **"Crosses" the flush threshold → `>=` (at-threshold flushes).** "Crosses" was ambiguous;
   reaching the threshold is the natural reading of "worth spending the moment on", and it makes
   `flushShedTokens: 0` a clean "flush every op immediately" off-position (useful for tests and
   for users who want pre-budget behavior). The **safety valve stays strictly `>`** — the spec
   pins it ("only above the threshold"), so at exactly 16000 queued tokens the valve stays shut.
2. **Moment accounting per trigger.** `volume`/`batch`/`valve` flushes spend a moment (the
   valve may push `momentsSpent` beyond `maxMoments` — the extra break is recorded honestly).
   An **audit** flush spends the budgeted moment only if one is unspent; at the cap it applies
   for free (spec (b) explicitly blesses audit as a rider). A **compaction** flush never spends
   anything — the provider destroyed the cache itself.
3. **Same-turn rides are free.** After any activation this turn, later ops *in the same turn*
   flush immediately without spending a new moment (this is what makes "five parallel shrinks =
   one moment" true). The per-turn flags reset on `turn_end`. Consequence (accepted, rare): an
   op arriving in a turn that already had a *compaction* flush also rides — a corner case where
   one extra activation shares the compaction's turn.
4. **Queue-first means even the first small op queues.** A single small shrink does not
   activate until an audit call, a same-turn sibling op, the volume threshold, or a compaction.
   This is deliberate (don't spend the only moment on a tiny shed) and is the biggest visible
   behavior change from v1 — the tool result text says "queued … still fully visible" so the
   model is never misled. `flushShedTokens: 0` restores immediate activation for users who
   prefer it.
5. **`maxMoments: 0` refuses ops outright** rather than queueing them (a queue that can never
   legitimately activate would be a lie); audit and cancel are untouched and keep working.
6. **Compaction detection** counts `type: "compaction"` entries on the branch between context
   fires (a watermark on the session runtime; the first observation only initializes, so a
   compaction that predates the queue never flushes anything).

### Where to look in the code

- `src/rewrite-budget.ts` — `submitRewrite` (the queue-first gate: same-turn ride → valve →
  volume → natural batching), `flushRewrites(trigger)` (activation + moment accounting),
  `maybeFlushOnCompaction` (the free-break rider, called from the context filter),
  `registerRewriteTurnReset` (the `turn_end` reset wired in `src/index.ts`).
- `src/runtime.ts` — per-session budget state: `momentsSpent`, `opsThisTurn`,
  `activatedThisTurn`, `compactionWatermark`, `rewriteQueue` (all reset by `resetRuntime` on
  `session_start`).
- `src/tools/shrink.ts` / `src/tools/rewind.ts` — build the payload exactly as before and hand
  it to `submitRewrite`; results render the normal success text on "applied", the honest queued
  text on "queued". (A missing runtime still falls open to the old immediate path, E13.)
- `src/tools/audit.ts` — flushes with trigger `"audit"` before rendering the report.
- `test/rewrite-budget.test.ts` — the v2 suites (moments vs operations, post-spend queueing,
  compaction riding, valve threshold, flush threshold boundary, session reset, fail-open
  config, `maxMoments: 0`, `turn_end` reset, audit trigger accounting).