# PRP — P1.M2.T1.S1: Rewrite the F-shrink-preventive model-driven path in scenarios.md (BUG-002)

## Goal

**Feature Goal**: Fix the two defects in the **F-shrink-preventive** scenario of `test/integration/scenarios.md`
so the test plan (a) cites the correct **per-tool** bloat thresholds (no stale `>8KB`) and (b) no longer claims
`mulligan_smoke_big` triggers the bloat reminder / sets `bloatHit:true` — because `bloatReminderHandler` skips
every `mulligan_*` tool. The rewritten model-driven path must be **consistent with `test/integration/smoke.ts`
itself** (lines 14–17, 139–141, 205–211), which already documents this limitation.

**Deliverable**: A documentation-only edit (Mode A) to **exactly one file** — `test/integration/scenarios.md` —
touching three spots inside the F-shrink-preventive scenario (§, lines 146–170):
- **line 148** — the `**Tests:**` line (stale threshold)
- **lines 159–164** — the "Run (model-driven …)" block + the line that follows it (wrong claim)
- **line 170** — the `**Pass (deterministic):**` parenthetical (consistency; see Task 3)

**Success Definition**: After the edit, scenarios.md F-shrink-preventive (a) describes the bloat reminder as
firing on a tool result exceeding its **resolved per-tool** threshold (bash 32 KB, read 20 KB, all others the
16 KB global default); (b) explicitly states `bloatHit:true` is **not achievable via `mulligan_smoke_big`**
because it is a `mulligan_*` tool that `bloatReminderHandler` skips (GOTCHA #3), and is currently
**unprovable in the smoke harness**; (c) illustrates what a genuine proof would require (a non-`mulligan_*`
model tool call exceeding its per-tool threshold); and (d) contains **no** `>8KB`, no "authoritative bloatHit
proof", and no claim that `mulligan_smoke_big` triggers the reminder. The deterministic block (lines 150–157)
is **preserved unchanged** (it was already correct).

## Why

- BUG-002 is a **documentation defect that actively misleads QA**: a QA engineer following scenarios.md would
  run `Call mulligan_smoke_big and tell me what it returned.`, expect `bloatHit:true`, observe
  `bloatHit:false`, and (wrongly) conclude the bloat reminder is broken.
- The scenario **directly contradicts the harness it documents** — `test/integration/smoke.ts` lines 14–17 /
  205–211 already say `mulligan_smoke_big` is skipped and `bloatHit:true` needs a real non-`mulligan_*` tool
  call. Fixing scenarios.md makes the two files agree.
- The stale `>8KB` figure is the **old global default**; P2 raised it to 16384 (16 KB) and added per-tool
  overrides (bash 32768 / read 20480). Citing the resolved per-tool threshold is the accurate description.
- **No business logic, no code, no tests, no build.** Pure documentation.

## What

Three surgical text replacements inside the **F-shrink-preventive** section of `test/integration/scenarios.md`
(the section begins at line 146 `### F-shrink-preventive`). No heading, numbering, or structural changes; no
other scenario touched; no other file touched.

### Success Criteria

- [ ] Line 148 `**Tests:**` describes the bloat reminder as firing on a tool result **exceeding its resolved
      per-tool bloat threshold (bash: 32 KB, read: 20 KB, all other tools: 16 KB global default)** — no `>8KB`.
- [ ] Lines 159–164 model-driven block explicitly states `mloatHit:true` is **NOT achievable via
      `mulligan_smoke_big`** (a `mulligan_*` tool → skipped by `bloatReminderHandler` per nudges.ts GOTCHA #3),
      cites smoke.ts lines 14–17 / 205–211, states `bloatHit:true` is currently **unprovable in the smoke
      harness**, and illustrates the only way to get a genuine proof (a non-`mulligan_*` model tool call
      exceeding its per-tool threshold).
- [ ] Line 170 parenthetical updated so it no longer implies `bloatHit:true` is model-driven-provable (it now
      points to the model-driven note above / marks it not-asserted). *(Consistency — required, else the
      section contradicts itself.)*
- [ ] `grep -n '>8KB' test/integration/scenarios.md` → **0 hits**.
- [ ] `grep -n 'authoritative bloatHit proof' test/integration/scenarios.md` → **0 hits**.
- [ ] `grep -n 'mulligan_smoke_big.*bloat reminder\|>8KB result triggers' test/integration/scenarios.md` → **0 hits**.
- [ ] The deterministic block (lines ~150–157) is byte-identical to before (it was already correct).
- [ ] No file other than `test/integration/scenarios.md` is modified.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains the verbatim current text of all three target spots, the verbatim desired
replacement text, the authoritative source-of-truth facts (threshold values + the exact skip line) with exact
file/line citations, and the deterministic grep validation gates. The implementer needs no codebase
exploration beyond opening `test/integration/scenarios.md`.

### Documentation & References

```yaml
# MUST READ — the ONLY file this PRP modifies
- file: test/integration/scenarios.md
  why: The F-shrink-preventive scenario (lines 146–170) is the documentation surface being corrected.
  section: "### F-shrink-preventive (line 146). Edit lines 148, 159–164, 170."
  gotcha: "Lines 160 and 162 are the inner ```bash fences of a code block. When replacing lines 159–164 as
           a block, reproduce the ```bash opening fence and the ``` closing fence EXACTLY (3 backticks each),
           and keep the leading 2-space indent on the `pi …` and `-p …` lines. Do NOT touch the deterministic
           ```bash block at lines 154–156."

# MUST READ — the harness's OWN documentation of this exact limitation (the contract scenarios.md must match)
- file: test/integration/smoke.ts
  why: Already documents (correctly) that mulligan_smoke_big is skipped and bloatHit:true needs a real
        non-mulligan_* tool call. scenarios.md must AGREE with these lines.
  section: "lines 14–17 (factory header: mulligan_* skipped + new defaults); lines 139–141 (bigResult()
            comment: size moot for bloat); lines 204–211 (F-shrink-preventive command case: real proof
            requires a NON-mulligan_* tool whose result exceeds its resolved threshold — model-driven)."
  pattern: "bloatReminderHandler SKIPS mulligan_* tools (src/nudges.ts GOTCHA #3) → size never triggers the
            reminder. Defaults: global 16384; per-tool bash 32768, read 20480."

# MUST READ — the skip behavior + the pure resolver (proves why mulligan_smoke_big can never fire)
- file: src/nudges.ts
  why: (1) Line 118 `if (event.toolName.startsWith(\"mulligan_\")) return;` — the skip the scenario must cite.
        (2) Lines 86–91 bloatThresholdFor(toolName, config) — the pure per-tool resolver; proves the thresholds.
  pattern: "skip BEFORE measurement → any mulligan_* tool result is passed through untouched, no reminder, no
            bloat-hit recorded. bloatThresholdFor: falsy toolName → global; else byTool[toolName] ?? global."

# MUST READ — the authoritative defaults table (cross-check the KB figures cited in the new text)
- file: spec/09-configuration.md
  why: Lines 35–38 (config example) + 66–67 (defaults table) confirm: global 16384 (16 KB); bash 32768 (32 KB);
        read 20480 (20 KB). The new scenarios.md text must cite THESE numbers.
  section: "§2 defaults table + §4 config example. READ-ONLY — do NOT edit spec/09 (separate nit, out of scope)."

# CONTEXT — root-cause + fix approach for BUG-002
- file: plan/002_df93178e6631/bugfix/001_4ac005217ade/architecture/bug_analysis.md
  why: BUG-002 section states the two defects + the fix approach (reframe, not register a new tool).
  critical: "Do NOT add/register a new tool (that's a code change). This is a DOC reframe of scenarios.md only."

# CONTEXT — the parallel spec fix (same threshold values; no file conflict)
- file: plan/002_df93178e6631/bugfix/001_4ac005217ade/P1M1T2S1/PRP.md
  why: CONTRACT. Edits spec/05-tools.md only. Cites the SAME thresholds (bash 32 KB / read 20 KB / global
        16 KB) — this PRP must cite identical numbers so the docs are mutually consistent. No file overlap
        (this PRP edits ONLY test/integration/scenarios.md).
```

### Current Codebase tree (the only relevant slice)

```bash
test/integration/
├── scenarios.md      # ← THIS PRP edits the F-shrink-preventive section (lines 148, 159–164, 170)
├── smoke.ts          # READ-ONLY reference — already documents the limitation correctly
└── run-smoke.mjs     # READ-ONLY reference — the deterministic runner (asserts per-scenario)
src/nudges.ts         # READ-ONLY reference — skip line 118 + bloatThresholdFor lines 86–91
spec/09-configuration.md  # READ-ONLY reference — defaults table (16/32/20 KB)
```

### Known Gotchas & Conventions

```python
# CRITICAL: the three edits are INSIDE one markdown scenario. Preserve:
#   - the exact leading "**Tests:**" / "**Run (model-driven ...):**" / "**Pass (deterministic):**" bold labels;
#   - the ```bash ... ``` code-fence pair inside the model-driven block (3 backticks; 2-space-indented body);
#   - the §2.3 / SOFT / custom_message wording style used elsewhere in the file.
# Do NOT renumber, re-head, or move any block. Do NOT touch the deterministic ```bash block (lines 154–156).

# CRITICAL — the numbers are FIXED by source-of-truth. Cite EXACTLY:
#   global default = 16384 bytes = 16 KB
#   bash            = 32768 bytes = 32 KB
#   read            = 20480 bytes = 20 KB
# Do NOT write "8 KB" anywhere in the rewritten text. Do NOT round (32/20/16 KB).

# CRITICAL — the skip is unconditional and fires BEFORE measurement:
#   src/nudges.ts line 118: if (event.toolName.startsWith("mulligan_")) return;
# So mulligan_smoke_big (name starts with "mulligan_") is skipped REGARDLESS of size.
# The new text must state this; it must NOT claim mulligan_smoke_big can trigger the reminder.

# OUT OF SCOPE (do NOT touch in this subtask):
#   - spec/05-tools.md → owned by P1.M1.T2.S1.
#   - spec/07, spec/09 → read-only reference (spec/09 §4 has a separate wording nit, OUT OF SCOPE).
#   - src/* (incl. src/nudges.ts, src/tools/audit.ts) → code, owned elsewhere / out of scope.
#   - test/integration/smoke.ts, test/*.test.ts → do NOT edit the harness or unit tests.
#   - Other scenarios in scenarios.md → only F-shrink-preventive changes.
# This PRP edits ONLY test/integration/scenarios.md.
```

---

## Implementation Blueprint

### Data models and structure
_N/A — documentation-only (Mode A). No code, no types, no migrations._

### Implementation Tasks (ordered by dependencies)

Three independent edits in one file; apply in the order below. Each is an exact find/replace. **Verify each
`FIND` string matches verbatim (including the inner ```bash fences) before replacing.**

```yaml
Task 1: EDIT test/integration/scenarios.md — line 148 (F-shrink-preventive **Tests:** line)
  - FIND (verbatim current):
      "**Tests:** the bloat reminder fires on a >8KB tool result; a turn-metric with `bloatHit:true` is recorded."
  - REPLACE WITH:
      "**Tests:** the bloat reminder fires on a tool result exceeding its resolved per-tool bloat threshold (bash: 32 KB, read: 20 KB, all other tools: 16 KB global default); a turn-metric with `bloatHit:true` is recorded."
  - RATIONALE: replaces the stale ">8KB" (old global default) with the shipped per-tool resolution
    (bloatThresholdFor: bash→32768, read→20480, else global 16384). Matches spec/09 §2 + smoke.ts line 16–17.
  - PRESERVE: the leading "**Tests:** " label and the trailing "; a turn-metric with `bloatHit:true` is
    recorded." clause EXACTLY. Change ONLY the middle clause (the threshold description).

Task 2: EDIT test/integration/scenarios.md — lines 159–164 (the model-driven block, AS A WHOLE)
  - FIND (verbatim current — note the ```bash fences and 2-space indented body):
      "**Run (model-driven — the authoritative bloatHit proof):**\n```bash\npi -e ./src/index.ts -e ./test/integration/smoke.ts \\\n  -p \"Call mulligan_smoke_big and tell me what it returned.\"\n```\nThe >8KB result triggers the `[mulligan]` bloat reminder; the turn-metric records `bloatHit:true`."
  - REPLACE WITH (the reframed block — keep the ```bash fences; body lines are 2-space indented):
      "**Run (model-driven):** `bloatHit:true` is **not achievable via `mulligan_smoke_big`** — it is a `mulligan_*` tool, and `bloatReminderHandler` skips every tool whose name starts with `mulligan_` (src/nudges.ts GOTCHA #3, the `if (event.toolName.startsWith(\"mulligan_\")) return;` line), so its result — however large — never fires the bloat reminder (see smoke.ts lines 14–17, 139–141, 205–211). The smoke harness registers no non-mulligan tool that can produce a >threshold result, so `bloatHit:true` is currently **unprovable in this harness**.\n\nA genuine `bloatHit:true` proof requires a **non-`mulligan_*`** model tool call whose result exceeds its resolved per-tool threshold, e.g. a `read` of a file larger than 20 KB or a `bash` command outputting more than 32 KB:\n```bash\n# Run against a checkout that contains a >20 KB file (e.g. a generated log), NOT the stock smoke harness:\npi -e ./src/index.ts -e ./test/integration/smoke.ts \\\n  -p \"Read the file big.log with the read tool and summarize it.\"\n```\nSuch a real `tool_result` event appends the `[mulligan]` bloat reminder to the result and records `bloatHit:true` in the turn-metric."
  - RATIONALE: matches smoke.ts lines 204–211 verbatim in spirit/wording (bloatHit needs a NON-mulligan_*
    tool whose result exceeds its resolved threshold — model-driven). Removes the false "authoritative
    bloatHit proof" title and the false ">8KB result triggers" claim. Cites the skip line (GOTCHA #3) and the
    smoke.ts line refs the harness itself uses.
  - PRESERVE: the ```bash opening fence + the ``` closing fence (3 backticks each); keep the `pi -e …` line
    and the `-p …` line 2-space indented, matching the file's existing code-block style.
  - DO NOT: claim a specific output is guaranteed (the harness registers no such tool / guarantees no large
    file); the `# Run against a checkout …` comment makes the precondition explicit. If you prefer a
    `bash`-based example instead of `read`, that is equally valid — keep the threshold numbers (32 KB bash /
    20 KB read) accurate.

Task 3: EDIT test/integration/scenarios.md — line 170 (**Pass (deterministic):** parenthetical, CONSISTENCY)
  - FIND (verbatim current):
      "**Pass (deterministic):** turn-metric exists; §2.3 invariants hold. *(bloatHit:true is model-driven — SOFT.)*"
  - REPLACE WITH:
      "**Pass (deterministic):** turn-metric exists; §2.3 invariants hold. *(bloatHit:true is unprovable in the smoke harness — see the model-driven note above; not asserted here.)*"
  - RATIONALE: Task 2 establishes bloatHit:true is unprovable in the harness; leaving "is model-driven —
    SOFT" here would imply it IS model-driven-provable, contradicting Task 2 and re-introducing the exact
    inconsistency BUG-002 is about. This keeps the section internally consistent. (Deterministic pass
    criteria unchanged: turn-metric exists + §2.3 invariants.)
  - PRESERVE: the "**Pass (deterministic):**" label, "turn-metric exists; §2.3 invariants hold." clause, and
    the wrapping `*(…)*` italics. Change ONLY the parenthetical's content.
```

### Implementation Patterns & Key Details

The behavior the rewritten text must faithfully describe (from `src/nudges.ts`):

```ts
// bloatReminderHandler — fires after every tool execution (nudges.ts lines 106–148)
if (!config.enabled || !config.nudges.bloatReminder) return;        // GOTCHA #8: both gates first
if (event.toolName.startsWith("mulligan_")) return;                 // GOTCHA #3: skip our own tools  ← the key line
const bytes = resultBytes(event.content as unknown as ResultContentBlock[]);
const threshold = bloatThresholdFor(event.toolName, config);        // bash→32768, read→20480, else 16384
if (bytes < threshold) return;                                      // under threshold → no record
// … APPEND the [mulligan] reminder + push a bloat hit (accumulated → turn-metric bloatHit) …
```

Consequences the scenario text must encode:
1. **`mulligan_smoke_big`** (name starts with `mulligan_`) is skipped at line 118 — **before** any size
   measurement — so its result **never** fires the reminder and **never** records a bloat hit, regardless of
   size. (smoke.ts lines 14–17, 139–141, 205–211 document exactly this.)
2. **`bloatHit:true`** can only come from a **non-`mulligan_*`** tool whose `tool_result` exceeds its resolved
   per-tool threshold (bash > 32 KB, read > 20 KB, any other tool > 16 KB). The smoke harness registers no
   such tool, so it is **unprovable in the harness**.
3. The **threshold values** are fixed: global 16384 (16 KB), bash 32768 (32 KB), read 20480 (20 KB).

### Integration Points

```yaml
NO INTEGRATION POINTS — documentation-only change (Mode A).
  - DATABASE: none
  - CONFIG: none (the doc CITES config defaults but does not change them)
  - ROUTES: none
  - CODE: none (smoke.ts, nudges.ts, audit.ts are READ-ONLY references; owned elsewhere / out of scope)
  - The only "integration" is CROSS-DOC CONSISTENCY: scenarios.md F-shrink-preventive must agree with
    smoke.ts (lines 14–17 / 205–211), spec/09 §2 (16/32/20 KB), and the parallel spec/05 fix (P1.M1.T2.S1).
    Validation gates below enforce this via grep.
```

---

## Validation Loop

This is a markdown doc change. Validation = grep-based consistency checks + cross-file line checks. No build,
no tests. (The deterministic smoke suite `npm run smoke` is unaffected — it asserts on the smoke log/JSONL,
not on this prose; F-shrink-preventive's deterministic path is unchanged.)

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Markdown sanity — code-fence count unchanged before/after (the model-driven block keeps ONE ```bash pair;
# we neither add nor remove a fence — we replace one ```bash block with another ```bash block).
grep -c '```' test/integration/scenarios.md   # note the count BEFORE and AFTER; must be identical

# Confirm each edit landed (print the updated lines):
sed -n '148p' test/integration/scenarios.md
sed -n '159,164p' test/integration/scenarios.md   # the reframed model-driven block (may now span a few more lines)
sed -n '170p' test/integration/scenarios.md       # the updated Pass parenthetical
```
Expected: line 148 now says "exceeding its resolved per-tool bloat threshold (bash: 32 KB, read: 20 KB …)";
the model-driven block contains "not achievable via `mulligan_smoke_big`" and "unprovable in this harness";
line 170 parenthetical now says "unprovable in the smoke harness".

### Level 2: Stale-content gate (the core BUG-002 checks)

```bash
# (a) No stale ">8KB" left anywhere in the file:
grep -n '>8KB' test/integration/scenarios.md && echo "FAIL: stale >8KB remains" || echo "PASS: no >8KB"

# (b) The false "authoritative bloatHit proof" title is gone:
grep -n 'authoritative bloatHit proof' test/integration/scenarios.md && echo "FAIL: false title remains" || echo "PASS: false title removed"

# (c) The false claim "the >8KB result triggers ... bloat reminder" is gone:
grep -n '>8KB result triggers' test/integration/scenarios.md && echo "FAIL: false claim remains" || echo "PASS: false claim removed"

# (d) The correct new content is present:
grep -n 'unprovable in this harness' test/integration/scenarios.md          # expect ≥1 hit in the model-driven block
grep -n 'GOTCHA #3' test/integration/scenarios.md                            # expect ≥1 hit (the skip is now cited)
grep -n 'smoke.ts lines 14' test/integration/scenarios.md                    # expect ≥1 hit (cross-ref to harness)
grep -n 'bash: 32 KB, read: 20 KB' test/integration/scenarios.md             # expect a hit at line ~148 (the Tests line)
```
Expected: (a)(b)(c) all PASS (no hits); (d) all present.

### Level 3: Cross-file consistency (system validation)

```bash
# scenarios.md's thresholds must match spec/09 §2 + smoke.ts line 16–17 exactly (16/32/20 KB).
echo "--- scenarios.md cited thresholds ---"
grep -nE '32 KB|20 KB|16 KB' test/integration/scenarios.md

echo "--- spec/09 defaults (source of truth) ---"
grep -nE '16384|32768|20480' spec/09-configuration.md

echo "--- smoke.ts own statement (the contract scenarios.md must match) ---"
sed -n '14,17p' test/integration/smoke.ts
sed -n '204,211p' test/integration/smoke.ts

echo "--- nudges.ts skip line (the GOTCHA #3 the scenario now cites) ---"
grep -n 'event.toolName.startsWith("mulligan_")' src/nudges.ts
```
Expected: scenarios.md cites bash 32 KB / read 20 KB / global 16 KB, identical to spec/09 (32768/20480/16384)
and smoke.ts lines 14–17 / 205–211; the nudges.ts skip line exists at line ~118.

### Level 4: Creative & Domain-Specific Validation

```bash
# Optional markdown preview: confirm the F-shrink-preventive section (line 146 onward) renders cleanly —
# the model-driven ```bash block is intact, the bold labels render, the *(…)* italics render.
# (No automated gate required for a prose edit; the Level-1 fence-count check covers structural integrity.)
```

---

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: ```` ``` ```` fence count unchanged before/after the edit.
- [ ] Level 1: `sed -n '148p;159,164p;170p'` shows the updated text (line numbers may shift ±a few after the
      block rewrite — search by content if so).
- [ ] Level 2(a): no `>8KB` in the file.
- [ ] Level 2(b): no `authoritative bloatHit proof`.
- [ ] Level 2(c): no `>8KB result triggers`.
- [ ] Level 2(d): `unprovable in this harness`, `GOTCHA #3`, `smoke.ts lines 14`, and
      `bash: 32 KB, read: 20 KB` all present.
- [ ] Level 3: cited thresholds (16/32/20 KB) match spec/09 (16384/32768/20480) and smoke.ts lines 14–17/205–211.

### Feature Validation
- [ ] Line 148 `**Tests:**` describes per-tool resolution (bash 32 KB, read 20 KB, others 16 KB global); no `>8KB`.
- [ ] Model-driven block states `bloatHit:true` is NOT achievable via `mulligan_smoke_big` (skipped by
      `bloatReminderHandler` GOTCHA #3), is unprovable in the smoke harness, and illustrates what a genuine
      non-`mulligan_*` proof requires; cites smoke.ts lines 14–17/205–211.
- [ ] Line 170 parenthetical no longer implies bloatHit:true is model-driven-provable.
- [ ] The deterministic block (lines ~150–157) and the deterministic `**Run (deterministic):**`,
      `**Expect in log:**`, `**Expect in JSONL:**` lines are byte-identical to before (already correct).
- [ ] No edits to any file other than `test/integration/scenarios.md`.

### Code Quality / Scope Discipline
- [ ] Did NOT touch `spec/05-tools.md` (owned by P1.M1.T2.S1).
- [ ] Did NOT touch `spec/07`, `spec/09` (read-only; spec/09 §4 nit is out of scope).
- [ ] Did NOT touch `src/*` (nudges.ts, audit.ts), `test/integration/smoke.ts`, or any `test/*.test.ts`.
- [ ] Did NOT touch any other scenario in scenarios.md (F-rewind-core, F-shrink-persist, F-nudge-drift,
      F-protected, F-maxdepth, F-checkpoint, F-failopen, F-reload, E7/E11/E12/E15/E20).
- [ ] Did NOT register/add a new tool — this is a documentation reframe, not a code change.

### Documentation
- [ ] scenarios.md F-shrink-preventive is now internally consistent (Tests ↔ model-driven ↔ Pass) and agrees
      with smoke.ts, spec/09, and the parallel spec/05 fix.
- [ ] A QA engineer reading the rewritten scenario would NOT expect `mulligan_smoke_big` to set `bloatHit:true`.

---

## Anti-Patterns to Avoid

- ❌ Don't register a new tool or edit `smoke.ts` — BUG-002's fix is a DOC reframe, not a code change (per
  `architecture/bug_analysis.md` fix approach).
- ❌ Don't keep the "authoritative bloatHit proof" framing or the `Call mulligan_smoke_big …` command as the
  proof — that path provably cannot set `bloatHit:true` (GOTCHA #3).
- ❌ Don't write `8 KB` / `>8KB` anywhere in the rewritten text — use the shipped per-tool values
  (bash 32 KB, read 20 KB, global 16 KB).
- ❌ Don't leave line 170 saying "model-driven — SOFT" after reframing the model-driven block — that would
  re-introduce the exact self-contradiction BUG-002 is about (apply Task 3).
- ❌ Don't touch the deterministic block (lines 150–157) or the deterministic `Run`/`Expect`/`Pass` lines —
  they were already correct.
- ❌ Don't edit any file other than `test/integration/scenarios.md`, and don't edit any other scenario.
- ❌ Don't add tests — documentation-only (Mode A); there is no executable surface to test.

---

## Confidence Score

**9/10** for one-pass implementation success. This is a 3-spot markdown edit with verbatim find/replace text
for every spot, the exact source-of-truth facts (thresholds 16384/32768/20480 + the `mulligan_` skip line 118)
with file/line citations, a parallel-doc contract (P1.M1.T2.S1) citing identical numbers, and deterministic
grep validation gates for every defect. The residual risks: (1) fidelity of the inner ```bash fences when
replacing lines 159–164 as a block (mitigated by the explicit "preserve the ```bash pair + 2-space indent"
instruction and the Level-1 fence-count gate); (2) the Task 3 line-170 consistency edit is strictly required
for internal consistency but is one line beyond the literal "lines ~160–164" in the contract — flagged as a
required consistency fix with full rationale so the implementer does not skip it.