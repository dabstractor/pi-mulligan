# Research note — P4.M3.T1.S2 (feature-blurb sentence on the two hard backstops)

Single deliverable: ONE sentence in `README.md` noting the two E22 hard backstops, with a pointer to
`spec/08-edge-cases.md` E22. This note records the placement decision + verification, so the PRP can cite it.

## 1. Placement options evaluated (contract offers two)

The contract says: *"near the existing E15 / 'Markers accumulate' note around README line 242, OR in the
rewind-feature section."*

| Option | Location | Verdict |
|---|---|---|
| **A — E15 bullet (§7 Known Limitations, ~line 246 post-S1)** | append to the "Markers accumulate" bullet | **CHOSEN** |
| B — `mulligan_rewind` tool section (§4, lines 130–150) | new sentence in the rewind tool blurb | rejected |

**Why A:** (1) architecture `codebase_patterns.md` §8 lists the E15 note as the *primary* ("line 242 or nearby");
(2) E15 and E22 are thematically unified — E22's runaway loop IS the severe manifestation of E15's marker/session
growth (each loop appends a `mulligan:rewind` + `mulligan:note` + `mulligan:turn-metric`), so the reader learns
the runaway-growth case is *bounded by hard backstops* right where the accumulation limit is stated; (3) the E15
bullet already mixes a limit with its mitigation (`rewind.maxDepth=5` bounds active markers) — appending the E22
backstops is the same structure; (4) the contract lists "E15 note" FIRST.

**Why not B:** the `mulligan_rewind` tool section (§4) describes the tool interface, granularities, and the
four-field note — it does NOT currently surface *any* refusal condition (E4 maxDepth, E3 protected messages,
E5 side effects are absent there). Dropping a single E22 sentence into it would open a topic the section
otherwise ignores, and would read as a dangling one-off (why E22 backstops but not the others?).

## 2. Exact anchor text (verified against HEAD, post-S1 line numbers)

The E15 bullet is a single markdown paragraph. Current full text (line 246 after S1 lands; was 244 pre-S1 —
edit anchors on TEXT, so merge-order-independent):

```
- **Markers accumulate (`spec/08-edge-cases.md` E15).** v1 does no marker garbage-collection — markers persist intentionally (they are the audit trail). `rewind.maxDepth=5` bounds simultaneous *active* rewind markers; the only cost is disk growth (markers are control state, not in context). The filter is cheap in practice (few markers × messages bounded by compaction).
```

Append the E22 sentence after the final period, same paragraph, space-separated. Anchor on the unique tail
sentence: `The filter is cheap in practice (few markers × messages bounded by compaction).` (the `×` is
U+00D7 MULTIPLICATION SIGN, not ASCII `x` — reproduce exactly).

## 3. Wording (verbatim from contract, ONE formatting fix)

Contract suggestion:
> "Two hard backstops guard against runaway same-prompt retry loops (spec/08-edge-cases.md E22): a per-prompt
> retry budget (`rewind.maxRetriesPerPrompt`) and a context-fraction stop (`rewind.abortContextFraction`) that
> refuse a rewind *before* it can drive the context to a provider 'Prompt too long' rejection."

**Formatting fix (mirror the S1 PRP's backtick-correction discipline):** the contract writes the spec pointer
as `(spec/08-edge-cases.md E22)` with NO backticks, but README convention backtick-wraps the file PATH while
leaving the `E##` token bare — e.g. the E15 bullet uses `` `spec/08-edge-cases.md` E15 ``. So the final
sentence uses `` (`spec/08-edge-cases.md` E22) ``. The two config knobs are already backtick'd in the contract
wording (correct — matches README table/`maxDepth` convention). Use the wording verbatim otherwise.

## 4. Spec-pointer target verification

`spec/08-edge-cases.md` line 108: `## E22. Same-prompt rewind retry loop — runaway growth (REQUIRED; hard backstop)` —
confirmed present. E22 defines both knobs: `config.rewind.maxRetriesPerPrompt` (default 5) and
`config.rewind.abortContextFraction` (default 0.9). The README sentence points the reader there for the full
required-behavior + acceptance criteria.

## 5. Scope boundary vs parallel sibling P4.M3.T1.S1 (zero overlap)

S1 (parallel, being implemented now) edits ONLY:
- config table rows (after `rewind.maxDepth`, README lines 85–86) — both cite E22 but with a DIFFERENT phrasing
  ("the runaway-loop bound (`spec/08-edge-cases.md` E22)" / "the zero-marker-loop guard (`spec/08-edge-cases.md` E22)").
- commented JSON example (README line 113).

S2 edits ONLY the E15 bullet (line 246). The two regions are ~160 lines apart and non-adjacent → **no git merge
conflict**. Both PRPs anchor on text (not line numbers) → **merge-order-independent**. The two new S1 table rows
also mention E22, so a grep for `E22` after both land returns 3 hits (2 S1 rows + 1 S2 sentence); validation must
anchor on the S2-unique phrase "Two hard backstops" / "Prompt too long" / "runaway same-prompt retry".

## 6. Validation approach (no markdown linter exists)

`package.json` has only `test` (vitest) + `smoke` — no markdown lint, no build. So validation = deterministic
`grep`/`git diff` + a visual `sed -n` of the E15 bullet region. The new sentence introduces three README-unique
phrases ("Two hard backstops", "runaway same-prompt retry loops", "'Prompt too long'") — any of them is a clean
presence/absence probe. `git diff --numstat` = `1 1 README.md` (the E15 bullet is one source line; appending a
sentence modifies it, not adds a new line).