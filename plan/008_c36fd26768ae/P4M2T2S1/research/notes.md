# Research Notes — P4.M2.T2.S1 (Conditional E5 mutation warning for reverted spans)

## The item contract (authoritative)
- Add module-local const `MUTATION_WARNING_REVERTED` with EXACT text:
  `"⚠ The hidden span ran side-effecting commands (see note). Non-filesystem effects PERSIST on disk (commits made, dependency installs, network/DB/process effects, staged index changes). Any files in 'failed' or 'refused' were NOT restored — do not blindly redo those. All other file modifications were reverted to their pre-span state."`
- Selection logic: `const warning = (reverted && revertResult.reverted.length > 0) ? MUTATION_WARNING_REVERTED : MUTATION_WARNING;`
- This is a **Mode A** (LLM-facing contract) doc task — the warning text IS the deliverable.

## Current state of rewind.ts (ON DISK, pre-S2)
1. `MUTATION_WARNING` const at ~line 155 (module-local):
   `"⚠ The hidden span modified files/ran side-effecting commands (see note). Those effects PERSIST on disk; do not blindly redo them."`
2. `successText(granularity, k, hasWarning, revertClause="")` at ~line 230 — module-local, ONE call site (step 9).
   Appends `" " + MUTATION_WARNING` when `hasWarning`.
3. Step 8 (~line 829): `hasWarning = config.rewind.requireMutationWarning && (ledger.modifiedFiles.length>0 || ledger.bashSideEffects.length>0)`. Has an EXPLICIT comment seam:
   `// [P4.M2.T2.T1] when revertRefused OR files were reverted, reword the E5 warning to name only non-working-tree effects — out of scope here; hasWarning is left unchanged.`
4. Step 9 (~line 838): `successText(granularity, k, hasWarning, revertClause)` + return details.

## S2 (P4.M2.T1.S2, parallel) — the handoff contract
This task is implemented AFTER S2. S2's PRP (read in full) GUARANTEES:
- `let revertSummaryDetails: RewindDetails["revertSummary"];` declared at the **6b-block-top scope** (beside `revertClause`/`revertRefused`/`revertBlock`) → **visible to step 8**.
- `RewindDetails.revertSummary?: { reverted: number; deleted: number; failed: number; skipped: number; refused: number; backend: "git"|"cas"|"none" }` — present ONLY on the proceed branch (undefined on every non-proceed branch).
- Step 9 return includes `revertSummary: revertSummaryDetails`.
- The proceed seam is filled: `revertSummaryDetails = { reverted: restoreResult.reverted.length, ... }`.
- `makeFakeStore` extended with `restoreResult?: RestoreResult` (scripted) + `restoreCalls?` capture.

**The signal I consume**: `revertSummaryDetails && revertSummaryDetails.reverted > 0` ≡ contract's `(reverted && revertResult.reverted.length > 0)`.
S2's PRP Task 4 LITERALLY says: "gives T2 (P4.M2.T2.T1, the warning reword) a clean signal — did revert_file_changes actually revert files? `revertSummary.reverted > 0`". (P4.M2.T2.T1 == P4.M2.T2.S1 — notation drift.)

## Semantic correctness — the contract handles every branch WITHOUT special-cases
| step-6b branch                          | restore ran? | `revertSummary.reverted` | `filesWereReverted` | warning used | semantically correct? |
|-----------------------------------------|--------------|--------------------------|---------------------|--------------|------------------------|
| no flags / disabled / group / missing   | NO           | undefined                | false               | ORIGINAL     | ✓ files persist        |
| dirty-guard REFUSED (`revertRefused`)   | NO           | undefined                | false               | ORIGINAL     | ✓ files persist (revert refused) |
| restore ran, reverted 0 (all failed)    | YES          | 0                        | false               | ORIGINAL     | ✓ files persist (restore failed) |
| restore ran, reverted >0                | YES          | >0                       | **true**            | **REVERTED** | ✓ file-state restored; only non-fs effects persist |
| (above, but `requireMutationWarning` false / empty ledger → `hasWarning` false) | — | — | — | none | ✓ hasWarning stays the gate |

→ No need to special-case `revertRefused`. The contract's single expression is complete & correct.

## Test idiom (test/tools/rewind.test.ts)
- vitest; hand-rolled `makePi()`/`makeCtx()` (NO `vi.fn()`); `.js` imports; `run(pi,ctx,params,toolCallId)`; `firstText(res)`; `VALID_NOTE`.
- `setConfig({revert:{enabled:true}})` required (beforeEach resets to DEFAULT_CONFIG = revert off).
- Seed runtime: `const rt = getRuntime(sid); rt.store = makeFakeStore({...}); seedTurnCheckpoint(rt);`.
- S2 EXTENDS `makeFakeStore({drifted?, throwOnCheck?, restoreResult?, restoreCalls?})` — my tests use `restoreResult: { reverted: ["src/a.ts"], ... }`.
- To make `hasWarning` fire I need `ledger.modifiedFiles` non-empty → use `asstWrite("WRITE","src/a.ts")` in the rewound span (mirrors the existing mutation-warning test, line 617).
- Existing mutation-warning tests (line 614+) use `last_tool_call_group` — but revert only runs at `last_turn`/`checkpoint`, so my reverted-warning tests use `last_turn`.
- `res.details.revertSummary?.reverted` is the test-visible signal (S2).

## Naming/notation note
- Item is `P4.M2.T2.S1`. S2's PRP + the on-disk comment seam call it `P4.M2.T2.T1`. SAME task (subtask T2 has one sub-item S1; T1/S1 drift). I'll use `P4.M2.T2.S1` (the canonical plan id) but reference the on-disk seam text verbatim for the edit.

## Risks / gotchas
- **Em-dash**: `MUTATION_WARNING_REVERTED` uses `—` (U+2014) in "restored — do not". Original uses `;`. Copy contract VERBATIM.
- **Single quotes** around `'failed'` / `'refused'` in the reverted text. Copy verbatim.
- `successText` is module-local with ONE call site → adding a 5th param `filesReverted = false` is safe (default preserves all existing behavior/tests).
- HARD DEPENDENCY: this task requires S2 (P4.M2.T1.S2) to be complete first (restore wiring + `revertSummaryDetails` accumulator + `RewindDetails.revertSummary`). If S2 is reverted/missing, this task cannot compile/run. The parallel_execution_context confirms S2 is being implemented now → it lands first.
- DO NOT special-case `revertRefused` (the on-disk comment seam mentions it, but the item contract's single expression already handles it correctly — see table). Adding a branch would diverge from the contract.
- DO NOT touch step 6b, the marker payload, or `RewindDetails` (S2 owns those). This task owns ONLY: the new const, the `successText` param, the step-8 signal, and tests.