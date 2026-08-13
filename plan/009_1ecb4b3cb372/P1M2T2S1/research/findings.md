# Research Findings — P1.M2.T2.S1 (README.md safety paragraph)

## 1. The task (Mode B docs)
Add a short SAFETY paragraph (3–5 sentences) to README.md §5 "Working-tree revert", summarizing the
R1–R4 detection-hardening changeset (plan/009). Three safety properties + a restore-guard reinforcement:
- (a) workspace root = `realpath(cwd)`, NO upward git discovery (no `rev-parse --show-toplevel/--git-dir/--absolute-git-dir`)
- (b) home / filesystem-root / depth-1 system dirs → backend refused ("none")
- (c) NO command of any kind (read OR write) against the user's `.git` — the shadow repo is the only git that receives commands

## 2. README §5 structure (headings, 1-indexed)
```
202 ## 5. Working-tree revert (v1.2, opt-in)
210   ### How to enable it
214   ### Per-call flags
221   ### Granularity scope
233   ### Git-safety guarantee          ← 5 guarantees (list ends line 241)
243   ### Dirty-guard behavior          ← INSERT new subsection BEFORE this line (after 241)
249   ### Non-git mode
258   ### Configuration
```
**Insertion point: a NEW `### Workspace-root safety` subsection between line 241 (end of Git-safety guarantee)
and line 243 (### Dirty-guard behavior).** This mirrors spec/14's split: §2 SAFETY INVARIANT (detection)
vs §3 GitBackend (5 git-safety guarantees) — distinct concerns, distinct subsections.

## 3. ⚠️ CRITICAL — the stale sentence the new paragraph directly negates
**README line 235** (opening of `### Git-safety guarantee`):
> "The user's `.git` is **never written — not even a transient/dangling object.** The only command ever run
> against the user's git is the read-only `git rev-parse` (to resolve repo root/gitdir)."

The second clause ("The only command... is the read-only git rev-parse") is now **FALSE** — plan/009's M1
hardening REMOVED the `rev-parse` call from detection (verified: `grep -rn "rev-parse" src/snapshot/store.ts`
shows it ONLY in COMMENTS saying "NO rev-parse"; `detectAndCreate` lines 447–490 use `realpathSync(cwd)` +
`isForbiddenRoot` + `existsSync(join(root,".git"))`, zero rev-parse).

The new paragraph's claim (c) ("NO command of any kind — read or write — is ever issued against the user's .git")
DIRECTLY NEGATES line 235's stale clause. You cannot truthfully add claim (c) while line 235 still says
"the only command is rev-parse" — that is a flat contradiction 2 subsections apart.

**SCOPE DECISION (documented in PRP):** S1 MUST make a MINIMAL one-clause coherence fix to line 235 (remove
the stale "rev-parse" claim, point to the new subsection), because truthfully delivering claim (c) is
incoherent otherwise. This is NOT the broader stale-reference sweep — guarantee #1's weaker wording (line 237,
"no ref-moving or WRITE command", which now understates) and ALL `src/snapshot/*.ts` JSDoc comments remain
**P1.M2.T2.S2**'s scope ("Stale-reference sweep across README.md + src/snapshot/*"). Line 235 is the ONLY
README sentence that directly contradicts the new paragraph (verified by grep — line 308 "upward" is the
unrelated high-water signal).

## 4. Grounding every claim in the implemented M1 code (verified this session)
| claim | code evidence |
|-------|---------------|
| (a) realpath(cwd) root, no upward discovery | `store.ts` detectAndCreate step (1) `root = realpathSync(cwd)`; step (3) comment "NO rev-parse, NO upward walk. Workspace root is realpath(cwd), full stop (spec/14 §2)"; `git.ts` lines 37–40 guarantee #1 |
| (b) forbidden-root refusal → "none" | `paths.ts` `isForbiddenRoot`: true for `root===""`, `"."`, `"/"`, `dirname(root)==="/"` (ALL depth-1: /home /etc /usr /var /bin /sbin /opt /tmp /root), `root===homedir()`. `store.ts` detectAndCreate step (2) `if (isForbiddenRoot(root)) return new NoOpStore("workspace root is forbidden (home/system root); revert refused")` |
| (c) no command against user .git | `git.ts` lines 37–40: "No command of any kind — read OR write — is ever issued against the USER's git... the old read-only rev-parse --show-toplevel/--absolute-git-dir is REMOVED". All git commands target the SHADOW repo. |
| restore() entry guard | `git.ts` lines 729–731 + `cas.ts` lines 994–996: `restore()` re-checks `isForbiddenRoot(this.cwd)` as its FIRST act, refuses with ZERO fs mutation if forbidden — last line of defense independent of detection |

## 5. README framing style (mirror this)
- Bold lead-ins (`**never written**`, `**no upward git discovery**`), backtick code spans, spec citations in
  parens (`spec/14 §2`), em-dashes for asides, one-line "see X" forwards. Tone: declarative, trust-oriented.
- The 5-guarantee list (lines 237–241) is the density model for the new paragraph (terse, bolded keywords).

## 6. Validation (markdown-only edit — NO TS compile/test involvement)
- No README tests exist; no markdown linter in package.json (scripts = test/typecheck/smoke/prepublishOnly).
- Validation = grep assertions + a regression guard:
  - `grep -c "### Workspace-root safety" README.md` → 1 (new heading present)
  - `grep -c "The only command ever run against the user's git is the read-only" README.md` → 0 (stale clause gone)
  - `npm test` → still green (PROVES no .ts source was accidentally touched — README is not compiled)
- NO ruff/mypy/eslint (Python tools — this is a TS project; the sibling PRP confirmed this).

## 7. Sibling task boundary (P1.M2.T1.S1 — parallel)
P1.M2.T1.S1 is TEST-ONLY (adds `F-revert-subdir-not-promoted` to `test/integration/revert-edge.test.ts`).
Its anti-patterns explicitly say "DO NOT touch README.md (M2.T2.S1/S2 own it)." → **zero overlap** with my
README-docs task; no file conflict.