# PRP — P1.M2.T1.S1: Fix nudges config block in spec/04-data-model.md (default 8192→16384 + add bloatThresholdBytesByTool)

## Goal

**Feature Goal**: Bring the `MulliganConfig.nudges` schema block in `spec/04-data-model.md` into consistency
with the **shipped** config (P2 raised the global default to `16384` and added the optional
`bloatThresholdBytesByTool` per-tool map). The block currently still says `// default 8192` and omits the
per-tool field entirely, contradicting `src/config.ts`, `spec/07`, `spec/09`, and PRD §7.

**Deliverable**: A documentation-only edit (Mode A) to **exactly one file** — `spec/04-data-model.md` —
touching the `nudges:` block (lines 240–244):
- **(A)** line 242 — change the `bloatThresholdBytes` comment from `// default 8192 …` to `// default 16384 …; 16 KB`.
- **(B)** insert ONE new line (after `bloatThresholdBytes`, before `driftThresholdTokens`) for the optional
  `bloatThresholdBytesByTool?` field with its default map.

**Success Definition**: After the edit, the `nudges` block in spec/04 (a) shows `bloatThresholdBytes` default
`16384` (16 KB); (b) contains an OPTIONAL `bloatThresholdBytesByTool?: Record<string, number>` field with
default `{ bash: 32768, read: 20480 }`; (c) these numbers exactly match `src/config.ts` (interface line 68 +
DEFAULT_CONFIG lines 109–110) and `spec/09-configuration.md:66–67`. No `8192` remains in the block.

## User Persona (if applicable)

**Target User**: Developers and build agents reading the omnibus spec (spec/01–spec/10 concatenate per PRD §0)
to implement or extend Mulligan. Per PRD §0, "a naive dev agent can one-shot the implementation" from the
spec — so the config schema in spec/04 must show the correct shape and defaults.

**Use Case**: A developer opens spec/04 to recall the `MulliganConfig` shape and the bloat-threshold defaults.

**Pain Points Addressed**: Today spec/04 shows the WRONG default (`8192`) and a MISSING field
(`bloatThresholdBytesByTool`), so a reader reconstructs a stale config shape and wrong default — directly
contradicting the shipped code and the other (correctly updated) spec files.

## Why

- **Consistency across the omnibus spec**: per PRD §0 the companion spec files concatenate into one
  specification. spec/04 currently disagrees with spec/07 (line 52: `16384`) and spec/09 (lines 66–67:
  `16384` + `{bash:32768, read:20480}`) — and with the shipped `src/config.ts`. BUG-002 is exactly this
  incomplete-sync residue from the P2 per-tool-threshold changeset.
- **Spec = authoritative master**: a stale schema + wrong default here is precisely how a build agent would
  re-introduce the old (wrong) 8 KB default or omit the per-tool map. Fixing spec/04 closes the gap so the
  data-model section agrees with the behavior section (spec/07) and the config section (spec/09).
- **No code, no tests, no build.** Pure documentation.

## What

Two surgical text changes inside the `nudges:` block of `spec/04-data-model.md` (the block is inside the
`interface MulliganConfig` ```ts fenced schema, lines 240–244). No heading, numbering, structural, or
fence change. No other spec file touched.

### Success Criteria

- [ ] Line 242 `bloatThresholdBytes: number;` comment reads `// default 16384 (in-context bytes of a single
      result; 16 KB)` — no `8192`.
- [ ] A new line for `bloatThresholdBytesByTool?: Record<string, number>; // per-tool overrides; default { bash: 32768, read: 20480 }`
      appears AFTER `bloatThresholdBytes` and BEFORE `driftThresholdTokens`.
- [ ] The new field is marked OPTIONAL (`?`) — matching `src/config.ts` interface line 68
      (`bloatThresholdBytesByTool?: Record<string, number>;`).
- [ ] The numbers cited (`16384`, `32768`, `20480`) match `src/config.ts:109-110` and `spec/09:66-67` exactly.
- [ ] `grep -n '8192' spec/04-data-model.md` → **0 hits** in the nudges block (and ideally the whole file).
- [ ] `grep -n 'bloatThresholdBytesByTool' spec/04-data-model.md` → **≥1 hit** (the new line).
- [ ] No file other than `spec/04-data-model.md` is modified.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains the verbatim current text of the target block, the verbatim desired replacement
text, the authoritative source-of-truth facts (shipped defaults + the optional-`?` interface field) with exact
file/line citations, the alignment analysis (why the new line's comment follows `;` with one space rather than
column-aligning), and the deterministic grep validation gates. The implementer needs no codebase exploration
beyond opening `spec/04-data-model.md`.

### Documentation & References

```yaml
# MUST READ — the ONLY file this PRP modifies
- file: spec/04-data-model.md
  why: The MulliganConfig schema (nudges block, lines 240–244) is the documentation surface being corrected.
  section: "§7 MulliganConfig interface, the nudges: { ... } block (line 240 'nudges: {' … line 244 '};')."
  gotcha: "The block is INSIDE a ```ts fenced code schema. Preserve the 4-space field indent and the
           column-aligned `//` comments of the UNCHANGED lines (bloatReminder/perTurnDrift/
           driftThresholdTokens). The NEW bloatThresholdBytesByTool line is LONGER than the alignment
           column (53 chars vs 38), so its `//` comment follows the `;` with a SINGLE space — it does NOT
           align to column 39 (see 'Alignment analysis' below). Do NOT re-align the other lines."

# MUST READ — the shipped config (the shape/defaults the spec must mirror)
- file: src/config.ts
  why: (1) Interface field line 68 `bloatThresholdBytesByTool?: Record<string, number>;` — the `?` OPTIONAL
        marker the spec must copy. (2) DEFAULT_CONFIG lines 109–110: `bloatThresholdBytes: 16384,` and
        `bloatThresholdBytesByTool: { bash: 32768, read: 20480 },` — the exact default values.
  pattern: "optional interface field (?:) + DEFAULT_CONFIG object — spec/04 mirrors the interface shape +
            cites the DEFAULT_CONFIG defaults."
  gotcha: "The interface uses `bloatThresholdBytesByTool?` (optional) but DEFAULT_CONFIG ALWAYS supplies it
           (validateConfig guarantees a valid map). The spec line must show the `?` (interface shape) while
           documenting the DEFAULT map in the comment."

# MUST READ — the authoritative defaults table (cross-check the numbers)
- file: spec/09-configuration.md
  why: Lines 66–67 are the source of truth for the defaults prose: global 16384 (16 KB); per-tool
        { "bash": 32768, "read": 20480 }. The new spec/04 comment must cite THESE numbers verbatim.
  section: "§2 defaults table, rows nudges.bloatThresholdBytes + nudges.bloatThresholdBytesByTool."
  gotcha: "READ-ONLY — do NOT edit spec/09 (it is already correct)."

# MUST READ — the nudge spec (already correct; spec/04 must agree with it)
- file: spec/07-preventive-and-nudges.md
  why: Line 52 states 'Default bloatThresholdBytes = 16384 (16 KB)' + the raise-from-8192 history. spec/04's
        new default (16384) must agree with this.
  section: "§1 line 52 (Default bloatThresholdBytes = 16384)."
  gotcha: "READ-ONLY — do NOT edit spec/07."

# CONTEXT — root-cause + the exact target text for BUG-002
- file: plan/002_df93178e6631/bugfix/002_7e5972dda3a9/architecture/system_context.md
  why: BUG-002 section gives the current (stale) block, the expected shape, and the already-correct
        references (spec/07:52, spec/09:66-67, src/config.ts:109-110) so the implementer can cross-check.
  critical: "This is a DOC-ONLY fix. Do NOT change any code. The parallel code fix (BUG-001) edits
             src/nudges.ts + test/nudges.test.ts — a completely separate surface; zero overlap."

# CONTEXT — the parallel code fix (confirms no file conflict)
- file: plan/002_df93178e6631/bugfix/002_7e5972dda3a9/P1M1T1S1/PRP.md
  why: CONTRACT. Edits src/nudges.ts (1 line + JSDoc) and test/nudges.test.ts (1 test). It does NOT touch
        any spec/ file. This PRP edits ONLY spec/04-data-model.md → no overlap, no dependency, either order.
```

### Current Codebase tree (the only relevant slice)

```bash
spec/
├── 04-data-model.md             # ← THIS PRP edits the nudges: { ... } block (lines 240–244)
├── 07-preventive-and-nudges.md  # READ-ONLY reference — line 52 already says 16384
├── 09-configuration.md          # READ-ONLY reference — lines 66–67 already correct
└── (01, 10 — owned by P1.M2.T2.S1/S2, BUG-003)
src/config.ts                    # READ-ONLY reference — interface line 68 + DEFAULT_CONFIG 109–110
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This item MODIFIES exactly one existing file:
spec/04-data-model.md   # 1 comment change (line 242) + 1 inserted line (new line 243)
```

### Known Gotchas of our codebase & Library Quirks

```python
# CRITICAL GOTCHA #1 (alignment): the existing nudges block column-aligns its `//` comments at column 39
#   (38 chars precede `//`). The NEW line's declaration is WIDER than that:
#     "    bloatThresholdBytesByTool?: Record<string, number>;" = 53 chars  (4-indent + 49)
#   which EXCEEDS the alignment column. So the new line's `//` comment follows the `;` with a SINGLE space
#   (the natural fallback when a declaration is wider than the block's alignment width). Do NOT try to
#   force-align it, and do NOT re-align the other (unchanged) lines. This matches the task contract's own
#   INPUT example, which uses `...number>; // per-tool overrides; ...` (single space).

# CRITICAL GOTCHA #2 (optional marker): the field MUST be written `bloatThresholdBytesByTool?` (with `?`),
#   matching src/config.ts interface line 68. The `?` records that the INTERFACE field is optional; the
#   comment documents the DEFAULT map ({ bash: 32768, read: 20480 }) that validateConfig always supplies.
#   Do NOT drop the `?` and do NOT drop the default-map comment — both are part of the correct shape.

# CRITICAL GOTCHA #3 (numbers are fixed): cite EXACTLY 16384 (global), 32768 (bash), 20480 (read).
#   These come from src/config.ts:109-110 and spec/09:66-67. Do NOT write 8192 or 8 KB anywhere in the
#   rewritten text.

# CRITICAL GOTCHA #4 (placement): the new line goes AFTER bloatThresholdBytes and BEFORE driftThresholdTokens
#   (not at the end of the block, not before bloatThresholdBytes). This keeps field order consistent with
#   src/config.ts (interface lines 64→68→71 and DEFAULT_CONFIG 109→110→111), which reads bloatThresholdBytes,
#   then bloatThresholdBytesByTool, then driftThresholdTokens.

# OUT OF SCOPE (do NOT touch in this subtask):
#   - src/* (config.ts, nudges.ts, audit.ts) → code, read-only / out of scope.
#   - spec/07, spec/09 → already correct (read-only references).
#   - spec/10 (line 67) and spec/01 (line 197) → BUG-003, owned by P1.M2.T2.S1/S2.
#   - README.md → P1.M2.T3.S1 sweep (separate).
#   - test/* → no tests for a doc change.
# This PRP edits ONLY spec/04-data-model.md, the nudges: block.
```

---

## Implementation Blueprint

### Data models and structure
_N/A — documentation-only (Mode A). The PRP mirrors an EXISTING shipped interface; it introduces no new
types. The spec line documents `src/config.ts` interface field `bloatThresholdBytesByTool?: Record<string, number>;`
(default `{ bash: 32768, read: 20480 }`) and corrects the `bloatThresholdBytes` default to `16384`._

### Alignment analysis (why the new line uses a single-space comment)

The existing four `nudges` lines column-align their `//` comments: **38 characters precede `//`** (column 39).
Verified by counting each declaration (4-space indent + `name: type;`):

| Line | declaration chars (incl. 4-indent) | padding before `//` |
|---|---|---|
| `    bloatReminder: boolean;` | 27 | 11 spaces |
| `    perTurnDrift: boolean;` | 26 | 12 spaces |
| `    bloatThresholdBytes: number;` | 32 | 6 spaces |
| `    driftThresholdTokens: number;` | 34 | 4 spaces |

The NEW line `    bloatThresholdBytesByTool?: Record<string, number>;` is **53 chars** — already past column 38.
So its inline comment **cannot** align to column 39; it follows the `;` with a **single space**
(`...number>; // per-tool overrides; default { bash: 32768, read: 20480 }`). This is exactly the form in the
task contract's INPUT example and is the conventional fallback for an over-wide declaration in an
otherwise-aligned block. **Do not re-align the other lines.**

### Implementation Tasks (ordered by dependencies)

Two edits in one file. Apply edit (A) then edit (B) (or together in one edit call). Each is an exact
find/replace. **Verify each `FIND` string matches verbatim before replacing.**

```yaml
Task 1 (edit A): EDIT spec/04-data-model.md — line 242 (bloatThresholdBytes comment)
  - FIND (verbatim current):
      "    bloatThresholdBytes: number;     // default 8192 (in-context bytes of a single result)"
  - REPLACE WITH:
      "    bloatThresholdBytes: number;     // default 16384 (in-context bytes of a single result; 16 KB)"
  - RATIONALE: the global default was raised 8192 → 16384 (16 KB) in P2 (src/config.ts:109,
    spec/09:66, spec/07:52). The "(in-context bytes of a single result)" wording is retained; only the
    number is corrected and "; 16 KB" is appended for clarity.
  - PRESERVE: the 4-space indent, the `bloatThresholdBytes: number;` declaration, the 6 padding spaces
    before `//`, and the "(in-context bytes of a single result)" clause. Change ONLY `8192` → `16384` and
    append `; 16 KB` before the closing of the comment.

Task 2 (edit B): EDIT spec/04-data-model.md — INSERT a new line for bloatThresholdBytesByTool
  - FIND (verbatim current — the bloatThresholdBytes line followed by the driftThresholdTokens line):
      "    bloatThresholdBytes: number;     // default 16384 (in-context bytes of a single result; 16 KB)\n    driftThresholdTokens: number;    // default 3000 (turn delta that triggers the nudge)"
    (NOTE: if you apply Task 1 first, the bloatThresholdBytes line is the POST-edit version above. If you
    apply both in one edit, FIND the PRE-edit two-line span with `8192` and REPLACE with the three-line
    span below.)
  - REPLACE WITH (three lines — bloatThresholdBytes [post-edit A] + NEW line + driftThresholdTokens):
      "    bloatThresholdBytes: number;     // default 16384 (in-context bytes of a single result; 16 KB)\n    bloatThresholdBytesByTool?: Record<string, number>; // per-tool overrides; default { bash: 32768, read: 20480 }\n    driftThresholdTokens: number;    // default 3000 (turn delta that triggers the nudge)"
  - RATIONALE: adds the optional per-tool override map (interface field src/config.ts:68; default map
    DEFAULT_CONFIG src/config.ts:110). Placed AFTER bloatThresholdBytes and BEFORE driftThresholdTokens to
    match src/config.ts field order. The `?` records the OPTIONAL interface field; the comment documents the
    default map ({ bash: 32768, read: 20480 }) that validateConfig always supplies.
  - FORM: the new line is `    bloatThresholdBytesByTool?: Record<string, number>; // per-tool overrides; default { bash: 32768, read: 20480 }`
    — 4-space indent, declaration, SINGLE space, `//` comment (see Alignment analysis: this line is wider
    than the block's alignment column, so its comment follows `;` with one space; do NOT column-align it).
  - DO NOT: change bloatReminder, perTurnDrift, or driftThresholdTokens lines; do NOT re-align the block;
    do NOT add a trailing blank line inside the block.
```

#### Resulting block (post-edit, lines ~240–245)

````
  nudges: {
    bloatReminder: boolean;          // tool_result annotation; default true
    perTurnDrift: boolean;           // context nudge; default true
    bloatThresholdBytes: number;     // default 16384 (in-context bytes of a single result; 16 KB)
    bloatThresholdBytesByTool?: Record<string, number>; // per-tool overrides; default { bash: 32768, read: 20480 }
    driftThresholdTokens: number;    // default 3000 (turn delta that triggers the nudge)
  };
````

### Implementation Patterns & Key Details

The shipped config the spec must mirror (from `src/config.ts`):

```ts
// src/config.ts — interface field (line 68): OPTIONAL marker `?`
bloatThresholdBytesByTool?: Record<string, number>;

// src/config.ts — DEFAULT_CONFIG (lines 109–111): always-supplied defaults
bloatThresholdBytes: 16384,
bloatThresholdBytesByTool: { bash: 32768, read: 20480 },
driftThresholdTokens: 3000,
```

Therefore the spec line is: optional interface field (`?`) documenting the always-supplied DEFAULT map.
`validateConfig`/`coerceBloatThresholdByTool` guarantees the map is a valid `Record<string, number>` after
validation (a non-object input falls back to the default map; invalid entries are dropped + warned) — so the
runtime value is never `undefined` even though the interface field is optional. The spec comment cites the
DEFAULT map; it does not need to describe coercion (that lives in spec/09 §4).

### Integration Points

```yaml
NO INTEGRATION POINTS — documentation-only change (Mode A).
  - DATABASE: none
  - CONFIG: none (the doc MIRRORS config.ts defaults; it does not change them)
  - ROUTES: none
  - CODE: none (src/* are READ-ONLY references; the parallel code fix P1.M1.T1.S1 edits src/nudges.ts +
          test/nudges.test.ts — a separate surface, zero overlap)
  - The only "integration" is CROSS-SPEC CONSISTENCY: spec/04 nudges block must agree with spec/07:52,
    spec/09:66-67, and src/config.ts:68/109-110. Validation gates below enforce this via grep.
```

---

## Validation Loop

This is a markdown schema-block edit. Validation = grep-based consistency checks + cross-file number checks.
No build, no tests (a spec-doc change has no executable surface; `npm run smoke` and the vitest suite are
unaffected — they run against code, not spec prose).

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Markdown sanity — the ```ts fence count is unchanged (the edit is internal to an existing fenced schema;
# we neither add nor remove a fence).
grep -c '```' spec/04-data-model.md   # note the count BEFORE and AFTER; must be identical

# Confirm the block now reads correctly (print the nudges block):
sed -n '240,245p' spec/04-data-model.md
```
Expected: the block matches the "Resulting block" above — `16384`, the `bloatThresholdBytesByTool?` line
present, `driftThresholdTokens` intact, `//` comments aligned on the unchanged lines and the new line's
comment following its `;` with one space.

### Level 2: Stale-content gate (the core BUG-002 checks)

```bash
# (a) No stale "8192" left in spec/04's nudges block (lines 240–245):
awk 'NR>=240 && NR<=245' spec/04-data-model.md | grep -n '8192' && echo "FAIL: stale 8192 in nudges block" || echo "PASS: no 8192 in nudges block"

# (b) The new field is present:
grep -n 'bloatThresholdBytesByTool' spec/04-data-model.md   # expect ≥1 hit in the nudges block

# (c) The corrected default is present:
grep -n 'default 16384' spec/04-data-model.md               # expect ≥1 hit (line 242)

# (d) The new field is OPTIONAL (has the `?`):
grep -n 'bloatThresholdBytesByTool?' spec/04-data-model.md  # expect ≥1 hit (the `?` must be present)
```
Expected: (a) PASS (no `8192`); (b)(c)(d) each ≥1 hit.

### Level 3: Cross-spec / cross-code consistency (system validation)

```bash
# The numbers cited in spec/04 must match src/config.ts (DEFAULT_CONFIG) and spec/09 (defaults table).
echo "--- src/config.ts DEFAULT_CONFIG (the shipped defaults) ---"
sed -n '109,111p' src/config.ts

echo "--- spec/09 defaults table (source of truth) ---"
sed -n '66,67p' spec/09-configuration.md

echo "--- spec/04 nudges block (the edited surface) ---"
sed -n '240,245p' spec/04-data-model.md
```
Expected: spec/04 cites `16384`, `{ bash: 32768, read: 20480 }` — identical to src/config.ts:109-110 and
spec/09:66-67.

```bash
# Optional: confirm spec/07 also agrees (16 KB):
grep -n '16384' spec/07-preventive-and-nudges.md | head -1
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Optional markdown preview: confirm the ```ts MulliganConfig schema still renders cleanly (the new line is
# a normal interface field; no broken fence or indentation). The Level-1 fence-count check covers structural
# integrity; no further automated gate is needed for a 1-line-insert + 1-comment-change prose edit.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: ```` ``` ```` fence count unchanged before/after the edit.
- [ ] Level 1: `sed -n '240,245p' spec/04-data-model.md` shows the corrected block.
- [ ] Level 2(a): no `8192` in the nudges block (lines 240–245).
- [ ] Level 2(b): `bloatThresholdBytesByTool` present in spec/04.
- [ ] Level 2(c): `default 16384` present (line 242).
- [ ] Level 2(d): the new field has the OPTIONAL `?` marker (`bloatThresholdBytesByTool?`).
- [ ] Level 3: cited numbers (`16384` / `32768` / `20480`) match src/config.ts:109-110 and spec/09:66-67.

### Feature Validation
- [ ] Line 242 comment reads `// default 16384 (in-context bytes of a single result; 16 KB)` — no `8192`.
- [ ] New `bloatThresholdBytesByTool?: Record<string, number>;` line present, AFTER `bloatThresholdBytes`
      and BEFORE `driftThresholdTokens`, comment `// per-tool overrides; default { bash: 32768, read: 20480 }`.
- [ ] The new field is OPTIONAL (`?`) — matches src/config.ts interface line 68.
- [ ] The unchanged lines (bloatReminder, perTurnDrift, driftThresholdTokens) are byte-identical.
- [ ] No edits to any file other than `spec/04-data-model.md`.

### Code Quality / Scope Discipline
- [ ] Did NOT touch `src/*` (config.ts, nudges.ts, audit.ts) — code, out of scope / parallel item's surface.
- [ ] Did NOT touch `spec/07` or `spec/09` — already correct (read-only references).
- [ ] Did NOT touch `spec/10` (line 67) or `spec/01` (line 197) — BUG-003, owned by P1.M2.T2.S1/S2.
- [ ] Did NOT touch `README.md` — P1.M2.T3.S1 sweep (separate).
- [ ] Did NOT touch `test/*` — no tests for a doc change.
- [ ] Did NOT re-align the block's unchanged `//` comments; the new line's comment follows `;` with one space
      (it is wider than the alignment column — see Alignment analysis).

### Documentation
- [ ] spec/04 nudges block now agrees with spec/07:52, spec/09:66-67, and src/config.ts:68/109-110.
- [ ] A developer/build agent reading only spec/04 would now reconstruct the correct config shape (optional
      per-tool map) and the correct default (16384 / {bash:32768, read:20480}).

---

## Anti-Patterns to Avoid

- ❌ Don't drop the `?` on `bloatThresholdBytesByTool?` — the interface field is OPTIONAL (src/config.ts:68);
  the `?` records that, while the comment documents the always-supplied DEFAULT map.
- ❌ Don't column-align the new line's `//` comment to column 39 — its declaration (53 chars) is wider than
  the alignment column; it must follow `;` with a single space. And do NOT re-align the other lines to
  accommodate it.
- ❌ Don't write `8192` or `8 KB` anywhere in the rewritten text — use the shipped values (16384 / 32768 /
  20480) from src/config.ts + spec/09.
- ❌ Don't place the new field at the end of the block or before `bloatThresholdBytes` — it goes BETWEEN
  `bloatThresholdBytes` and `driftThresholdTokens` (matching src/config.ts field order).
- ❌ Don't touch src/config.ts, src/nudges.ts, audit.ts, spec/07, spec/09, spec/10, spec/01, README, or any
  test file — those are out of scope / owned by other subtasks. This PRP edits ONLY spec/04-data-model.md.
- ❌ Don't add tests or run the build — documentation-only (Mode A); there is no executable surface to test.

---

## Confidence Score

**9/10** for one-pass implementation success. This is a 2-spot markdown edit (1 comment change + 1 inserted
line) with verbatim find/replace text, the exact shipped source-of-truth (src/config.ts interface line 68 +
DEFAULT_CONFIG 109–110) and cross-references (spec/09:66-67, spec/07:52) with file/line citations, an
explicit alignment analysis (the one non-obvious decision: why the new line's comment uses a single space
rather than column-aligning), and deterministic grep validation gates for every defect. The residual risks:
(1) the implementer might be tempted to column-align the new line's comment — explicitly called out in the
Alignment analysis and the Anti-Patterns; (2) line numbers may shift by one after the insert — the grep gates
key on content (`bloatThresholdBytesByTool`, `default 16384`, no `8192`), not on fixed line numbers, so they
remain robust. No dependency on the parallel code fix (separate file surface).