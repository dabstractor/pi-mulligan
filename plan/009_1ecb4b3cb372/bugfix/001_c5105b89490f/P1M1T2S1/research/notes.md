# Research Notes — P1.M1.T2.S1 (README + spec/14 delete_created_files safety-guarantee doc sync)

Mode B documentation-only subtask. Depends on P1.M1.T1.S1 (GitBackend guard — COMPLETE) and
P1.M1.T1.S2 (CasBackend guard — in-flight). This PRP describes the POST-HARDENING end state (both
backends now have the defense-in-depth restore-time size guard).

## The hardening semantics (the INPUT — read from S1/S2 PRPs)

**GitBackend (S1, COMPLETE)** — restore() step (c) delete loop: for each delete-candidate surviving the
existing `isDangerousWorkspaceRel` + `spare.has(rel)` guards, after resolving `abs`, `stat(abs)` is
consulted. If `st.size > cfg.revert.maxFileBytes` → SPARED (`continue`) + appended (deduped) to
`result.skipped`. A thrown stat (ENOENT/inaccessible) → fall through to unlink. Closes the R1
note-write-failure window: deletion safety no longer SOLELY depends on the best-effort oversize git note.

**CasBackend (S2, in-flight)** — walkTree delete callback accepts the already-computed `st`; after
`if (spare.has(rel)) return;` adds `if (st.size > this.cfg.maxFileBytes) return;` (bare return, no
skipped push). Belt-and-suspenders: CAS is already immune to R1 (manifest writeFile is last step before
`return label`; failure → null → no ref → delete never runs), but the guard makes both backends behave
identically on the safety floor.

**Combined semantics for the docs:**
- BOTH backends: a delete-candidate whose CURRENT size exceeds maxFileBytes is SPARED in the DELETE path,
  INDEPENDENT of the capture record (the oversize note / manifest.skipped).
- Fail-SAFE: when uncertain (capture record lost/absent), the only safe action is to NOT delete (a
  leftover file is recoverable; a deleted pre-existing file is not).
- It is a SECOND layer (defense-in-depth) IN ADDITION to the capture-record spare Set (the first layer).
- It is NOT a promise that NO oversize file is ever touched anywhere — it is SPECIFIC to the DELETE path.
  A genuinely span-created file UNDER maxFileBytes is still deleted. (A span-created file OVER maxFileBytes
  is now also spared — the conservative choice; that's fine, not over-claiming.)
- ASYMMETRY (do NOT bake into user-facing docs): GitBackend pushes the spared path to result.skipped
  (visibility); CasBackend's residual-case bare return does not. Describe BEHAVIOR ("spared"), not the
  internal surfacing asymmetry — it's a backend-internal detail T2 may reconcile.

## Exact current text located (verified line-exact this session)

### README.md
- **Line 241** (delete_created_files flag blurb): "- **`delete_created_files`** — **destructive.** Delete
  working-tree files the rewound span newly created (files that did not exist before the span). Requires
  **both** this flag **and** the global `config.revert.allowDeleteCreatedFiles: true`. Deletion is the one
  irreversible action, so it sits behind two gates (the per-call flag **and** a config kill-switch)."
- **Line 262** (Git-safety guarantee #4): "4. **`delete_created_files` only deletes files the span
  created** (present now, absent from the before-snapshot), behind the per-call flag **and**
  `config.revert.allowDeleteCreatedFiles`."
- **Line 294** (maxFileBytes config row): "| `revert.maxFileBytes` | `262144` | Per-file cap (256 KB);
  skip + warn (fail-closed) — a huge gitignored data file is not silently captured. |"

### spec/14-working-tree-revert.md
- **§3 restore bullet** (the "Restore (`restore(beforeRef, opts)`...)" block): "- If `deleteCreatedFiles`
  (and `allowDeleteCreatedFiles`): delete work-tree files present now but absent from the `beforeRef` tree
  (span creations)."
- **§3 guarantee #4** (the "five guarantees" list, item 4): "4. **`delete_created_files` only deletes
  files the span created** (present now, absent from `beforeRef`), behind the per-call flag AND
  `config.revert.allowDeleteCreatedFiles`."
- **§4.3** (fail-closed large files bullet): "- **Fail-closed large files:** in `explicit-paths` mode, a
  file exceeding `config.revert.maxFileBytes` is **skipped + warned** (never silently claimed restorable).
  In `cas` mode the per-file cap skips+logs; the comprehensive backends otherwise handle large files
  within `maxTotalBytes`."
- **§6 step 4**: "4. **Restore:** for each affected path, write its `beforeRef` content (best-effort;
  failure → `failed[]`, not fatal). If `deleteCreatedFiles` (and `allowDeleteCreatedFiles`): delete
  work-tree files present now but absent from `beforeRef` (span creations)."
- **§6 step 6**: "6. **Never** run a write command against the user's git; **never** touch the source
  index/refs; **never** delete a file not provably created during the span."

## Review decision per location

| Location | Decision | Rationale |
|---|---|---|
| README guarantee #4 (262) | **EDIT** — add defense-in-depth clause | Primary home for the safety floor. Current parenthetical "(present now, absent from before-snapshot)" now understates: the delete set is actually "…AND not exceeding maxFileBytes". Adding the clause strengthens the claim accurately (the work item's suggested wording "a file larger than maxFileBytes is never unlinked by delete_created_files" is ACCURATE, not over-claiming). |
| README maxFileBytes row (294) | **EDIT** (minor) — note the dual role | The knob now has a capture role AND a restore-time role. A config-table reader benefits from the cross-link. Minimal clause. |
| README flag blurb (241) | **CONSCIOUS NO-EDIT** | The flag blurb conveys destructive intent + two-gate CONSENT at the right level. The precise delete-set (with the size floor) belongs at guarantee #4. Editing over-loads the consent description. Document the decision. |
| spec §3 guarantee #4 | **EDIT** — add two-layer note | Authoritative spec; work-item LOGIC (c) mandates aligning guarantee #4 to mention both layers (spare Set from capture record AND size guard). |
| spec §3 restore bullet | **EDIT** — note the sparing | The restore()-algorithm description; add the sparing clause for implementation-level completeness. |
| spec §6 step 4 | **EDIT** — note the sparing | The restore-semantics algorithm step; same rationale as §3 restore bullet. |
| spec §4.3 (fail-closed large files) | **CONSCIOUS NO-EDIT** | §4.3's bullet is CAPTURE-focused (maxFileBytes capture skip). The restore-time role is now carried at §3 guarantee #4 + §6 step 4. Keeping §4.3 capture-focused preserves section structure. (Optional one-clause cross-link if preferred — wording provided in PRP.) |
| spec §6 step 6 ("never delete a file not provably created during the span") | **CONSCIOUS NO-EDIT** | Step 6 states the INVARIANT; the size guard is one MECHANISM that enforces it. The invariant remains TRUE (the size guard only SHRINKS the delete set — also spares oversize span files). Mechanism detail lives at step 4 + guarantee #4. Leaving avoids redundancy. |

## "Do not over-claim" guardrail (from the work item)
The accurate, scoped statement: "a delete-candidate (in the delete_created_files path) whose current size
exceeds maxFileBytes is spared, regardless of whether it was captured." Do NOT generalize to "no large
file is ever touched" (that would falsely imply the REVERT path also spares oversize files, or that no
oversize file is affected anywhere). The delete path is the ONLY path the floor applies to.

## Validation approach (doc-only)
- No code change → no `npm run typecheck` needed (but a sanity `npm test` run confirms no test broke —
  docs don't affect tests, but a green run rules out accidental file corruption).
- PRIMARY validation = grep: confirm the new size-floor clause is present at guarantee #4; confirm NO
  over-claiming phrasing ("never touches large files" unscoped) was introduced.
- DIFF review: confirm edits are additive (no existing guarantee weakened/removed).