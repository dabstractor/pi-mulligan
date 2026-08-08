# Research notes — P1.M3.T2.S1: Enhance F-rewind-core + F-checkpoint smoke assertions (RE-PLAN, attempt 2/3)

## Why attempt 1 failed (the issue feedback)
Attempt 1 tried to assert actual hiding on the **2-prompt** deterministic path (`-p "/mulligan_smoke X" -p "Reply OK"`).
It hit a STRUCTURAL wall: at command-handler time on a FRESH session, the only thing on the branch is the
`/mulligan_smoke` user message itself — nothing committed AFTER it. So:
- resolveLastTurn finds no message after the last user → K=0 → nothing pinned.
- setCheckpoint (post-M1.T2.S1 fix) walks getBranch() backwards for a `message` entry with a role; on a fresh
  session at command-handler time there is NONE → "no stable entry to checkpoint" → REFUSES → no label, no marker.
Attempt 1's HIDE_CANARY workaround (pi.sendMessage a custom_message inside the handler) also gave K=0 because the
just-appended custom_message is not yet resolvable/committable at the synchronous rewind-preview tick, AND custom
messages are not the `message` entries the resolvers count. Conclusion (attempt 1): "deterministic hiding is
impossible; re-scope to pure-unit tier (P1.M3.T1.S1) or model-driven."

## THE BREAKTHROUGH (this session) — the SEED-prompt approach breaks the wall
The wall only holds for the **2-prompt** path. A **seed model turn PREPENDED** before the command handler commits
a real assistant message to the branch, so at command-handler time the resolvers HAVE content to anchor/hide.
Verified empirically (fresh `$$`-suffixed session IDs each run; pi 0.84.1; working keys present):

### F-rewind-core — 3-prompt seed flow (CONFIRMED)
`-p "Reply with exactly: SEED" -p "/mulligan_smoke F-rewind-core" -p "Reply OK"`
- p1 commits the SEED assistant reply.
- p2 command: `rewindNow(last_turn)`. The smoke log `tool.rewind` line reads:
  **"Mulligan: rewound last_turn. 1 messages will be hidden from your view starting next turn."** → **K=1**.
  (resolveLastTurn: iLastUser=user(p1); remove=indices>p1=[SEED assistant]; captureHideEntryIds pins it.)
- p3 observing inference: a throwaway 3rd observer logged `roles=[custom,user,custom,user]` → **NO assistant
  survives**. The SEED reply is HIDDEN. (Compare 2-prompt baseline: K=0, count:3, nothing hidden.)

### F-checkpoint — 5-prompt set/seed/rewind split flow (CONFIRMED, K>0)
`-p "Reply SEED_ANCHOR" -p "/probeCp" -p "Reply SEED_HIDDEN" -p "/probeRw" -p "Reply OK"`
(throwaway probe registering probeCp=setCheckpoint, probeRw=rewind, + a context observer)
- setCheckpoint: **"checkpoint 'alpha' set at entry b0c90c1c"** → SUCCEEDED (found SEED_ANCHOR assistant).
- rewind: **"Mulligan: rewound checkpoint. 2 messages will be hidden from your view starting next turn."**
  → **K=2** (the post-checkpoint SEED_HIDDEN turn + its user prompt). Catches BUG-003 directly (was always K=0).
- p5 observing: `n=4 assistants=1` (SEED_ANCHOR survives = checkpoint kept its anchor; SEED_HIDDEN is gone).

### Baseline breakage ALSO confirmed (must be fixed by this task)
The CURRENT 2-prompt F-checkpoint REFUSES on a fresh session:
- `tool.checkpoint`: "Mulligan: refused — could not set checkpoint: no stable entry to checkpoint"
- `tool.rewind`:    "Mulligan: refused — checkpoint 'alpha' not found on this branch."
- context.fire: count:2, notePresent:false, hasRewindMarker:false.
→ assertCheckpoint FAILS at baseline (no label, no marker). This is a regression from the M1.T2.S1 setCheckpoint
fix (it now correctly refuses on a transient leaf). The seed flow FIXES it (setCheckpoint finds the seed assistant).

## Why the SEED approach is legitimate (NOT a "vacuous guard")
- The seed reply is REAL committed content produced by the model (the same mechanism the harness ALREADY relies on
  for session-JSONL persistence: the 2nd `-p "Reply OK"` must produce a model reply). Adding seed turns is the SAME
  kind of model-dependence the suite already has.
- TWO independent signals compose into the guard (no single-point vacuity):
  (a) `tool.rewind` text reports K≥1 → the REAL rewind tool FOUND + PINNED hideable content (proves it existed).
  (b) context handler logs the seed canary ABSENT from the assistant view on the observing inference (proves it's
      hidden, not just absent). If pinning regressed (BUG-001/002) the seed reply LEAKS BACK → (b) fails. If
      resolveCheckpoint regressed to remove=[] (BUG-003) → (a) reports K=0 → fails.
- On model TIMEOUT (no seed reply): (a) reports K=0 → the assertion FAILS with a clear message — honest (cannot
  assert hiding without content), NOT a silent false-pass. This is the correct behavior.

## Why the LITERAL contract ("MSG_CANARY hidden by last_turn") is still impossible — and the honest substitute
The session-start MSG_CANARY is injected at session_start BEFORE the first user message. resolveLastTurn removes
ONLY content AFTER the last `role:"user"` message → the session-start canary is NEVER in the removal set. This is
structural and unrelated to fresh/polluted sessions. The contract's INTENT ("a deterministic guard that FAILS if
hiding regresses") IS achievable: assert the SEED reply (committed AFTER the first user message) is hidden. This is
the "dedicated hideable canary after the rewind/checkpoint point" the attempt-1 notes already identified as the
intent — but created via a real model turn (works) instead of pi.sendMessage (fails).

## Design (minimal, never-throwing; 2 files, no new files/tools)
### smoke.ts
- +2 const: `SEED_ANCHOR="MULLIGAN-SMOKE-SEED-ANCHOR"`, `SEED_HIDDEN="MULLIGAN-SMOKE-SEED-HIDDEN"`.
- +1 module var `currentScenario` (set+normalized in driveScenario; read by the context handler).
- context handler: +2 fields (`seedAnchorInAssistant`, `seedHiddenInAssistant`), +2 scenario-scoped HARD
  smokeLog pass/fail assertions (F-rewind-core.hiding on `hasRewindMarker` → seedHiddenInAssistant===false;
  F-checkpoint.hiding → seedHiddenInAssistant===false AND seedAnchorInAssistant===true).
- driveScenario: set currentScenario; add `F-checkpoint-set` (setCheckpoint only) + `F-checkpoint-rewind`
  (rewindNow only). F-rewind-core recipe UNCHANGED (the seed is prepended by run-smoke.mjs). Old `F-checkpoint`
  case kept as a fallback alias (not driven by the new flow).
### run-smoke.mjs
- runPi: accept optional `{prompts}` (default = existing 2-prompt flow) so seed flows can pass custom -p sequences.
- runScenario: special-case F-rewind-core (3-prompt seed) + F-checkpoint (5-prompt set/seed/rewind).
- assertRewindCore: +K≥1 assert (not "0 messages will be hidden") + seed-hidden assert (F-rewind-core.hiding pass).
- assertCheckpoint: rewrite — setCheckpoint SUCCEEDED (not refused) + rewind K>0 (BUG-003) + seed-hidden/anchor-
  survives (F-checkpoint.hiding pass) + existing JSONL label/marker invariants.

## Verified facts (this session, all direct — no inference)
- Rewind K-text formats (src/tools/rewind.ts, confirmed in smoke logs): K=0 → "0 messages will be hidden from your
  view starting next turn (nothing matched to hide)"; K>0 → "${k} messages will be hidden from your view starting
  next turn". Regex `/0 messages will be hidden/i` detects K=0. Refusals contain "refused".
- setCheckpoint stable-entry logic (src/markers.ts:345-376): walks getBranch() ROOT→LEAF backwards for a `message`
  entry with non-empty `message.role`; none found → `{error:"no stable entry to checkpoint"}`. A seed model turn
  produces exactly such an entry → setCheckpoint succeeds.
- resolveLastTurn (src/transforms.ts:319): iLastUser = last role:"user"; remove = indices > iLastUser (minus the
  rewind's own unit + notes). A seed reply AFTER user(p1) is in the removal span.
- vitest baseline (this session): 18 files / 706 tests green. tsc: exit 0. My task touches smoke.ts (type-checked
  via tsconfig include:['src','test']) + run-smoke.mjs (plain .mjs, NOT type-checked). vitest does NOT run smoke.ts.
- pi 0.84.1 available at /home/dustin/.local/bin/pi; working keys present (OPENAI/CLAUDE/etc).

## Files in scope (both MODIFIED — no new files)
- `test/integration/smoke.ts` — ~25 new lines (consts, module var, context-handler fields/assertions, 2 cases).
- `test/integration/run-smoke.mjs` — runPi refactor + runScenario special-cases + 2 asserter rewrites (~40 lines).

## Parallel coordination (P1.M3.T1.S1 — LANDED)
P1.M3.T1.S1 APPENDED unit tests to test/transforms.test.ts (the pure-tier permanence guard — 706 tests). It does
NOT touch smoke.ts or run-smoke.mjs. My task is the INTEGRATION-tier guard (complementary, different files). The
two tiers together: unit tier proves filterPipeline permanence; integration tier proves the REAL tools + REAL pi
session + REAL filter fire-hide the content end-to-end.

## Residual risks
1. **Seed model-turn reliability:** the seed prompt asks for an exact reply; models usually comply but may add
   framing. The guard is robust because (a) K≥1 from the tool proves content existed regardless of exact text, and
   (b) seedHiddenInAssistant checks the canary substring in any assistant message. If a model totally ignores the
   seed instruction → no assistant content → K=0 → honest FAIL. Mitigation: keep seed prompts trivially simple.
2. **Model-dependence (timeout):** these 2 scenarios now REQUIRE working model turns (same as session-JSONL
   persistence already does). On timeout they FAIL with a clear K=0/seed-missing message (honest). Documented.
3. **Pi prompt persistence of /cmd:** verified /mulligan_smoke command prompts do NOT appear in the filtered view
   as user messages (the obs probe showed roles without a stray user for the command). So the view stays clean.
4. **F-checkpoint 5-prompt length:** longer flow = slightly more model-turn surface. Each turn is trivial
   ("Reply OK"/"Reply SEED"). The 120s PI_TIMEOUT_MS in run-smoke.mjs is ample (probes finished in ~3s/turn).