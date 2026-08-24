# Research notes — P1.M1.T2.S2 (wire E22 identical-note advisory into rewindExecute success text)

## Verified code state

### src/tools/rewind.ts
- `successText(granularity, k, hasWarning)` at :179-187 — module-local, builds text: `"Mulligan: rewound {granularity}. {kClause}. Note left."` then `if (hasWarning) text += " " + MUTATION_WARNING;` (E5 VERBATIM const at :137).
- `rewindExecute` steps: (1) config gates, (2) note validation, (3) checkpoint existence, (4) depth guard, (4b) retry budget :570-581, (4c) context-fraction stop :583-612, (5) resolvePreview, (6) renderNote, (7) appendRewindMarker at :631 + leaveNote, (7b) checkpoint label clear, (8) hasWarning compute, (9) success via successText at :~699-704. Whole body in ONE try/catch (E13). `params.note.what_happened` is the current note (validated string by step 2).
- CRITICAL TIMING: the current marker is persisted at step 7 — so the prev-note comparison must run BEFORE step 7 (helper reads getEntries(), and the just-appended marker would become its own "previous").
- Helper contract (S1, treat as landed): exported `prevRewindNoteAtLatestPrompt(ctx): string | null` — last surviving (cancel-excluded) same-prompt rewind's `note.what_happened` normalized `trim().toLowerCase()`; null on no-prompt/no-surviving/no-note; never throws.

### Spec
- spec/08-edge-cases.md:117 (E22): advisory text VERBATIM: `"⚠ You have rewound with an identical note — the re-attempt is reproducing the mistake. Change approach or shrink the offending result rather than rewinding again."` SHOULD-level — "This steers; the budget/context-fraction stops above are what ultimately refuse."
- Backstops 4b/4c MUST remain byte-identical (no behavioral coupling — advisory only appends text).

### Test harness — test/tools/rewind.test.ts
- Retry-budget describe blocks ~:1001-1060 show the exact style: `setConfig({rewind:{maxRetriesPerPrompt:3}})`, `makePi()` → `{appended, pi}`, `makeCtx({entries:[...]})`, `await run(pi, ctx, {note: VALID_NOTE, granularity:"last_turn"})`, `firstText(res)` assertions. Fixtures: `msgEntry(user("..."))`, `rewindEntry(seq)` (no note), `rewindEntryWithNote(seq, whatHappened, id?)` (S1's new fixture), cancel entry `{type:"custom",customType:"mulligan:cancel",data:{targetId}}`.
- Note: `rewindEntry(seq)` fixtures carry no note → prev helper returns null → no advisory. Tests needing the advisory must seed `rewindEntryWithNote` AND pass the same what_happened in the call's note (note must pass validateNote — check VALID_NOTE shape; what_happened must be a non-empty valid string).
- k=0 case: entries with nothing to hide → kClause "0 messages ... (nothing matched to hide)" — advisory still appended (E22 (c)).
- MUTATION_WARNING coexistence: need a ledger with modifiedFiles/bashSideEffects — resolvePreview derives ledger from the message span; simplest coexistence test may instead assert at successText level OR construct a fixture whose preview yields side effects. PRAGMATIC: test (f) can call successText directly if it's exported… it is module-LOCAL. Options: (i) export it, or (ii) drive coexistence via a seeded bash result in entries. Item description says "Extend successText's signature" — internal signature change; tests can drive end-to-end via run() with an entry fixture containing a bash-modified file… simpler: verify coexistence by asserting ordering when hasWarning true. Check whether any existing test drives MUTATION_WARNING end-to-end (grep MUTATION_WARNING in rewind.test.ts) and reuse that fixture technique.

## Key decisions for the PRP
- Comparison: `prevRewindNoteAtLatestPrompt(ctx) !== null && prev === params.note.what_happened.trim().toLowerCase()` — compute BEFORE step 7 (e.g. right after step 4c guards / before step 5), store in `identicalNote: boolean`.
- successText gains 4th param `identicalNote = false` (optional default keeps old call shape); append `" " + IDENTICAL_NOTE_ADVISORY` AFTER the MUTATION_WARNING clause so all three clauses coexist. Order: k-clause → note → MUTATION_WARNING → advisory.
- `IDENTICAL_NOTE_ADVISORY` const next to MUTATION_WARNING (:137 area), spec-verbatim, em-dash included.
- Never refuses, never alters k-clause/warning/budget logic; no config knob.