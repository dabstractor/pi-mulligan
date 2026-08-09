# PRP — P4.M3.T1.S2: Add feature-blurb sentence on the two hard backstops

**Parent**: P4.M3.T1 (README config table + JSON example + blurb). This is the **S2** half: it adds ONE
sentence to `README.md` noting the two E22 hard backstops, with a pointer to `spec/08-edge-cases.md` E22. The
sibling **S1** adds the config-table rows + JSON example and is a SEPARATE item — do NOT touch the config table
or JSON example here. This item edits **only `README.md`** (a single sentence appended to the E15 bullet).
README is user-facing → **[Mode B]**: this README update *is* the changeset-level doc; no further doc subtask.

**Spec refs**: `spec/08-edge-cases.md` E22 (Same-prompt rewind retry loop — runaway growth; REQUIRED; hard
backstop) — the spec the sentence points at; it defines `config.rewind.maxRetriesPerPrompt` (default 5) and
`config.rewind.abortContextFraction` (default 0.9). Architecture: `plan/004_d3d84055c5b2/architecture/codebase_patterns.md`
§8 (README Mode B locations: "line 242 / the E15 'Markers accumulate' note or nearby — add one sentence on the
two hard backstops pointing to `spec/08-edge-cases.md` E22"). Research note:
`plan/004_d3d84055c5b2/P4M3T1S2/research/placement-and-wording.md`.

**Depends on**: **P4.M1.T2.S1 (retry budget guard) + P4.M1.T2.S2 (context-fraction stop) — both DONE** — these
shipped the two hard backstops into `src/tools/rewind.ts` (refuse a rewind before it can drive a runaway loop),
gated by `config.rewind.maxRetriesPerPrompt` and `config.rewind.abortContextFraction` (added to `src/config.ts`
by P4.M1.T1.S1, DONE). This item documents those shipped backstops in the README prose. It does NOT depend on
the parallel P4.M3.T1.S1 (config table + JSON example) — zero region overlap with that edit (see Scope Boundary).

---

## Goal

**Feature Goal**: Make `README.md` surface the two E22 hard backstops — the per-prompt retry budget
(`rewind.maxRetriesPerPrompt`) and the context-fraction stop (`rewind.abortContextFraction`) that refuse a
rewind *before* it can drive a runaway same-prompt retry loop to a provider "Prompt too long" rejection — with a
one-line pointer to `spec/08-edge-cases.md` E22.

**Deliverable**: ONE surgical edit in **`README.md`** — append exactly one sentence to the end of the E15
"Markers accumulate" bullet in §7 Known Limitations (current line ~246 after S1 lands; was ~244 pre-S1).

**Success Definition**:
- The E15 bullet ends with a new sentence naming both backstops, both config knobs (backtick'd), and the
  `(`spec/08-edge-cases.md` E22)` pointer.
- The sentence uses the item contract's wording verbatim, with the one README-convention formatting fix
  (backtick-wrap the spec file path).
- `git diff --stat` touches **only** `README.md` (zero `src/`, zero test files, zero other `.md`).
- The config table (S1's region) and the JSON example (S1's region) are UNTOUCHED by this item.

## User Persona

**Target User**: A human reading the README to understand Mulligan's safety model, or a contributor/operator
evaluating the worst-case (runaway loop) failure mode and its guard. **[Mode B]** — user-facing documentation is
the deliverable.

**Use Case**: The reader hits the Known Limitations §7, reads the E15 "Markers accumulate" bullet (markers
persist, `maxDepth` bounds active markers), and learns — in the next breath — that the severe accumulation
manifestation (a runaway same-prompt retry loop) is additionally arrested by two *hard* backstops, with a spec
pointer to read the full required behavior + acceptance criteria.

**User Journey**: README → §7 Known Limitations → "Markers accumulate" bullet → sees the appended sentence naming
the two backstops + config knobs + E22 pointer → (optional) opens `spec/08-edge-cases.md` E22 for details.

**Pain Points Addressed**: Doc/code drift — the two backstops shipped in P4.M1.T2 (`src/tools/rewind.ts`) and
P4.M1.T1 (`src/config.ts`) but the README prose never mentions them; a reader has no README pointer to the
guard that prevents the single most-severe Mulligan failure mode (E22 risk: "hours-long retry loop → unrecoverable
'Prompt too long' hard stop").

---

## Why

- **P4.M1.T2 shipped the guards** (`src/tools/rewind.ts`): the rewind tool refuses once same-prompt retries hit
  `maxRetriesPerPrompt`, and refuses once the filtered-context estimate hits `abortContextFraction` of the window.
  The README is the last user-facing prose surface still silent on them.
- **E22 is the most severe Mulligan failure mode** (`spec/08-edge-cases.md` E22, "Risk (observed in live use)":
  a single prompt left the agent retrying for *hours* until the provider rejected the request as "Prompt too long",
  at which point the human could not even send a new message). The two backstops are what arrest it; users/operators
  must be able to discover them in the README.
- **Thematic fit with E15**: E22's runaway loop IS the severe manifestation of E15's marker/session growth (each
  loop iteration appends a `mulligan:rewind` marker + `mulligan:note` + `mulligan:turn-metric`). Appending the E22
  sentence to the E15 bullet turns a would-be-open accumulation limit into a bounded one, in the place a reader
  already learns about accumulation.
- **Mode B**: this README update is the changeset-level documentation for the E22 backstops. No separate doc task.
- The single appended sentence is the **entire** deliverable (the config table + JSON example are S1's, not here).

## What

- **User-visible behavior**: the README's E15 "Markers accumulate" bullet gains one trailing sentence naming the
  two backstops, their config knobs, and the E22 spec pointer. No code, config defaults, or runtime behavior change.
- **Technical requirement**: one append-only edit to the tail of the E15 bullet (see Blueprint for exact find/replace).

### Success Criteria

- [ ] The E15 bullet ends with the new sentence (verbatim contract wording + one formatting fix).
- [ ] Both config knobs appear backtick'd: `` `rewind.maxRetriesPerPrompt` `` and `` `rewind.abortContextFraction` ``.
- [ ] The sentence includes the pointer `` (`spec/08-edge-cases.md` E22) `` (path backtick'd, `E22` bare — matching
      the E15 bullet's own `` `spec/08-edge-cases.md` E15 `` convention).
- [ ] The sentence is appended to the SAME paragraph (the E15 bullet), space-separated from the preceding sentence.
- [ ] `git diff --stat` shows **only** `README.md` modified; the config table (S1's rows) and JSON example are untouched.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement this
successfully?_ **Yes** — the exact current text of the E15 bullet (with a verified unique anchor sentence), the
exact replacement text (contract wording verbatim + the one README-convention formatting fix), the verified spec
pointer target (E22 confirmed at `spec/08-edge-cases.md` line 108), the parallel-sibling scope boundary, and
deterministic grep/diff validation are all pinned below.

### Documentation & References

```yaml
# MUST READ — the spec the sentence points at (defines both knobs + the failure mode + acceptance)
- url: spec/08-edge-cases.md §E22 (Same-prompt rewind retry loop — runaway growth; REQUIRED; hard backstop)
  why: The pointer target. E22 defines config.rewind.maxRetriesPerPrompt (default 5) — refuses after N same-prompt
        rewinds — AND config.rewind.abortContextFraction (default 0.9) — refuses once filtered context ≥ that
        fraction of the window. Its "Risk" paragraph is exactly the runaway the README sentence names
        ("provider 'Prompt too long' rejection").
  critical: E22 is at line 108 of spec/08-edge-cases.md (verified). The README sentence paraphrases E22's "Risk"
        + "Required behavior" in one line; the pointer sends the reader to E22 for the full detail.

# Architecture research (verified against HEAD) — the placement mandate
- docfile: plan/004_d3d84055c5b2/architecture/codebase_patterns.md
  section: "§8 README.md — Mode B locations (P4.M3)"
  why: States the placement contract: "Feature blurb: line 242 (the E15 / 'Markers accumulate' note) or nearby —
        add one sentence on the two hard backstops pointing to spec/08-edge-cases.md E22." This item appends to
        that E15 note (post-S1 it sits at line ~246; the edit anchors on text, not the line number).

# Research note — the placement decision + wording + scope boundary (this item's own research)
- docfile: plan/004_d3d84055c5b2/P4M3T1S2/research/placement-and-wording.md
  why: Documents why the E15 bullet (option A) was chosen over the mulligan_rewind tool section (option B), the
        exact anchor text, the verbatim-from-contract wording with the backtick-formatting fix, and the zero-overlap
        scope boundary vs S1.

# THE SOURCE OF TRUTH for the knobs named in the sentence (already shipped — this item only documents them)
- file: src/config.ts
  why: DEFAULT_CONFIG + interface + validation (shipped by P4.M1.T1.S1) prove the knobs exist with defaults
        maxRetriesPerPrompt=5 (integer ≥ 1) and abortContextFraction=0.9 (number in (0,1]). The README sentence
        NAMES these knobs (it does not state defaults — the config table S1 adds does that) but they must be the
        real knob names. Read this to CONFIRM the two names — do NOT invent or re-spell them.
  pattern: The README sentence's two backtick'd knobs must be byte-identical to the src/config.ts field names.
  gotcha: Knob names are maxRetriesPerPrompt and abortContextFraction (camelCase, exactly). Do not abbreviate or
        re-case them.

# THE FILE TO EDIT (the only file this item touches)
- file: README.md
  why: The E15 "Markers accumulate" bullet in §7 Known Limitations (current line ~246) is the anchor. This is the
        single edit region.
  pattern: §7 bullets are single-paragraph markdown lines beginning "- **<Title> (`spec/...`)...**". Spec file
        paths are backtick'd but the trailing "E##" token is bare (see the E15 bullet's own
        "`spec/08-edge-cases.md` E15"). Config knobs are backtick'd (see "rewind.maxDepth=5" in the same bullet).
  gotcha: The E15 bullet is ONE source line (display wrapping is not line breaks). Appending a sentence modifies
        that one line; `git diff --numstat` will read "1 1 README.md", not "+1 0".
```

### Current Codebase tree (the relevant slice)

```bash
README.md          # EDIT: append one sentence to the E15 bullet (§7 Known Limitations, ~line 246)
src/config.ts      # READ-ONLY — confirms the two knob names (already shipped by P4.M1.T1.S1)
src/tools/rewind.ts # READ-ONLY — confirms the two backstops exist (already shipped by P4.M1.T2)
spec/08-edge-cases.md # READ-ONLY — confirms E22 is the pointer target (line 108)
# NO new files. NO src/ changes. NO test changes. NO other .md changes.
```

### Desired Codebase tree with files to be edited

```bash
README.md          # EDIT (E15 bullet tail only — one sentence appended)
```

### Known Gotchas of our codebase & Library Quirks

```markdown
<!-- CRITICAL (backtick the spec PATH): the item contract's wording writes the pointer as "(spec/08-edge-cases.md E22)"
     with NO backticks. README convention backtick-wraps the file PATH and leaves "E##" bare — the E15 bullet itself
     uses "`spec/08-edge-cases.md` E15". So the final pointer is "(`spec/08-edge-cases.md` E22)". The two config knobs
     are already backtick'd in the contract wording (correct) — keep them. Use the contract wording VERBATIM otherwise. -->

<!-- CRITICAL (the anchor is the LAST sentence of the E15 bullet): the edit appends the new sentence to the SAME
     paragraph as the E15 bullet (not a new line, not a new bullet, not a new paragraph). Space-separate it from
     "...bounded by compaction)." This keeps §7's "four bullets" structure intact — do not add a 5th bullet. -->

<!-- GOTCHA (the × character): the E15 bullet contains "few markers × messages" using U+00D7 MULTIPLICATION SIGN,
     not ASCII "x". When anchoring on the tail sentence, reproduce it exactly — a mismatched char fails the find/replace. -->

<!-- GOTCHA (line numbers are post-S1): the architecture doc and contract say "line 242"; after S1 adds two config-table
     rows + modifies the JSON example, the E15 bullet is at ~line 246. Do NOT anchor on a line number — anchor on the
     unique tail sentence text. This makes the edit merge-order-independent (whether S1 has landed or not). -->

<!-- GOTCHA (no automated markdown gate): package.json has only `test` (vitest) + `smoke`. There is NO markdown linter
     and NO build script. Validation for this item = deterministic grep/git-diff checks + a visual sed -n of the bullet.
     That is expected and sufficient for a [Mode B] one-sentence doc item. -->

<!-- SCOPE BOUNDARY: S1 (P4.M3.T1.S1) owns the config table (README lines ~85–86) and the JSON example (README line ~113).
     Do NOT touch either. This item's edit region (the E15 bullet, ~line 246) is ~160 lines below S1's regions and
     non-adjacent → zero git-merge-conflict risk, and both PRPs anchor on text → merge-order-independent. Touch exactly
     ONE file: README.md, ONE sentence. -->
```

---

## Implementation Blueprint

### Data models / structure

None. No code, no types. This item appends one sentence to one markdown bullet.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT README.md — APPEND the E22 backstops sentence to the tail of the E15 bullet (§7 Known Limitations)
  - FIND (exact current text — the E15 bullet's unique tail sentence; anchor on THIS, not a line number):
      The filter is cheap in practice (few markers × messages bounded by compaction).
  - REPLACE WITH (the tail sentence UNCHANGED + the new sentence appended, same paragraph, space-separated —
        contract wording VERBATIM with the one README-convention backtick fix on the spec PATH):
      The filter is cheap in practice (few markers × messages bounded by compaction). Two hard backstops guard against runaway same-prompt retry loops (`spec/08-edge-cases.md` E22): a per-prompt retry budget (`rewind.maxRetriesPerPrompt`) and a context-fraction stop (`rewind.abortContextFraction`) that refuse a rewind *before* it can drive the context to a provider 'Prompt too long' rejection.
  - PRESERVE: the E15 bullet's lead "- **Markers accumulate (`spec/08-edge-cases.md` E15).** ..." prefix and its
        three existing sentences byte-for-byte; the surrounding §7 bullets (E7, D6, D1); the §7 header; everything
        else in README.md. The `edit` tool anchors on the single unique tail sentence and expands it to two
        sentences, so only the appended clause is net-new.
  - GOTCHA (backticks): the contract prints the pointer as "(spec/08-edge-cases.md E22)" with no backticks — you
        MUST write it as "(`spec/08-edge-cases.md` E22)" (path backtick'd, E22 bare) to match the E15 bullet's own
        "`spec/08-edge-cases.md` E15" convention. The two config knobs are already backtick'd in the contract
        wording — keep them as-is.
  - GOTCHA (placement): append to the SAME paragraph (the E15 bullet line), NOT a new bullet. §7 stays "four
        bullets". Do not add a 5th bullet and do not start a new paragraph.
  - GOTCHA (anchor char): the anchor contains "×" (U+00D7); reproduce it exactly in oldText or the match fails.
```

### Implementation Patterns & Key Details

```markdown
<!-- ── The E15 bullet AFTER Task 1 (§7 Known Limitations; the appended sentence is the last clause) ───────── -->
- **Markers accumulate (`spec/08-edge-cases.md` E15).** v1 does no marker garbage-collection — markers persist intentionally (they are the audit trail). `rewind.maxDepth=5` bounds simultaneous *active* rewind markers; the only cost is disk growth (markers are control state, not in context). The filter is cheap in practice (few markers × messages bounded by compaction). Two hard backstops guard against runaway same-prompt retry loops (`spec/08-edge-cases.md` E22): a per-prompt retry budget (`rewind.maxRetriesPerPrompt`) and a context-fraction stop (`rewind.abortContextFraction`) that refuse a rewind *before* it can drive the context to a provider 'Prompt too long' rejection.

<!-- WHY the sentence belongs HERE (and not in §4 mulligan_rewind): E22's runaway loop is the severe manifestation
     of E15's marker/session growth — each loop iteration appends a marker + note + turn-metric, so the prompt grows
     until the provider rejects it. Appending the E22 backstops to the E15 bullet turns an otherwise-open accumulation
     limit into a bounded one, in the exact place a reader learns about accumulation. The §4 tool section does NOT
     currently surface ANY refusal condition (E4 maxDepth, E3 protected messages, E5 side effects are all absent
     there), so dropping a lone E22 sentence into it would open an uncovered topic. The E15 bullet is the right home. -->

<!-- WHY the wording cites BOTH knobs but states NEITHER default: the sentence's job is to NAME the two backstops and
     point to E22; the config table (S1's rows) carries the defaults + per-knob rationale, and E22 carries the full
     required behavior + acceptance criteria. The sentence is the discovery hook, not the spec. -->
```

### Integration Points

```yaml
DATABASE: none.
CONFIG: none — this item only DOCUMENTS the backstops already shipped in src/tools/rewind.ts (P4.M1.T2) and the
  knobs already shipped in src/config.ts (P4.M1.T1). The knobs are NAMED (not defaulted) in the sentence; defaults
  live in the S1 config-table rows.
ROUTES/EVENTS: none.
PERSISTENCE: none.
DOCUMENTATION: [Mode B] — this README update IS the changeset-level doc for the E22 backstops. No further doc
  subtask. The E15 bullet is the user-facing prose surface.
```

---

## Validation Loop

### Level 1: Markdown sanity (no linter exists — deterministic grep/diff checks)

```bash
# (a) The new sentence landed (use a S2-UNIQUE phrase — S1's config-table rows also mention E22, so do NOT grep
#     bare "E22"; anchor on a phrase that exists ONLY in the appended sentence):
grep -c "Two hard backstops guard against runaway same-prompt retry loops" README.md   # → 1
grep -c "'Prompt too long' rejection" README.md                                       # → 1
grep -c "runaway same-prompt retry loops" README.md                                   # → 1
# Expected: all three return 1. If any returns 0, the sentence is absent or was re-worded — re-apply Task 1.

# (b) Both config knobs are backtick'd inside the sentence:
grep -c '(`rewind.maxRetriesPerPrompt`)' README.md   # → 1
grep -c '(`rewind.abortContextFraction`)' README.md  # → 1

# (c) The spec pointer is backtick-formatted per README convention (path backtick'd, E22 bare):
grep -c '(`spec/08-edge-cases.md` E22)' README.md    # → 1

# (d) The anchor sentence (the E15 bullet's pre-existing tail) is STILL PRESENT and immediately precedes the new
#     sentence (confirms an append, not a replacement of the tail):
grep -c "bounded by compaction). Two hard backstops" README.md   # → 1

# Expected: all greps return 1. If (b) shows 0, you dropped the backticks. If (c) shows 0, you used the contract's
#   raw "(spec/08-edge-cases.md E22)" instead of the backtick'd form. If (d) shows 0, you replaced the tail
#   sentence instead of appending to it — re-apply with the tail sentence kept verbatim.
```

### Level 2: Visual bullet inspection

```bash
# Render the E15 bullet region and eyeball that the appended sentence reads as part of the bullet (no broken
# structure, no accidental new bullet/paragraph):
sed -n '244,247p' README.md
# Expected: four §7 bullets (E7, D6, D1, E15). The E15 bullet is ONE source line whose tail now reads
#   "...bounded by compaction). Two hard backstops guard against runaway same-prompt retry loops
#   (`spec/08-edge-cases.md` E22): a per-prompt retry budget (`rewind.maxRetriesPerPrompt`) and a context-fraction
#   stop (`rewind.abortContextFraction`) that refuse a rewind *before* it can drive the context to a provider
#   'Prompt too long' rejection." No new "- " bullet starts; no blank line splits the paragraph.
```

### Level 3: Doc/code consistency (the sentence names the real shipped knobs)

```bash
# (a) The two knob names in the sentence match the src/config.ts interface field names exactly (camelCase):
grep -n "maxRetriesPerPrompt\|abortContextFraction" src/config.ts | head
# Expected: both names appear in the interface + DEFAULT_CONFIG (e.g. "maxRetriesPerPrompt: 5," and
#   "abortContextFraction: 0.9," in DEFAULT_CONFIG). The README sentence's spellings must match these byte-for-byte.

# (b) The spec pointer target exists and is E22 (not a typo to E2/E20/etc.):
grep -n "^## E22\." spec/08-edge-cases.md
# Expected: "108:## E22. Same-prompt rewind retry loop — runaway growth (REQUIRED; hard backstop)"
```

### Level 4: Scope check (deterministic — confirms surgical scope + zero overlap with S1)

```bash
# (a) Only README.md changed (NO src/, NO tests, NO other .md):
git diff --stat
# Expected: exactly ONE file — README.md. Zero files under src/ or test/.

# (b) S1's regions are UNTOUCHED by this item — the config table + JSON example are S1's, not here. The appended
#     sentence is the ONLY net-new prose:
git diff README.md | grep -E '^\+' | grep -viE 'Two hard backstops|runaway same-prompt|maxRetriesPerPrompt|abortContextFraction|Prompt too long|per-prompt retry budget|context-fraction stop|refuse a rewind' | grep -vE '^\+\+\+'
# Expected: NO output (every added line is part of the one appended sentence). Any other added line = scope creep.

# (c) The config table rows S1 adds (rewind.maxRetriesPerPrompt / rewind.abortContextFraction TABLE rows) are NOT
#     duplicated or altered by this item — this item's E22 mention is PROSE in §7, not a table row:
grep -c '| `rewind.maxRetriesPerPrompt` | `5` |' README.md   # → 1 (S1's row; unchanged by S2)
grep -c '| `rewind.abortContextFraction` | `0.9` |' README.md # → 1 (S1's row; unchanged by S2)

# (d) The net change is one modified line (the E15 bullet is a single source line; appending a sentence modifies it):
git diff --numstat README.md
# Expected: "1       1       README.md" (1 line changed: the E15 bullet line, old version removed + new version added).
#   NOTE: if S1 has NOT yet landed when you run this, the numstat still reads "1 1" for THIS item's contribution
#   because both edits are text-anchored and independent. If S1 HAS landed, S2's own diff hunk is still "1 1".
```

---

## Final Validation Checklist

### Technical Validation
- [ ] Level 1 greps all return 1 (the sentence is present, both knobs backtick'd, pointer backtick'd, tail preserved).
- [ ] Level 2 visual inspection: the E15 bullet stays ONE paragraph; §7 stays four bullets; no new bullet/paragraph.
- [ ] Level 3: the two knob names in the sentence match `src/config.ts` field names exactly; E22 exists at
      `spec/08-edge-cases.md` line 108.
- [ ] Level 4: `git diff --stat` touches ONLY `README.md`; S1's regions (config table + JSON example) untouched;
      numstat ≈ `1 1 README.md`.

### Feature Validation
- [ ] The appended sentence names BOTH backstops: a per-prompt retry budget (`rewind.maxRetriesPerPrompt`) and a
      context-fraction stop (`rewind.abortContextFraction`).
- [ ] The sentence states they refuse a rewind *before* it can drive a runaway loop to a provider "Prompt too long"
      rejection.
- [ ] The sentence points to `spec/08-edge-cases.md` E22.
- [ ] The sentence uses the contract wording verbatim (with the one README-convention backtick fix on the spec path).

### Code Quality Validation
- [ ] The spec pointer matches README convention (path backtick'd, `E22` bare), mirroring the E15 bullet's own style.
- [ ] The appended sentence reads coherently as a continuation of the E15 bullet (accumulation → runaway-loop bound).
- [ ] No scope creep into S1's config table / JSON example, into `src/`, into tests, or into any other `.md`.

### Documentation
- [ ] [Mode B] this README update IS the changeset-level doc for the E22 backstops — no separate doc subtask needed.
- [ ] A reader scanning §7 Known Limitations now discovers the two backstops + the E22 spec pointer.

---

## Anti-Patterns to Avoid

- ❌ Don't copy the item contract's pointer text verbatim — it writes "(spec/08-edge-cases.md E22)" with NO
      backticks. README convention backtick-wraps the file PATH and leaves `E22` bare (the E15 bullet uses
      "`spec/08-edge-cases.md` E15"). Write it as "(`spec/08-edge-cases.md` E22)". The two config knobs are
      already backtick'd in the contract wording — keep them.
- ❌ Don't anchor on a line number ("line 242"). The architecture doc / contract cite the pre-S1 number; after S1
      lands the E15 bullet is at ~line 246. Anchor on the unique tail sentence text
      ("The filter is cheap in practice (few markers × messages bounded by compaction).") so the edit is
      merge-order-independent.
- ❌ Don't add a 5th bullet to §7, or start a new paragraph. Append the sentence to the SAME paragraph as the E15
      bullet (space-separated). §7 stays "the four things Mulligan deliberately does not do" — the appended clause
      bounds one of them, it is not a fifth limitation.
- ❌ Don't touch the `mulligan_rewind` tool section (§4), the config table, or the JSON example. §4 does not
      currently surface ANY refusal condition, so a lone E22 sentence there would be a dangling one-off; the config
      table + JSON example are S1's (P4.M3.T1.S1) deliverable. This item is strictly the §7 E15-bullet sentence.
- ❌ Don't state the knob defaults in the sentence. The sentence NAMES the knobs and points to E22; defaults live in
      S1's config-table rows, and the full required behavior lives in E22. Adding defaults here duplicates S1 and
      bloats the sentence.
- ❌ Don't edit `src/` or `spec/` — the backstops already ship in `src/tools/rewind.ts` (P4.M1.T2) and the knobs in
      `src/config.ts` (P4.M1.T1). This item only documents them in README prose.
- ❌ Don't run `npm test` / `npm run build` expecting a README gate — there is no markdown linter and no build
      script; validation is the grep/diff checks in the Validation Loop.
- ❌ Don't re-word or re-flow the sentence. The contract wording is the mandated text (it is a precise one-line
      condensation of E22's "Risk" + "Required behavior"); preserve it verbatim, applying only the backtick fix.

---

**Confidence Score: 10/10** for one-pass success. This is one sentence appended to one verified-unique anchor in a
single file — the exact oldText/newText is pinned, the wording is verbatim-from-contract (with the single
README-convention backtick fix spelled out), the spec pointer target is confirmed (E22 at `spec/08-edge-cases.md`
line 108), and validation is deterministic grep/diff against S2-unique phrases (avoiding the false-positive that
S1's config-table rows also mention E22). The only implementation judgment is *not* over-editing (leave §4, the
config table, the JSON example, and `src/` alone — all S1's or out of scope) — which the gotchas and anti-patterns
make explicit. Zero merge-conflict risk with the parallel S1 (regions ~160 lines apart, both text-anchored).