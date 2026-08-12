# PRP — P1.M2.T1.S1: renderAuditReport checkpoint clause — add `(user-set)`, singularize count (BUG-003)

## Goal

**Feature Goal**: Bring `renderAuditReport`'s checkpoint clause into compliance with spec/13 §4 step 3: append
` (user-set)` when at least one checkpoint is armed, and singularize the count (`1 checkpoint`, not
`1 checkpoints`). The `(user-set)` annotation is meaningful in v1.1 — checkpoints moved to the user (E23), so
the annotation distinguishes them as user-owned destructive-power grants. Affects BOTH the agent
`mulligan_audit` tool and the human `/mulligan_audit` command (they share `renderAuditReport`).

**Deliverable**: Edits to **two files**:
1. `src/tools/audit.ts` — the checkpoint clause (lines ~448–454): add `ckptWord` (singularize) +
   `ckptUserSet` (`(user-set)` when length > 0) consts; reorder the template so `(user-set)` follows the names
   bracket and precedes the cancelledClause.
2. `test/tools/audit.test.ts` — 2 verbatim assertions gain ` (user-set)` (lines 550, 929) + 1 doc-comment
   (line 23) + 1 NEW pure-renderer test for the singular+annotation case. (`commands.test.ts` is
   self-consistent — unaffected.)

**Success Definition**: After the edit, `renderAuditReport` with `checkpointNames:["before-x","before-y"]`
renders `… 2 checkpoints [before-x, before-y] (user-set)`; with `["solo"]` renders `… 1 checkpoint [solo]
(user-set)`; with `[]` renders `0 checkpoints []` (no annotation). `npx tsc --noEmit` exits 0;
`npx vitest run test/tools/audit.test.ts test/commands.test.ts` passes (audit +1 new test; commands unchanged).

## User Persona (if applicable)

**Target User**: The human reading the `/mulligan_audit` output (and the agent reading `mulligan_audit`) — they
need to see, at a glance, what destructive power (checkpoints) they have armed.

**Use Case**: The user runs `/mulligan_audit` to review armed checkpoints before a destructive rewind.

**Pain Points Addressed**: Today the audit report shows `N checkpoints [names]` with no indication these are
USER-set grants (vs. some agent-internal construct), and says `1 checkpoints` (un-singularized). The fix adds
the `(user-set)` qualifier and fixes the grammar.

## Why

- **Spec compliance (spec/13 §4 step 3)**: the report's Active-markers line MUST include
  `N checkpoints [names] (user-set)`. The implementation omits it — BUG-003 (Minor). PRD §2.5 recommends the fix.
- **v1.1 semantics (E23)**: checkpoints moved from an agent tool to a user command; the `(user-set)` annotation
  makes their user-owned nature visible in the audit, reinforcing the guardrail mental model.
- **Cosmetic correctness**: `1 checkpoints` → `1 checkpoint`. Trivial but the audit is a human-facing surface.

## What

Two new consts + a template reorder in the checkpoint clause of `renderAuditReport`. No signature change, no
type change, no behavior beyond the rendered string. Plus 2 test-string updates, 1 doc-comment, 1 new test.

### Success Criteria

- [ ] `renderAuditReport` checkpoint clause uses `ckptWord` (`"checkpoint"` when length===1, else `"checkpoints"`)
      and appends ` (user-set)` (via `ckptUserSet`) when `checkpointNames.length > 0`.
- [ ] Template order: `${count} ${ckptWord}${ckptNames}${ckptUserSet}${cancelledClause}` — `(user-set)` AFTER
      the names bracket, BEFORE the cancelledClause.
- [ ] `0 checkpoints []` (length 0) renders with NO `(user-set)` (cancelledClause still appends if
      `cancelledCount > 0`).
- [ ] audit.test.ts line 550 + line 929 assertions updated to include ` (user-set)`.
- [ ] NEW pure-renderer test: `checkpointNames:["solo"]` → `1 checkpoint [solo] (user-set)`.
- [ ] `npx tsc --noEmit` exits 0; `npx vitest run test/tools/audit.test.ts test/commands.test.ts` passes.
- [ ] No edits to `commands.test.ts` (self-consistent). No edits outside audit.ts + audit.test.ts.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP carries the verbatim current checkpoint clause, the verbatim desired replacement (with the
two new consts + reordered template), the verbatim before→after for both affected test assertions, the new
test's full body, the proof that `commands.test.ts` is self-consistent (unaffected), and the spec citation.

### Documentation & References

```yaml
# MUST READ — the file being edited (the checkpoint clause)
- file: src/tools/audit.ts
  why: renderAuditReport (lines ~440–480); the checkpoint clause is the L.push at lines ~448–454. Add ckptWord
        + ckptUserSet consts; change `checkpoints` → `${ckptWord}`; insert `${ckptUserSet}` before
        `${cancelledClause}`. PURE function (shared by agent tool + human command — spec/13 §4 'same renderer').
  pattern: "the clause is one L.push template literal: `${rewinds} rewind…, ${shrinks} shrink, ${count}
            checkpoints${ckptNames}${cancelledClause}`. The fix splits `checkpoints` into `${ckptWord}` and
            inserts `${ckptUserSet}` between ckptNames and cancelledClause."
  gotcha: "template ORDER matters: `${count} ${ckptWord}${ckptNames}${ckptUserSet}${cancelledClause}`. The
           `(user-set)` must come AFTER the names bracket and BEFORE the `, N cancelled (retired)` clause.
           ckptUserSet is `\"\"` (empty) when length===0, so the empty-checkpoint tests stay byte-identical."

# MUST READ — the bug research (exact fix form + spec citation)
- file: plan/007_67d7d8c6e4c5/bugfix/001_8fe6022f172a/architecture/bug_analysis.md
  why: §BUG-003 (lines 109–157) gives the exact ckptWord/ckptUserSet consts (lines 136–139), the spec/13 §4
        step 3 citation (line 121–122), and the affected-tests map (lines 146–157) incl. the NEW singular test.
  critical: "the cancelledClause (P3.M1.T4.S1 / E21 (c)) stays LAST — `(user-set)` precedes it. The
             empty-checkpoint tests (length 0) are UNCHANGED (no annotation)."

# MUST READ — the test file (2 string updates + 1 new test + 1 doc-comment)
- file: test/tools/audit.test.ts
  why: Line 550 (integration toContain) + line 929 (pure-renderer exact toBe(lines[2])) both assert
        `2 checkpoints [before-x, before-y]` → append ` (user-set)`. Line 23 (file-header docstring) shows the
        same format → update for consistency. Lines 558 + 975 (`0 checkpoints []`) UNCHANGED. Add a NEW
        pure-renderer it() for `checkpointNames:["solo"]` → `1 checkpoint [solo] (user-set)`.
  gotcha: "the cancelled tests (568–600) use checkpointNames:[] → no annotation appears → their
           `.toContain(', N cancelled (retired)')` still matches. DO NOT edit them."

# SHOULD READ — proves commands.test.ts is UNAFFECTED (self-consistent)
- file: test/commands.test.ts
  why: buildExpectedReport (516–543) calls renderAuditReport; the case-(a) test (559) asserts EXACT-STRING
        equality `notify msg === renderAuditReport re-derived`. BOTH sides call renderAuditReport → both change
        identically → equality holds. Fixtures use entries:[] → `0 checkpoints []` (no annotation anyway).
  critical: "do NOT edit commands.test.ts. It is self-consistent (symmetric renderer use). Editing it would be
             a scope violation; the exact-equality test passes unchanged."

# SHOULD READ — the spec requirement
- file: spec/13-human-facing-surface.md
  why: §4 step 3 (line 89): 'the report's Active markers line includes `N checkpoints [names] (user-set)` so
        the human can see what they have armed.' This is the verbatim target format.
  gotcha: "READ-ONLY — do NOT edit spec/13. The JSDoc/code comment cites it."

# CONTEXT — the parallel item (confirms disjoint files)
- file: plan/007_67d7d8c6e4c5/bugfix/001_8fe6022f172a/P1M1T2S1/PRP.md
  why: CONTRACT. Edits src/nudges.ts (renderHighWaterNudge) + test/drift_nudge.test.ts + README. Does NOT touch
        audit.ts / audit.test.ts / commands.test.ts. Zero overlap; either order.
```

### Current Codebase tree (the only relevant slice)

```bash
src/
└── tools/audit.ts        # ← EDIT: renderAuditReport checkpoint clause (448–454)
test/
├── tools/audit.test.ts   # ← EDIT: lines 550 + 929 (append ' (user-set)'), line 23 (doc), + 1 new test
└── commands.test.ts      # READ-ONLY — self-consistent exact-equality; UNAFFECTED
spec/13-human-facing-surface.md  # READ-ONLY reference — §4 step 3 (the target format)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This item MODIFIES exactly two existing files:
src/tools/audit.ts        # checkpoint clause: +ckptWord +ckptUserSet, reordered template
test/tools/audit.test.ts  # 2 assertion string updates + 1 doc-comment + 1 new singular test
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 (template ORDER): the checkpoint fragment must be
//   `${count} ${ckptWord}${ckptNames}${ckptUserSet}${cancelledClause}`.
//   (user-set) comes AFTER the names bracket ([…]) and BEFORE the cancelledClause (", N cancelled (retired)").
//   Example with both: `2 checkpoints [before-x, before-y] (user-set), 1 cancelled (retired)`.

// CRITICAL GOTCHA #2 (length 0 → NO annotation): ckptUserSet is "" when checkpointNames.length === 0. So
//   `0 checkpoints []` stays byte-identical (the empty-checkpoint tests at lines 558 + 975 are UNCHANGED).
//   Do NOT append (user-set) when nothing is armed.

// CRITICAL GOTCHA #3 (commands.test.ts is self-consistent — DO NOT EDIT): its case-(a) test asserts
//   `notify === renderAuditReport(re-derived)`. Both sides call renderAuditReport → both produce the new
//   format identically → exact equality STILL HOLDS. Editing it would break the symmetry / violate scope.

// CRITICAL GOTCHA #4 (cancelled tests use empty checkpoints): the cancelledCount>0 tests (568–600) set
//   checkpointNames:[] → no (user-set) annotation → their `.toContain(", N cancelled (retired)")` still
//   matches. Leave them unchanged.

// OUT OF SCOPE (do NOT touch in this subtask):
#   - src/nudges.ts (renderHighWaterNudge) → parallel P1.M1.T2.S1.
#   - renderAuditReport's OTHER clauses (rewinds, shrinks, Protected, Top messages, Suggestion) → unchanged.
#   - The cancelledClause logic (P3.M1.T4.S1 / E21 (c)) → unchanged (it just moves after (user-set)).
#   - commands.test.ts, drift_nudge.test.ts, README → unaffected / other subtasks.
#   - spec/13, spec/05 → read-only.
# This PRP edits ONLY src/tools/audit.ts (checkpoint clause) + test/tools/audit.test.ts (2 strings + doc + 1 test).
```

---

## Implementation Blueprint

### Data models and structure
_N/A — no data-model change. `AuditReportArgs` (incl. `checkpointNames: string[]`, `cancelledCount: number`)
is unchanged. Only the rendered string template changes._

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/tools/audit.ts — the checkpoint clause (THE FIX)
  - LOCATE renderAuditReport's checkpoint clause (lines ~448–454).
  - FIND (verbatim current):
      "  const ckptNames = args.checkpointNames.length ? ` [${args.checkpointNames.join(\", \")}]` : \" []\";\n  // P3.M1.T4.S1 / E21 (c): append \", N cancelled (retired)\" ONLY when there are retired markers. Omitted when 0\n  // so the line stays clean AND the pre-existing exact-string active-markers assertions stay byte-identical.\n  const cancelledClause = args.cancelledCount > 0 ? `, ${args.cancelledCount} cancelled (retired)` : \"\";\n  L.push(\n    `Active markers: ${args.rewinds.length} rewind${gran ? ` (${gran})` : \"\"}, ` +\n      `${args.shrinks.length} shrink, ${args.checkpointNames.length} checkpoints${ckptNames}${cancelledClause}`,\n  );"
  - REPLACE WITH (add ckptWord + ckptUserSet; use ${ckptWord}; insert ${ckptUserSet} before ${cancelledClause}):
      "  const ckptNames = args.checkpointNames.length ? ` [${args.checkpointNames.join(\", \")}]` : \" []\";\n  // BUG-003 / spec/13 §4 step 3: singularize the count (1 → \"checkpoint\") and append \" (user-set)\" when at\n  // least one checkpoint is armed (v1.1 E23 — checkpoints are user-owned destructive-power grants, so the\n  // human can see what they have armed). Omitted when 0 (nothing armed). The (user-set) annotation goes AFTER\n  // the names bracket and BEFORE the cancelledClause below.\n  const ckptWord = args.checkpointNames.length === 1 ? \"checkpoint\" : \"checkpoints\";\n  const ckptUserSet = args.checkpointNames.length > 0 ? \" (user-set)\" : \"\";\n  // P3.M1.T4.S1 / E21 (c): append \", N cancelled (retired)\" ONLY when there are retired markers. Omitted when 0\n  // so the line stays clean AND the pre-existing exact-string active-markers assertions stay byte-identical.\n  const cancelledClause = args.cancelledCount > 0 ? `, ${args.cancelledCount} cancelled (retired)` : \"\";\n  L.push(\n    `Active markers: ${args.rewinds.length} rewind${gran ? ` (${gran})` : \"\"}, ` +\n      `${args.shrinks.length} shrink, ${args.checkpointNames.length} ${ckptWord}${ckptNames}${ckptUserSet}${cancelledClause}`,\n  );"
  - RATIONALE: realizes spec/13 §4 step 3. ckptWord singularizes (1 → "checkpoint"); ckptUserSet adds
    "(user-set)" only when ≥1 armed. Template order puts (user-set) after [names], before cancelledClause.
  - PRESERVE: ckptNames logic, cancelledClause logic, the rewinds/shrinks fragments, all other L.push lines.
  - DO NOT: append (user-set) when length===0; reorder cancelledClause ahead of (user-set); touch other clauses.

Task 2: EDIT test/tools/audit.test.ts:550 — append ' (user-set)' (integration toContain)
  - FIND: '      "Active markers: 1 rewind (last_tool_call_group), 1 shrink, 2 checkpoints [before-x, before-y]",'
  - REPLACE WITH: '      "Active markers: 1 rewind (last_tool_call_group), 1 shrink, 2 checkpoints [before-x, before-y] (user-set)",'

Task 3: EDIT test/tools/audit.test.ts:929 — append ' (user-set)' (pure-renderer exact toBe)
  - FIND: '      "Active markers: 1 rewind (last_tool_call_group), 0 shrink, 2 checkpoints [before-x, before-y]",'
  - REPLACE WITH: '      "Active markers: 1 rewind (last_tool_call_group), 0 shrink, 2 checkpoints [before-x, before-y] (user-set)",'

Task 4: EDIT test/tools/audit.test.ts:23 — doc-comment consistency (file-header docstring)
  - FIND: ' *      "Active markers: 1 rewind (last_tool_call_group), 1 shrink, 2 checkpoints [a, b]".'
  - REPLACE WITH: ' *      "Active markers: 1 rewind (last_tool_call_group), 1 shrink, 2 checkpoints [a, b] (user-set)".'

Task 5: EDIT test/tools/audit.test.ts — ADD the singular + annotation pure-renderer test
  - LOCATE the pure-renderer 2-checkpoint test ends at its closing '});' (after line 932), immediately before
    the 'empty filtered' it() (line 935). INSERT a new it(...) between them.
  - FIND (anchor on the next test's title, unique):
      "  });\n\n  it(\"empty filtered → 'No messages in filtered view.' and no suggestion/top block\", () => {"
  - REPLACE WITH (insert the new test before the empty-filtered it):
      "  });\n\n  it(\"checkpointNames length 1 → singular '1 checkpoint' + '(user-set)' annotation (BUG-003)\", () => {\n    const report = renderAuditReport({\n      totalTokens: 0,\n      confidence: \"low\",\n      rewinds: [],\n      shrinks: [],\n      checkpointNames: [\"solo\"],\n      protectedRoles: [\"first:user\", \"latest:user\"],\n      rows: [],\n      filtered: [], // the Active-markers line is pushed BEFORE the empty-filtered early-return\n      cancelledCount: 0,\n    });\n    expect(report).toContain(\"Active markers: 0 rewind, 0 shrink, 1 checkpoint [solo] (user-set)\");\n    expect(report).not.toContain(\"1 checkpoints\"); // singularized — never the plural with count 1\n  });\n\n  it(\"empty filtered → 'No messages in filtered view.' and no suggestion/top block\", () => {"
  - RATIONALE: locks in BOTH the singularization (1 → "checkpoint") and the (user-set) annotation. The
    `not.toContain("1 checkpoints")` guards against a singularization regression. Uses filtered:[] (the
    Active-markers line is pushed before the empty-filtered early-return, so it's present).
  - DO NOT: modify the empty-filtered test itself; the new test is a SIBLING it() in the same describe.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: the checkpoint fragment is built from 4 consts composed in a fixed order:
//   ckptNames   = length>0 ? ` [n1, n2]` : " []"          (the names bracket; leading space)
//   ckptWord    = length===1 ? "checkpoint" : "checkpoints" (BUG-003 singularize)
//   ckptUserSet = length>0  ? " (user-set)" : ""           (BUG-003 annotation; spec/13 §4 step 3)
//   cancelledClause = cancelledCount>0 ? `, N cancelled (retired)` : ""   (P3.M1.T4.S1 / E21 (c))
// Composed: `${count} ${ckptWord}${ckptNames}${ckptUserSet}${cancelledClause}`
//   2 armed : "2 checkpoints [before-x, before-y] (user-set)"
//   1 armed : "1 checkpoint [solo] (user-set)"
//   0 armed : "0 checkpoints []"                       (no annotation; + cancelledClause if any)

// WHY commands.test.ts is safe (self-consistency): its case-(a) test is
//   expect(notifyMsg).toBe(buildExpectedReport(filtered, ctx))   // buildExpectedReport calls renderAuditReport
// Both sides render via the SAME function → any format change is symmetric → exact equality still holds.
```

### Integration Points

```yaml
CODE:
  - modify: src/tools/audit.ts — renderAuditReport checkpoint clause (Task 1)
  - consumed-by (NO change): the agent mulligan_audit tool AND the human /mulligan_audit command both call
    renderAuditReport (spec/13 §4 'same renderer') — both pick up the new format automatically.
TESTS:
  - modify: test/tools/audit.test.ts — 2 string updates (Tasks 2–3) + 1 doc-comment (Task 4) + 1 new test (Task 5)
  - unchanged: test/commands.test.ts (self-consistent), the cancelled tests (568–600), the empty-checkpoint
    tests (558, 975).

CONFIG / DATABASE / ROUTES / REGISTRATION:
  - none. Pure renderer text change; no config, no DB, no routes, no registration.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Type-check — the change is pure template-literal edits; type-clean.
npx tsc --noEmit
echo "tsc exit: $?"   # expect 0 (baseline was 0)

# Confirm the new consts + template landed:
grep -n 'ckptWord\|ckptUserSet' src/tools/audit.ts   # expect 2 const decls + 2 template refs
```
Expected: tsc exit 0; grep prints the two new consts and their use in the template.

### Level 2: Unit Tests (Component Validation)

```bash
# The audit suite — the 2 updated assertions + the new singular test + the (unchanged) cancelled/empty tests.
npx vitest run test/tools/audit.test.ts
# EXPECT: all pass. Count = baseline + 1 (the new singular test). If a '2 checkpoints [before-x, before-y]'
# assertion fails with 'received … (user-set)', you missed Task 2 or 3. If '0 checkpoints []' fails, you
# wrongly appended (user-set) at length 0 (re-check ckptUserSet).

# The commands suite — MUST stay green unchanged (self-consistent: both sides call renderAuditReport).
npx vitest run test/commands.test.ts
# EXPECT: all pass (same count as baseline). If it FAILS, you accidentally edited commands.test.ts or broke the
# renderer's determinism — revert any commands.test.ts change.

# Full suite — regression guard.
npx vitest run
# EXPECT: all pass; count = baseline + 1 (the new audit test).
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A — no service/endpoint/DB. Direct REPL proof of the 3 cases (the spec/13 §4 step 3 format):
npx tsx -e "
import { renderAuditReport } from './src/tools/audit.js';
const line = (r) => r.split('\n').find(l => l.startsWith('Active markers:'));
console.log(line(renderAuditReport({totalTokens:0,confidence:'low',rewinds:[],shrinks:[],checkpointNames:['before-x','before-y'],protectedRoles:[],rows:[],filtered:[],cancelledCount:0})));
console.log(line(renderAuditReport({totalTokens:0,confidence:'low',rewinds:[],shrinks:[],checkpointNames:['solo'],protectedRoles:[],rows:[],filtered:[],cancelledCount:0})));
console.log(line(renderAuditReport({totalTokens:0,confidence:'low',rewinds:[],shrinks:[],checkpointNames:[],protectedRoles:[],rows:[],filtered:[],cancelledCount:0})));
"
# EXPECT:
#   'Active markers: 0 rewind, 0 shrink, 2 checkpoints [before-x, before-y] (user-set)'
#   'Active markers: 0 rewind, 0 shrink, 1 checkpoint [solo] (user-set)'
#   'Active markers: 0 rewind, 0 shrink, 0 checkpoints []'
```

### Level 4: Creative & Domain-Specific Validation

```bash
# N/A for a renderer text-format change. No UI/perf/security surface. Levels 1–3 cover correctness.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` exits 0 (baseline 0; pure template-literal edits).
- [ ] `npx vitest run test/tools/audit.test.ts` — all pass (+1 new test).
- [ ] `npx vitest run test/commands.test.ts` — all pass (UNCHANGED; self-consistent).
- [ ] `npx vitest run` — full suite passes (baseline + 1).
- [ ] Level 3 REPL prints the 3 expected checkpoint-clause forms.

### Feature Validation
- [ ] `renderAuditReport` with 2 checkpoints → `2 checkpoints [before-x, before-y] (user-set)`.
- [ ] with 1 checkpoint → `1 checkpoint [solo] (user-set)` (singular + annotation).
- [ ] with 0 checkpoints → `0 checkpoints []` (NO annotation).
- [ ] `(user-set)` precedes the cancelledClause when both apply.
- [ ] No edits to any file other than `src/tools/audit.ts` and `test/tools/audit.test.ts`.

### Code Quality / Scope Discipline
- [ ] Did NOT edit `test/commands.test.ts` (self-consistent — would break the symmetry).
- [ ] Did NOT edit the cancelled tests (568–600) or the empty-checkpoint tests (558, 975).
- [ ] Did NOT touch `renderAuditReport`'s other clauses (rewinds/shrinks/Protected/Top/Suggestion).
- [ ] Did NOT touch `src/nudges.ts` / `renderHighWaterNudge` (parallel P1.M1.T2.S1).
- [ ] Did NOT change the `cancelledClause` logic (it just follows `(user-set)` now).
- [ ] Did NOT append `(user-set)` at length 0.

### Documentation
- [ ] Inline code comment cites BUG-003 / spec/13 §4 step 3 (Mode A). No README change for this subtask
      (the audit format is not quoted verbatim in the README; P1.M3.T1 sweeps if needed).

---

## Anti-Patterns to Avoid

- ❌ Don't append `(user-set)` when `checkpointNames.length === 0` — ckptUserSet must be `""` at 0, so
  `0 checkpoints []` stays byte-identical (the empty-checkpoint tests rely on it).
- ❌ Don't put `(user-set)` AFTER the cancelledClause — order is `${ckptNames}${ckptUserSet}${cancelledClause}`
  (annotation after the bracket, before the cancelled clause).
- ❌ Don't edit `test/commands.test.ts` — its exact-equality test is self-consistent (both sides call
  renderAuditReport); editing it breaks the symmetry and violates scope.
- ❌ Don't singularize as `<= 1` or `=== 0` — the rule is `length === 1 ? "checkpoint" : "checkpoints"`
  (0 stays plural "checkpoints", matching the existing `0 checkpoints []` tests).
- ❌ Don't touch the cancelled tests (568–600) — they use `checkpointNames: []`, so no annotation appears and
  their `.toContain(", N cancelled (retired)")` still matches.
- ❌ Don't edit `src/nudges.ts`, other renderAuditReport clauses, spec/13, or README — out of scope / parallel / read-only.

---

## Confidence Score

**9/10** for one-pass implementation success. The fix is two new consts + a reordered template fragment in one
pure renderer, with the verbatim current clause and verbatim desired replacement. The two affected test
assertions have exact before→after; the new singular test's body is specified verbatim; and the two
"unchanged" categories (empty-checkpoint tests; cancelled tests) are explained by the length-0 / empty-array
semantics. The one non-obvious point — `commands.test.ts` is self-consistent and must NOT be edited — is
called out as a GOTCHA + Anti-Pattern (its exact-equality test passes unchanged because both sides call the
same renderer). Residual risks: appending `(user-set)` at length 0 (mitigated by GOTCHA #2 + the Level-2
"0 checkpoints []" failure signature); mis-ordering the cancelledClause (mitigated by GOTCHA #1 + the Level-3
REPL). Both caught by `npx vitest run test/tools/audit.test.ts`. No dependency on the parallel item (disjoint
files); commands.test.ts confirmed unaffected.