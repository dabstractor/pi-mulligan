# P4.M1.T1.S3 Research — README trust note for shrink-preservation invariant

## Task in one line
Add ONE sentence to README.md's `### mulligan_shrink` section stating the E19
"original never lost" hard invariant in the shrink blurb's voice. Mode B doc sync.
0.5 points. No code change, no spec edit (spec already updated by commit d5701c8f).

## Why this is small but must be precise
- It is a *trust/trustworthiness* note. The wording must be correct (the invariant
  is hard) and non-duplicative with two EXISTING general soft-delete statements in
  the same README (L233, L241). It is the shrink-section-specific, E19-framed
  "view substitution" version.

## The verified invariant (documented AFTER it is verified)
- S1 (edge-cases.test.ts, COMPLETE): asserts `applyShrink` is non-mutating — the
  input array's original survives unchanged.
- S2 (smoke.ts F-shrink-persist, IMPLEMENTING): extends the smoke harness to also
  shrink a real `role:"user"` message (USER_CANARY="MULLIGAN-SMOKE-USER-CANARY")
  and asserts (a) substitution took effect in filtered view and (b) the original
  user content survives verbatim on disk. **S3 documents an invariant S1+S2 prove.**
- Authoritative spec wording — `spec/08-edge-cases.md` E19, L96–99:
  > "The original is never lost (hard invariant): shrink is a *view substitution*
  > — the user's actual message stays on disk and is recoverable via `/tree`
  > (D2 / soft-delete). Summarizing user input is acceptable precisely because the
  > original always survives; only the model's in-context copy is replaced."

## Current README.md shrink section (authoritative, v1.1 final state)
Lines (1-indexed):
- L155  `### mulligan_shrink`  (heading)
- L156  `> Replace a specific past tool result with a compact summary...` (intro blockquote)
- L159  `**When to use it (vs mulligan_rewind):**` ... (rewind=mistake, shrink=fine-but-big)
- L161  `**Operator echo (zero context cost).**` ...
- L163  `**Target matchers** (resolved live each turn, robust to compaction):`
- L165  `- by_tool_call_id — ...`
- L166  `- by_tool_name + occurrence (...) — ...`
- L167  `- by_content_includes — the first message (any role) whose text contains the substring. An empty substring matches nothing (resolves to null).`
- L169  `The \`replacement\` must be non-empty and **faithful** — the model treats it as ground truth from then on.`
- L171  `Checkpoints moved to the human in v1.1 (...) ...` (next paragraph — start of checkpoint note)
- L173  `### mulligan_audit`  (next tool heading — END of shrink section)

**INSERTION POINT:** a new paragraph immediately AFTER L169 (the faithful-replacement
line) and BEFORE L171 (the Checkpoints-moved paragraph). This closes the shrink blurb
with the trust note, and the narrative is coherent: matchers can hit any-role message
(L167) → but it's a view substitution, the original always survives (new line).

## Anti-duplication analysis (the core correctness constraint)
Two EXISTING general soft-delete statements S3 must NOT duplicate/contradict:
- L233: "`/tree` is the audit trail. Every rewind, shrink, and checkpoint is a
  persisted entry — the human can inspect the full un-filtered history..."
- L241: "**Soft-delete / audit trail.** Hidden content is **never lost** — it stays
  in the session JSONL on disk and is visible in Pi's native `/tree`."

=> S3's note must be: (a) inside the shrink blurb, (b) use E19's "view substitution"
vocabulary, (c) carry the shrink-specific + "even a user message is lossless" angle.
Those three properties distinguish it from L233/L241. Reusing the words "never
deletes"/"view substitution"/"recoverable via /tree" is FINE and expected (it IS
the same guarantee) — duplication risk is only if the note were generic again.

## P3 sweep interaction — NOT in flight
- P3.M1.T1.S1 (README v1.1 sweep) is COMPLETE per plan_status. It edited v1.1-surface
  sentences only (tool-count 5→4, to_previous_prompt removal, mulligan_checkpoint
  subsection removal, human-commands subsection, BUG-006, status line, banner config
  row). **P3 did NOT touch the mulligan_shrink blurb (L155–169).**
- => The README is already in its final v1.1 state when S3 runs. No edit-order race.
  The two edit sites are disjoint. S3 touches ONLY the shrink blurb.

## Repo validation surface (what gates the change)
- `package.json` scripts: `test` (vitest run), `smoke`, `typecheck` (tsc --noEmit),
  `prepublishOnly` (typecheck && test). No markdown linter / prettier / eslint /
  markdownlint config exists at repo root or in .github/workflows.
- => A README-only edit cannot break typecheck/test, but running them is the cheap
  sanity check that no code file was accidentally touched.
- The task's OWN acceptance: `grep README.md for 'shrink'` to confirm the note reads
  cleanly in context and introduces no stale reference.

## Recommended sentence (single sentence, shrink-blurb voice, hits 4 requirements)
Recommended exact insertion (lead paragraph matches README's `**X.**` paragraph style):

```
**View substitution (trust note).** Shrink never deletes anything — it is a *view substitution*: the original message stays on disk and is recoverable by the human via `/tree`, so only the model's in-context copy is replaced — even summarizing a user message (E19) is lossless at the session level.
```

Requirements it satisfies: (1) ONE sentence; (2) in shrink blurb voice; (3) uses
"view substitution" (E19 vocabulary); (4) states original-on-disk + recoverable via
/tree + the user-message-lossless E19 angle; (5) distinct from L233/L241 (shrink-
specific, E19-framed, not a restatement of the general soft-delete bullet).