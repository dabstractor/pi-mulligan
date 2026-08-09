name: "P3.M4.T1.S3 — Update README feature blurbs (windowed drift, high-water, marker retraction)"
description: |
  Docs-only (Mode B) task. Synchronise README.md's feature-blurb prose ("How It Works" §5,
  the §7 "Known Limitations" D6 bullet, and the "Further reading" tool count) with three
  refinements that already shipped in P3.M3 (drift) + P3.M1 (retraction): (a) the per-turn
  drift nudge is now WINDOWED (moving average over `nudges.driftWindowTurns`, default 3 —
  sustained growth fires, single spikes don't); (b) a new edge-triggered HIGH-WATER signal
  (one-time annotation at `nudges.highWaterFraction`, default 0.7); (c) rewind/shrink
  markers are now RETRACTABLE via `mulligan_cancel` — softens the §7 D6 "no undo" rule.
  No source changes, no tests. Edit ONLY §5 / §7 / "Further reading" — §3 (S1) and §4 (S2)
  are DONE and out of scope.

---

## Goal

**Feature Goal**: Make README.md's feature-blurb prose reflect the three P3 refinements that
already shipped — (a) windowed drift signaling, (b) the edge-triggered high-water signal,
(c) retractable markers (`mulligan_cancel`) — so a human reading the "How It Works" and
"Known Limitations" sections learns the refined behavior, not the pre-refinement v1 prose.

**Deliverable**: An edited `README.md` with FOUR precise prose changes (no new files, no
structural rewrites): (1) §5 "How It Works" nudge block gains windowing on the drift nudge +
a new high-water bullet; (2) §5 shrink paragraph gains a one-sentence marker-retraction note;
(3) §7 "Known Limitations" "No undo (D6)" bullet is amended to record retractable markers;
(4) "Further reading" tool count `four` → `five` (a drift S2 deferred to S3).

**Success Definition**: (1) §5 names `nudges.driftWindowTurns` (default 3) and explains
"sustained growth fires, single spikes don't"; (2) §5 describes the high-water signal as a
one-time, edge-triggered annotation at `nudges.highWaterFraction` (default 0.7) that never
nags; (3) §5 + §7 both mention markers are retractable via `mulligan_cancel`; (4) "Further
reading" reads "five tools"; (5) NO edits to §3 (S1) or §4 (S2).

## User Persona (if applicable)

**Target User**: A human (developer / operator) reading the README "How It Works" section to
understand *how* Mulligan nudges the agent and whether its operations are reversible.
**Use Case**: Deciding whether to rely on Mulligan for a long session — reading §5/§7 to learn
the nudge signals and the retraction escape hatch.
**Pain Points Addressed**: §5 currently describes the drift nudge as a raw per-turn delta
(pre-§5.1 behavior) and omits the high-water signal; §7's D6 bullet says rewinds/shrinks are
"permanent" with no mention of `mulligan_cancel`. A human reading these sees stale, pre-P3
behavior.

## Why

- **Documentation correctness**: the README "How It Works" prose is the public explanation of
  the nudge/operation behavior. P3.M3 (drift refinements) and P3.M1 (marker retraction) shipped
  code-level behavior that the README blurbs never caught up to.
- **Completes P3.M4.T1 (changeset-level docs sync)**: this is task S3 of 3. S1 (README §3
  config table) is COMPLETE; S2 (README §4 tools list — `mulligan_cancel`) is COMPLETE / in
  flight. S3 owns the feature blurbs: §5 "How It Works", §7 "Known Limitations", and the
  "Further reading" tool count. S2's PRP explicitly deferred the "Further reading" `four`→`five`
  count and the §7 D6 amendment to S3.
- Low risk: documentation-only. README.md is imported by no code (`grep -rl README src/ test/`
  is empty), so there is no build/type-check/test impact; `npx tsc --noEmit` and `npm test`
  stay green regardless.

## What

Edit **only** `README.md`. Four targeted prose edits — no tables, no code fences, no new files:

1. **§5 "How It Works" — nudge block** (the `**Two ride-along nudges (zero extra model
   requests):**` numbered list): (a) update the header to cover three signals; (b) add
   windowing prose to the drift-nudge bullet; (c) ADD a third bullet for the high-water signal.
2. **§5 "How It Works" — shrink paragraph**: append ONE sentence noting rewind/shrink markers
   are retractable via `mulligan_cancel` (cross-link to §4).
3. **§7 "Known Limitations" — "No undo (D6)" bullet**: amend in place so it records that a
   mis-targeted marker is retractable via `mulligan_cancel` (forward-only; softens D6),
   while keeping the bullet a genuine *limitation* (no replay of hidden content / no reversal
   of on-disk side effects).
4. **"Further reading"** (line ~255): `the four tools' full specification` →
   `the five tools' full specification`.

### Success Criteria

- [ ] §5 drift-nudge bullet mentions `nudges.driftWindowTurns` (default 3) and the
      "single heavy turn does not fire; sustained growth does" rule.
- [ ] §5 has a high-water bullet: one-time, edge-triggered annotation at
      `nudges.highWaterFraction` (default 0.7); "never nags"; uses the *filtered* total.
- [ ] §5 shrink-area prose AND §7 D6 bullet both state markers are retractable via
      `mulligan_cancel`.
- [ ] "Further reading" reads "five tools" (and `grep -n "four tools" README.md` → empty).
- [ ] No edits to §3 (config) or §4 (tools) — those are S1/S2.

## All Needed Context

### Context Completeness Check

_"If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?"_ → **Yes.** The exact current README prose for every edit site, the exact
verified behavior (from `src/nudges.ts`), the verbatim annotation formats, and the precise
before/after wording are all quoted below. This is a single-file, four-paragraph, docs-only
edit.

### Documentation & References

```yaml
# MUST READ — the authoritative behavior for all three refinements (verified).
- file: src/nudges.ts
  why: "shouldNudge (windowed moving-average gate), shouldHighWater + renderHighWaterNudge
        (edge-triggered, annotation format), are all here. The doc-comments quote the spec
        verbatim. Confirms: (a) windowing is in the GATE, the rendered drift nudge still shows
        the latest turn's raw delta; (b) high-water annotation is
        '[mulligan] Context is at ~<pct>% of the window. Consider mulligan_shrink or
        mulligan_rewind to reclaim space.'; (c) high-water uses the FILTERED total, is
        edge-triggered (latch rt.aboveHighWater), customType 'mulligan:high-water'."
  pattern: "Read shouldNudge, shouldHighWater, renderHighWaterNudge doc-comments — they state
            the exact algorithm + the acceptance criteria (single 8k spike no-fire; sustained
            growth fires)."

# MUST READ — the spec sections the blurbs reference (and that §3 already cites).
- file: spec/07-preventive-and-nudges.md
  why: "§5.1 Windowed drift signaling + §5.2 Edge-triggered high-water signal. §3 config rows
        already cite these (driftWindowTurns → §5.1; highWaterFraction → §5.2). The §5 blurb
        should cite the same section anchors for consistency."
  section: "§5.1 (windowed drift), §5.2 (high-water). §2 = Nudge B mechanism (the phase-1
            turn_end metric + phase-2 context injection) the §5 blurb summarizes."

# MUST READ — the marker-retraction spec the §7 amendment records.
- file: spec/08-edge-cases.md
  why: "E21 'Marker retraction — cancel an erroneous/stale marker (REQUIRED; softens D6)'.
        The §7 D6 amendment must mirror E21's framing: retraction is forward-only (no on-disk
        undo, no replay), cancelled markers stay on disk for the audit trail, softens D6."
  section: "E21 (~heading 'E21. Marker retraction')."

# The CANCEL_DESC already quoted in §4 (S2) — the §5/§7 retraction prose cross-links to it.
- file: src/tools/cancel.ts
  why: "S2 already added the §4 `mulligan_cancel` entry with CANCEL_DESC verbatim. S3's §5/§7
        prose should NAME the tool and link to §4 — do NOT re-quote CANCEL_DESC (that's §4's
        job, done)."

# The ONLY file to edit.
- file: README.md
  why: "§5 'How It Works' (lines ~190–225), §7 'Known Limitations' (lines ~234–243),
        'Further reading' (line ~255). Edit ONLY these — §3 (lines ~67–122) = S1 DONE;
        §4 (lines ~124–188) = S2 DONE."
  pattern: "§5 blurb style: bold-lead-in + em-dash + one-or-two-sentence plain-language
            explanation + inline config-knob name + a spec anchor. §7 bullet style: bold
            title with spec anchor in parens + one-paragraph explanation. Match both exactly."
  gotcha: "Do NOT touch §3 or §4. Do NOT renumber §7's 'four things it deliberately does not
           do' intro count (still four bullets — you AMEND one, you do not add a fifth)."
```

### Current Codebase tree (relevant slice)

```bash
README.md                       # ← EDIT ONLY this file (§5, §7, "Further reading")
src/nudges.ts                   # ← READ ONLY (ground-truth behavior)
spec/07-preventive-and-nudges.md# ← READ ONLY (§5.1 windowed drift, §5.2 high-water)
spec/08-edge-cases.md           # ← READ ONLY (E21 marker retraction, softens D6)
src/tools/cancel.ts             # ← READ ONLY (CANCEL_DESC — already in §4, cross-link only)
```

### Desired Codebase tree (no new files)

```bash
README.md                       # §5 + §7 + "Further reading" prose updated in place
```

### Known Gotchas of our codebase & Library Quirks

```python
# CRITICAL: Scope boundary. This task = README §5 + §7 + "Further reading" ONLY. Do NOT edit
# §3 (config table + JSON example = S1, DONE) or §4 (tools list incl. mulligan_cancel = S2,
# DONE). Both are verbatim-strict sibling tasks; touching them collides with the sequencing.

# CRITICAL: Keep §7 a "limitations" list. The bullet you amend must STAY a limitation — the
# thing that REMAINS limited is: no replay of hidden content, no reversal of on-disk side
# effects. Do not reframe it as "Mulligan now has full undo" (it does not). E21 softens D6;
# it does not repeal it.

# CRITICAL: The rendered drift nudge STILL shows the latest turn's raw delta (e.g.
# '[mulligan: last turn +4.2k tokens; rewind available]'). The windowing is in the FIRE GATE
# (shouldNudge), NOT in the rendered text. So the existing README example stays valid — do
# NOT rewrite it to show a "windowed average". Only the FIRE CONDITION is windowed.

# CRITICAL: The two annotation prefixes DIFFER and are real (do not "normalize" them):
#   drift nudge -> '[mulligan: ...]'   (colon, from renderDriftNudge)
#   high-water  -> '[mulligan] ...'    (no colon, from renderHighWaterNudge)
# Preserve each format verbatim in any example you quote.

# GOTCHA: The high-water annotation uses the FILTERED total (what the model actually sees),
# the same total mulligan_audit reports — NOT ctx.getContextUsage().tokens (which would count
# hidden/rewound tokens). Phrase it as "the filtered context" in the blurb.

# GOTCHA: Edge-triggered = "fires ONCE on the upward crossing, stays quiet while above, re-arms
# when the total drops back below". This is the §3 config row's exact phrasing for
# highWaterFraction — mirror it for cross-section consistency.

# GOTCHA: README is not imported by any code (grep `README` across src/ test/ → no hits), so
# there is no build/type-check/test impact. `npx tsc --noEmit` and `npm test` are unaffected
# and need NOT be re-run as a gate for this docs change (they remain green regardless).

# GOTCHA: Em dashes "—" are real Unicode (U+2014), not "--". Existing README prose uses them;
# preserve in new prose.
```

## Implementation Blueprint

### Data models and structure

N/A — documentation-only. No data models, schemas, or code.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT README.md §5 — rework the nudge block (windowed drift + high-water bullet)
  - FIND: the "**Two ride-along nudges (zero extra model requests):**" header + its two
          numbered bullets (Bloated-result reminder; Per-turn drift nudge).
  - REPLACE the header + bullets with the three-signal version (see Suggested wording A):
      * header broadened to "Ride-along nudges & signals (zero extra model requests):";
      * bullet 1 (bloat reminder) UNCHANGED (keep verbatim);
      * bullet 2 (drift nudge) — KEEP the existing sentence, APPEND the windowing clause
        naming `nudges.driftWindowTurns` (default 3) and the "single heavy turn does not
        fire; sustained growth does" rule, citing spec/07 §5.1;
      * bullet 3 (NEW) — high-water signal: one-time, edge-triggered annotation at
        `nudges.highWaterFraction` (default 0.7) of the FILTERED context, "fires once on
        crossing, stays quiet until it drops back below — never nags", example line in the
        verbatim '[mulligan] ...' format, citing spec/07 §5.2.
  - PRESERVE: the "[mulligan: last turn +4.2k tokens; rewind available]" example verbatim;
    the "The `mulligan:nudge` annotation is **never persisted**." sentence.
  - WHY: item contract (a) + (b).

Task 2: EDIT README.md §5 — append a marker-retraction sentence after the shrink paragraph
  - FIND: the "**Shrink** = view substitution: ... pairing invariant holds)." paragraph
          (immediately above the nudges header).
  - APPEND ONE new paragraph (or extend the existing one) noting BOTH rewind and shrink
    markers are retractable via `mulligan_cancel` (stops applying from the next turn on),
    framed as "a safety valve for a mis-targeted rewind or shrink", cross-linking to §4.
  - KEEP IT SHORT (1–2 sentences). Do NOT re-quote CANCEL_DESC (§4 already has it verbatim).
  - WHY: item contract (c) — "in the operations description".

Task 3: EDIT README.md §7 — amend the "No undo (D6)" limitation bullet for retraction
  - FIND: the bullet "- **No undo (`spec/SPEC.md` §9 D6).** Agent-initiated rewinds and
          shrinks are permanent ... uses Pi's native `/tree`."
  - AMEND in place: keep it a LIMITATION. State rewinds/shrinks persist across reload +
    /resume, and there is still no replay of hidden content / no reversal of on-disk side
    effects — BUT add that a mis-targeted marker is retractable via `mulligan_cancel`
    (stops applying from the next turn; cancelled markers stay on disk for the audit trail;
    forward-only). Cite E21. Frame as "softens the D6 no-undo rule".
  - PRESERVE: the §7 intro line "These are the four things it deliberately does not do in v1."
    (you AMEND a bullet; you do not add a fifth). Preserve the other three §7 bullets verbatim.
  - WHY: item contract (c) + consistency with §4's "softens D6" framing.

Task 4: EDIT README.md "Further reading" — tool count four → five
  - FIND (line ~255): "- `spec/05-tools.md` — the four tools' full specification."
  - CHANGE: "four tools" → "five tools".
  - WHY: §4 now lists five (cancel is the 5th, S2). S2's PRP explicitly deferred this count
    to S3. Leaving "four" is stale/wrong.

Task 5: VERIFY (no edits) — see Validation Loop Level 1–2.
```

### Suggested wording

> NOTE: these are faithful, ground-truth-accurate suggestions. The blockquote-style example
> lines MUST be copied verbatim from `src/nudges.ts` (the two `[mulligan...]` formats differ).
> Tighten the prose if needed but do NOT invent behavior beyond spec/07 §5 and E21.

**(A) §5 nudge block — replace the header + two bullets with:**

````markdown
**Ride-along nudges & signals (zero extra model requests):**

1. **Bloated-result reminder** — a `tool_result` hook appends a short reminder to any result exceeding the per-tool bloat threshold (`bash`: 32 KB, `read`: 20 KB, others: the 16 KB global default).
2. **Per-turn drift nudge** — at `turn_end` Mulligan records the token delta; on the *next* inference it injects a one-line annotation (e.g. `[mulligan: last turn +4.2k tokens; rewind available]`). The delta is **windowed** (`spec/07-preventive-and-nudges.md` §5.1): smoothed over a rolling window of the last `nudges.driftWindowTurns` turns (default 3) before the threshold, so a single heavy turn (reading several source files, a pasted reference doc) does **not** fire it, but *sustained* growth across consecutive turns does. The `mulligan:nudge` annotation is **never persisted**.
3. **High-water signal** (`spec/07-preventive-and-nudges.md` §5.2) — a one-time annotation (`[mulligan] Context is at ~70% of the window. Consider mulligan_shrink or mulligan_rewind to reclaim space.`) the first time the *filtered* context crosses `nudges.highWaterFraction` of the window (default 0.7). It is **edge-triggered** — it fires once on the upward crossing and stays quiet until the total drops back below the fraction, so it never nags. This catches slow, steady accumulation that no single-turn delta nudge sees.
````

**(B) §5 shrink paragraph — append this new paragraph immediately AFTER the existing shrink
paragraph:**

```markdown
Both rewind and shrink markers are **retractable**: `mulligan_cancel` retires a mis-targeted marker so it stops applying from the next turn on — a safety valve when a rewind hid something still needed or a shrink hit the wrong message (see [§4 Tools](#4-tools)). Retraction is forward-only: on-disk side effects persist and originally-hidden content stays recoverable via `/tree`.
```

**(C) §7 "No undo (D6)" bullet — replace the bullet with:**

```markdown
- **No general undo (`spec/SPEC.md` §9 D6; softened by `spec/08-edge-cases.md` E21).** Agent-initiated rewinds and shrinks persist across reload and `/resume`, and there is no un-rewind that *replays* hidden content or *reverses* on-disk side effects (file edits and bash commands persist) — a human who wants to explore hidden content uses Pi's native `/tree`. One safety valve now exists: a mis-targeted marker is **retractable** via `mulligan_cancel`, which stops the transform applying from the next turn on (the marker stays on disk for the audit trail). This softens D6 for marker mistakes; it does not make rewinds/shrinks generally reversible.
```

**(D) "Further reading" line ~255 — change:**

```
- `spec/05-tools.md` — the four tools' full specification.
```
→
```
- `spec/05-tools.md` — the five tools' full specification.
```

### Implementation Patterns & Key Details

```markdown
# §5 blurb style (match the existing two bullets): bold lead-in + em-dash + plain-language
# explanation + inline config-knob name (backticked) + a spec anchor in parens. The new
# high-water bullet follows the SAME shape.

# Annotation formats are VERBATIM from src/nudges.ts — and they DIFFER (do not "fix" them):
#   drift : '[mulligan: last turn +4.2k tokens; rewind available]'   (colon after mulligan)
#   high  : '[mulligan] Context is at ~70% of the window. Consider mulligan_shrink or mulligan_rewind to reclaim space.'  (no colon)

# Windowing language consistency: §3's driftWindowTurns row says "smoothed before thresholding"
# and "Turns a noisy single-turn signal into a sustained-growth signal." Mirror that phrasing
# in the §5 drift bullet so §3 and §5 read as one voice.

# Edge-triggered language consistency: §3's highWaterFraction row says "edge-triggered — fires
# once on crossing, clears when the total drops back below". Mirror it in the §5 high-water
# bullet.

# Cross-link: the §5 retraction sentence links to "#4-tools" (GitHub-style anchor from the
# "## 4. Tools" heading). The §4 mulligan_cancel subsection already exists (S2) — link, do
# not duplicate.

# §7 stays a LIMITATIONS list. The amended D6 bullet must STILL read as a limitation (no
# replay, no side-effect reversal) — the retraction clause is the one softening, not a repeal.
```

### Integration Points

```yaml
CODE: none — README.md is documentation, imported by nothing.
CONFIG: none — config.ts is unaffected (the knobs already shipped + are documented in §3 by S1).
TESTS: none — README changes have no test surface; vitest + tsc are unaffected and stay green.
DOCS: this IS the docs change (Mode B). No new external links. Internal cross-links added:
      §5 → #4-tools (the mulligan_cancel entry); §5/§7 → spec/07 §5.1/§5.2 + spec/08 E21
      (already cited by §3 config rows, so anchors are consistent).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# No markdown linter in this repo (package.json has only tsc + vitest). Validate manually:
#  - the three numbered bullets in §5 are well-formed (1./2./3.) and the high-water bullet is
#    a real third item, not folded into bullet 2;
#  - the new §5 retraction paragraph and the amended §7 bullet are single paragraphs (no
#    broken fences);
#  - the "## 6. Guarantees" and "## 7. Known Limitations" headings still follow §5; the
#    "---" separators are intact.

# Print the §5 nudge block to eyeball it:
sed -n '/Ride-along nudges/,/audit trail\.\*\*/p' README.md
```

### Level 2: Content Consistency (the real gate)

```bash
# (a) Windowed drift mentioned in §5, with the knob name + default:
grep -n "driftWindowTurns" README.md
# Expected: ≥2 lines (one in §3 config table = S1, one NEW in §5 blurb).
grep -n "sustained.*growth\|single heavy turn\|does not fire" README.md
# Expected: ≥1 line (the new §5 drift clause).

# (b) High-water signal present in §5, edge-triggered + the verbatim annotation format:
grep -n "high-water\|highWaterFraction\|High-water signal" README.md
# Expected: ≥2 lines (§3 config row + NEW §5 bullet).
grep -n "Context is at ~70% of the window" README.md
# Expected: ≥1 line (the new §5 bullet, verbatim from renderHighWaterNudge).
grep -n "edge-triggered" README.md
# Expected: ≥2 lines (§3 config row + §5 bullet — consistent phrasing).
grep -n "never nags" README.md
# Expected: ≥1 line (the new §5 bullet).

# (c) Marker retraction mentioned in BOTH §5 and §7:
grep -n "retractable\|mulligan_cancel" README.md
# Expected: ≥4 lines (§4 S2 entry + §5 retraction sentence + §7 amended bullet, at least).

# (d) §7 D6 bullet amended (still a limitation, now mentions retraction/E21):
grep -n "softened by\|softens D6\|E21" README.md
# Expected: ≥1 line (the amended §7 bullet).

# (e) "Further reading" tool count updated:
grep -n "five tools' full specification" README.md   # Expected: exactly 1 line.
grep -n "four tools' full specification" README.md   # Expected: NO output (old text gone).

# (f) Scope boundary — §3 and §4 untouched (S1/S2 territory). Confirm the sibling markers
#     are still intact and you did not drift into them:
grep -n "All 17 knobs" README.md          # §3 header note — still present, UNCHANGED.
grep -n "five agent-callable tools" README.md  # §4 intro — still present, UNCHANGED (S2).
grep -n "### \`mulligan_cancel\`" README.md     # §4 subsection — still present, UNCHANGED (S2).
grep -n "3000" README.md                  # §3 — STILL no stale 3000 (S1 already fixed it).
# Expected: all present/absent as noted. If any changed, you drifted into a sibling's scope —
# revert that change.
```

### Level 3: Integration Testing (System Validation)

```bash
# Docs-only task — no runtime integration to test. Confirm no source file imports README:
grep -rl "README" src/ test/ 2>/dev/null || echo "no code references README (expected)"

# Confirm the build/test baseline is unaffected (README is not compiled or tested):
npx tsc --noEmit && echo "tsc OK (unaffected by README edit)"
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Visual review: open README.md and read §5 → §6 → §7 → "Further reading" top-to-bottom.
# Confirm:
#  - §5 nudge block has THREE numbered items (bloat, drift [windowed], high-water);
#  - the drift bullet keeps the '[mulligan: last turn ...]' example AND adds the windowing
#    clause naming driftWindowTurns (default 3);
#  - the high-water bullet uses the '[mulligan] Context is at ~70% ...' format (NO colon after
#    mulligan — distinct from the drift example), says "edge-triggered", "never nags", and
#    cites spec/07 §5.2;
#  - the shrink paragraph is followed by a new retraction sentence naming mulligan_cancel and
#    linking to §4;
#  - §7's amended D6 bullet still reads as a LIMITATION (no replay / no side-effect reversal)
#    and adds the mulligan_cancel retraction clause citing E21;
#  - §7 intro still says "the four things it deliberately does not do in v1" (four bullets —
#    you amended one, did not add a fifth);
#  - "Further reading" reads "the five tools' full specification";
#  - NOTHING in §3 (config) or §4 (tools) changed.
```

## Final Validation Checklist

### Technical Validation

- [ ] Level 1: §5 nudge block has three well-formed bullets; §5/§7 prose paragraphs intact.
- [ ] Level 2 (a): §5 mentions `driftWindowTurns` + "sustained growth fires, single spikes don't".
- [ ] Level 2 (b): §5 high-water bullet present, edge-triggered, verbatim `[mulligan] Context is at ~70% ...` format.
- [ ] Level 2 (c): retraction (`mulligan_cancel`) mentioned in BOTH §5 and §7.
- [ ] Level 2 (d): §7 D6 bullet amended, cites E21 / "softens D6".
- [ ] Level 2 (e): "Further reading" reads "five tools"; "four tools" gone.
- [ ] Level 2 (f): §3 ("All 17 knobs", no "3000") and §4 ("five agent-callable tools", `### \`mulligan_cancel\``) UNCHANGED.
- [ ] Level 3: no code references README; `npx tsc --noEmit` still green.

### Feature Validation

- [ ] §5 explains windowed drift (single spike no-fire, sustained growth fires).
- [ ] §5 describes the high-water signal (one-time, edge-triggered, 70%, never nags).
- [ ] §5 + §7 both note markers are retractable via `mulligan_cancel`.
- [ ] "Further reading" tool count corrected to five.

### Code Quality Validation

- [ ] New §5 prose matches the existing blurb style (bold lead-in + em-dash + knob name + spec anchor).
- [ ] Annotation examples copied verbatim from `src/nudges.ts` (the two `[mulligan...]` formats preserved).
- [ ] §3/§4 config/tools language mirrored for cross-section consistency (windowing + edge-triggered phrasing).
- [ ] No edits to §3 (S1) or §4 (S2).
- [ ] §7 remains a genuine limitations list (retraction is a softening, not a repeal of D6).

### Documentation & Deployment

- [ ] Em dashes ("—") preserved as Unicode (not "--"); no mojibake.
- [ ] No environment variables, config code, or source files touched.

---

## Anti-Patterns to Avoid

- ❌ Don't rewrite the drift example `[mulligan: last turn +4.2k tokens; rewind available]` —
  the rendered nudge STILL shows the latest turn's raw delta; only the FIRE GATE is windowed.
- ❌ Don't "normalize" the two annotation prefixes — drift uses `[mulligan: ...]` (colon),
  high-water uses `[mulligan] ...` (no colon). Copy each verbatim from `src/nudges.ts`.
- ❌ Don't reframe the §7 D6 bullet as "full undo" — retraction is forward-only and softens
  (not repeals) D6; the bullet must stay a limitation.
- ❌ Don't edit §3 (config table/JSON) or §4 (tools list/mulligan_cancel blockquote) — those
  are S1/S2 and are DONE/verboten here.
- ❌ Don't add a fifth §7 bullet or change its "four things" intro — you AMEND the D6 bullet.
- ❌ Don't modify any `src/` or `spec/` file — this is README prose only.
- ❌ Don't re-quote `CANCEL_DESC` in §5/§7 — §4 (S2) already has it verbatim; cross-link instead.
- ❌ Don't re-run `npm test`/`tsc` as a *gate* for a docs change — they're unaffected and stay
  green; use the grep checks in Level 2 as the real gate.

---

## Confidence Score

**9/10** — One-pass implementation highly likely. This is a four-paragraph, single-file,
docs-only edit. Every edit site's exact before-state is quoted, every refinement's behavior is
verified against `src/nudges.ts` (the doc-comments quote the spec verbatim), and the suggested
wording is ground-truth-accurate. The only residual risk is the implementer paraphrasing a
verbatim annotation format — the Gotchas + Level-2 grep checks guard against that.