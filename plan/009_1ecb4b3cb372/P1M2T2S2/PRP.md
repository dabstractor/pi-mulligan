---
name: "P1.M2.T2.S2 — Stale-reference sweep across README.md + src/snapshot/*"
description: "Mode B changeset-level documentation catch-all sweep. Grep README.md + src/snapshot/*.ts (+ verify test/) for stale v1.2-detection language (rev-parse, show-toplevel, absolute-git-dir, sourceGitDir, repo-root-keyed, read-only rev-parse, share one shadow repo) and confirm NONE survives outside the SAFETY INVARIANT's intentional explanatory 'why' text. M1's Mode A doc updates landed cleanly (verified) — the sweep finds exactly ONE straggler: README guarantee #1 still says 'write command' where the hardened model is 'read or write'. Rewrite that one line; document the verification. Satisfies Definition-of-Done criterion #7 (part 2)."
---

## Goal

**Feature Goal**: Run the catch-all stale-reference sweep across `README.md` + `src/snapshot/*.ts` (and verify `test/`) for residual v1.2-detection language from the pre-hardening model (upward `rev-parse` discovery, `sourceGitDir`, repo-root-keyed sharing), and confirm none of it survives outside the `spec/14 §2` SAFETY INVARIANT's intentional explanatory "why the old behavior was removed" text. This closes the documentation half of the plan/009 detection-hardening changeset.

**Deliverable**: A documented grep-and-classify verification sweep + **one concrete edit**: reword README §5 "Git-safety guarantee" item #1 from the stale "No ref-moving or **write** command" to the hardened "No command of any kind — **read or write**" (matching `spec/14 §3` guarantee #1, the `git.ts` class header, and the S1-rewritten opening clause two lines above). The sweep itself confirms every other `rev-parse`/`sourceGitDir`/`repo-root-keyed` reference in `README.md`, `src/snapshot/*.ts`, and `test/` is intentional explanatory text, a correct negation, or a legitimate shadow-repo command — and records that finding.

**Success Definition**:
- `grep` proves **zero** stale AFFIRMATIVE detection language ("we resolve the root via `rev-parse`", "`sourceGitDir` records the rev-parse result", "repo-root-keyed sharing across subdirectory launches", "the only command against the user's git is the read-only `rev-parse`") survives in `README.md` + `src/snapshot/*.ts` outside the SAFETY INVARIANT's explicit "why removed" explanations.
- README guarantee #1 reads "No command of any kind — read or write" and is internally consistent with the §5 opening clause (line ~235) and the `### Workspace-root safety` subsection.
- `git diff --name-only` shows ONLY `README.md` changed (no `.ts` / test / config files touched).
- `npm test` still green (README is not imported by anything).
- Definition-of-Done criterion #7 (part 2) satisfied.

## User Persona

**Target User**: The operator/developer reading README §5 and the snapshot source to evaluate the revert feature's safety — and the future maintainer who must not reintroduce upward repo discovery. Stale language that describes the *old* (hazardous) model as *current* behavior is a trust defect and a foot-gun.

**Use Case**: An operator reads README §5's five git-safety guarantees. If guarantee #1 says "no **write** command" while the opening clause (line ~235) and the new "Workspace-root safety" subsection both say "no command of any kind, **read or write**", the operator sees an internal contradiction and loses trust in the doc. The sweep removes that contradiction.

**Pain Points Addressed**: The plan/009 hardening (realpath(cwd) root, no upward discovery, no-command-against-user-git) rewrote the code AND most doc comments (Mode A, via P1.M1.T1–T4) + added a README safety subsection + fixed one stale clause (Mode B, via P1.M2.T2.S1). But a catch-all is needed to catch any straggler that describes the pre-hardening model as current. This task is that catch-all.

## Why

- **DoD #7 (part 2)**: The plan/009 Definition-of-Done requires a stale-reference sweep confirming no pre-hardening detection language survives outside the intentional SAFETY INVARIANT explanation. This task is that criterion.
- **Trust + correctness**: README §5 currently contradicts itself — the opening (line ~235, S1-rewritten) and the Workspace-root safety subsection both assert "no command of any kind, read or write", but guarantee #1 (line 237) still says "write command" only. The sweep's one edit resolves the contradiction.
- **Closes the Mode B loop**: P1.M2.T2.S1 added the safety paragraph + fixed the directly-negated line-235 clause but deliberately deferred (a) guarantee #1's wording and (b) the broader `src/snapshot/*.ts` JSDoc sweep to S2. This task picks up exactly those deferred items.

## What

A documentation-only change with two components:
1. **VERIFICATION SWEEP** (the bulk — produces no edits if M1 was thorough): run the documented `grep` across `README.md` + `src/snapshot/*.ts` (+ verify `test/`) for the stale-term list, classify every hit as KEEP (SAFETY INVARIANT explanation / correct negation / legitimate shadow command) or REWRITE (stale current-behavior description), and record the inventory.
2. **ONE CONCRETE EDIT**: reword README §5 guarantee #1 (line ~237) from "No ref-moving or write command" to "No command of any kind — read or write".

### Success Criteria

- [ ] `grep -rn -iE "rev-parse|show-toplevel|absolute-git-dir|sourceGitDir|repo-root-keyed|read-only rev-parse|share one shadow repo" README.md src/snapshot/*.ts` returns ONLY intentional-explanation / negation / shadow-`has()` hits (classified KEEP in the inventory).
- [ ] README guarantee #1 (line ~237) reads "No command of any kind — read or write" (matches spec §3 guarantee #1 + git.ts class header + the line-~235 opening).
- [ ] No AFFIRMATIVE stale detection language ("resolve the root via rev-parse", "sourceGitDir records...", "repo-root-keyed sharing IS used", "the only command ... is rev-parse") survives in README.md or src/snapshot/*.ts.
- [ ] `test/` has no stale assertion that detection issues `rev-parse` against the user repo (verified, not edited — M1 reworked them correctly).
- [ ] `git diff --name-only` → README.md only.
- [ ] `npm test` still green.

## All Needed Context

### Context Completeness Check
_Passes "No Prior Knowledge":_ the implementing agent needs only `README.md` (§5, lines ~233–247), `src/snapshot/{store,git,cas,paths}.ts` (to re-run the grep against live files and spot-classify), the sweep's classification rule (quoted below), and the exact oldText→newText for the one edit. The full hit inventory from this PRP's research is provided so the agent can CONFIRM it against the live files (and catch any drift) rather than re-derive it blind. No external research needed.

### Documentation & References

```yaml
# MUST READ — the sweep definition (verbatim) + the classification rule
- docfile: plan/009_1ecb4b3cb372/architecture/test_strategy.md
  section: "lines ~87-88 (Stale-reference sweep)"   # the literal contract for THIS task
  why: "Defines the exact term list + the KEEP-vs-REWRITE boundary ('confirm none survive outside the SAFETY INVARIANT text')."
  critical: "Line ~40 of the same file gives the TARGET guarantee-#1 wording verbatim: 'No command of any kind — read or write — is ever issued against the user's git.' Use that exact phrasing."

- docfile: spec/14-working-tree-revert.md
  section: "## 2. Architecture — the SnapshotStore"   # the SAFETY INVARIANT blockquote + Detection paragraph
  why: "Source of truth for the KEEP boundary: the SAFETY INVARIANT deliberately MENTIONS the old behavior by name ('upward traversal (rev-parse --show-toplevel) once resolved...') to explain the hazard. That reference is INTENTIONAL and stays. Only references OUTSIDE this explanatory 'why' text get rewritten."
  critical: "§3 guarantee #1 is the canonical 'No command of any kind — read or write' wording — README guarantee #1 must match it."

# THE file to edit (read §5 fully before editing)
- file: README.md
  why: "The ONLY file modified. §5 'Working-tree revert' — the '### Git-safety guarantee' subsection is lines ~233-241; guarantee #1 is line ~237."
  pattern: "Mirror the README's existing guarantee-list style (bold lead-in, backtick command list, em-dash asides, spec citation). The reworded guarantee #1 must read coherently with the S1-rewritten opening (line ~235) and the new '### Workspace-root safety' subsection (line ~245)."
  gotcha: "S1 (P1.M2.T2.S1) already rewrote line ~235's opening clause AND inserted the Workspace-root safety subsection — those edits are ON DISK. Guarantee #1 (line ~237) is the straggler S1 deliberately deferred to S2. Edit ONLY guarantee #1; do NOT touch S1's opening or subsection."

# CODE EVIDENCE (read-only — re-run the grep to confirm the inventory; do NOT edit .ts files)
- file: src/snapshot/git.ts
  section: "class header guarantee #1 (lines ~36-40) + shadowKey doc (lines ~137-145) + header keying note (lines ~53-56) + has() (lines ~564-577)"
  why: "CONFIRM these are correct (M1 Mode A landed): guarantee #1 already says 'read OR write'; the keying notes explain WHY repo-root-keyed sharing is NOT used (the hazard); has() uses shadow `rev-parse --verify`. All KEEP."
  critical: "If a hit here reads as AFFIRMATIVE current behavior (e.g. 'we resolve the root via rev-parse'), that is a straggler — rewrite it to the realpath(cwd) model. As of this research, none exist; re-verify against live files."

- file: src/snapshot/store.ts
  section: "detectAndCreate doc (lines ~408-470) + the S2 divider comment (lines ~252-256)"
  why: "CONFIRM these say 'NO rev-parse / NO upward walk / rev-parse FORBIDDEN' (correct negations). KEEP."

- file: src/snapshot/cas.ts   # and paths.ts
  why: "CONFIRM zero stale-term hits (the grep should return nothing here). No action."

# CONTRACT from the parallel sibling (assume it landed exactly)
- docfile: plan/009_1ecb4b3cb372/P1M2T2S1/PRP.md
  section: "Anti-Patterns + Final Validation Checklist (S1/S2 boundary)"
  why: "S1 added the Workspace-root safety subsection + fixed the line-~235 opening clause. It EXPLICITLY deferred guarantee-#1 widening + the src/snapshot/*.ts JSDoc sweep to S2 (this task). Confirms zero file conflict (S1 is README-only; its edits are disjoint from guarantee #1)."
  critical: "S1's edits are already on disk (verified this session: README line ~235 reads 'no command of any kind, read or write'; line ~245 has the new subsection). Build on that state — do not redo or revert S1's work."
```

### Current Codebase tree (relevant slice)

```
README.md                      # ← THE file to edit (§5, guarantee #1 line ~237)
src/snapshot/
  store.ts   git.ts   cas.ts   paths.ts   # re-run grep to CONFIRM inventory (read-only — NOT edited)
test/
  store.test.ts  git.test.ts  integration/revert-{edge,git}.test.ts  # verify no stale assertions (read-only)
spec/14-working-tree-revert.md # §2 SAFETY INVARIANT (KEEP boundary) + §3 guarantee #1 (target wording)
plan/009_1ecb4b3cb372/architecture/test_strategy.md  # §87-88 = the sweep contract (read-only)
plan/009_1ecb4b3cb372/P1M2T2S1/PRP.md                # S1's deferred-to-S2 boundary (read-only contract)
```

### Desired Codebase tree (what changes)

```
README.md   # MODIFIED — guarantee #1 (line ~237) reworded "write command" → "command of any kind, read or write"
```
No other files. No `.ts`. No tests. No new files. (The src/snapshot/*.ts + test/ review is read-only verification.)

### Known Gotchas of our codebase & doc style

```markdown
<!-- CRITICAL: the classification rule is subtle. A hit is KEEP if it is EITHER (a) a correct NEGATION
     ("NO rev-parse", "rev-parse ... FORBIDDEN", "needs no rev-parse"), OR (b) explanatory "why the old
     behavior was removed" text inside/adjacent to the SAFETY INVARIANT ("the old read-only rev-parse ...
     is REMOVED — the hazard closed by the SAFETY INVARIANT"; "repo-root-keyed sharing ... intentionally
     NOT used: it required upward traversal ... the hazard"), OR (c) a LEGITIMATE shadow-repo command
     (git.ts has()'s `git rev-parse --verify <ref>` against shadowEnv()). A hit is REWRITE only if it
     AFFIRMS the old model as CURRENT behavior. M1 was thorough: as of this research the ONLY such hit is
     README guarantee #1. -->

<!-- CRITICAL: git.ts has()'s `rev-parse --verify` is NOT stale. It targets the SHADOW repo (shadowEnv()),
     not the user's git, and external_deps.md §57 explicitly says it is "KEPT (targets shadow repo)" —
     "the ONLY rev-parse that survives in src/snapshot/". Do NOT flag or remove it. The contract itself
     excludes "shadow-repo has() calls" from the sweep. -->

<!-- CRITICAL: the plan/009 architecture/*.md docs (system_context.md, external_deps.md, test_strategy.md)
     contain MANY "rev-parse"/"sourceGitDir"/"repo-root-keyed" references. These are READ-ONLY PLANNING
     docs describing the BEFORE→AFTER transition ("Was X", "TARGET STATE: Delete", "Must be removed").
     They are NOT in this task's edit scope (README.md + src/snapshot/* only). Do NOT edit them. -->

<!-- CRITICAL: do NOT edit src/snapshot/*.ts or test/. The contract scope is README.md + src/snapshot/*
     for the GREP, and the sole EDIT is README guarantee #1. If the grep finds a NEW stale .ts hit (files
     drifted since this research), rewrite that ONE comment to the realpath(cwd) model — but do not
     broaden into a code refactor. test/ is VERIFY-ONLY (M1 reworked the assertions; confirm, don't edit). -->

<!-- GOTCHA: README guarantee #1 must stay CONSISTENT with the S1-rewritten opening clause (line ~235:
     "no command of any kind, read or write") and the new Workspace-root safety subsection (line ~245).
     Use the spec §3 guarantee #1 phrasing ("No command of any kind — read or write"). There will be mild
     semantic overlap with the opening clause — that is acceptable and mirrors the spec's own structure
     (§3 intro references it; guarantee #1 states it). Do NOT revert S1's opening to "avoid redundancy". -->

<!-- GOTCHA: README renders on GitHub. Backtick all git subcommands/flags: `rev-parse`, `realpath(cwd)`,
     `.git`, `add`, `write-tree`, etc. Keep the existing command list (`add`/`write-tree`/`commit-tree`/
     `update-ref`/`read-tree`/`checkout`/`gc`) and the "Forbidden everywhere" tail unchanged. -->
```

## Implementation Blueprint

### Data models and structure
N/A — this is a documentation sweep + one prose edit. No data models.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: RUN the stale-reference grep sweep (read-only — produces the inventory)
  - RUN (the contract's term list, case-insensitive, across README + src/snapshot):
      grep -rn -iE "rev-parse|show-toplevel|absolute-git-dir|sourceGitDir|repo-root-keyed|read-only rev-parse|share one shadow repo" \
        README.md src/snapshot/store.ts src/snapshot/git.ts src/snapshot/cas.ts src/snapshot/paths.ts
  - ALSO RUN a broader-term sweep (catches affirmative detection language the term list might miss):
      grep -rn -iE "upward (traversal|discovery|walk)|resolve the (repo )?root|find an? (enclosing )?repo|git discovery" \
        README.md src/snapshot/*.ts
  - EXPECT (per this PRP's research): every hit is a KEEP (negation / SAFETY-INVARIANT explanation / shadow has()).
    Record the live inventory. If a hit is NOT in the inventory below, classify it fresh (Task 2 rule).

Task 2: CLASSIFY every hit — KEEP vs REWRITE (the contract rule)
  - KEEP if the hit is ANY of:
      (a) a correct NEGATION — "NO rev-parse", "rev-parse ... FORBIDDEN", "needs no rev-parse",
          "NO upward walk/discovery";
      (b) explanatory "why removed" text near the SAFETY INVARIANT — "the old read-only rev-parse ...
          is REMOVED", "repo-root-keyed sharing ... intentionally NOT used: it required upward traversal
          ... the hazard closed by the SAFETY INVARIANT";
      (c) a LEGITIMATE shadow-repo command — git.ts has()'s `git rev-parse --verify <ref>` (targets
          shadowEnv(), NOT the user's git; external_deps.md §57: "KEPT").
  - REWRITE if the hit AFFIRMS the pre-hardening model as CURRENT behavior — e.g. "resolve the root via
      rev-parse", "sourceGitDir records the rev-parse result", "repo-root-keyed sharing IS used", "the
      only command against the user's git is the read-only rev-parse".
  - EXPECTED inventory (verify against live files):
      * README.md line ~245 (Workspace-root safety subsection) — all rev-parse/show-toplevel/absolute-git-dir
        mentions are INSIDE the intentional explanatory subsection → KEEP.
      * README.md line ~237 (guarantee #1) — "No ref-moving or write command" → REWRITE (Task 3). [This is
        the ONLY rewrite; it does not itself contain a grep term but is caught by the broader sweep /
        the "stale description of current behavior" rule.]
      * src/snapshot/git.ts lines 38-40, 53-56, 137-145, 281, 298, 304 — KEEP (correct negations + "why
        removed" explanations). git.ts 564-577 (has) — KEEP (shadow --verify).
      * src/snapshot/store.ts lines 255, 416, 466 — KEEP (correct negations).
      * src/snapshot/cas.ts, paths.ts — no hits.
  - If a NEW REWRITE hit appears (files drifted): rewrite that ONE comment to the realpath(cwd) +
    no-command-against-user-git model (mirror git.ts header guarantee #1). Do NOT broaden into a refactor.

Task 3: EDIT README.md — reword guarantee #1 (the ONE concrete edit)
  - EDIT: README §5 "### Git-safety guarantee", item #1 (line ~237). oldText (exact, unique in README):
      "1. **No ref-moving or write command is ever issued against the user's git** — every write (`add`, `write-tree`, `commit-tree`, `update-ref`, `read-tree`, `checkout`, `gc`) targets the shadow repo. Forbidden everywhere: `commit`, `reset`, `checkout <branch>`, `merge`, `stash`, `rebase` against the source."
    newText:
      "1. **No command of any kind — read or write — is ever issued against the user's git** (the root is `realpath(cwd)` and needs no `rev-parse`; see Workspace-root safety below): every write (`add`, `write-tree`, `commit-tree`, `update-ref`, `read-tree`, `checkout`, `gc`) targets the shadow repo. Forbidden everywhere: `commit`, `reset`, `checkout <branch>`, `merge`, `stash`, `rebase` against the source."
  - WHY: guarantee #1 predates the M1 hardening (which closed READ commands too). The spec §3 guarantee #1,
    the git.ts class header (lines 36-40), and the S1-rewritten §5 opening (line ~235) all say "read or
    write"; guarantee #1 saying "write command" only is an internal contradiction 2 lines below the opening.
  - SCOPE: edit ONLY guarantee #1. Do NOT touch the opening clause (line ~235 — S1's), the Workspace-root
    safety subsection (line ~245 — S1's), guarantees #2–#5, or any other line. Do NOT touch any .ts/test file.

Task 4: VERIFY test/ has no stale assertions (read-only — the contract's explicit verify step)
  - RUN:
      grep -rn -iE "rev-parse|show-toplevel|absolute-git-dir|sourceGitDir|repo-root-keyed" test/
  - EXPECT (per this PRP's research): all hits assert the NEW behavior (NO rev-parse against user git;
    lexical detection; subdir-NOT-promoted) OR use shadow `rev-parse --verify` legitimately. Specifically:
      * test/store.test.ts 275-409 — assert NO rev-parse / lexical / no-upward-walk → correct.
      * test/git.test.ts 132-138, 239 — assert ZERO commands against user's git → correct.
      * test/git.test.ts 403-432 — shadow has() --verify tests → correct.
      * test/integration/revert-edge.test.ts 668-694 — F-revert-subdir-not-promoted → correct.
      * test/integration/revert-git.test.ts 112/116 — uses rev-parse --show-toplevel as a TEST HARNESS
        helper to canonicalize the expected repoRoot (NOT an assertion detection uses it) → correct.
  - ACTION: if a test ASSERTS the old behavior (e.g. "expect a rev-parse --show-toplevel call recorded"),
    that is a straggler — but per research none exist (M1 reworked them). Do NOT edit test/ unless you find
    a genuine stale assertion; if you do, rework it to assert the new behavior (mirror store.test.ts (a)/(f)).

Task 5: FINAL grep — prove zero stale AFFIRMATIVE language survives (read-only proof)
  - RUN (the affirmative-detection sweep — should return NOTHING):
      grep -rn -iE "resolve.{0,12}(repo )?root.{0,20}rev-parse|repo-root-keyed (is |sharing)|sourceGitDir =|only command.{0,30}rev-parse" README.md src/snapshot/*.ts
  - EXPECT: zero matches. (Any match = a straggler missed in Tasks 1-2; rewrite it per the Task-2 rule.)
  - RUN (the KEEP-set is intact — the explanatory references survive):
      grep -rn -i "SAFETY INVARIANT" README.md src/snapshot/*.ts
  - EXPECT: hits present (the intentional explanatory text that MUST stay).
```

### Implementation Patterns & Key Details

```markdown
<!-- Task 3 is the only edit. It is a single-line rewording of a numbered list item. The oldText is unique
     in README.md (the exact bold lead "**No ref-moving or write command is ever issued against the user's git**"
     appears once). Use one `edit` call with one entry. -->

<!-- Task 3 newText keeps the ENTIRE existing tail verbatim ("— every write (...) targets the shadow repo.
     Forbidden everywhere: ...") and only (a) swaps the bold lead to "No command of any kind — read or write"
     and (b) inserts a parenthetical causal note + cross-ref. This is the minimal change that resolves the
     contradiction; it does not restructure the list. -->

<!-- Reading order of §5 after the edit (unchanged by S2 — S1 already set this):
     ### Git-safety guarantee
       opening: "...no command of any kind, read or write, is ever issued against it."   [S1 — on disk]
       1. No command of any kind — read or write ... (root is realpath(cwd), needs no rev-parse)  [S2 — THIS EDIT]
       2..5. (unchanged)
     ### Workspace-root safety                                                                  [S1 — on disk]
     ### Dirty-guard behavior
   All three now AGREE: no command of any kind, read or write, against the user's git. -->

<!-- The grep commands in Tasks 1/4/5 are the VERIFICATION deliverable. Run them, paste the results into
     your work log / PR description, and confirm each hit is classified KEEP. The proof that the sweep
     passed IS the deliverable (plus the one README edit). -->
```

### Integration Points

```yaml
DOCUMENTATION (the deliverable):
  - README.md §5 guarantee #1: reworded "write command" → "command of any kind, read or write".
  - (Verification record): the grep inventories for README.md + src/snapshot/*.ts + test/ documenting
    that all other stale-term hits are intentional explanatory text / negations / shadow commands.
NO CODE: zero .ts files touched (README is not compiled).
NO TESTS: zero test files touched (test/ is verify-only).
NO CONFIG / NO DB / NO ROUTES.
DEPENDENCY ON PRIOR WORK: assumes plan/009 M1 (P1.M1.T1–T4, all Complete) + P1.M2.T2.S1 (README subsection +
                          line-235 fix, on disk). This task consumes S1's README state and closes its
                          deferred-to-S2 items (guarantee #1 wording + the src/snapshot/*.ts JSDoc sweep).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Markdown has no compiler/linter in this project (scripts = test/typecheck/smoke/prepublishOnly).
# Validate structurally with grep.
# (a) guarantee #1 is reworded:
grep -c "No command of any kind — read or write — is ever issued against the user's git" README.md
# Expected: 1   (the reworded guarantee #1)

# (b) the stale "write command" lead is GONE:
grep -c "No ref-moving or write command is ever issued against the user's git" README.md
# Expected: 0

# (c) the §5 opening (S1) is UNCHANGED by S2 (S2 did not revert it):
grep -c "no command of any kind, read or write, is ever issued against it" README.md
# Expected: 1   (S1's opening clause — still present)
```

### Level 2: Unit Tests (Component Validation)

```bash
# N/A — README.md is documentation; there is no README test. (The Python-template ruff/mypy/pytest gates
# do NOT apply: this is a TypeScript project and the edit touches no .ts/test files.)
```

### Level 3: Integration Testing (System Validation)

```bash
# THE SWEEP — the core deliverable. Run against README + src/snapshot:
grep -rn -iE "rev-parse|show-toplevel|absolute-git-dir|sourceGitDir|repo-root-keyed|read-only rev-parse|share one shadow repo" \
  README.md src/snapshot/*.ts
# Expected: EVERY hit is a KEEP — inspect each:
#   - README:245 (Workspace-root safety subsection) → explanatory, KEEP
#   - src/snapshot/git.ts (header 38-40, keying 53-56, shadowKey 137-145, init 281/298/304) → negations/explanations, KEEP
#   - src/snapshot/git.ts has() 564-577 → shadow `rev-parse --verify`, KEEP (legitimate)
#   - src/snapshot/store.ts (255/416/466) → negations, KEEP
# Affirmative-detection sweep (should be EMPTY):
grep -rn -iE "resolve.{0,12}(repo )?root.{0,20}rev-parse|repo-root-keyed (is |sharing)|sourceGitDir =|only command.{0,30}rev-parse" \
  README.md src/snapshot/*.ts
# Expected: zero matches.

# test/ verification (the contract's explicit check — verify-only, do NOT edit):
grep -rn -iE "rev-parse|show-toplevel|sourceGitDir" test/
# Expected: all hits assert the NEW behavior or use shadow --verify (see Task 4 inventory). No stale assertion.

# REGRESSION GUARD: prove only README.md changed.
git diff --name-only
# Expected: README.md  (and ONLY README.md)

# The full suite still passes (README is not imported by anything; confirms no stray .ts/test edit):
npm test
# Expected: all green.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Coherence check: read README §5 "### Git-safety guarantee" top-to-bottom. The opening clause (line ~235),
# guarantee #1 (line ~237, now reworded), and the "### Workspace-root safety" subsection (line ~245) must
# all AGREE: "no command of any kind, read or write, against the user's git." No internal contradiction.

# Scope-boundary check: confirm you did NOT touch source/test/config:
git diff --name-only | grep -qE "\.ts$|config|test/" && echo "FAIL: source/test/config changed (S2 is README-only)" || echo "OK: README-only"

# (Optional) render-check: open README.md in a GitHub markdown preview; confirm §5 reads cleanly and the
# reworded guarantee #1's parenthetical + cross-ref render correctly.
```

## Final Validation Checklist

### Technical Validation
- [ ] `grep -c "No command of any kind — read or write — is ever issued against the user's git" README.md` → 1
- [ ] `grep -c "No ref-moving or write command is ever issued against the user's git" README.md` → 0
- [ ] `grep -c "no command of any kind, read or write, is ever issued against it" README.md` → 1 (S1 opening intact)
- [ ] `git diff --name-only` → README.md only
- [ ] `npm test` → still green

### Feature Validation (the sweep)
- [ ] The stale-term grep across README.md + src/snapshot/*.ts returns ONLY KEEP-classified hits (negations, SAFETY-INVARIANT explanations, shadow `has()`)
- [ ] The affirmative-detection grep returns ZERO matches
- [ ] test/ grep confirms no stale assertion that detection issues rev-parse against the user repo
- [ ] git.ts `has()`'s `rev-parse --verify` is correctly identified as KEEP (shadow, not user git)
- [ ] README §5 is internally coherent (opening + guarantee #1 + Workspace-root safety all agree)
- [ ] DoD criterion #7 (part 2) satisfied — no stale v1.2-detection language survives outside the SAFETY INVARIANT text

### Code Quality Validation (documentation-specific)
- [ ] Guarantee #1 wording matches spec §3 guarantee #1 + git.ts class header (lines 36-40)
- [ ] All git subcommands/flags backticked in the reworded line
- [ ] Existing command list (`add`/`write-tree`/...) and "Forbidden everywhere" tail preserved unchanged
- [ ] Cross-ref "see Workspace-root safety below" is consistent with S1's opening-clause cross-ref

### Scope Guardrails (did NOT over-reach)
- [ ] ONLY README.md changed; zero `.ts` / test / config files touched
- [ ] Did NOT edit src/snapshot/*.ts (the grep there is read-only verification; M1 Mode A landed clean)
- [ ] Did NOT edit test/ (verify-only; M1 reworked the assertions)
- [ ] Did NOT touch the plan/009 architecture/*.md docs (read-only planning docs; out of scope)
- [ ] Did NOT redo or revert S1's README edits (line ~235 opening / line ~245 subsection) — built on them
- [ ] Did NOT run `ruff`/`mypy`/`eslint`/`pytest` (Python tools; no-ops in this TS+markdown project)

---

## Anti-Patterns to Avoid

- ❌ Don't flag git.ts `has()`'s `rev-parse --verify` as stale — it targets the SHADOW repo (`shadowEnv()`), is the ONLY rev-parse that survives in src/snapshot/ (external_deps.md §57: "KEPT"), and the contract explicitly excludes "shadow-repo has() calls".
- ❌ Don't rewrite the SAFETY INVARIANT's intentional "why removed" text — the spec §2 SAFETY INVARIANT deliberately names the old behavior (`rev-parse --show-toplevel` once resolved the workspace to `$HOME`) to explain the hazard. That reference STAYS. Only AFFIRMATIVE current-behavior descriptions get rewritten.
- ❌ Don't edit `src/snapshot/*.ts` or `test/` — the contract's edit scope is README guarantee #1 only. The `.ts`/`test` greps are read-only VERIFICATION (M1 Mode A + P1.M1.T2/T3 reworked them correctly). If you find a genuine new straggler (files drifted), rewrite that ONE comment to the realpath(cwd) model — do not broaden into a refactor.
- ❌ Don't edit the plan/009 `architecture/*.md` docs — they contain many "rev-parse"/"sourceGitDir" references but are READ-ONLY BEFORE→AFTER planning docs ("Was X", "TARGET STATE: Delete"). Out of scope.
- ❌ Don't revert or redo S1's README edits (line ~235 opening clause, line ~245 Workspace-root safety subsection). They are on disk and correct; build on them. The mild semantic overlap between the opening and the reworded guarantee #1 is acceptable (it mirrors the spec's own structure).
- ❌ Don't touch guarantees #2–#5 — only guarantee #1 is stale (#2–#5 are accurate).
- ❌ Don't run `ruff`/`mypy`/`eslint`/`pytest` — this is a TS+markdown project; those Python gates are no-ops. The only project gates are `npm run typecheck` and `npm test`, and this README-only task exercises neither (it touches no compiled code).

---

## Confidence Score: 9/10

**Why 9, not 10:** This is a well-scoped verification sweep with a clear contract (test_strategy.md §87-88 defines it verbatim), a clear KEEP-vs-REWRITE rule, and a full hit inventory verified against live files this session. The sweep found exactly ONE stale current-behavior description (README guarantee #1) with an exact, unique oldText → newText. Every other stale-term hit in README.md + src/snapshot/*.ts + test/ is confirmed intentional (negation / SAFETY-INVARIANT explanation / shadow `has()`). The only residual risk is files drifting between this research and implementation (a NEW stale hit appearing) — the Task-1/Task-2 grep+classify loop catches and handles that case-by-case per the documented rule. No external research is needed.

**Parallel-execution note:** Sibling P1.M2.T2.S1 is README-only and its edits (line ~235 opening rewrite + line ~245 Workspace-root safety subsection) are already ON DISK (verified this session). This task's single edit (guarantee #1, line ~237) targets a DISJOINT line from both of S1's edits, so there is no merge conflict. S1's PRP explicitly deferred guarantee-#1 widening + the src/snapshot/*.ts JSDoc sweep to S2 — this PRP picks up exactly those deferred items and references S1's outputs as the contract it builds upon.