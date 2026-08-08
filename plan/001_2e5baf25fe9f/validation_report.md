# pi-mulligan — Validation Report

> Independent validation pass over the pi-mulligan v1.0 codebase against its PRD/spec.
> Produced by a read-only validation agent. **No source code was modified** — only `./validate.sh`
> and this report were written.

**Date:** validation run against commit `a79c7b0` (branch `main`).
**Environment:** Pi `0.84.1`, Node `v26.7.0`.

---

## TL;DR

The codebase is **architecturally sound and functionally correct** for its core mission. Every
headline behavior — autonomous rewind, shrink substitution, checkpoint targeting, mutation
warnings, fail-open, protected boundaries — was verified end-to-end against the **real**
production pipeline (not mocks). All 671 unit tests pass, TypeScript compiles cleanly under
strict mode, the extension loads zero-config, and all 14 integration smoke scenarios pass on a
clean run.

**However, two real issues were found**, plus three lower-severity observations:

| # | Severity | Issue |
|---|----------|-------|
| 1 | **HIGH** | Settings-driven configuration is **non-functional**. The README/spec advertise reading `settings.mulligan` and an `enabled: false` disable switch, but `src/index.ts` hard-codes `setConfig(undefined)` and never reads Pi's `settings.json`. |
| 2 | **MEDIUM** | No `LICENSE` file despite README/spec declaring MIT (package.json also lacks a `license` field). |
| 3 | **MEDIUM** | The integration smoke harness is **weaker than spec/10 §2.1's required pass criteria** — several F-* scenarios mark the *functional* outcomes as SOFT/model-driven rather than deterministically asserting them. |
| 4 | LOW | `.pi/extensions/` is empty — the README's "recommended for daily use" auto-discovery path requires manual setup the repo does not provide. |
| 5 | LOW | Documented F-protected flake on repeated `npm run smoke` (harness state-leakage from `--session-id` reuse). Could not reproduce in this environment. |

See [§3 Issues](#3-issues-found) for detail and [§4 Confirmed-working](#4-confirmed-working-behaviors) for what passed.

---

## 1. What was validated

`./validate.sh` runs six phases (only phases that exist in the repo are included):

| Phase | What | Result |
|-------|------|--------|
| 1. Type checking | `npx tsc --noEmit` (strict + skipLibCheck) | ✅ exit 0 |
| 2. Unit testing | `npm test` (vitest) | ✅ **671 passed, 0 failed** (18 files) |
| 3. Load smoke | `pi -e ./src/index.ts -p "Reply with exactly: OK"` (zero-config, spec/11 §2 Step 9) | ✅ loads, model replies `ok` |
| 4. Integration smoke | `npm run smoke` (cleaned state) | ✅ **14/14 scenarios passed** |
| 5. End-to-end functional | Real `filterPipeline` + `contextHandler` (no mocks), 13 checks | ✅ **13/13 pass** |
| 6. Static integrity | settings-gap, LICENSE, stray `console.*` | ⚠ 2 findings |

> **Note on linting/style:** no ESLint/Prettier/Ruff config exists in the repo, so those phases
> are intentionally omitted. `tsconfig.json` enforces `strict` + `noImplicitAny`, which is the
> only static-analysis gate; it passes.

---

## 2. User workflows exercised (per PRD §2.3)

The PRD's five agent capabilities were each driven end-to-end against the real pipeline:

| PRD capability | How validated | Outcome |
|----------------|---------------|---------|
| **Rewind** (shed a bloated tool group) | `contextHandler` with a `last_tool_call_group` marker + a bloated `grep` canary | ✅ bloated toolGroup hidden; rewind's own unit + user task survive (5→3 messages) |
| **Shrink** (replace a bloated result) | `contextHandler` with a `by_tool_call_id` shrink marker on a 20KB result | ✅ content replaced with summary; `role`/`toolCallId`/`toolName` preserved (pairing intact) |
| **Checkpoint** (tag + rewind to it) | `contextHandler` with a `checkpoint` marker + a `label` entry on the branch | ✅ entry→message mapping correct; messages after the checkpoint hidden (4→2), prefix kept |
| **Audit** (filtered token view) | unit-tested in `test/tools/audit.test.ts` (38 tests); uses `rt.lastFiltered` (the filtered cache), never `getContextUsage()` | ✅ covered |
| **Nudges** (bloated-result + drift) | `bloatReminderHandler` unit-tested; drift nudge suppression verified | ✅ covered |

The **mutation warning** (E5) was also verified: a `write` tool call in the rewound span produces
the ⚠ warning and the ledger correctly extracts `modifiedFiles: ["out.ts"]`.

---

## 3. Issues found

### Issue 1 — Settings-driven configuration is non-functional  *(HIGH)*

**Symptom.** README §3 ("Configuration") and spec/09 §1 state that Mulligan reads a `mulligan`
object from Pi's `settings.json` (global and/or project-local). README §3 "Disabling" explicitly
promises:

> `enabled: false` makes the **entire extension a no-op**: no context transform … the tools
> refuse cleanly with `Mulligan: refused — Mulligan is disabled.` The human can disable Mulligan
> without uninstalling it.

**Reality.** `src/index.ts:29` calls only `setConfig(undefined)`, which yields `DEFAULT_CONFIG`
(`enabled: true`, all defaults). No code path reads `settings.json`:

```
$ grep -rn "setConfig(" src/index.ts
29:  setConfig(undefined);
$ grep -rE "getSettingsPath|settings\.mulligan|settings\[" src/*.ts  # (code, not comments)
(none)
```

`setConfig` is the *only* config seam, and it is never called with anything but `undefined`. A
user who puts any of the following in `settings.json` gets **zero effect**:

- `"mulligan": { "enabled": false }` — the extension stays fully active.
- `"rewind": { "maxDepth": 10 }`, threshold tuning, `log.file`, etc. — all ignored.

**Impact.** The single most-advertised operator control (disabling without uninstalling) does not
work. This is a documentation-vs-behavior mismatch: the README actively advertises a feature the
implementation stubs out. The project's own `VERIFICATION.md` is honest about this
("DoD #4 — verified at the unit level in v1 (settings-driven disable is v1.1)"), but that caveat
is **not** surfaced to users in the README.

**Root cause (structural).** Pi's `ExtensionContext` does **not** expose a settings accessor
(verified against `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`).
Reading settings requires importing `getSettingsPath()` from the Pi package and parsing the file
(a real, supported path — the function is exported). The v1.0 factory simply does not do this.

**Recommendation.** Either (a) wire `index.ts` to read `settings.mulligan` via `getSettingsPath()`
+ a JSON parse (the documented contract), or (b) correct the README to state that v1.0 is
zero-config-only and settings-driven disable/tuning arrives in v1.1. As written, the README
misleads operators.

---

### Issue 2 — No LICENSE file despite MIT declaration  *(MEDIUM)*

**Symptom.** `spec/SPEC.md` (line 2) and README §8 declare the project **MIT**-licensed. README
§8 even notes: *"Adding a top-level `LICENSE` file with the MIT text is recommended but not yet
present in this repo."* `package.json` has **no `license` field** either.

```
$ ls LICENSE* 2>/dev/null || echo "NO LICENSE FILE"
NO LICENSE FILE
$ grep -n "license" package.json || echo "NO license field in package.json"
NO license field in package.json
```

**Impact.** Without an explicit license file (or a `package.json` `license` field), the code is
effectively **"All Rights Reserved"** by default copyright — which contradicts the MIT claim and
makes the package technically unusable/redistributable under the terms the project advertises.
For a project that states MIT in three places, the omission is a real (if easily fixed) gap.

**Recommendation.** Add a top-level `LICENSE` file with the standard MIT text and set
`"license": "MIT"` in `package.json`.

---

### Issue 3 — Integration smoke harness is weaker than spec/10 §2.1's required pass criteria  *(MEDIUM)*

**Symptom.** spec/10 §2.1 defines explicit pass criteria for each F-* scenario. The shipped
harness (`test/integration/run-smoke.mjs`) marks several of the *functional* outcomes as `soft`
(warn-only, not failing) or only partially asserts them:

| Scenario | spec/10 §2.1 required pass criteria | Harness actually asserts (hard) |
|----------|--------------------------------------|----------------------------------|
| **F-rewind-core** | "`context.fire` shows canary present then **dropped** on the next inference; a second assistant message is produced (auto-prompt)" | Only: marker+note persist (JSONL), `context.fire` observed, `hasRewindMarker`. **Canary-drop + auto-prompt are SOFT.** |
| **F-shrink-preventive** | "result content has the appended `[mulligan]` reminder; `turn-metric` records `bloatHit:true`" | Only: `tool.smoke_big` logged, a turn-metric exists. **Reminder-append + `bloatHit:true` are SOFT.** |
| **F-nudge-drift** | "next inference's filtered view **ends with a `mulligan:nudge` custom message**" | Only: a turn-metric exists, ZERO nudge entries on disk. **`hasNudge:true` is SOFT.** |
| **F-checkpoint** | "rewind **hides back to the labeled point** (assert filtered message count drops to prefix)" | Only: label + rewind entries exist. **Count-drop not asserted.** |

The harness comments are candid about *why* (the `-p` two-prompt orchestration injects a new user
message between the rewind and the observing inference, so a `last_turn` canary is no longer
"after the last user message" by context-fire time — the canary-drop becomes model-driven).

**Impact.** The headline DoD criterion #1 — *"An agent that captures a bloated tool result can,
autonomously and within the same agent loop, shed it so that no subsequent inference sees it —
**proven end-to-end**"* — is **not** deterministically proven by the project's own integration
suite. (It *is* covered indirectly: the pure `filterPipeline` has 132 unit tests, and
`contextHandler` delegates correctly; my Phase 5 e2e checks close the gap with the real pipeline.
But the project's `npm run smoke` does not meet spec/10 §2.1's literal bar for these scenarios.)

**Recommendation.** Either strengthen the harness (e.g., a `last_tool_call_group` canary that
*is* deterministically droppable, or an in-process driver that fires `context` without injecting a
new user message), or explicitly document in `scenarios.md`/`VERIFICATION.md` which criteria are
SOFT and why, so DoD #1's "proven end-to-end" claim is not overstated.

---

### Issue 4 — `.pi/extensions/` is empty; auto-discovery not set up  *(LOW)*

README §2 names `.pi/extensions/*.ts` (project-local) as the **"recommended for daily use"** load
path (supports `/reload`). The directory exists but is empty:

```
$ ls -la .pi/extensions/
(empty)
```

**Impact.** Only `pi -e ./src/index.ts` works out of the box. The "recommended" path requires the
operator to manually symlink/copy `src/index.ts` — a step the repo does not document procedurally
or automate. Minor, since `pi -e` works, but the README's framing ("recommended for daily use")
implies it is ready.

**Recommendation.** Either add the symlink (or a build step) or reframe README §2 so `pi -e` is
presented as the primary path and auto-discovery as "set this up yourself if you want `/reload`".

---

### Issue 5 — Documented F-protected flakiness on repeated `npm run smoke`  *(LOW)*

`VERIFICATION.md` documents that `run-smoke.mjs` reuses `--session-id smoke-<scenario>` across
invocations, so repeated `npm run smoke` runs (without clearing state) accumulate user messages
in the F-protected session file, which can flip its `iFirstUser === iLastUser` assumption and
flake the assertion.

**Could not reproduce** in this environment (two consecutive `npm run smoke` runs both passed
14/14). Documenting it as a real-but-environment-dependent harness quality issue: a test that can
flake depending on prior runs is a maintenance hazard even if it usually passes. The documented
mitigation (run-scoped session IDs) is reasonable.

---

## 4. Confirmed-working behaviors

The following were verified and give high confidence in the core product:

- **Pure transform core** (`transforms.ts`, 0 Pi imports): `partitionIntoUnits` pairing,
  `resolveLastToolCallGroup`/`resolveLastTurn`/`resolveCheckpoint`, `applyRewind`/`applyShrink`,
  `filterPipeline` composition, `protectedOk` — 132 unit tests + the e2e checks above.
- **Pairing invariant** holds end-to-end: shrinking a `toolResult` preserves `toolCallId`/`toolName`
  so the model API never sees an orphaned `toolCall`/`toolResult`.
- **Rewind** (the headline feature): a bloated `grep` toolGroup is hidden from the filtered view
  while the rewind's own mid-turn unit and the user task survive — verified with the **real**
  `contextHandler` + `filterPipeline`, no mocks.
- **Shrink**: content substitution in place, pairing-relevant fields preserved.
- **Checkpoint**: the one place Mulligan maps entries↔messages (`resolveCheckpoint`) correctly
  maps a labeled entry to a message index and hides the suffix; refuses safely on compaction
  (indeterminate) rather than guessing.
- **Mutation warning (E5)**: a `write` in the rewound span yields the ⚠ warning + a correct
  `modifiedFiles` ledger.
- **Fail-open (E13)**: a malformed marker does not throw and does not break the turn.
- **Protected boundary (E3)**: a nuclear `last_turn` rewind on a single-user-message session is
  refused (the original task survives).
- **Determinism**: rewinds oldest-first, shrinks oldest-first, last-wins on duplicate shrink
  targets (E17).
- **Zero-config load** (spec/11 §2 Step 9): `pi -e ./src/index.ts -p "..."` loads with no
  `mulligan` config and completes a turn.
- **Code hygiene**: exactly one `console.warn` in `src/` (the documented config-validation seam in
  `config.ts`); no stray `console.log`/`error`/`debug`/`info`. `tsc --noEmit` clean.
- **API correctness**: every Pi symbol the tools/handlers use (`defineTool`,
  `sessionEntryToContextMessages`, `ReadonlySessionManager` members `getEntries`/`getBranch`/
  `buildContextEntries`/`getLeafId`/`getSessionId`/`getSessionFile`, `ExtensionContext.getContextUsage`,
  `pi.appendEntry`/`sendMessage`/`setLabel`/`on`/`registerTool`) is a real export verified against
  the installed Pi `.d.ts`.

---

## 5. Observations (not bugs)

- **`TurnMetric.deltaTokens` type widened to `number | null`.** spec/04 §5's code block shows
  `deltaTokens: number`, but its prose says "If the baseline is missing … `deltaTokens` is `null`".
  The implementation (`markers.ts`) widened the field to `number | null` to honor the prose; this
  is a defensible reconciliation of an internal spec inconsistency, and the nudge path handles
  `null` correctly. Not a bug.
- **Depth guard counts all markers ever** (not "currently-effective" ones). Since markers are
  permanent (no GC), an agent that legitimately rewinds 6+ times in a long session is permanently
  blocked from rewinding again (must use `mulligan_shrink` or continue). This matches spec E4's
  "markers are permanent" stance but is a latent usability ceiling worth noting for v1.1.
- **VERIFICATION.md is unusually candid** about the v1 limitations (the settings gap, the harness
  SOFT markers, the F-protected flake). That honesty is a positive signal; the gap is that the
  *user-facing* README does not carry the same caveats.

---

## 6. Reproducing this report

```bash
./validate.sh          # runs all 6 phases; exits non-zero if any finding
                       # (currently exits 1 on Issue 1 + Issue 2)
```

Phase 4 (`npm run smoke`) takes ~5–8 minutes (14 scenarios × 2 `pi` spawns each). For a fast
re-check, phases 1–3 + 5–6 run in under a minute:

```bash
npx tsc --noEmit && npm test && pi -e ./src/index.ts -p "Reply with exactly: OK"
```

---

## 7. Verdict

**The core product works.** The pure-transform correctness heart, the Pi integration glue, the
four tools, and the fail-open discipline are all sound and verified end-to-end. The two findings
that gate `validate.sh` (Issue 1 settings-reading, Issue 2 LICENSE) are **documentation/packaging
gaps**, not functional defects — but Issue 1 in particular means the README advertises an operator
control (`enabled: false`) that silently does nothing, which warrants fixing or correcting the
docs before any "releaseable" claim is taken at face value beyond the zero-config happy path.