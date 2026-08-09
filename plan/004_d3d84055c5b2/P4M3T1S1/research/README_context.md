# Research — P4.M3.T1.S1: Add two rows to config table + JSON example

## Verdict
Single-file doc edit (`README.md`). The item contract is explicit and fully specifies the exact row text,
insertion point, and JSON example replacement. All facts below were verified against HEAD on 2024-plan-004.

## Verified facts (all confirmed by direct read of the tree)

### 1. The two knobs already exist in `src/config.ts` (P4.M1.T1.S1 — DONE)
```
src/config.ts:45      maxRetriesPerPrompt: number;      // interface field
src/config.ts:51      abortContextFraction: number;     // interface field
src/config.ts:131     maxRetriesPerPrompt: 5,           // DEFAULT_CONFIG
src/config.ts:132     abortContextFraction: 0.9,        // DEFAULT_CONFIG
```
Validation rules (config.ts:239-247): `maxRetriesPerPrompt` = integer >= 1 (default 5);
`abortContextFraction` = number in (0,1] (default 0.9). These match the item contract's stated ranges EXACTLY.

### 2. README config table — current rows (lines 82-85), verified by grep + read
```
82: | `rewind.enabled`              | `true`                          | ...
83: | `rewind.protectedRoles`       | `["first:user", "latest:user"]` | ...
84: | `rewind.maxDepth`             | `5`                             | ...
85: | `rewind.requireMutationWarning` | `true`                        | ...
```
**Insertion point:** two new rows go AFTER line 84 (`rewind.maxDepth`) and BEFORE line 85
(`rewind.requireMutationWarning`). This keeps the rewind block contiguous and matches the spec/09 JSON
knob order: `maxDepth, maxRetriesPerPrompt, abortContextFraction, requireMutationWarning`.

### 3. JSON example — current line 111 (verified by grep, exact match)
```
111:   //   "rewind": { "maxDepth": 5 },
```
The contract's replacement is exact:
```
  //   "rewind": { "maxDepth": 5, "maxRetriesPerPrompt": 5, "abortContextFraction": 0.9 },
```

### 4. CRITICAL GOTCHA — backtick formatting (the contract omits it)
The item contract prints the new rows WITHOUT markdown backticks:
`| rewind.maxRetriesPerPrompt | 5 | ... |`

But EVERY existing row in the table wraps the knob name AND the default value in backticks:
`| \`rewind.maxDepth\` | \`5\` | ... |`

→ The implementer MUST apply backtick formatting to the knob name and default to match the table convention.
The canonical rows (with backticks) are given in the PRP Blueprint. Do NOT copy the contract's raw text verbatim.

### 5. Validation tooling
- `package.json` scripts: only `test` (vitest run) and `smoke`. NO markdown linter, NO build script.
- → There is NO automated gate for README changes. Validation = deterministic `grep`/`git diff` checks +
  visual markdown-table inspection (columns align in a viewer). This is expected for a [Mode B] doc item.

### 6. Scope boundary (do NOT cross)
- This item (S1) = config table rows + JSON example ONLY.
- **S2** (separate item, P4.M3.T1.S2) = the feature-blurb sentence near line 242. Do NOT touch line 242 here.
- The architecture note (§8) lists the blurb as part of "README.md — Mode B locations" but it is a DISTINCT
  subtask. Stay strictly within: 2 table rows + 1 JSON example line.
- README.md is user-facing → [Mode B]: this README update IS the changeset-level doc; no further doc subtask.

## Spec cross-references (for the description-column wording)
- spec/09-configuration.md §2 (schema, PRD h2.107): JSON knob order = maxDepth, maxRetriesPerPrompt,
  abortContextFraction, requireMutationWarning.
- spec/09-configuration.md §3 (rationale, PRD h2.108): condensed rationale text used verbatim/paraphrased in
  the contract's description-column wording.
- spec/08-edge-cases.md E22 (PRD h2.102): the runaway-loop / zero-marker-loop backstop — the spec pointer both
  new rows cite.