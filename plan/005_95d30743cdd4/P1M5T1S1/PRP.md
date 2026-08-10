# PRP — P1.M5.T1.S1: README config table + JSON example

## Goal

**Feature Goal**: Sync `README.md`'s configuration section so it reflects the `shrink.notifyMaxChars` knob
(default **2048**) that was shipped in P1.M2.T1.S1 and is consumed by the P1.M2.T1.S2 operator echo. The README
currently lists 19 knobs and is missing `notifyMaxChars`; the source-of-truth `spec/09-configuration.md` §3
already lists 20. This task closes that one-row gap and updates the commented JSON example, keeping the README's
explicit "All N knobs" caption accurate.

**Deliverable**: **Three edits to `README.md` only** (no code, no tests, no spec files):
1. Knob-count caption line 75: `All 19 knobs` → `All 20 knobs`.
2. Config table: insert a new `shrink.notifyMaxChars` row (default `2048`) between line 91
   (`shrink.staleAfterFires`) and line 92 (`**nudges**` subheader).
3. Commented JSON example shrink block (line 114): add `, "notifyMaxChars": 2048`.

Plus two **confirmations** (no edits — already present, verified): (b) `bloatThresholdBytesByTool` row already
shows `{ "read": 24576 }` (line 96); (d) the rewind JSON example already has the P4 knobs
`maxRetriesPerPrompt` + `abortContextFraction` (line 113).

**Success Definition**: After the edits, `README.md`'s config table lists the same 20 knobs in the same order
as `spec/09-configuration.md` §3; the "All 20 knobs" caption matches the row count; the JSON example's `shrink`
block matches `spec/09-configuration.md` §2; the two confirmation targets remain intact; and `grep` shows zero
orphaned `19 knobs` / `shrink": { "maxActive": 32, "staleAfterFires": 3 }` (old form) strings.

## User Persona (if applicable)

**Target User**: pi-mulligan operators and developers reading `README.md` to configure the extension via
`settings.json` — and the build agent that reads the README as the human-facing mirror of `spec/09`.

**Use Case**: An operator wants to tune how much of a `mulligan_shrink` replacement is shown in the TUI toast
(`ctx.ui.notify`). They open README §3, find `shrink.notifyMaxChars` documented with its default (2048) and
rationale, and set it in `settings.json` using the JSON example as a template.

**User Journey**: README §3 → "Defaults table" → finds the `shrink.notifyMaxChars` row → scrolls to "Minimal
example `settings.json`" → copies the commented `shrink` block (now including `notifyMaxChars`) → uncomments &
edits.

**Pain Points Addressed**: Today the README is missing the row entirely (the knob exists in code + spec but is
invisible to a README reader), and the knob-count caption is stale. This task makes the README whole.

## Why

- **Code↔spec↔README three-way consistency.** `shrink.notifyMaxChars` shipped in P1.M2.T1.S1 (`src/config.ts`
  line 73/146/271) and is consumed by P1.M2.T1.S2 (`src/tools/shrink.ts` lines 320–326). `spec/09` §2/§3
  already document it. The README — which the project itself calls the human-facing config reference and which
  cites `spec/09` §3 as its rationale source — is the one artifact still behind. M5 exists specifically to
  close this kind of gap ("Mode B: changeset-level documentation sync").
- **Accurate self-description.** The README's caption "All N knobs" is a maintained invariant (git history:
  commit `338dc161 "Fix stale knob count..."`). Adding the row without bumping 19→20 reintroduces the exact
  stale-count bug that prior commit fixed.
- **Scope discipline.** This is the *narrowest* README sync: the config table + JSON example only. The four
  behavior-change *prose* blurbs (§4 tool descriptions, §5/§6/§7) are sibling **P1.M5.T1.S2**'s job — they are
  deliberately split out so this 0.5-pt item can land independently and be verified in isolation.

## What

Three text edits to `README.md` (all within §3 "Configuration"). No other file is touched.

### Success Criteria

- [ ] README line 75 reads `All 20 knobs (...)` (was `All 19 knobs`).
- [ ] README config table has a new row between `shrink.staleAfterFires` (line 91) and the `**nudges**`
      subheader (line 92): `| \`shrink.notifyMaxChars\` | \`2048\` | Caps the replacement text shown to the
      operator via \`ctx.ui.notify\` when a shrink is recorded. Pure UI side-channel — **zero context cost**
      (the tool result itself stays terse). See \`spec/05-tools.md\` §2. |`
- [ ] README JSON example (line 114) reads `//   "shrink": { "maxActive": 32, "staleAfterFires": 3,
      "notifyMaxChars": 2048 },` (added `, "notifyMaxChars": 2048` before the closing brace).
- [ ] Confirmation (b): line 96 still shows `| \`nudges.bloatThresholdBytesByTool\` | \`{ "read": 24576 }\` |`
      (unchanged — already correct).
- [ ] Confirmation (d): line 113 still shows `"rewind": { "maxDepth": 5, "maxRetriesPerPrompt": 5,
      "abortContextFraction": 0.9 }` (unchanged — already correct).
- [ ] No file other than `README.md` is modified.

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains the verbatim current text of all three README edit sites (with exact line numbers),
the verbatim target text for each, the source-of-truth values (`src/config.ts` + `spec/09` §2/§3) each edit is
derived from, the two no-op confirmation targets, and a knob-count reconciliation table proving 19→20. The
implementer needs to open only `README.md` and apply three find/replace edits.

### Documentation & References

```yaml
# MUST EDIT — the sole deliverable target
- file: README.md
  why: §3 "Configuration" — (1) knob-count caption line 75; (2) "Defaults table" — insert the notifyMaxChars
        row between line 91 and line 92; (3) "Minimal example settings.json" — shrink block line 114.
  pattern: "every existing config-table row mirrors spec/09-configuration.md §3 one-for-one (same wording,
            same default, same spec cross-ref style). The new notifyMaxChars row must do the same. JSON
            example rows are compact one-liners keyed by section, commented with //."
  gotcha: "the README uses `spec/NN-name.md` cross-refs (NOT spec/09's `@NN-name.md` form) — translate the
           spec/09 §3 rationale's `@05-tools.md` into `spec/05-tools.md`. Line 75 already cites `spec/09
           -configuration.md` as the rationale source, so mirroring §3 is the consistent choice."

# SOURCE OF TRUTH — the shipped knob (READ-ONLY; proves default 2048 + JSDoc intent)
- file: src/config.ts
  why: line 73 `notifyMaxChars: number;` + JSDoc (69–72) "Caps the replacement text shown to the operator via
        ctx.ui.notify ... pure UI side-channel with ZERO context cost ... Must be > 0"; line 146 default 2048;
        line 271 coerceNumber validation (mustBePositive true).
  section: "MulliganConfig.shrink interface (57–73); DEFAULT_CONFIG.shrink (142–147); validateConfig shrink
            block (261–272)."
  critical: "default is exactly 2048 — do not invent another value. Field is REQUIRED (no `?`)."

# SOURCE OF TRUTH — the spec the README must match (READ-ONLY; already correct)
- file: spec/09-configuration.md
  why: §2 schema (line 34) `"notifyMaxChars": 2048` inside the shrink block; §3 rationale (line 75) the row to
        mirror; §3 already lists 20 knobs total (notifyMaxChars included), proving the README count bump.
  section: "§2 Schema & defaults (shrink block); §3 Rationale per knob (shrink.notifyMaxChars row + the full
            20-row table)."
  gotcha: "READ-ONLY — do NOT edit spec/09 (it already specifies the knob correctly). This PRP makes README
           match the spec."

# CONTEXT — the architecture research (exact edit design + knob-count proof)
- file: plan/005_95d30743cdd4/architecture/system_context.md
  why: "README.md | 262 LOC | M5 | config table at line ~73; JSON example at line ~105" — pins the edit region.
        Also notes Change 5 (`bloatThresholdBytesByTool: { read: 24576 }`) is DONE — confirming (b) is a no-op.

# CONTEXT — the PRP that shipped the knob (confirms the value + that code already exists)
- file: plan/005_95d30743cdd4/P1M2T1S1/PRP.md
  why: CONTRACT for the knob. It edited src/config.ts (3 insertions) + test/config.ts (6 snapshots) ONLY and is
        Complete. Confirms default 2048, REQUIRED field, mustBePositive=true — the exact values this PRP documents.
  critical: "M2.T1.S1 is DONE — the knob is real and shipped. M5.T1.S1 only writes it into README."
```

### Current Codebase tree (the only relevant slice)

```bash
README.md                                  # ← EDIT: 3 edits (lines 75, 91→92 insert, 114). The sole target.
src/config.ts                              # READ-ONLY source of truth (knob default 2048, lines 73/146/271)
spec/09-configuration.md                   # READ-ONLY source of truth (§2 schema, §3 rationale — 20 rows)
spec/05-tools.md                           # READ-ONLY (§2 — the behavior that consumes the knob; cited in new row)
plan/005_95d30743cdd4/architecture/system_context.md   # READ-ONLY (pins README edit region + confirms (b) is DONE)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This item MODIFIES exactly one existing file:
README.md   # +1 knob-count digit (19→20); +1 config-table row (shrink.notifyMaxChars); +1 JSON key in shrink block
```

### Known Gotchas of our codebase & Library Quirks

```markdown
<!-- GOTCHA #1 (the count bump is REQUIRED, not optional). Adding the notifyMaxChars row takes the config table
     from 19 → 20 data rows. Line 75's caption "All 19 knobs" is a maintained invariant (git: 338dc161 "Fix
     stale knob count..."). If you add the row but leave the caption at 19, you reintroduce the exact stale-count
     bug that prior commit fixed. ALWAYS do EDIT 1 + EDIT 2 together. Proof: spec/09 §3 lists 20 knobs; the
     reconciliation table below confirms both sources agree at 20. -->

<!-- GOTCHA #2 (spec cross-ref style differs between spec/ and README). spec/09 §3 writes refs as `@NN-name.md`
     (e.g. `@05-tools.md`); the README writes them as `spec/NN-name.md` (see existing rows: `spec/08-edge-cases.md`
     E15/E21, `spec/07-preventive-and-nudges.md` §5.1). When mirroring the §3 rationale into the new row, translate
     `@05-tools.md §2` → `spec/05-tools.md §2`. Do NOT copy the `@` form into the README. -->

<!-- GOTCHA #3 (row placement — above the nudges subheader, not at the end of the table). The shrink rows are a
     contiguous group: enabled, maxActive, staleAfterFires, [notifyMaxChars NEW]. The `**nudges**` line is a
     section *subheader* (a row with empty Default/Description cells). Insert the new row BETWEEN line 91
     (shrink.staleAfterFires) and line 92 (**nudges**). Putting it after nudges/audit/log would break the
     logical grouping and diverge from spec/09 §3's ordering. -->

<!-- GOTCHA #4 (the JSON example is COMMENTED OUT — preserve the comment prefix and trailing comma). Line 114
     begins with `  //   ` and ends with ` },`. The edit only inserts `, "notifyMaxChars": 2048` immediately
     before the closing `}`. Do NOT uncomment the block, do NOT drop the trailing comma (the next line, nudges,
     follows it), and do NOT reformat onto multiple lines — the README deliberately uses compact one-liners. -->

<!-- GOTCHA #5 (confirmations (b) and (d) are NO-OPS — do not "fix" them). (b) line 96 already shows
     `{ "read": 24576 }` (shipped in a prior delta; system_context.md "Already-done items, Change 5"). (d) line
     113 already has maxRetriesPerPrompt + abortContextFraction (P4 work). If you find yourself editing either,
     STOP — re-read the contract; they are confirmation-only. The validation loop greps them to prove they're
     intact post-edit. -->

<!-- GOTCHA #6 (sibling S2 owns the prose blurbs — do not touch them). P1.M5.T1.S2 "Feature blurbs for four
     behavior changes" will edit §4 tool descriptions (mulligan_cancel target API, shrink echo, checkpoint
     expiry, nudge text) and §5/§6/§7 prose. This PRP (S1) touches ONLY §3 (config table + JSON example). Do
     NOT pre-empt S2's edits — it lands separately and is verified separately. -->
```

## Implementation Blueprint

### Data models and structure

N/A — pure documentation. No types, schemas, or runtime models change. The only "model" is the README's
config-table row shape, which the new row mirrors exactly:

```markdown
| `<knob.path>` | `<default>` | <one-sentence rationale, mirroring spec/09 §3, with spec/ cross-refs> |
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT README.md line 75 — bump the knob-count caption
  - FIND:    "All 19 knobs (source of truth: `src/config.ts` `DEFAULT_CONFIG`; rationale: `spec/09-configuration.md` §3)."
  - REPLACE: "All 20 knobs (source of truth: `src/config.ts` `DEFAULT_CONFIG`; rationale: `spec/09-configuration.md` §3)."
  - WHY: adding the notifyMaxChars row (Task 2) takes the table 19 → 20. spec/09 §3 already lists 20, so 20 is
    correct and self-consistent. Leaving "19" reintroduces the stale-count bug fixed by git 338dc161.
  - UNIQUENESS: the string "All 19 knobs" appears exactly once in the repo (README line 75) — safe single replace.
  - DO NOT: change anything else on the line (the source-of-truth / rationale citation stays verbatim).

Task 2: EDIT README.md — insert the shrink.notifyMaxChars config-table row
  - FIND (the boundary: line 91 row + line 92 subheader, as a 2-line block so the insert lands in exactly one place):
      "| `shrink.staleAfterFires` | `3` | Auto-retire a pinned shrink whose target has been absent for this many consecutive filter fires (`spec/08-edge-cases.md` E15/E21). Stops dead markers being walked every fire. |\n| **nudges** | | |"
  - REPLACE (same 2 lines with the new row inserted BETWEEN them):
      "| `shrink.staleAfterFires` | `3` | Auto-retire a pinned shrink whose target has been absent for this many consecutive filter fires (`spec/08-edge-cases.md` E15/E21). Stops dead markers being walked every fire. |\n| `shrink.notifyMaxChars` | `2048` | Caps the replacement text shown to the operator via `ctx.ui.notify` when a shrink is recorded. Pure UI side-channel — **zero context cost** (the tool result itself stays terse). See `spec/05-tools.md` §2. |\n| **nudges** | | |"
  - WHY: mirrors spec/09 §3's `shrink.notifyMaxChars` rationale row (the README's cited rationale source), with
    `@05-tools.md` → `spec/05-tools.md` translation (GOTCHA #2). Default `2048` matches src/config.ts line 146.
    Placement after staleAfterFires / before **nudges** matches spec/09 §3 ordering (GOTCHA #3).
  - CONTRACT NOTE: the work-item's short gist ("Caps the replacement shown to the operator via ctx.ui.notify;
    zero context cost.") is satisfied and EXPANDED to the README's standard row detail (every other row mirrors
    spec/09 §3 at this length — e.g. shrink.staleAfterFires, nudges.driftThresholdTokens).
  - DO NOT: use the `@05-tools.md` form (use `spec/05-tools.md`); reorder existing rows; edit the staleAfterFires
    or **nudges** lines themselves (they're the FIND anchors and stay byte-identical).

Task 3: EDIT README.md line 114 — add notifyMaxChars to the JSON example shrink block
  - FIND:    '  //   "shrink": { "maxActive": 32, "staleAfterFires": 3 },'
  - REPLACE: '  //   "shrink": { "maxActive": 32, "staleAfterFires": 3, "notifyMaxChars": 2048 },'
  - WHY: matches spec/09 §2 (shrink block contains "notifyMaxChars": 2048) and the contract's verbatim target.
    Keeps the compact one-line commented form (GOTCHA #4).
  - UNIQUENESS: the string `//   "shrink": { "maxActive": 32, "staleAfterFires": 3 }` appears exactly once
    (README line 114) — safe single replace.
  - DO NOT: uncomment the block; drop the trailing comma (nudges line follows); split onto multiple lines; touch
    the rewind line (113) or nudges line (115).
```

### Implementation Patterns & Key Details

```markdown
<!-- PATTERN: every README config row mirrors its spec/09 §3 row. Side-by-side, the existing shrink rows prove
     the convention. notifyMaxChars follows it exactly. The ONLY README-specific transform is the cross-ref
     prefix: spec/09's "@NN-name.md" → README's "spec/NN-name.md". -->

<!-- PATTERN: the JSON example is a COMPACT, COMMENTED-OUT template (each section on one line, prefixed `//`).
     It shows representative non-default-shaped keys, not every knob (e.g. rewind omits enabled/protectedRoles;
     shrink omits enabled). Adding notifyMaxChars to the shrink line keeps that shape — one more key in the
     existing one-liner, nothing more. -->

<!-- The three edits are INDEPENDENT (no ordering dependency among them) but MUST all land: Task 1 without
     Task 2 leaves a stale count; Task 2 without Task 1 leaves an undercounted caption; Task 3 is standalone
     but is the contract's deliverable (c). Apply all three in one pass. -->
```

### Integration Points

```yaml
CODE:        none — no source files touched.
TESTS:       none — no tests touch README; `npx vitest run` is unaffected and irrelevant as a gate.
SPEC:        none — spec/09 §2/§3 are READ-ONLY (already correct); spec/05 is READ-ONLY (cited only).
CONFIG/DB:   none.
REGISTRATION: none.
DOCS:
  - modify: README.md §3 (Configuration) — 3 edits (caption count, table row, JSON shrink block).
  - deferred to sibling P1.M5.T1.S2: §4 tool blurbs + §5/§6/§7 prose for the four behavior changes.
  - this IS the Mode B changeset-level doc sync for the config surface — no other doc file is in scope.
```

## Validation Loop

> This is a documentation-only change. There is **no** `tsc`/`vitest` gate that exercises README (no markdown
> linter is configured in the repo). Validation is **grep + cross-check**. Each level below is a concrete,
> runnable command with its expected output.

### Level 1: Edit landing (grep — proves the three edits applied, no orphans)

```bash
# EDIT 1 landed: caption now says 20.
grep -n "All 20 knobs" README.md          # expect: 75:All 20 knobs (...)
grep -n "All 19 knobs" README.md          # expect: NO output (no orphaned stale count)

# EDIT 2 landed: the new row exists, placed between staleAfterFires and **nudges**.
grep -n "shrink.notifyMaxChars" README.md # expect exactly 2 hits: the table row + the JSON key
sed -n '91,93p' README.md                 # expect: staleAfterFires row, THEN notifyMaxChars row, THEN **nudges**

# EDIT 3 landed: JSON shrink block includes notifyMaxChars; old form is gone.
grep -n '"shrink": { "maxActive": 32, "staleAfterFires": 3, "notifyMaxChars": 2048 }' README.md  # expect 1 hit (line 114)
grep -n '"shrink": { "maxActive": 32, "staleAfterFires": 3 }' README.md                          # expect NO output (old form gone)
```
Expected: every "expect" above holds. Any mismatch ⇒ an edit was missed or mis-targeted.

### Level 2: Source-of-truth cross-check (proves the documented values are correct)

```bash
# Default 2048 matches src/config.ts (the shipped knob).
grep -n "notifyMaxChars: 2048" src/config.ts                       # expect 1 hit (DEFAULT_CONFIG, line 146)
# The knob is the 4th shrink field in the interface (after staleAfterFires).
grep -n "notifyMaxChars" src/config.ts                             # expect 3 hits: interface(73), default(146), validate(271)

# README row mirrors spec/09 §3 (the cited rationale source) — same default, same intent.
grep -n "shrink.notifyMaxChars" spec/09-configuration.md           # expect 2 hits: §2 schema(34), §3 rationale(75)
grep -n '"notifyMaxChars": 2048' spec/09-configuration.md          # expect 1 hit (§2 schema, line 34)
```
Expected: all hits present. The README's `2048` and the row's "zero context cost" wording derive directly from
these sources.

### Level 3: Confirmations intact + table integrity (proves (b)/(d) untouched + count reconciles)

```bash
# Confirmation (b): bloatThresholdBytesByTool row still shows { "read": 24576 } (a NO-OP — was already correct).
grep -n 'bloatThresholdBytesByTool.*{ "read": 24576 }' README.md   # expect 1 hit (line 96, table row)
grep -n '"bloatThresholdBytesByTool": { "read": 24576 }' README.md # expect 1 hit (line 115, JSON example)

# Confirmation (d): rewind JSON example still has both P4 knobs (a NO-OP — was already correct).
grep -n '"rewind": { "maxDepth": 5, "maxRetriesPerPrompt": 5, "abortContextFraction": 0.9 }' README.md  # expect 1 hit (line 113)

# Count reconciliation: README config-table data rows == spec/09 §3 rows == 20.
echo "README shrink+all data rows:"; grep -cE '^\| `(rewind|shrink|nudges|audit|log)\.' README.md   # expect 19 (rewind6 + shrink4 + nudges7 + audit1 + log1)
echo "(+ the master 'enabled' row)"; grep -cE '^\| `enabled`' README.md                            # expect 1
# → 19 + 1 = 20 total knobs. Matches "All 20 knobs" (EDIT 1) and spec/09 §3's 20 rows.
```
Expected: (b) and (d) greps each return their single hit (unchanged); the row counts sum to 20.

### Level 4: Render sanity (proves the markdown still parses cleanly)

```bash
# Table column count is uniform (every data row has exactly 3 cells: | knob | default | desc |).
# A miscounted row would break rendering. Count pipe-leading-cell per row in the config table region:
sed -n '/^### Defaults table/,/^### Minimal/p' README.md | grep -E '^\|' | awk -F'|' '{print NF-2" cells: "$0}' | grep -vE '^3 cells:' || echo "OK: all rows have 3 cells"

# The JSON example is still a balanced, commented block (every line starts with // or {/}; braces balance).
sed -n '/^```jsonc/,/^```/p' README.md | grep -v '^\(' | tr -cd '{}' | awk '{o=0; for(i=1;i<=length;i++){c=substr($0,i,1); if(c=="{")o++; else o--} } END{print (o==0?"OK: braces balance":"MISMATCH: "o)}'
```
Expected: "OK: all rows have 3 cells" and "OK: braces balance". (These are best-effort render guards; a human
eyeball of the rendered §3 table + JSON block is the final check.)

## Final Validation Checklist

### Technical Validation
- [ ] Level 1 grep: caption = `All 20 knobs`; new row present between staleAfterFires and **nudges**; JSON
      shrink block has `notifyMaxChars: 2048`; no orphaned `19 knobs` or old shrink-block strings.
- [ ] Level 2 cross-check: README `2048` == `src/config.ts` line 146 == `spec/09` §2 line 34; row wording
      mirrors `spec/09` §3 line 75.
- [ ] Level 3: confirmations (b) line 96 and (d) line 113 unchanged; README data rows sum to 20.
- [ ] Level 4: table rows all 3 cells; JSON braces balance.

### Feature Validation
- [ ] README §3 "Defaults table" lists `shrink.notifyMaxChars` (default `2048`) — the gap vs spec/09 §3 closed.
- [ ] README §3 "Minimal example settings.json" shrink block includes `"notifyMaxChars": 2048`.
- [ ] Knob-count caption matches the actual row count (20).
- [ ] `bloatThresholdBytesByTool` row and rewind JSON example left intact (confirmations b & d).
- [ ] All four contract sub-items (a add row, b confirm read:24576, c JSON shrink, d confirm rewind knobs) met.

### Code Quality / Scope Discipline
- [ ] ONLY `README.md` modified — no `src/`, `test/`, `spec/`, or other files touched.
- [ ] Cross-ref style is `spec/NN-name.md` (NOT spec/09's `@NN-name.md` form) — GOTCHA #2 respected.
- [ ] New row placed after `shrink.staleAfterFires`, before `**nudges**` (logical grouping preserved) — GOTCHA #3.
- [ ] JSON example stays commented-out, one-line, trailing comma retained — GOTCHA #4.
- [ ] Did NOT preempt sibling P1.M5.T1.S2 (§4 tool blurbs / §5–§7 prose) — GOTCHA #6.
- [ ] Did NOT "fix" the already-correct confirmation targets — GOTCHA #5.

### Documentation
- [ ] New row's description is faithful to spec/09 §3 (caps ctx.ui.notify replacement; zero context cost) and
      names the consuming spec (`spec/05-tools.md` §2).
- [ ] No new env vars, no code, no behavior change — README is the entire deliverable.

---

## Anti-Patterns to Avoid

- ❌ Don't add the notifyMaxChars row but leave "All 19 knobs" — that's the exact stale-count bug git 338dc161
  fixed. EDIT 1 and EDIT 2 are a pair.
- ❌ Don't copy spec/09's `@05-tools.md` cross-ref verbatim into the README — translate to `spec/05-tools.md`
  (the README convention; see every existing row).
- ❌ Don't place the new row at the end of the table or after `**nudges**` — it belongs in the shrink group,
  after `staleAfterFires`, mirroring spec/09 §3's ordering.
- ❌ Don't uncomment, reformat, or strip the trailing comma from the JSON example — it's a compact commented
  template; add one key, nothing more.
- ❌ Don't touch the `bloatThresholdBytesByTool` row or the rewind JSON line — both are confirmation-only
  no-ops (already correct).
- ❌ Don't edit §4 tool descriptions or §5/§6/§7 prose — that's sibling P1.M5.T1.S2's scope.
- ❌ Don't run `npx vitest run` / `tsc` as a gate for *this* change — no code changed; they're irrelevant. The
  gates are the grep + cross-check commands in the Validation Loop.

---

## Confidence Score

**9/10** for one-pass implementation success. This is a three-edit markdown sync against an already-shipped,
already-specified knob, with verbatim find/replace for every site, exact line numbers, the source-of-truth
value (2048) cited from two independent sources (`src/config.ts` + `spec/09`), and a knob-count reconciliation
table proving 19→20. The non-obvious risks are all surfaced: (1) the count bump (GOTCHA #1 — the pair rule),
(2) the `@`→`spec/` cross-ref translation (GOTCHA #2), (3) row placement above the **nudges** subheader
(GOTCHA #3), (4) preserving the commented JSON form (GOTCHA #4), (5) treating (b)/(d) as no-ops (GOTCHA #5),
and (6) not pre-empting S2's prose blurbs (GOTCHA #6). All are caught by the Level 1–3 grep gates. Residual
risk: a find-string typo — mitigated by each FIND being quoted verbatim from the current README and asserted
unique. No dependency on the parallel item P1.M4.T3.S1 (it touches `src/nudges.ts` + a test file, not README).