# Research notes — P3.M4.T1.S2: Add mulligan_cancel to README tools list

## Task shape
Mode-B docs-only task (0.5 pts). The `mulligan_cancel` tool **already shipped**
(P3.M1.T3.S1 COMPLETE) and is registered in `src/index.ts` (line 11 import,
line 42 `pi.registerTool(makeCancelTool(pi))`). The README §4 "Tools" list
still says "four agent-callable tools" and omits `mulligan_cancel`. This task
brings the docs in line. **No source changes, no tests.**

## README §4 "Tools" — current structure (file: README.md, lines 124–181)

```
## 4. Tools                                          ← line 124
  intro line 126: "Mulligan registers four agent-callable tools. The
  descriptions below are **verbatim copies** of the LLM-facing description
  strings ... When-to-use guidance follows each one (from `spec/05-tools.md`)."
  ### `mulligan_rewind`   (line 128)  — blockquote(verbatim desc) + "When to use it:"
  ### `mulligan_shrink`   (line 150)  — blockquote(verbatim desc) + "When to use it (vs ...):"
  ### `mulligan_checkpoint` (164)     — blockquote(verbatim desc) + "When to use it:"
  ### `mulligan_audit`    (line 172)  — blockquote(verbatim desc) + "When to use it:" + extra para
  [audit's last para ends "...The audit is **read-only** and persists nothing."]
  ---                                                 ← separator before §5
## 5. How It Works                                    ← line 182
```

### The §4 convention (MUST follow — do not invent a new pattern)
- Blockquote `> ...` = a **verbatim copy** of the LLM-facing description string
  from the tool's `src/tools/<name>.ts` module (the intro line says so explicitly).
- Below the blockquote: a `**When to use it:**` paragraph condensed from
  `spec/05-tools.md`'s "When the agent should use it" section.
- Sub-heading format: `### \`mulligan_<name>\``.

## The verbatim CANCEL_DESC string (the blockquote content)
Source of truth: `src/tools/cancel.ts` `export const CANCEL_DESC`.
Cross-confirmed identical in `spec/05-tools.md` §7 line 299. Concatenated:

> Retract (cancel) a mulligan_rewind or mulligan_shrink marker so it no longer
> applies going forward. Use when you issued a rewind or shrink against the
> wrong target and need to undo it — without it, the mistaken transform would
> apply on every turn for the rest of the session. Pass the markerId you
> received in details when you issued the marker. The transform stops applying
> from the next turn on (cancelled markers stay on disk for the audit trail).
> Cancelling a non-existent or already-cancelled marker is a safe no-op.

## spec/05 §5 "When the agent should use it" (source for the README's "When to use it")
`spec/05-tools.md` lines 222–223:

> When you issued a `mulligan_rewind` or `mulligan_shrink` against the **wrong
> target** and need to undo it. Without this tool, the mistaken transform would
> apply on every turn for the rest of the session (a `mulligan_rewind` of the
> issuing call does NOT retire a marker — markers are `custom` control entries
> outside the rewind's `hideEntryIds` span). Cancelling a non-existent or
> already-cancelled id is a safe no-op — call it freely if unsure.

Plus spec/05 §5 "Purpose" + "What retraction is NOT" (lines 217–220) give the
forward-only / no-on-disk-undo framing the contract wants (safety-valve framing).

## Scope boundaries (collisions to AVOID)
From the P3.M4.T1 sibling plan + the S1 PRP:
- **S1 (COMPLETE / implementing):** README **§3 Configuration** only. Don't touch it.
- **S2 (THIS TASK):** README **§4 Tools** only — change the §4 intro count
  ("four" → "five agent-callable tools") AND add the `### mulligan_cancel` entry.
- **S3 (planned):** README feature blurbs = §1 Overview, §5 How It Works, §6
  Guarantees, **§7 Known Limitations (the D6 "no undo" amendment)**, and the
  **"Further reading"** section.

⚠ Two count references that are OUTSIDE §4 and belong to S3 — DO NOT edit here:
1. `## 7. Known Limitations` — bullet "No undo (`spec/SPEC.md` §9 D6). Agent-initiated
   rewinds and shrinks are permanent..." → S3 amends this for marker retraction.
2. "Further reading" — "`spec/05-tools.md` — the four tools' full specification."
   (count "four"→"five" is feature-blurb territory → S3).

Editing either of those here collides with the sequenced S3 task. Leave them.

## Placement decision
Append `### mulligan_cancel` as the **5th** entry, **after `### mulligan_audit`**.
Rationale: matches the canonical order in `spec/05-tools.md` (§1 rewind, §2 shrink,
§3 checkpoint, §4 audit, §5 cancel) and the tool's own self-description in
`src/tools/cancel.ts` ("FIFTH of the five Mulligan agent-callable tools").
Insertion point: after the audit paragraph ending "...persists nothing." and
before the `---` separator + `## 5. How It Works`.

## No code/test impact
README.md is imported by nothing (`grep -rl README src/ test/` → empty).
`tsc --noEmit` and `npm test` are unaffected by a README edit and stay green.
The real gate is content consistency (grep checks), not the build.

## Verification commands (the actual gate)
```
grep -n "five agent-callable tools" README.md              # → 1 line (new)
grep -n "four agent-callable tools" README.md              # → empty (old gone)
grep -n '### `mulligan_cancel`' README.md                  # → 1 line (new heading)
grep -n "Retract (cancel) a mulligan_rewind" README.md     # → 1 line (verbatim blockquote)
grep -c "mulligan_cancel" README.md                        # → ≥3 (heading + body mentions)
# Verbatim check against the source of truth:
grep -n "Cancelling a non-existent or already-cancelled marker is a safe no-op." src/tools/cancel.ts README.md
# Both files must contain the identical tail sentence.
```