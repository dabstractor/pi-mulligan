# PRP — P4.M3.T1.S1: Add two rows to config table + JSON example

**Parent**: P4.M3.T1 (README config table + JSON example + blurb). This is the **S1** half: it adds the two
E22 backstop knobs to the README's config table and to the commented JSON example. The sibling **S2** adds the
feature-blurb sentence (near line 242) and is a SEPARATE item — do NOT touch the blurb here. This item edits
**only `README.md`**. README is user-facing → **[Mode B]**: this README update *is* the changeset-level doc;
no further doc subtask.

**Spec refs**: `spec/09-configuration.md` §2 (schema & JSON knob order) + §3 (rationale per knob);
`spec/08-edge-cases.md` E22 (the backstop both knobs gate). Architecture:
`plan/004_d3d84055c5b2/architecture/codebase_patterns.md` §8 (README Mode B locations).

**Depends on**: **P4.M1.T1.S1 (DONE)** — it added `maxRetriesPerPrompt` (default 5, integer ≥ 1) and
`abortContextFraction` (default 0.9, number in (0,1]) to `src/config.ts` (interface + `DEFAULT_CONFIG` +
validation). This item documents those already-shipped knobs. It does NOT depend on the parallel P4.M2 work
(that touches test files; no README overlap — zero conflict risk).

---

## Goal

**Feature Goal**: Make `README.md`'s config table and commented `settings.json` example reflect the two E22
backstop knobs that `src/config.ts` already ships — `rewind.maxRetriesPerPrompt` and `rewind.abortContextFraction`
— with correct defaults, spec pointers, and placement matching the spec/09 JSON knob order.

**Deliverable**: Two surgical edits in **`README.md`** —
1. **Config table (after current line 84):** insert two rows (knob / default / description) —
   `rewind.maxRetriesPerPrompt` then `rewind.abortContextFraction` — positioned AFTER the `rewind.maxDepth`
   row and BEFORE the `rewind.requireMutationWarning` row.
2. **JSON example (current line 111):** replace `//   "rewind": { "maxDepth": 5 },` with the three-key form.

**Success Definition**:
- The README config table contains exactly the 19 knobs present in `src/config.ts` `DEFAULT_CONFIG`
  (17 existing + 2 new), in spec/09 JSON order within the rewind block:
  `maxDepth → maxRetriesPerPrompt → abortContextFraction → requireMutationWarning`.
- The commented JSON example's `rewind` object shows all three rewind knobs that have scalar defaults
  (`maxDepth`, `maxRetriesPerPrompt`, `abortContextFraction`); `enabled`/`protectedRoles`/`requireMutationWarning`
  are intentionally omitted from the example (as they are today — the example is illustrative, not exhaustive).
- Both new rows cite `spec/08-edge-cases.md` E22 and match the existing table's backtick markdown convention.
- `git diff --stat` touches **only** `README.md` (zero `src/`, zero test files, zero other `.md`).

## User Persona

**Target User**: A human configuring Mulligan via `settings.json`, or a contributor reading the README to
understand the rewind knobs. **[Mode B]** — user-facing documentation is the deliverable.

**Use Case**: The reader scans the config table to find the knob that bounds a runaway same-prompt rewind loop
(`maxRetriesPerPrompt`) and the knob that hard-stops rewinds near the context-window ceiling
(`abortContextFraction`). Today both are absent from the README despite being live in `src/config.ts` since
P4.M1.T1.S1 — a doc/code drift.

**User Journey**: README → "Configuration" section → config table → sees the two new rows with defaults + a
one-line rationale + a spec pointer → scrolls to the commented `settings.json` example → sees the same knobs
illustrated in the `rewind` block.

**Pain Points Addressed**: Doc/code drift (knobs live in code but undocumented); a user who hits E22's runaway
loop has no README pointer to the knobs that arrest it.

---

## Why

- **P4.M1.T1.S1 shipped both knobs to `src/config.ts`** (interface, `DEFAULT_CONFIG`, validation), and the
  tool guards landed in P4.M1.T2. The README is the last surface still lagging — it advertises only 17 knobs
  while the code ships 19.
- **E22 is the most severe Mulligan failure mode** (`spec/08-edge-cases.md` E22: a same-prompt rewind loop grew
  a session until the provider rejected it as "Prompt too long", unrecoverable). The two knobs are the *hard
  backstops* against it; users/operators must be able to discover and tune them.
- **Mode B**: this README update is the changeset-level documentation for the E22 feature. No separate doc task.
- The two new rows + the JSON-example update are the **entire** deliverable (the blurb is S2's, not here).

## What

- **User-visible behavior**: the README's Configuration section gains two table rows and a richer commented
  `rewind` object in the JSON example. No code, config defaults, or runtime behavior changes.
- **Technical requirement**: two edits to `README.md` (see Blueprint for exact find/replace text).

### Success Criteria

- [ ] Config table has a `rewind.maxRetriesPerPrompt` row: default `5`, description matching the contract, with
      `spec/08-edge-cases.md` E22 pointer, backtick-formatted like its neighbors.
- [ ] Config table has a `rewind.abortContextFraction` row: default `0.9`, description matching the contract,
      with `spec/08-edge-cases.md` E22 pointer, backtick-formatted like its neighbors.
- [ ] Both new rows sit between `rewind.maxDepth` and `rewind.requireMutationWarning` (spec/09 JSON order).
- [ ] JSON example line is the three-key `rewind` object: `"maxDepth": 5, "maxRetriesPerPrompt": 5, "abortContextFraction": 0.9`.
- [ ] `git diff --stat` shows **only** `README.md` modified.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement this
successfully?_ **Yes** — the exact current text of every line to anchor on (with verified line numbers), the
exact replacement text (with the backtick-formatting correction the contract omits), the verified
defaults/validation from `src/config.ts`, the spec pointer both rows cite, and deterministic validation
commands are all pinned below.

### Documentation & References

```yaml
# MUST READ — the spec authority for the two knobs' semantics, defaults, and the E22 backstop they gate
- url: spec/09-configuration.md §2 (Schema & defaults)
  why: Defines the JSON knob order WITHIN the rewind block: maxDepth, maxRetriesPerPrompt, abortContextFraction,
       requireMutationWarning. The two new table rows + the JSON example MUST use this order (so the example
       reads the same top-to-bottom as the schema block).
  critical: "maxRetriesPerPrompt": 5 (default) and "abortContextFraction": 0.9 (default) — both confirmed.
- url: spec/09-configuration.md §3 (Rationale per knob)
  why: The condensed rationale text the new rows' description columns paraphrase. Use the item contract's
       wording (already a faithful condensation) verbatim — do not re-invent.
- url: spec/08-edge-cases.md E22 (Same-prompt rewind retry loop — runaway growth)
  why: The spec pointer BOTH new rows cite in their description column. E22 is the runaway-loop bound
       (maxRetriesPerPrompt) AND the zero-marker-loop guard (abortContextFraction).

# Architecture research (verified against HEAD) — the exact insertion points
- docfile: plan/004_d3d84055c5b2/architecture/codebase_patterns.md
  section: "§8 README.md — Mode B locations (P4.M3)"
  why: Pins the config-table insertion (after rewind.maxDepth / before rewind.requireMutationWarning) and the
        JSON-example line. Confirms the spec/09 JSON order is the canonical ordering to match.

# THE SOURCE OF TRUTH for defaults/validation (already shipped — this item only documents them)
- file: src/config.ts
  why: DEFAULT_CONFIG (lines 131-132) + interface (lines 45, 51) + validation (lines 239-247) prove the two
        knobs exist with defaults maxRetriesPerPrompt=5 (integer >= 1) and abortContextFraction=0.9 (number in
        (0,1]). Read this to CONFIRM the defaults the README must show — do NOT invent or round them.
  pattern: The README defaults column must be byte-identical to DEFAULT_CONFIG's literal (5, 0.9).
  gotcha: DEFAULT_CONFIG uses bare numbers (5, 0.9); the README table convention wraps them in backticks
        (`5`, `0.9`). Both are correct for their context — the table uses backticks, the JSON example does not.

# THE FILE TO EDIT (the only file this item touches)
- file: README.md
  why: The Configuration section config table (rows around lines 80-96) and the commented settings.json
        example (line 111) live here. Both edits are in this one file.
  pattern: Table rows use the markdown form `| `knob.name` | `default` | description |` — backticks around the
        knob name AND the default value (see every existing rewind row). The JSON example is a `jsonc` fenced
        block, commented out line by line with `  //   ` indentation (note: two leading spaces, then `//`, then
        three spaces).
  gotcha: The item contract prints the new rows WITHOUT backticks ("| rewind.maxRetriesPerPrompt | 5 | ...").
        That is RAW content only — you MUST wrap the knob name and default in backticks to match the table.
        The canonical backtick'd rows are in the Blueprint below; use those, not the contract's raw text.
```

### Current Codebase tree (the relevant slice)

```bash
README.md          # EDIT: 2 table rows (after L84) + JSON example (L111)
src/config.ts      # READ-ONLY — confirms defaults/validation (already shipped by P4.M1.T1.S1)
# NO new files. NO src/ changes. NO test changes. NO other .md changes.
```

### Desired Codebase tree with files to be edited

```bash
README.md          # EDIT (config table + JSON example only)
```

### Known Gotchas of our codebase & Library Quirks

```markdown
<!-- CRITICAL (backtick formatting): the item contract gives the new rows WITHOUT markdown backticks
     ("| rewind.maxRetriesPerPrompt | 5 | ... |"). EVERY existing row in the table wraps the knob name and the
     default in backticks ("| `rewind.maxDepth` | `5` | ... |"). You MUST apply backticks to match. The
     canonical rows (with backticks) are in the Blueprint — copy those, not the contract's raw text. -->

<!-- CRITICAL (insertion ORDER): insert maxRetriesPerPrompt FIRST, then abortContextFraction — i.e. the row
     order within the rewind block becomes maxDepth, maxRetriesPerPrompt, abortContextFraction,
     requireMutationWarning. This matches spec/09 §2's JSON schema block exactly. Do NOT alphabetize and do NOT
     put abortContextFraction above maxRetriesPerPrompt. -->

<!-- CRITICAL (insertion POINT): the two rows go AFTER the `rewind.maxDepth` row (current L84) and BEFORE the
     `rewind.requireMutationWarning` row (current L85). Keep the rewind block contiguous (do not split it). -->

<!-- GOTCHA (description-column text): use the item contract's description wording VERBATIM (it is already a
     faithful condensation of spec/09 §3). Both rows cite `spec/08-edge-cases.md` E22. Do not add/remove the
     em-dashes or re-flow the text — match the contract. -->

<!-- GOTCHA (the default for abortContextFraction is a DECIMAL): show `0.9` (not `90%`, not `0.90`). The JSON
     example likewise uses the bare `0.9`. -->

<!-- GOTCHA (JSON example is COMMENTED OUT): the replacement line keeps the exact `  //   ` indentation prefix
     (two spaces, `//`, three spaces) and the trailing `,`. Match the existing example's indentation precisely. -->

<!-- GOTCHA (no automated markdown gate): package.json has only `test` (vitest) + `smoke`. There is NO markdown
     linter and NO build script. Validation for this item = deterministic `grep`/`git diff` checks + visual
     table-rendering inspection. That is expected and sufficient for a [Mode B] doc item. -->

<!-- SCOPE BOUNDARY: S2 (P4.M3.T1.S2) owns the feature-blurb sentence near line 242. Do NOT touch line 242 or
     any prose outside the config table + JSON example. Touch exactly ONE file: README.md. -->
```

---

## Implementation Blueprint

### Data models / structure

None. No code, no types. This item edits two regions of a markdown table and one line of a `jsonc` example.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT README.md — INSERT two config-table rows after the rewind.maxDepth row (current L84)
  - FIND (exact current text — anchor on the maxDepth row; match by this, not by line number):
      | `rewind.maxDepth` | `5` | Max simultaneous *active* `mulligan:rewind` markers on a branch. Bounds accumulation (markers are permanent). |
      | `rewind.requireMutationWarning` | `true` | Append a ⚠ warning when the hidden span wrote files / ran side-effecting bash (those effects persist on disk). |
  - REPLACE WITH (maxDepth row unchanged + TWO new rows inserted between, in spec/09 JSON order, backtick-formatted
        to match the table convention — the description-column text is the contract's wording verbatim):
      | `rewind.maxDepth` | `5` | Max simultaneous *active* `mulligan:rewind` markers on a branch. Bounds accumulation (markers are permanent). |
      | `rewind.maxRetriesPerPrompt` | `5` | Max *consecutive* rewinds that re-land at the same latest user prompt before refusal — the runaway-loop bound (`spec/08-edge-cases.md` E22). Distinct from `maxDepth` (cumulative markers). |
      | `rewind.abortContextFraction` | `0.9` | Refuse any rewind once the filtered-context estimate reaches this fraction of the window — the zero-marker-loop guard (`spec/08-edge-cases.md` E22). |
      | `rewind.requireMutationWarning` | `true` | Append a ⚠ warning when the hidden span wrote files / ran side-effecting bash (those effects persist on disk). |
  - PRESERVE: the `**rewind**` section header row above and the `**shrink**` section header row below; all other
        rows byte-for-byte. The `edit` tool anchors on the two-row block (maxDepth + requireMutationWarning) and
        expands it to four rows, so only the insertion is net-new.
  - GOTCHA: wrap knob name AND default in backticks (`` `rewind.maxRetriesPerPrompt` `` / `` `5` `` /
        `` `rewind.abortContextFraction` `` / `` `0.9` ``). The contract's raw text omits them — do not copy raw.

Task 2: EDIT README.md — UPDATE the commented JSON example (current L111) to the three-key rewind object
  - FIND (exact current text — verified by grep, single match):
      //   "rewind": { "maxDepth": 5 },
  - REPLACE WITH (keep the `  //   ` prefix and trailing `,`; add the two knobs in spec/09 JSON order):
      //   "rewind": { "maxDepth": 5, "maxRetriesPerPrompt": 5, "abortContextFraction": 0.9 },
  - PRESERVE: the surrounding commented lines (the `mulligan`/`enabled` line above, the `shrink`/`nudges` lines
        below). Only this one line changes.
  - GOTCHA: the JSON keys are bare (no backticks — this is `jsonc`, not the table). Defaults `5` and `0.9` are
        bare numbers. Match the existing `"maxDepth": 5` style exactly (space after colon, no quotes on values).
```

### Implementation Patterns & Key Details

```markdown
<!-- ── The rewind block of the config table AFTER Task 1 (19 knobs total: 17 prior + 2 new) ──────────── -->
| **rewind** | | |
| `rewind.enabled` | `true` | Enable the `mulligan_rewind` tool. |
| `rewind.protectedRoles` | `["first:user", "latest:user"]` | Message selectors that can never be rewound past (the original task / the current ask). v1 supports these two selectors; unknown entries are dropped. |
| `rewind.maxDepth` | `5` | Max simultaneous *active* `mulligan:rewind` markers on a branch. Bounds accumulation (markers are permanent). |
| `rewind.maxRetriesPerPrompt` | `5` | Max *consecutive* rewinds that re-land at the same latest user prompt before refusal — the runaway-loop bound (`spec/08-edge-cases.md` E22). Distinct from `maxDepth` (cumulative markers). |
| `rewind.abortContextFraction` | `0.9` | Refuse any rewind once the filtered-context estimate reaches this fraction of the window — the zero-marker-loop guard (`spec/08-edge-cases.md` E22). |
| `rewind.requireMutationWarning` | `true` | Append a ⚠ warning when the hidden span wrote files / ran side-effecting bash (those effects persist on disk). |

<!-- ── The commented settings.json example AFTER Task 2 ─────────────────────────────────────────────── -->
```jsonc
{
  // "mulligan": {
  //   "enabled": true,
  //   "rewind": { "maxDepth": 5, "maxRetriesPerPrompt": 5, "abortContextFraction": 0.9 },
  //   "shrink": { "maxActive": 32, "staleAfterFires": 3 },
  //   "nudges": { "bloatThresholdBytes": 16384, "bloatThresholdBytesByTool": { "bash": 32768, "read": 20480 }, "driftThresholdTokens": 6000, "driftWindowTurns": 3, "highWaterFraction": 0.7 }
  // }
}
```

<!-- WHY the example shows only these three rewind keys: the existing example is illustrative, not exhaustive —
     it already omits rewind.enabled/protectedRoles/requireMutationWarning. Adding the two NEW scalar knobs to
     the maxDepth line keeps the example a faithful (if partial) illustration without bloating it. Do NOT add
     enabled/protectedRoles/requireMutationWarning to the example — that would expand scope beyond this item. -->
```

### Integration Points

```yaml
DATABASE: none.
CONFIG: none — this item only DOCUMENTS knobs already shipped in src/config.ts by P4.M1.T1.S1.
ROUTES/EVENTS: none.
PERSISTENCE: none.
DOCUMENTATION: [Mode B] — this README update IS the changeset-level doc for the E22 feature. No further doc
  subtask. The config table + JSON example are the user-facing surface.
```

---

## Validation Loop

### Level 1: Markdown sanity (no linter exists — deterministic grep/diff checks)

```bash
# (a) Both new rows landed, in spec/09 JSON order, between maxDepth and requireMutationFraction:
grep -n "rewind.maxRetriesPerPrompt\|rewind.abortContextFraction" README.md
# Expected: TWO matches, both inside the config table (not in prose). Their line numbers must be
#   BETWEEN the rewind.maxDepth line and the rewind.requireMutationWarning line:
grep -n "rewind\.maxDepth\`\|rewind\.requireMutationWarning\`" README.md
#   → maxDepth must be ABOVE maxRetriesPerPrompt/abortContextFraction, which must be ABOVE requireMutationWarning.

# (b) The rows are backtick-formatted (knob name AND default wrapped in backticks), matching the table:
grep -c '| `rewind.maxRetriesPerPrompt` | `5` |' README.md   # → 1
grep -c '| `rewind.abortContextFraction` | `0.9` |' README.md # → 1

# (c) The JSON example line is the three-key rewind object:
grep -c '//   "rewind": { "maxDepth": 5, "maxRetriesPerPrompt": 5, "abortContextFraction": 0.9 },' README.md
# → 1

# (d) The OLD single-key example line is GONE (no leftover):
grep -c '//   "rewind": { "maxDepth": 5 },' README.md   # → 0

# Expected: all greps return the counts above. If (b) shows 0, you forgot the backticks. If (d) shows 1,
#   Task 2 did not replace the line — re-run it.
```

### Level 2: Visual markdown-table inspection

```bash
# Render the config table region and eyeball column alignment (no linter exists, so this is manual):
sed -n '80,96p' README.md
# Expected: a well-formed markdown table — every row has 3 cells separated by `|`, the two new rows read
#   naturally as part of the rewind block, no broken pipes, no doubled spaces inside cell content. The
#   `**rewind**` header row and `**shrink**` header row still bracket the rewind block correctly.
```

### Level 3: Doc/code consistency (the README now matches src/config.ts)

```bash
# (a) The README config table advertises exactly the knobs src/config.ts ships. The rewind block should now
#     list 6 rewind knobs (enabled, protectedRoles, maxDepth, maxRetriesPerPrompt, abortContextFraction,
#     requireMutationWarning):
sed -n '/| \*\*rewind\*\*/,/| \*\*shrink\*\*/p' README.md | grep -c '^| `rewind\.'
# Expected: 6

# (b) The two new defaults match DEFAULT_CONFIG exactly (5 and 0.9):
grep -A2 "rewind:" src/config.ts | grep -E "maxRetriesPerPrompt|abortContextFraction"
# Expected:
#       maxRetriesPerPrompt: 5,
#       abortContextFraction: 0.9,
```

### Level 4: Scope check (deterministic — confirms surgical scope)

```bash
# (a) Only README.md changed (NO src/, NO tests, NO other .md):
git diff --stat
# Expected: exactly ONE file — README.md. Zero files under src/ or test/.

# (b) Line 242 (the E15 "Markers accumulate" blurb) is UNTOUCHED — that is S2's territory:
git diff README.md | grep -E '^\+|^-' | grep -i "markers accumulate\|hard backstop\|runaway" || echo "blurb untouched (correct)"
# Expected: "blurb untouched (correct)" — this item must not touch the prose blurb (S2 owns it).

# (c) The net line count delta is +2 (two inserted table rows; the JSON example is a 1:1 replacement):
git diff --numstat README.md
# Expected: "2       1       README.md" (2 added, 1 removed — the removed line is the old single-key JSON line).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] Level 1 greps all return the expected counts (2 new table rows present + backtick-formatted; JSON example
      is the three-key form; old single-key line gone).
- [ ] Level 2 visual inspection: config table is well-formed, rewind block stays contiguous.
- [ ] Level 3: README rewind block lists 6 knobs; defaults match `src/config.ts` `DEFAULT_CONFIG` (5, 0.9).
- [ ] Level 4: `git diff --stat` touches ONLY `README.md`; blurb (L242) untouched; numstat ≈ `2 1 README.md`.

### Feature Validation
- [ ] `rewind.maxRetriesPerPrompt` row: default `5`, cites `spec/08-edge-cases.md` E22, describes the
      runaway-loop bound, notes it is distinct from `maxDepth`.
- [ ] `rewind.abortContextFraction` row: default `0.9`, cites `spec/08-edge-cases.md` E22, describes the
      zero-marker-loop guard.
- [ ] Both rows sit between `rewind.maxDepth` and `rewind.requireMutationWarning` (spec/09 JSON order).
- [ ] JSON example line: `"rewind": { "maxDepth": 5, "maxRetriesPerPrompt": 5, "abortContextFraction": 0.9 },`.

### Code Quality Validation
- [ ] New rows match the existing table's backtick markdown convention (knob name + default both backtick'd).
- [ ] Description-column wording matches the item contract verbatim (faithful condensation of spec/09 §3).
- [ ] No scope creep into the feature blurb (S2), into `src/config.ts`, or into any test file.

### Documentation
- [ ] [Mode B] this README update IS the changeset-level doc — no separate doc subtask needed.
- [ ] The two new knobs are now discoverable by a user scanning the README config table / JSON example.

---

## Anti-Patterns to Avoid

- ❌ Don't copy the item contract's raw row text verbatim — it OMITS the markdown backticks the table requires.
      Wrap the knob name AND default in backticks (`` `rewind.maxRetriesPerPrompt` `` / `` `5` ``), matching
      every existing rewind row. The canonical rows are in the Blueprint.
- ❌ Don't put `abortContextFraction` above `maxRetriesPerPrompt`, or insert them outside the
      `maxDepth … requireMutationWarning` window. The order is `maxDepth → maxRetriesPerPrompt →
      abortContextFraction → requireMutationWarning` (spec/09 §2 JSON schema order).
- ❌ Don't touch the feature blurb near line 242 — that is **S2's** (P4.M3.T1.S2) deliverable. This item is
      strictly the config table + JSON example.
- ❌ Don't add `rewind.enabled` / `rewind.protectedRoles` / `rewind.requireMutationWarning` to the JSON example.
      The example is intentionally illustrative (it already omits those three today); adding only the two NEW
      scalar knobs to the `maxDepth` line keeps it faithful without bloating it.
- ❌ Don't edit `src/config.ts` — the knobs already exist there (P4.M1.T1.S1, DONE). This item only documents
      them. Editing the source would be out of scope and would not change defaults anyway.
- ❌ Don't run `npm test` / `npm run build` expecting a README gate — there is no markdown linter and no build
      script; validation is the grep/diff checks in the Validation Loop.
- ❌ Don't re-flow or re-word the description columns — the contract wording is already a faithful condensation
      of spec/09 §3. Preserve the em-dashes and the `spec/08-edge-cases.md E22` pointers exactly.

---

**Confidence Score: 10/10** for one-pass success. This is two markdown-table row insertions (pinned to exact
anchor text, in a verified order, with the one formatting correction the contract omits spelled out) plus one
1:1 JSON-example line replacement — all in a single file, with deterministic grep/diff validation and a strict
one-file `git diff --stat` scope check. The defaults are confirmed against `src/config.ts` `DEFAULT_CONFIG`
(5, 0.9), and the only implementation judgment is *not* over-editing (leave the blurb to S2, leave
`enabled`/`protectedRoles`/`requireMutationWarning` out of the JSON example, leave `src/config.ts` alone) —
which the gotchas and anti-patterns make explicit.