# P1.M7.T4.S2 — Verification Gate Ground Truth

> Research notes for the **final verification pass**. Captures the LIVE state of every
> Definition-of-Done gate (spec/11 §3) as observed during PRP authoring, so the PRP can state
> exact commands + expected output + the precise files to touch if a gate goes red.
> Companion file: `research/enabled-disabled-analysis.md` (the config.enabled=false no-op proof).

---

## 0. Task nature

**This is a VERIFICATION + FINALIZATION task, NOT a greenfield build.** 0.5 points. The prior
26 subtasks (M1→M7.T3) built the entire extension; S1 (parallel) writes the README. S2 is the
**convergence point**: run the 6 Definition-of-Done gates, fix any genuine failures (src/ edits
ARE permitted here, unlike S1), apply README corrections (Mode B), and do final cleanup.

The implementer should **bias heavily toward NOT changing code** — if every gate is green, the
deliverable is a green codebase + a verification report, with at most trivial cleanup. Code edits
happen ONLY when a gate is red AND the root cause is in scope (a real v1 bug, not a test that
asserts pre-E14 behavior).

---

## 1. The 6 Definition-of-Done criteria (spec/11 §3) → the gates

| # | DoD criterion (spec/11 §3) | Gate command | Current state (research) |
|---|---|---|---|
| 1 | All Tier-1 unit tests green (incl. pairing-invariant property test) | `npm test` (= `vitest run`) | **667/671 pass; 4 FAIL** in `test/edge-cases.test.ts` — see §2 |
| 2 | All F-* integration scenarios green | `npm run smoke` (= `node test/integration/run-smoke.mjs`) | NOT run live (needs `pi` + model; deterministic paths hold on timeout) |
| 3 | `mulligan:nudge` provably never persisted | grep session JSONL for `mulligan:nudge` | Code-correct (see §3); covered by smoke `assertGlobalInvariants` |
| 4 | `config.enabled=false` → pure no-op (no context transform, tools refuse) | unit tests + code inspection | Code-correct + E14 LANDED — see `enabled-disabled-analysis.md` |
| 5 | Intentional filter exception doesn't break turn | F-failopen + `filter.test.ts` fail-open tests | 1 of the 4 failing tests is the getEntries-throw case (E13) — P1.M7.T3.S1 |
| 6 | README documents everything | cross-check S1 README vs src/ | README does NOT exist yet (S1 parallel, in-flight) |

**Contract-additional gates:**
- **typebox schemas compile** → `npx tsc --noEmit` → **exit 0 (GREEN)** ✓ (verified live).
- **zero-config smoke** → `pi -e ./src/index.ts -p 'Reply with the single word: ok'` loads with no error
  (spec/11 §2 Step 9 / def-of-done #6). index.ts:29 `setConfig(undefined)` → DEFAULT_CONFIG.

---

## 2. The 4 currently-failing tests (BLOCKER — P1.M7.T3.S1 in-flight)

`npm test` currently reports `Tests  4 failed | 667 passed (671)`. ALL 4 are in
`test/edge-cases.test.ts`, which is **P1.M7.T3.S1's** "Implementing" work (E1–E20 hardening):

1. **E5** — Side effects: `a side-effecting removed span → success text ENDS WITH the VERBATIM
   MUTATION_WARNING`. (Expected text suffix vs actual — the mutation-warning string or its
   placement is slightly off.)
2. **E13** — `contextHandler: a throwing getEntries → returns undefined (void/pass-through)`.
   (filter.ts `readMarkers` already catches a throwing getEntries → empty bundle; but the
   contextHandler-level assertion may need the throw to surface differently.)
3. **E13** — `makeRewindTool: a throwing pi.appendEntry → returns a refusal text, does NOT throw`.
   (Tool returns success text instead of "Mulligan: refused" when appendEntry throws.)
4. **E13** — `makeShrinkTool: a throwing pi.appendEntry → returns a refusal text, does NOT throw`.
   (Same as #3 for shrink.)

**CRITICAL for S2:** these are NOT S2's bugs to introduce — they are P1.M7.T3.S1's in-flight
fixes. **S2 MUST NOT start until P1.M7.T3.S1 is Complete** (all 671 green). If these are STILL
red when S2 begins, that is a hard blocker: report it and stop, do NOT paper over a red gate.
The PRP's gate (a) `npm test` is the first thing that surfaces this.

---

## 3. mulligan:nudge-leak analysis (DoD #3)

**Why it's correct by construction (verified in `src/nudges.ts` `injectNudge`):**
```ts
export function injectNudge(messages: MessageLike[], metric: TurnMetric): MessageLike[] {
  const line = renderDriftNudge(metric);
  const nudge: MessageLike = { role: "custom", customType: "mulligan:nudge", content: line, display: false, ... };
  return [...messages, nudge];   // ← appended to a NEW COPY; NEVER pi.sendMessage
}
```
The nudge lives ONLY in the returned array (the in-flight context copy the model sees THIS inference).
Pi persists the ORIGINAL branch untouched → `mulligan:nudge` never lands in the session JSONL. The
function has NO `pi` parameter; it structurally cannot persist.

**How DoD #3 is verified:**
- **Smoke harness:** `run-smoke.mjs` `assertGlobalInvariants()` asserts `§2.3 ZERO mulligan:nudge
  entries on disk` for EVERY marker-creating scenario; `assertNudgeDrift` asserts it again for
  F-nudge-drift specifically.
- **Direct grep (S2 gate (d)):** after `npm run smoke`, grep ALL session JSONL files under the
  smoke temp dir (`os.tmpdir()/mulligan-smoke/`) AND any session JSONL for `mulligan:nudge`:
  `grep -rl "mulligan:nudge" /tmp/mulligan-smoke/ ~/.pi/sessions/ 2>/dev/null | wc -l` → **0**.
- **Unit test:** `test/nudges.test.ts` (drift_nudge.test.ts) asserts injectNudge returns a NEW
  array with the nudge appended + does not mutate input.

**If >0 found:** that IS a real v1 bug (a nudge leaked to disk). Fix site = `nudges.ts`
`injectNudge` (ensure it never calls `pi.sendMessage`) OR `filter.ts` contextHandler (ensure the
nudge-bearing copy is returned, not persisted). Currently correct.

---

## 4. typebox schemas (compile gate)

All 4 tool parameter schemas use `Type.Object` from `typebox` (verified, compile clean):
- `src/tools/rewind.ts:75` `RewindParams = Type.Object({ note: Type.Object({...}), granularity:
  Type.Union([Literal×3]), to_previous_prompt?: Type.Optional(Boolean), checkpoint?: Optional(String) })`
- `src/tools/shrink.ts` `ShrinkParams = Type.Object({ target: ..., replacement: String, reason? })`
- `src/tools/checkpoint.ts:48` `CheckpointParams = Type.Object({ name: Type.String({...}) })`
- `src/tools/audit.ts:61` `AuditParams = Type.Object({ top: Type.Optional(Type.Number) })`

`npx tsc --noEmit` → **exit 0** (verified live, 2024-research). `tsconfig.json` `include:["src","test"]`
+ `strict` + `skipLibCheck`. typebox IS in `node_modules/`; `@earendil-works/pi-coding-agent` is
resolved from the GLOBAL pi at runtime (absent from local node_modules — by design; spec/11 §1.1 note).

---

## 5. Zero-config smoke (DoD #6 / spec/11 §2 Step 9)

`src/index.ts:29` → `setConfig(undefined)` → `validateConfig(undefined)` → `structuredClone(DEFAULT_CONFIG)`
(enabled:true, log off). **The factory loads with NO `mulligan` settings and NEVER throws** (validateConfig
is fully try/catch-wrapped). The zero-config smoke proves this end-to-end:

```bash
pi -e ./src/index.ts -p "Reply with the single word: ok"
```

**Expected:** no "Error loading extension" / no stack trace at load; the model either responds or
times out on the model call (a model timeout is NOT a load failure — the deterministic smoke paths
persist markers BEFORE any model call). The acceptance check is the **load**, not the response.

**Gotcha — API key:** print mode (`-p`) makes a model call. If no API key is configured the call
fails, but the EXTENSION still loaded (the failure is in the model step, after the factory ran).
Distinguish: "EXTENSION LOAD FAILED" (smoke GOTCHA #12 — non-zero pi exit + empty smoke log) vs a
model/API error (the extension loaded fine). The smoke harness documents API-key tolerance.

---

## 6. config.enabled=false no-op (DoD #4) — see enabled-disabled-analysis.md

Verified code gates (grep-confirmed):
- `src/filter.ts:180` `if (!config.enabled) return;` — pass-through, does NOT pollute the audit cache.
- `src/tools/rewind.ts:322` `if (!config.enabled) return refusal("Mulligan is disabled", granularity);` — **E14 fix LANDED**.
- `src/tools/shrink.ts:235` `if (!config.enabled) return refusal("Mulligan is disabled");` — **E14 fix LANDED**.
- `src/nudges.ts:98` (bloat) + `:176` (turn_end) `if (!config.enabled || ...) return;` — no-op.
- `src/tools/audit.ts` + `src/tools/checkpoint.ts` — **INTENTIONALLY no gate** (always-on read-only
  diagnostics; documented GOTCHA #4 in each). Do NOT "fix" by adding a gate.

**v1 nuance:** config is set via `setConfig(undefined)` at load (index.ts:29). Reading real
`settings.mulligan` is **v1.1** (index.ts:28 comment). So in v1, `enabled` is ALWAYS true at
runtime via Pi settings. **DoD #4 is therefore verified at the UNIT level** — `setConfig({enabled:false})`
then assert: `filter.test.ts` "returns undefined (pass-through) when config.enabled is false";
`config.test.ts` enabled:false round-trip; `tools/rewind.test.ts` E14 refusal path. NOT via a
Pi settings.json edit (that's v1.1).

---

## 7. fail-open (DoD #5)

`contextHandler` (filter.ts) wraps its ENTIRE body in one try/catch → logs + returns nothing
(pass-through, C4). `bloatReminderHandler` + `turnEndMetricHandler` (nudges.ts) same. The tools
(rewind/shrink) wrap execute() in try/catch → refusal text, never throw.

**Verified by:**
- `test/filter.test.ts` "fail-open: a throwing filterPipeline is caught..." + "a throwing
  getSessionId is caught" + "readMarkers never throws when getEntries throws".
- `test/edge-cases.test.ts` E13 cases (the 3 currently-red ones are P1.M7.T3.S1's in-flight fixes
  for the tool-level appendEntry-throw refusal text).
- Smoke `F-failopen` (malformed marker appended → asserts pi exits 0 + context.fire still logged).

---

## 8. S1 (README) dependency

README.md does NOT exist yet (`ls README.md` → not found — S1 is in-flight in parallel). S2 assumes
S1 produces it per the S1 PRP contract. S2's gate (6) cross-checks the S1 README's accuracy claims:
- The 4 tool descriptions VERBATIM from `src/tools/*.ts` (*_DESC).
- The 12-knob config table matches `DEFAULT_CONFIG`.
- The zero-config claim is TRUE (gate (b) proves it).
- The Disabling note ↔ enabled row ↔ Guarantees are internally consistent + reflect POST-E14 behavior.

**Mode B:** if verification reveals a README inaccuracy, S2 APPLIES the correction to README.md.
S2 may edit README.md (corrections) AND src/ (genuine bug fixes) — but must NOT change the verbatim
tool descriptions or config defaults (those are source-of-truth FROM src/).

---

## 9. The gate-command cheat sheet (one-liners the PRP cites)

```bash
# (a) Tier-1 unit tests — DoD #1
npm test                                    # = vitest run ; expect 671 passed, 0 failed

# typebox + full type check
npx tsc --noEmit                            # expect exit 0

# (b) zero-config smoke — DoD #6 / spec/11 §2 Step 9
pi -e ./src/index.ts -p "Reply with the single word: ok"   # expect no LOAD error

# (2)+(3)+(5) integration scenarios + nudge-leak + fail-open
npm run smoke                               # = node test/integration/run-smoke.mjs ; expect 9/9 PASS

# (d) nudge-leak direct grep — DoD #3
grep -rl "mulligan:nudge" "$(npm config get tmp 2>/dev/null || echo /tmp)/mulligan-smoke" 2>/dev/null | wc -l  # expect 0

# (c) enabled=false no-op — DoD #4 (unit-level in v1)
npx vitest run test/config.test.ts test/filter.test.ts test/tools/  # the enabled:false + pass-through + refusal tests

# (6) README accuracy cross-check
ls README.md && grep -c "Mulligan is disabled" README.md   # Disabling note present (POST-E14)
```

---

## 10. Files the implementer may touch (ONLY if a gate is red / cleanup)

**Permitted edits (this task is allowed to fix code, unlike S1):**
- `src/*.ts`, `src/tools/*.ts` — ONLY a genuine v1 bug found by a gate (e.g. a nudge leak, a
  missing fail-open catch). Bias toward NOT editing.
- `README.md` — accuracy corrections discovered during verification (Mode B). Never change the
  verbatim *_DESC strings or config defaults.
- `test/*.ts` — only if a test asserts PRE-E14 / stale behavior and the code is correct (flip the
  assertion). Rare; prefer fixing the code.

**NEVER touch (out of scope / owned elsewhere):**
- `spec/**` — read-only reference.
- `package.json` / `tsconfig.json` / `.gitignore` — frozen.
- `plan/**/tasks.json`, `**/prd_snapshot.md` — orchestrator-owned.

**Final cleanup targets (low-risk):** stray `TODO`/`FIXME` comments that reference resolved
edge cases; dead imports; any non-`warnConfig` `console.log` left from debugging. The single
intentional `console.warn` in `config.ts warnConfig()` STAYS (it's the documented warn seam).