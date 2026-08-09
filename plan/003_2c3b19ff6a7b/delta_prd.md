# Delta PRD — Spec refinements (drift-window nudges, stale-marker retirement, marker retraction)

**Source of delta:** the spec advanced from the per-tool-bloat-threshold state (end of session 002) to HEAD via commit `0ea555ed` ("Add drift-window nudges and marker retraction"). That commit's diff is ~38 lines across `spec/SPEC.md` (the D6 amendment), `spec/07-preventive-and-nudges.md` (§5.1/§5.2), `spec/08-edge-cases.md` (E15, E21), and `spec/09-configuration.md` (new config knobs).

**Sizing:** Medium. Three small, well-specified, REQUIRED feature groups — none of which are implemented today (verified: no `cancel`, `driftWindowTurns`, `highWaterFraction`, `maxActive`, or `staleAfterFires` anywhere in `src/`). One phase, three milestones, one doc-sync task. The spec already specifies the algorithms, defaults, and acceptance criteria; this PRD is the build plan to implement them.

**Scope delta at a glance:**

| # | Feature group | Spec source | Status |
|---|---|---|---|
| G3 | **Marker retraction** — agent can cancel a `mulligan:rewind`/`mulligan:shrink` marker by id; amends D6 ("no undo") | `spec/08` E21, `SPEC.md` D6 amendment | Spec written, **not implemented** |
| G2 | **Stale-marker retirement + soft cap** — auto-retire a dead pinned shrink; cap active shrinks | `spec/08` E15, `spec/09` | Spec written, **not implemented** (depends on G3) |
| G1 | **Drift-nudge refinements** — windowed signaling (§5.1) + edge-triggered high-water signal (§5.2) | `spec/07` §5.1/§5.2, `spec/09` | Spec written, **not implemented** |

**Build order rationale:** G2's spec literally says "treated as cancelled per E21" — stale retirement *reuses* the cancel primitive from G3. So G3 ships first, G2 builds on it, G1 is independent and goes last.

**Leveraging prior work:** All three reuse existing, shipped patterns — no new architecture:
- Marker persistence → the `appendRewindMarker`/`appendShrinkMarker`/`appendTurnMetric` wrappers in `src/markers.ts` (stamp `MulliganEnvelope`, `pi.appendEntry`, capture leaf id via `getLeafId()`, return `id|null`, never throw).
- Tool registration → the `make<Tool>(pi)` factory + `defineTool` pattern (`src/tools/shrink.ts`, `src/tools/rewind.ts`).
- Marker reading → `readMarkers(ctx)` in `src/filter.ts` (scan `custom` entries, bucket by `customType`+`kind`).
- Nudge gating → `shouldNudge`/`injectNudge`/`suppressCheck` in `src/nudges.ts`; the per-turn nudge is wired in `contextHandler` (`src/filter.ts`).
- Audit rendering → `renderAuditReport` in `src/tools/audit.ts` (which already calls `readMarkers`).
- Config → `MulliganConfig` + `DEFAULT_CONFIG` + `validateConfig` in `src/config.ts` (Pi-free).
- The agent already receives the cancel target id: `mulligan_shrink` returns `details.markerId` (the marker entry id) and `mulligan_rewind` returns the same — so `mulligan_cancel` has a stable id to target.

**Prior research to reuse:** `plan/002_df93178e6631/architecture/config_validation_design.md` (the `coerceNumber`/`coerceBloatThresholdByTool` merge pattern for new numeric/object config knobs) and `…/system_context.md` (exact current code state of `config.ts`/`filter.ts`/`markers.ts`).

---

## Phase P3 — Implement the spec refinements from commit `0ea555ed`

Three milestones, ordered by dependency. Each milestone is independently shippable and verifiable. Pure-helper changes stay Pi-free (unit-tested); Pi-coupled glue stays thin.

---

### Milestone P3.M1 — Marker retraction (G3; amends D6)

**Goal:** an agent can cancel any `mulligan:rewind`/`mulligan:shrink` marker by id; on the next `context` fire the cancelled transform no longer applies; `mulligan_audit` lists cancelled markers as retired; cancelling a non-existent / already-cancelled id is a safe no-op that never throws. (Acceptance criteria a–d in `spec/08` E21.)

**Implementation surface:**
1. **`src/markers.ts`** — add a `CancelMarker` envelope shape + an `appendCancelMarker(pi, ctx, targetMarkerId)` wrapper (mirrors `appendShrinkMarker`: stamp `{schema:"pi-mulligan", v:1, kind:"cancel", targetId, seq, ts}`, `pi.appendEntry("mulligan:cancel", …)`, capture leaf id, return `id|null`, never throw). Extend `MulliganEnvelope.kind` to include `"cancel"` (or give `mulligan:cancel` its own self-describing envelope — either is fine; pick the one that keeps `kind` a closed union).
2. **`src/filter.ts` `readMarkers`** — also collect `mulligan:cancel` entries; build a `Set<string>` of cancelled `targetId`s; **drop** any rewind/shrink whose `id` ∈ that set *before* returning the bundle. (Cancelled markers stay on disk — audit trail — they're just skipped going forward.) Expose the cancelled ids on `MarkersBundle` (e.g. `cancelledIds: Set<string>`) so audit can list them.
3. **`src/tools/cancel.ts`** (new) + register in `src/index.ts` — a `mulligan_cancel` tool taking `markerId` (string). Validate `config.enabled`; scan `ctx.sessionManager.getEntries()` to confirm a marker with that `id` exists and is not already cancelled; append the cancel marker via `appendCancelMarker`; return confirmation text. Non-existent / already-cancelled → safe no-op returning a reason (never throws — shared tool convention). Follow the `makeShrinkTool(pi)` factory pattern (`defineTool`, capture `pi` via closure).
4. **`src/tools/audit.ts` `renderAuditReport`** — extend the "Active markers" line (or add a line) to list cancelled markers as retired (acceptance c).
5. **Docs (Mode A — ride with the work):** add a `mulligan_cancel` tool entry to `spec/05-tools.md` (parameter schema, behavior, refusal conditions — mirroring §2 `mulligan_shrink`); add the `CancelMarker` shape to `spec/04-data-model.md`; document the `readMarkers` cancel-drop in `spec/06-context-filter.md`. (E21 in `spec/08` and the D6 amendment in `SPEC.md` already exist — do not rewrite them.)
6. **Tests:** unit tests for `readMarkers` cancellation (cancel a shrink → original message reappears verbatim in `filterPipeline` output; cancel a rewind → hidden messages reappear); a `mulligan_cancel` tool test (success, non-existent id no-op, already-cancelled no-op, config-disabled refusal); an audit test asserting cancelled markers are listed. Mirror the assertions named in E21 acceptance (b)/(c)/(d).

---

### Milestone P3.M2 — Stale-marker retirement + soft cap (G2; depends on P3.M1)

**Goal:** bound long-session filter cost per `spec/08` E15 — a pinned shrink whose target entry has been absent for `config.shrink.staleAfterFires` (default 3) consecutive fires is auto-retired; active shrink markers are capped at `config.shrink.maxActive` (default 32), oldest retired when exceeded. Retirement reuses the G3 cancel primitive ("treated as cancelled per E21").

**Implementation surface:**
1. **`src/config.ts`** — add `shrink.maxActive` (default 32) and `shrink.staleAfterFires` (default 3) to the `MulliganConfig` interface, `DEFAULT_CONFIG`, and `validateConfig` (numeric coercion `> 0` via the established `coerceNumber` pattern from `config_validation_design.md`; never throw).
2. **`src/runtime.ts`** — add per-session state to track pinned-shrink miss counts: `Map<shrinkMarkerId, consecutiveMisses>` (reset on `session_start`, like the existing token baseline).
3. **`src/filter.ts` (the Pi-coupled handler, NOT the pure `filterPipeline`)** — after `filterPipeline` runs, walk the active shrinks: for each pinned shrink whose target was absent this fire, increment its miss count; reset to 0 when present. When a count reaches `staleAfterFires`, call `appendCancelMarker(pi, ctx, id)` (auto-retire). Separately, if `activeShrinks.length > maxActive`, retire the oldest by seq. These appends take effect on the *next* fire (readMarkers drops the cancelled id) — no in-fire mutation. Because `appendCancelMarker` is from P3.M1, **this milestone depends on P3.M1**. (The pure `filterPipeline` in `transforms.ts` stays Pi-free; it only needs to surface per-shrink hit/miss this fire, e.g. via a small return extension or a parallel resolution pass in `filter.ts`.)
4. **Tests:** a pinned shrink whose target is absent for N fires is retired on fire N+1 (assert `mulligan:cancel` appended + the shrink stops applying); exceeding `maxActive` retires the oldest; config defaults validated. Edge: never throws, never breaks the turn.

---

### Milestone P3.M3 — Drift-nudge refinements (G1; windowed signaling + high-water)

**Goal:** cut drift-nudge false positives and catch slow accumulation, both riding the existing `context` event (D4 — zero extra requests). Per `spec/07` §5.1/§5.2 and `spec/09`.

**Two sub-features:**
- **§5.1 Windowed drift signaling (REQUIRED):** `shouldNudge` smooths the per-turn token delta over a rolling window of the last `config.nudges.driftWindowTurns` (default 3) turns (moving-average / M-of-N) before comparing to `driftThresholdTokens`. The window is computed in the filter from the last N `mulligan:turn-metric` entries on the branch. Acceptance: a single 8k-token turn amid small turns does NOT fire; three ~4k turns in a row DO.
- **§5.2 Edge-triggered high-water signal (REQUIRED):** the first time the **total filtered** context crosses `config.nudges.highWaterFraction` (default 0.7) of the window, inject a one-line annotation — **edge-triggered** (fire once on crossing, not every turn while above), tracked via `rt.aboveHighWater` (set true when the annotation fires, cleared only when the total drops back below the fraction).

**Implementation surface:**
1. **`src/config.ts`** — add `nudges.driftWindowTurns` (default 3) and `nudges.highWaterFraction` (default 0.7); **raise `nudges.driftThresholdTokens` from 3000 → 6000** (the on-disk `spec/09` specifies 6000 with rationale: "Raised from 3000 after live use showed 3k false-positived on routine multi-file reads; the §5.1 windowing is what makes 6k a quiet, accurate trip point." Code currently has 3000 — this is a drift to fix as part of this milestone). Validate numbers (`driftWindowTurns` integer `> 0`; `highWaterFraction` finite in `(0,1)`).
2. **`src/filter.ts` `readMarkers`** — currently keeps only the LATEST `mulligan:turn-metric`; expose the last N (up to `driftWindowTurns`) recent metrics so `contextHandler` can compute the windowed signal. Minimal change: return the recent-metrics slice on `MarkersBundle`.
3. **`src/nudges.ts`** — change `shouldNudge`'s signature from `(metric, _config)` to accept the recent-metrics window and compute the smoothed delta (§5.1); keep `injectNudge` for the drift annotation. Add a `shouldHighWater(totalFilteredTokens, windowTokens, rt, config)` + `renderHighWaterNudge` helper for §5.2 (pure, unit-testable).
4. **`src/filter.ts` `contextHandler`** — compute the total filtered tokens (it already has `rt.lastFiltered` + `estimateTokens`), compute the windowed drift signal from recent metrics, and inject either/both annotations. Track edge state in `rt.aboveHighWater` (add to `SessionRuntime` in `src/runtime.ts`).
5. **Tests:** windowed-drift unit tests (single heavy turn → no fire; sustained window → fire; the exact acceptance from §5.1); high-water edge-trigger test (crosses once → one annotation; stays above → no repeat; drops below then above → fires again); config-validation tests for the three new knobs + the 3000→6000 change. Update any existing test asserting `driftThresholdTokens === 3000`.

---

## Sync changeset-level documentation (Mode B; depends on P3.M1–M3)

**README.md** is stale relative to this changeset and must be synced once all three milestones land:
- **Config table + JSON example** (`README.md` ~line 91–108): add rows for `shrink.maxActive`, `shrink.staleAfterFires`, `nudges.driftWindowTurns`, `nudges.highWaterFraction`; change `nudges.driftThresholdTokens` default `3000 → 6000` with the windowing rationale; update the commented JSON example to match.
- **Tools list**: add `mulligan_cancel` (purpose + the D6-amendment framing: markers are now retractable by id).
- **Feature blurbs / "How it works"**: mention windowed drift signaling + the high-water signal alongside the existing per-turn drift nudge, and note marker retraction as a safety valve for mis-targeted rewinds/shrinks.

(No `SPEC.md`/`spec/07`/`spec/08`/`spec/09` writing is needed here — those are the *source* of this delta and already exist. The Mode A spec entries for `spec/05`/`spec/04`/`spec/06` are carried under P3.M1.)

---

## Non-goals for this delta

- No new architecture, no new event, no new model request (D4 holds — all nudges ride the existing `context` fire).
- No hard-delete, no on-disk replay of hidden content (E21 scope: retraction only suppresses the marker going forward; originally-hidden messages stay recoverable via `/tree`; on-disk side effects persist — D1/E5).
- No drift-nudge behavior change beyond §5.1/§5.2 (the existing bloat reminder and single-turn drift path are unchanged except where the window now gates the latter).
- The reserved `shrink.autoOnBloat` stays out of v1.

## Definition of done

1. `npm test` green: new unit tests for cancel-readMarkers, cancel/audit tools, windowed drift, high-water edge-trigger, stale retirement, and config validation.
2. All three feature groups behave per their spec acceptance criteria (E21 a–d; E15 retirement + cap; §5.1/§5.2 windows/edge-trigger).
3. `config.enabled === false` still makes everything a clean no-op; every new code path is fail-open (never breaks a turn — E13).
4. README + the `spec/05`/`spec/04`/`spec/06` entries reflect the new tool/marker/filter behavior; `driftThresholdTokens` is 6000 in code, config docs, and README consistently.