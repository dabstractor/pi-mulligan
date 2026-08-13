---
name: "P1.M2.T2.S1 — Add safety paragraph to README.md working-tree-revert section"
description: "Mode B changeset-level documentation. Add a short SAFETY subsection to README.md §5 'Working-tree revert' summarizing the R1–R4 detection-hardening changeset (realpath(cwd) root, no upward git discovery, forbidden-root refusal, no command against user .git, restore() entry guard). Plus a minimal one-clause coherence fix to the now-stale 'the only command... is rev-parse' sentence in the adjacent Git-safety guarantee subsection, which the new paragraph directly negates."
---

## Goal

**Feature Goal**: Document the plan/009 detection-hardening changeset's safety guarantees in the user-facing README, so operators evaluating the revert feature can see — at a glance — that the snapshot subsystem never walks up the tree, never touches the user's `.git`, and refuses to operate on home/system roots.

**Deliverable**: Two edits to `README.md` §5 "Working-tree revert":
1. **ADD** a new `### Workspace-root safety` subsection (heading + one 4–5 sentence paragraph) between the `### Git-safety guarantee` and `### Dirty-guard behavior` subsections.
2. **MINIMAL coherence fix** to the single stale clause in the `### Git-safety guarantee` opening (line ~235) that the new paragraph directly negates.

This satisfies Definition-of-Done criterion #7 (part 1). It is the Mode-B summary of the entire R1–R4 changeset.

**Success Definition**:
- The new `### Workspace-root safety` subsection is present and states claims (a) realpath(cwd) root + no upward discovery, (b) forbidden-root refusal → backend "none", (c) no command of any kind (read or write) against the user's `.git`, plus the `restore()` entry-guard reinforcement.
- The stale "The only command ever run against the user's git is the read-only `git rev-parse`" clause is gone from README §5.
- README §5 is internally coherent (no two-sentences-apart contradiction).
- No source code (`.ts`) or test files are touched — `npm test` still passes unchanged.

## User Persona

**Target User**: The operator/developer evaluating whether to enable `config.revert.enabled` — i.e. deciding whether to trust Mulligan to restore files in their working tree. Safety trust is the adoption gate.

**Use Case**: Reading README §5 to understand the revert feature's blast radius and safety properties before turning it on.

**User Journey**: Operator reaches §5 → reads the intro → sees "How to enable" → flags → granularity → **Workspace-root safety** (new) → Git-safety guarantee (5 guarantees) → Dirty-guard → Non-git → Configuration. The new subsection answers "will this ever escape my project dir or touch my `.git`?" *before* the operator digs into the guarantee list.

**Pain Points Addressed**: The plan/009 changeset closed a catastrophic hazard (upward `rev-parse` discovery once resolved the workspace to `$HOME` and `restore()` reverted the entire home tree). That hardening is currently **invisible** in README §5 — the README even still claims (stale) that `rev-parse` runs against the user's git. This PRP makes the new safety model visible AND removes the stale lie.

## Why

- **Trust visibility**: The revert feature rewrites files on disk; the #1 question is "how is this bounded?" The detection-hardening (realpath root, forbidden-root refusal, no-command-against-user-git, restore guard) is the answer, and it belongs in the user-facing doc.
- **Removes a stale lie**: README line ~235 currently states "The only command ever run against the user's git is the read-only `git rev-parse`" — which M1 *removed*. This is directly contradicted by the new paragraph's claim (c). Leaving it makes the README self-contradictory; the minimal coherence fix is inherent to truthfully adding claim (c).
- **Unblocks DoD #7**: Definition-of-Done criterion #7 (part 1) requires this changeset-level doc.

## What

A documentation-only change to `README.md`:
1. A new short subsection `### Workspace-root safety` (4–5 sentences) summarizing the detection safety model, citing `spec/14` §2 (SAFETY INVARIANT) + §3 (guarantee #1).
2. A one-clause rewrite of the stale `rev-parse` sentence in the `### Git-safety guarantee` opening so the two subsections agree.

### Success Criteria

- [ ] `### Workspace-root safety` subsection exists in README §5, between `### Git-safety guarantee` and `### Dirty-guard behavior`.
- [ ] The paragraph states (a) `realpath(cwd)` root + no upward discovery, (b) forbidden-root refusal, (c) no command (read or write) against user `.git`, + `restore()` entry guard.
- [ ] The stale "The only command ever run against the user's git is the read-only `git rev-parse`" clause is removed from README.
- [ ] README §5 is internally coherent (grep finds zero "the only command... rev-parse" stale phrasing).
- [ ] `npm test` still green (no source/test files touched).

## All Needed Context

### Context Completeness Check
_Passes "No Prior Knowledge":_ the implementing agent needs only `README.md` (§5, lines 202–280) and the two quoted spec snippets (§2 SAFETY INVARIANT, §3 guarantee #1) provided below. Every claim is grounded in already-shipped code (`src/snapshot/paths.ts`, `store.ts`, `git.ts`, `cas.ts`) — exact code evidence is cited so the agent can verify wording against the implementation if desired. Exact old-text → new-text edits are given; no guessing.

### Documentation & References

```yaml
# MUST READ — the source of truth for the safety wording
- docfile: spec/14-working-tree-revert.md
  section: "## 2. Architecture — the SnapshotStore"   # the "SAFETY INVARIANT — non-negotiable" blockquote
  why: "Source of truth for claims (a) realpath(cwd) root + no upward discovery and (b) forbidden-root refusal. Copy the rationale + the forbidden-roots framing."
  critical: "The invariant is 'non-negotiable' in the spec — mirror that tone (declarative, trust-oriented). The forbidden set = home, filesystem root, ANY depth-1 system dir."

- docfile: spec/14-working-tree-revert.md
  section: "## 3. GitBackend (external shadow repository)"   # guarantee #1
  why: "Source of truth for claim (c): 'No command of any kind — read or write — is ever issued against the user's git' + the rationale that realpath(cwd) needs no rev-parse."
  critical: "The spec explicitly notes 'previously a read-only rev-parse --show-toplevel/--absolute-git-dir ran against it; that is removed' — this is EXACTLY the stale README line 235 that must be corrected."

# THE file to edit (read §5 fully before editing — lines 202–280)
- file: README.md
  why: "The ONLY file modified. §5 'Working-tree revert' is lines 202–276. The '### Git-safety guarantee' subsection is lines 233–241 (its 5-guarantee list ends at 241); '### Dirty-guard behavior' starts at 243."
  pattern: "Mirror the README's framing style: bold lead-ins, backtick code spans, spec citations in parens like '(spec/14 §2)', em-dash asides, the terse bolded-keyword density of the 5-guarantee list (lines 237–241)."
  gotcha: "Line 235 currently contains a STALE clause ('The only command ever run against the user's git is the read-only git rev-parse') that the new paragraph's claim (c) directly negates. The minimal coherence fix to that clause is INHERENT to truthfully adding claim (c) — see Implementation Tasks Task 2. Do NOT touch the 5 guarantees themselves (that broader polish is S2)."

# CODE EVIDENCE (read-only — verify wording against the shipped implementation, do NOT edit)
- file: src/snapshot/store.ts
  section: "detectAndCreate (≈ lines 440–490)"
  why: "Grounds claim (a): step (1) `root = realpathSync(cwd)`, step (2) `isForbiddenRoot` gate → NoOpStore, step (3) `existsSync(join(root, '.git'))` LEXICAL — comment literally says 'NO rev-parse, NO upward walk. Workspace root is realpath(cwd), full stop (spec/14 §2)'."
- file: src/snapshot/paths.ts
  section: "isForbiddenRoot"
  why: "Grounds claim (b): forbidden = `root===''|'.'|'/'`, `dirname(root)==='/'` (ALL depth-1 system dirs: /home /etc /usr /var /bin /sbin /opt /tmp /root), `root===os.homedir()`. Returns true → detectAndCreate refuses → backend 'none'."
- file: src/snapshot/git.ts
  section: "header comment guarantee #1 (≈ lines 37–40) + restore() guard (≈ 729–731)"
  why: "Grounds claim (c): 'No command of any kind — read OR write — is ever issued against the USER's git... the old read-only rev-parse --show-toplevel/--absolute-git-dir is REMOVED'. Grounds the restore-guard sentence: restore() re-checks isForbiddenRoot as its FIRST act, refuses with ZERO fs mutation."
- file: src/snapshot/cas.ts
  section: "restore() guard (≈ 994–996)"
  why: "Confirms the restore() entry guard exists in BOTH backends (not just git) — 'last line of defense independent of detection'."

# PATTERN guide (read-only)
- docfile: plan/009_1ecb4b3cb372/P1M2T1S1/PRP.md   # sibling (test-only, does NOT touch README)
  why: "Confirms project toolchain (npm run typecheck / npm test; NO ruff/mypy/eslint) and that the sibling task explicitly does NOT touch README (its anti-patterns say so) → zero file conflict."
```

### Current Codebase tree (relevant slice)

```
README.md                      # ← THE file to edit (§5 lines 202–276)
spec/14-working-tree-revert.md # §2 SAFETY INVARIANT + §3 guarantee #1 — source of truth (read-only)
src/snapshot/
  store.ts                     # detectAndCreate — grounds claim (a)+(b) (read-only verify)
  paths.ts                     # isForbiddenRoot — grounds claim (b) forbidden list (read-only verify)
  git.ts                       # guarantee #1 + restore guard — grounds claim (c) + restore guard (read-only verify)
  cas.ts                       # restore guard — confirms both backends (read-only verify)
```

### Desired Codebase tree (what changes)

```
README.md   # MODIFIED — +1 new subsection (Workspace-root safety) + 1 minimal clause rewrite (line ~235 stale rev-parse claim)
```
No other files. No source. No tests. No new files.

### Known Gotchas of our codebase & doc style

```markdown
<!-- CRITICAL: README line ~235 is STALE. It says "The only command ever run against the user's git is the
     read-only git rev-parse (to resolve repo root/gitdir)." Plan/009's M1 REMOVED that rev-parse call.
     The new paragraph's claim (c) ("NO command of any kind — read or write — against the user's .git")
     DIRECTLY NEGATES that clause. You cannot add claim (c) truthfully while line 235 still says rev-parse
     runs. The minimal coherence fix to that ONE clause is part of this task (Task 2) — it is inherent to
     delivering claim (c), NOT the broader stale-reference sweep (that is P1.M2.T2.S2). -->

<!-- GOTCHA: do NOT touch the 5 git-safety guarantees themselves (lines 237–241). Guarantee #1 currently
     says "No ref-moving or WRITE command" (understating — it omits reads). Strengthening that wording is
     P1.M2.T2.S2's job (stale-reference sweep). S1 only (1) adds the new subsection and (2) removes the
     one directly-contradicted stale clause in line 235. -->

<!-- GOTCHA: keep the paragraph to 3–5 sentences (item contract). The spec §2 SAFETY INVARIANT is long;
     do NOT copy it wholesale. Summarize: realpath root + no upward discovery (1 sentence), forbidden-root
     refusal (1 sentence), no-command-against-user-git as a consequence (1 sentence), restore guard (1 sentence). -->

<!-- GOTCHA: README renders on GitHub. Use a real heading (### Workspace-root safety) so it appears in the
     rendered TOC. Backtick all code identifiers (realpath(cwd), rev-parse, .git, restore()). Spec citations
     in parens: (spec/14 §2 SAFETY INVARIANT; §3 git-safety guarantee #1). -->

<!-- GOTCHA: the forbidden-roots list in the paragraph should be ILLUSTRATIVE not exhaustive — write
     "/, /home, /etc, /usr, /var, /bin, …" (matching isForbiddenRoot's depth-1 rule: dirname(root)==='/').
     Do NOT claim only the named dirs are refused — the rule forbids ALL depth-1 paths + home. -->
```

## Implementation Blueprint

### Data models and structure
N/A — this is a documentation task. The "data" is the prose. Two exact edits are specified below (old-text → new-text), copy-paste precise.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD the new "### Workspace-root safety" subsection to README.md
  - EDIT: README.md §5. Insert a new subsection BETWEEN the end of "### Git-safety guarantee"
    (its 5-item list ends at the line containing guarantee #5, ≈ line 241) and the "### Dirty-guard behavior"
    heading (≈ line 243). Insert a blank line, the new heading, a blank line, the paragraph, a blank line.
  - INSERT (exact text — copy verbatim; tighten only if you must, but keep all 3 claims + restore guard + spec cite):

    ### Workspace-root safety

    The snapshot subsystem never walks up the tree to find an enclosing repository. The workspace root is always `realpath(cwd)` — exactly the directory the session was launched in — resolved lexically, with **no upward git discovery** (no `rev-parse --show-toplevel` / `--git-dir` / `--absolute-git-dir`), so a subdirectory launch can never be silently promoted to a parent directory. If `realpath(cwd)` is the user's home directory, the filesystem root (`/`), or any depth-1 system directory (`/home`, `/etc`, `/usr`, `/var`, `/bin`, …), the backend is **refused** and revert is unavailable (backend `"none"`; the rewind still proceeds with just the note). Because the root needs no `rev-parse` to resolve it, **no command of any kind — read or write — is ever issued against the user's `.git`**: the external shadow repo is the only git that receives any command. `restore()` additionally re-checks this invariant at its entry and refuses (zero filesystem mutation) if the root is forbidden — a last line of defense independent of detection. (`spec/14` §2 SAFETY INVARIANT; §3 git-safety guarantee #1.)

  - FOLLOW pattern: the 5-guarantee list (README lines 237–241) for bolded-keyword density + spec citation style.
  - NAMING: heading exactly "### Workspace-root safety" (renders anchor #workspace-root-safety; matches the spec's "workspace root" terminology).
  - PLACEMENT: after Git-safety guarantee list, before Dirty-guard behavior. Rationale: mirrors spec/14's split (§2 detection SAFETY INVARIANT vs §3 GitBackend guarantees); groups safety properties together; answers "is this bounded?" before the dirty-guard detail.
  - VERIFY each claim is grounded: (a) store.ts detectAndCreate realpathSync+lexical; (b) paths.ts isForbiddenRoot; (c) git.ts guarantee #1 lines 37–40; restore guard git.ts 729–731 + cas.ts 994–996.

Task 2: MINIMAL coherence fix to the stale "rev-parse" clause in README line ~235 (INHERENT to Task 1's claim (c))
  - EDIT: the opening paragraph of "### Git-safety guarantee" (README ≈ line 235). It currently reads:
      "...and its `GIT_WORK_TREE` points at the user's working tree. The user's `.git` is **never written — not even a transient/dangling object.** The only command ever run against the user's git is the read-only `git rev-parse` (to resolve repo root/gitdir). The five git-safety guarantees (`spec/14` §3):"
  - REPLACE the stale sentence. oldText (exact, unique in the file):
      "The user's `.git` is **never written — not even a transient/dangling object.** The only command ever run against the user's git is the read-only `git rev-parse` (to resolve repo root/gitdir)."
    newText:
      "The user's `.git` is **never written — not even a transient/dangling object**, and — because the workspace root is resolved as `realpath(cwd)` with no upward discovery (see Workspace-root safety below) — **no command of any kind, read or write, is ever issued against it.**"
  - WHY this is S1 not S2: the new subsection's claim (c) ("no command of any kind — read or write — against the user's .git") is a direct negation of line 235's stale "the only command... is rev-parse". Adding claim (c) while leaving the stale clause is an introduced contradiction 2 subsections apart. This one-clause fix is inseparable from delivering Task 1 truthfully.
  - SCOPE LIMIT: do NOT touch the 5 guarantees themselves (lines 237–241) — guarantee #1's weaker "no ref-moving or WRITE command" wording is S2's polish. Do NOT touch any .ts file. ONLY this one sentence in README.
  - GOTCHA: keep the "**never written — not even a transient/dangling object**" bold span intact (it is still true and unchanged) — only the trailing "rev-parse" clause is rewritten.

Task 3: VERIFY no other README contradiction + no source touched (read-only checks, NOT edits)
  - CONFIRM: `grep -rn "rev-parse" README.md` — after Tasks 1+2, the only "rev-parse" mentions in §5 are the NEW paragraph's negations ("no rev-parse --show-toplevel", "needs no rev-parse to resolve it"). The stale AFFIRMATIVE "the only command... is rev-parse" is GONE.
  - CONFIRM: `git diff --name-only` shows ONLY README.md changed (no .ts / test files).
  - CONFIRM: the broader stale-reference sweep (guarantee #1 wording, src/snapshot/*.ts JSDoc comments referencing the old detection model) is LEFT for P1.M2.T2.S2 — do not start it here.
```

### Implementation Patterns & Key Details

```markdown
<!-- The two edits are localized and non-overlapping. Task 1 inserts a NEW block (no existing text removed).
     Task 2 replaces ONE sentence in an EXISTING paragraph. They can be done in one `edit` call with two
     entries (they touch different, non-adjacent regions of README §5). -->

<!-- Task 1 insertion anchor (do NOT change these existing lines — insert BETWEEN them):
        5. **Pre-flight refuse-on-dirty** (below): ... — never a silent clobber.      ← end of Git-safety guarantee list (≈241)
                                                                                            ← INSERT: blank + ### Workspace-root safety + para + blank
        ### Dirty-guard behavior                                                          ← (≈243)
-->

<!-- Task 2 edit (exact oldText → newText given in Task 2). The oldText is unique in README.md. -->

<!-- Final §5 reading order after both edits:
     ... ### Git-safety guarantee  [opening para now says "no command of any kind, read or write"]
            1..5 guarantees
          ### Workspace-root safety  [NEW — realpath root, no upward discovery, forbidden-root, no-command, restore guard]
          ### Dirty-guard behavior
     ... -->
```

### Integration Points

```yaml
DOCUMENTATION (the deliverable):
  - README.md §5: +### Workspace-root safety subsection; +1 clause rewrite in Git-safety guarantee opening.
NO CODE: zero .ts files touched (README is not compiled or tested).
NO TESTS: zero test files touched (README has no tests; this is Mode B docs).
NO CONFIG / NO DB / NO ROUTES.
DEPENDENCY ON PRIOR WORK: assumes plan/009 M1 (P1.M1.T1–T4) is COMPLETE — it is (all marked Complete).
                          The claims describe shipped code; do not document anything not yet implemented.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Markdown has no compiler/linter in this project (package.json scripts = test/typecheck/smoke/prepublishOnly).
# Validate structurally with grep — the new heading is present exactly once and is a real H3:
grep -c "^### Workspace-root safety$" README.md
# Expected: 1

# The stale AFFIRMATIVE rev-parse claim is GONE (Task 2 succeeded):
grep -c "The only command ever run against the user's git is the read-only" README.md
# Expected: 0

# The new paragraph's claims are present:
grep -c "no upward git discovery" README.md       # Expected: 1
grep -c "no command of any kind" README.md        # Expected: 2  (once in new subsection, once in the rewritten line-235 clause)

# Heading depth sanity — the new heading is H3 (###), matching its siblings (### Git-safety guarantee etc.):
grep -n "^### Workspace-root safety\|^### Git-safety guarantee\|^### Dirty-guard behavior" README.md
# Expected: three consecutive ### headings in §5 in that order.
```

### Level 2: Unit Tests (Component Validation)

```bash
# N/A — README.md is documentation; there is no README test. (The Python-template ruff/mypy/pytest gates
# do NOT apply: this is a TypeScript project and the edit touches no .ts/test files.)
```

### Level 3: Integration Testing (System Validation)

```bash
# REGRESSION GUARD: prove the doc edit did not accidentally touch any source/test file.
git diff --name-only
# Expected: README.md  (and ONLY README.md)

# The full suite still passes (README is not imported by anything; this just confirms no stray .ts edit):
npm test
# Expected: all green, identical pass count to before the change.

# Optional: render-check. If you want visual confirmation, open README.md in a GitHub-flavored markdown
# previewer and confirm §5's TOC now lists "Workspace-root safety" and the paragraph reads cleanly.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Coherence check: read §5 top-to-bottom and confirm NO contradiction remains between the rewritten
# Git-safety guarantee opening (line ~235, now "no command of any kind, read or write") and the new
# Workspace-root safety subsection. They must AGREE (both assert no command against the user's git).

# Scope-boundary check: confirm you did NOT start the broader stale-reference sweep (that is S2):
#   - guarantee #1 (line ~237) should still say "No ref-moving or WRITE command" (S2 will widen to read-or-write):
grep -n "No ref-moving or write command" README.md   # Expected: still present (S2's job to reword)
#   - src/snapshot/*.ts JSDoc comments referencing the old model should be UNCHANGED:
git diff --name-only | grep -q "\.ts$" && echo "FAIL: .ts files changed (S1 must not touch source)" || echo "OK: no .ts touched"
```

## Final Validation Checklist

### Technical Validation
- [ ] `grep -c "^### Workspace-root safety$" README.md` → 1
- [ ] `grep -c "The only command ever run against the user's git is the read-only" README.md` → 0
- [ ] `grep -c "no upward git discovery" README.md` → 1 (new subsection)
- [ ] `grep -c "no command of any kind" README.md` → 2 (new subsection + rewritten line-235 clause)
- [ ] `git diff --name-only` → README.md only
- [ ] `npm test` → still green (no source touched)

### Feature Validation
- [ ] New `### Workspace-root safety` subsection sits between `### Git-safety guarantee` and `### Dirty-guard behavior`
- [ ] Paragraph states (a) `realpath(cwd)` root + no upward discovery, (b) home/root/depth-1 refusal → backend "none", (c) no command read-or-write against user `.git`, + `restore()` entry guard
- [ ] Stale line-235 "the only command... is rev-parse" clause replaced with the truthful "no command of any kind, read or write" wording
- [ ] README §5 reads coherently end-to-end (no two-subsections-apart contradiction)
- [ ] Spec citation present: `spec/14 §2 SAFETY INVARIANT; §3 git-safety guarantee #1`

### Code Quality Validation (documentation-specific)
- [ ] Paragraph is 3–5 sentences (concise, per item contract)
- [ ] Mirrors README framing style (bold lead-ins, backtick code, spec cites in parens, em-dash asides)
- [ ] Forbidden-roots list is illustrative (`/`, `/home`, `/etc`, …) not falsely-exhaustive
- [ ] All code identifiers backticked: `realpath(cwd)`, `rev-parse`, `.git`, `restore()`

### Documentation & Scope Guardrails
- [ ] ONLY README.md changed; zero `.ts` / test / config files touched
- [ ] Did NOT touch the 5 git-safety guarantees (lines 237–241) — S2's scope
- [ ] Did NOT start the broader stale-reference sweep (src/snapshot/*.ts JSDoc, guarantee #1 wording) — S2's scope
- [ ] DoD criterion #7 (part 1) satisfied — changeset-level doc present

---

## Anti-Patterns to Avoid

- ❌ Don't copy the spec §2 SAFETY INVARIANT blockquote wholesale — summarize to 3–5 sentences (the item caps it).
- ❌ Don't leave line 235's stale "the only command... is rev-parse" claim — it directly negates the new paragraph's claim (c); the minimal coherence fix is inherent to the task.
- ❌ Don't touch the 5 git-safety guarantees or any `.ts` file — that's the broader stale-reference sweep, which is P1.M2.T2.S2.
- ❌ Don't run `ruff`/`mypy`/`eslint`/`pytest` — this is a TS+markdown project; those Python gates are no-ops here. The only project gates are `npm run typecheck` and `npm test`, and this task doesn't exercise either (it touches no compiled code).
- ❌ Don't claim the forbidden-roots list is exhaustive by name — `isForbiddenRoot` refuses ALL depth-1 paths + home; phrase it as "/, /home, /etc, …" (illustrative).
- ❌ Don't invent safety properties not backed by shipped code — every claim above is grounded in `store.ts`/`paths.ts`/`git.ts`/`cas.ts` (M1, all marked Complete). If a claim can't be verified in code, drop it.
- ❌ Don't add a markdown link with a hand-built anchor (`[x](#workspace-root-safety)`) unless you've confirmed the GitHub anchor slug — plain-text "see Workspace-root safety below" is safer and sufficient.

---

## Confidence Score: 9/10

**Why 9, not 10:** This is a small, well-scoped documentation edit with (1) an exact insertion anchor (between the Git-safety guarantee list and the Dirty-guard heading), (2) copy-paste-precise prose for the new subsection, (3) an exact oldText→newText for the stale line-235 clause, and (4) every safety claim grounded in already-shipped M1 code (verified this session). The only judgment call is the S1/S2 boundary on the stale line-235 fix — the PRP resolves it explicitly (the fix is inherent to truthfully delivering claim c; the broader sweep is S2). No external research is needed.

**Parallel-execution note:** The sibling P1.M2.T1.S1 is test-only and explicitly does NOT touch README.md (its anti-patterns say so), so there is zero file conflict. The downstream task P1.M2.T2.S2 (stale-reference sweep) will handle the BROADER cleanup (guarantee #1 wording, src/snapshot/*.ts JSDoc comments); this PRP's Task 2 touches only the single line-235 clause that the new paragraph directly negates, and documents that boundary so S2 doesn't duplicate it.