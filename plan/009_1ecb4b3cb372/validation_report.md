# pi-mulligan — Validation Report

**Repo:** `pi-mulligan` (branch `state-reset`, spec v1.2) · **Pi:** `0.84.1` · **Validator:** automated + manual
**Date:** 2026-08-13

---

## 1. Executive summary

`pi-mulligan` is a mature, heavily-instrumented Pi extension giving a coding agent autonomous,
token-cheap control over its own context window (rewind / shrink / cancel / audit) plus an opt-in
working-tree-revert feature (v1.2) and a narrow human slash-command surface (v1.1).

**Validation outcome: the code is correct and production-ready.** All deterministic gates pass:

| Gate | Command | Result |
|---|---|---|
| Type checking (strict) | `npm run typecheck` (`tsc --noEmit`) | ✅ PASS — 0 errors |
| Unit + integration tests | `npm test` (vitest) | ✅ PASS — **1394 / 1394 tests across 31 files** |
| Integration smoke (isolated) | `npm run smoke` (14 scenarios) | ✅ PASS — **14 / 14** (verified in isolation; see Issue #1) |
| Live extension load (isolated) | `pi -e ./src/index.ts` | ✅ PASS — loads + filters correctly |
| Spec invariants (static) | grep checks | ✅ PASS — nudge never persisted; note `display:true`; SAFETY INVARIANT enforced |

**One operational issue was found (Issue #1, minor–moderate).** It is **not a code defect** — the
extension runs correctly when loaded as a single copy — but it makes the project's own primary
E2E acceptance gate (`npm run smoke` and the README "Zero-config smoke") un-runnable in the exact
configuration the README recommends for daily use. Details and remediation below.

No critical, major, or correctness bugs were found in the implementation itself. The pure transform
core, the marker/notes data model, the v1.2 git/CAS snapshot backends (including the `.git`
byte-identical git-safety guarantee and the forbidden-root / dirty-guard defenses), and the v1.1
consent model all match the PRD and are covered by passing tests.

---

## 2. Issue tracker

### Issue #1 — `npm run smoke` and the "Zero-config smoke" fail whenever `pi-mulligan` is globally registered as a Pi package *(minor–moderate, operational/tooling)*

**Severity:** minor–moderate (blocks the documented acceptance check; no runtime impact on a correctly-installed production copy).

**Symptom.** Running the project's own E2E acceptance gate produces total red:

```
$ npm run smoke
FAIL F-rewind-core    — EXTENSION LOAD FAILED (check src/index.ts; pi exit=1)
FAIL F-shrink-persist — EXTENSION LOAD FAILED (check src/index.ts; pi exit=1)
... (all 14 scenarios)
0/14 scenarios passed
```

The README "Zero-config smoke" (spec/11 §2 Step 9 acceptance check) fails the same way:

```
$ pi -e ./src/index.ts -p "Reply with exactly: OK"
Error: Failed to load extension ".../pi-mulligan/src/index.ts":
       Tool "mulligan_rewind" conflicts with .../pi-mulligan-state-reset/src/index.ts
Error: Failed to load extension ".../pi-mulligan/src/index.ts":
       Tool "mulligan_shrink" conflicts with .../pi-mulligan-state-reset/src/index.ts
... (mulligan_audit, mulligan_cancel)
Hint: Start without extensions using "pi -ne".
```

**Root cause.** Pi auto-loads every extension listed in `~/.pi/agent/settings.json` → `packages`.
In this environment that list contains `"../../projects/pi-mulligan"` (the `main`-branch checkout),
so the extension is **already registered before** the `-e ./src/index.ts` flag is processed. The
globally-loaded copy and the `-e` copy both call `pi.registerTool({ name: "mulligan_rewind", … })`
→ duplicate-tool-name conflict → the `-e` copy is rejected → `pi` exits 1 → the smoke orchestrator
(`run-smoke.mjs`) reports "EXTENSION LOAD FAILED" for all 14 scenarios. The 14 red lines look like a
total code break but are purely a duplicate-registration conflict.

This is **the README's own recommended install path** (§2 "Three ways to load": auto-discovery into
`~/.pi/agent/extensions/`, or "As a distributed Pi package: `pi install`") — i.e. the configuration
every daily-use / production user is in. `VERIFICATION.md` line 18 and 24 assert "`npm run smoke` →
14/14 passed" and "`pi -e ./src/index.ts` → no load error" as acceptance results, but neither
document states the implicit precondition ("no other copy of pi-mulligan may be registered").

**Evidence it is NOT a code defect.** With the global registration temporarily removed (atomic
backup/restore, then re-verified), the identical code passes every gate:
- `pi -e ./src/index.ts -e ./test/integration/smoke.ts …` → loads cleanly, smoke logs
  `[mulligan-smoke] PASS F-rewind-core.hiding`, context-fire shows the canary correctly dropped
  (`msgCanaryPresent:true, resultCanaryPresent:false, notePresent:true, hasRewindMarker:true`).
- Full `npm run smoke` → **14/14 scenarios PASS** (9 F-* + 5 edge cases E7/E11/E12/E15/E20).

**Impact.** Any developer who installed `pi-mulligan` the recommended way (global package or global
auto-discovery) and then clones the repo to run the acceptance check sees 14/14 red and is misled
into believing the code is broken. The unit suite still passes (so the pure logic is provably
correct), but the real-Pi `context`-event E2E proof — the central artifact the project exists to
validate — becomes un-runnable without undocumented manual steps.

**Why the harness has no defense.** `run-smoke.mjs` spawns `pi -e ./src/index.ts …` with no flag to
suppress global-package auto-loading (Pi has none analogous to a "only these extensions" mode that
also keeps the `-e` copy), and it does not detect the conflict signature (`Tool … conflicts with`)
to translate the misleading "EXTENSION LOAD FAILED" into an actionable message.

**Suggested remediation (for the implementer — this validator does not modify code):**
1. Document the precondition in `VERIFICATION.md` + `README.md` ("Zero-config smoke" / "How to run
   the smoke"): *if `pi-mulligan` is registered globally, remove it from
   `~/.pi/agent/settings.json` → `packages` (or use `pi -ne` + an alternate load mechanism) before
   running `npm run smoke`.*
2. Harden `run-smoke.mjs`: detect the `Tool … conflicts with` / `EXTENSION LOAD FAILED` +
   empty-smoke-log signature and print a single clear diagnostic ("a second copy of pi-mulligan is
   already registered at `<path>`; remove it from settings.json `packages` and re-run") instead of
   14 misleading red lines.
3. (Optional) Add a one-shot isolated runner (`npm run smoke:isolated`) that spawns `pi` with a
   throwaway `PI_AGENT_DIR` / temp settings so the harness is self-contained and never depends on
   the host's global registration.

**Reproducibility (100% deterministic):**
```
grep pi-mulligan ~/.pi/agent/settings.json          # → "../../projects/pi-mulligan"  (the culprit)
npm run smoke                                        # → 0/14 EXTENSION LOAD FAILED
# (temporarily remove that one line, then:)
npm run smoke                                        # → 14/14 PASS  (code is correct)
```

---

## 3. What was verified (besides the issue above)

**Implementation completeness vs PRD:**
- All 4 agent tools registered (`mulligan_rewind`, `mulligan_shrink`, `mulligan_audit`,
  `mulligan_cancel`); `mulligan_checkpoint` correctly **removed** as an agent tool (E23 resolved).
- All 3 human slash commands registered (`/mulligan_checkpoint`, `/mulligan_checkpoint_revoke`,
  `/mulligan_audit`).
- `context` filter, `tool_result` bloat nudge (Nudge A), `turn_end` drift metric + `context`
  nudge injection (Nudge B), active-checkpoint banner — all wired in `index.ts`.
- v1.2 working-tree revert: `SnapshotStore` + `GitBackend` (external shadow repo) + `CasBackend`
  + capture lifecycle (`turn_start` / `agent_end` / `tool_call`) + prompt-boundary GC.

**Safety (the highest-stakes surface):**
- `GitBackend`/`CasBackend.restore()` each re-check `isForbiddenRoot(this.cwd)` at entry and refuse
  with zero filesystem mutation (spec/14 §2 SAFETY INVARIANT — last line of defense).
- `detectAndCreate` uses lexical `existsSync('.git')` with **no upward git discovery**; workspace
  root is always `realpath(cwd)`. `isForbiddenRoot` refuses `$HOME`, `/`, and all depth-1 system
  dirs.
- `revert-git` integration test asserts the user's `.git` is **byte-identical** before vs after a
  full capture→mutate→rewind sequence (git-safety guarantee #2) — passes.
- Dirty guard refuses on post-`agent_end` drift (E30) — covered by `revert-edge` integration tests.

**Spec invariants (static + runtime):**
- `mulligan:nudge` is **never** persisted — `injectNudge`/`injectHighWaterNudge` only mutate the
  in-flight message copy (spec/10 §2.3).
- `mulligan:note` uses `display:true` (spec/04 §3).
- E22 runaway-loop backstops all present in `rewind.ts`: `maxDepth`, `maxRetriesPerPrompt`,
  `abortContextFraction`, plus the `rewindRefusedTurnIndex` nudge-mute.
- Token accounting uses the filtered view, never `getContextUsage()` (D5).

**No code-smell debt:** no `TODO`/`FIXME`/`@ts-ignore` left in `src/` (the single `@ts-expect-error`
match is inside a JSDoc comment warning *against* adding one).

---

## 4. Conclusion

The `pi-mulligan` implementation is correct, complete against the v1.2 PRD, and well-tested
(1394 passing tests incl. real-git `.git`-byte-identical assertions). The single finding
(Issue #1) is an operational gap in the project's own E2E harness: it cannot run when a second copy
of the extension is globally registered — which is the README's recommended install state — and the
failure mode masquerades as total code breakage. The code itself was independently verified to pass
all 14 smoke scenarios in isolation.