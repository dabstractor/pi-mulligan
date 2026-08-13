# Research Notes — P1.M2.T2.S2 (Stale-reference sweep: README + src/snapshot/*)

## The sweep contract (verbatim from plan/009 architecture/test_strategy.md §87-88)
> "Stale-reference sweep: grep for 'rev-parse', 'show-toplevel', 'sourceGitDir', 'read-only rev-parse',
>  'repo-root-keyed', 'share one shadow repo' — confirm none survive outside the SAFETY INVARIANT text."

This is the EXACT definition of P1.M2.T2.S2. DoD criterion #7 part 2.

## Classification rule (from the item description)
- KEEP: any hit inside the SAFETY INVARIANT's explanatory "why the old behavior was removed" text, OR a
  correct negation ("NO rev-parse"), OR a legitimate shadow-repo command (`has()`'s `rev-parse --verify`).
- REWRITE: any hit that describes CURRENT behavior using the old model (affirmative detection language).

## FULL INVENTORY (verified against live files this session)

### README.md — status: POST-S1 (S1's edits already on disk)
S1 landed: (a) new `### Workspace-root safety` subsection (line 245) + (b) rewrote line-~235 opening
("no command of any kind, read or write"). All `rev-parse`/`show-toplevel`/`absolute-git-dir` mentions in
README live INSIDE the new subsection (intentional explanatory text → KEEP).
  → ONE stale REWRITE found: **guarantee #1 (line 237)** still says "No ref-moving or **write** command".
    S1's PRP explicitly deferred widening it to "read or write" for S2. It contradicts the S1-rewritten
    opening (line ~235) 2 lines above + spec §3 guarantee #1 + git.ts class header (lines 36-40).
  → Also: README:359 "top-level LICENSE" and README:312 "upward crossing" are UNRELATED (high-water / license) → KEEP.

### src/snapshot/*.ts — status: ZERO rewrites (M1 Mode A landed clean)
- git.ts class header (36-40): guarantee #1 already says "No command of any kind — read OR write" + "the
  old read-only rev-parse --show-toplevel/--absolute-git-dir is REMOVED" → KEEP (correct + explanatory).
- git.ts shadowKey doc (137-145) + header (53-56): "repo-root-keyed sharing ... intentionally NOT used:
  it required upward traversal (rev-parse --show-toplevel) ... the hazard closed by the SAFETY INVARIANT" →
  KEEP (explains WHY the old approach was removed — exactly the contract's KEEP case).
- git.ts 281/298/304: "NO rev-parse, NO upward discovery" → KEEP (correct negations).
- git.ts has() 564-577: `git rev-parse --verify <ref>` (shadow) → KEEP (legitimate shadow command;
  contract explicitly excludes "shadow-repo has() calls"; external_deps.md §57 confirms "KEPT").
- store.ts 255/416/466: "NO git command ... no rev-parse, read or write" / "rev-parse ... FORBIDDEN" /
  "NO rev-parse, NO upward walk" → KEEP (correct negations).
- cas.ts: NO stale-term hits at all.
- paths.ts: NO stale-term hits.

### test/ — status: ZERO rewrites (P1.M1.T2.S1 / P1.M1.T3.S1 reworked correctly)
- store.test.ts 275-409: assert NO rev-parse / lexical detection / subdir-NOT-promoted → KEEP (new behavior).
- git.test.ts 132-138, 239: assert "ZERO commands against user's git (no rev-parse --show-toplevel/...) → KEEP.
- git.test.ts 403-432: `rev-parse --verify` shadow has() tests → KEEP (legitimate).
- revert-edge.test.ts 668-694: F-revert-subdir-not-promoted (asserts NO upward walk) → KEEP (added by P1.M2.T1.S1).
- revert-git.test.ts 112/116: uses `git rev-parse --show-toplevel` as a TEST HARNESS helper to derive the
  canonical repoRoot for expected-value setup — NOT an assertion that detection uses it → KEEP.

### src/ OUTSIDE snapshot/ — clean (no stray refs).
### plan/009 architecture/*.md — contain MANY "rev-parse"/"sourceGitDir"/"repo-root-keyed" refs, but these
  are READ-ONLY PLANNING docs describing the BEFORE→AFTER transition ("Was X", "TARGET STATE: Delete",
  "Must be removed"). NOT in the edit scope (contract = README.md + src/snapshot/* + verify test/). Intentional.

## The ONE edit
README.md line 237, guarantee #1:
  OLD: "1. **No ref-moving or write command is ever issued against the user's git** — every write (...) ..."
  NEW: "1. **No command of any kind — read or write — is ever issued against the user's git** (the root is
       `realpath(cwd)` and needs no `rev-parse`; see Workspace-root safety below): every write (...) ..."
oldText is UNIQUE in README. Disjoint from S1's edits (line ~235 opening / line 245 subsection) → no conflict.

## Deliverable shape (honest framing)
This is a VERIFICATION sweep that found exactly one straggler. The bulk of the "work" is the documented
grep + classification proving no stale language survives; the single concrete edit is README guarantee #1.
Do NOT fabricate additional edits — M1 was thorough.

## Toolchain: npm run typecheck (tsc --noEmit) + npm test (vitest run). NO ruff/mypy/eslint/uv (Python tools).
README-only edit → neither gate is exercised, but `npm test` confirms no stray .ts/test edit.