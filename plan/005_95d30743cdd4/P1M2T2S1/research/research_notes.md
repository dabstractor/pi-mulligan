# Research Notes — P1.M2.T2.S1: Comment alignment for `display:true` rationale (rewind-note)

## Scope
Mode A (documentation/comment-only). Expand ONE JSDoc paragraph in `src/markers.ts` `leaveNote()` so it
cites the deliberate-operator-visibility rationale from spec/05 §1 step 6. **No code change, no test change.**

## The single target site (verbatim, confirmed via sed/grep 2025)
`src/markers.ts` — the `leaveNote()` function JSDoc, the paragraph documenting `display:true`
(lines 367-368). Unique in the file (grep count for "so the note is visible in the UI transcript" = 1).

### Current JSDoc paragraph (the FIND target — lines 367-368)
```
 * `display:true` (spec/04 §3) so the note is visible in the UI transcript (/tree). `content` is the rendered note
 * string (notes.renderNote output).
```
- This documents WHY `display:true` is set, but it only says "visible in the UI transcript" — it does NOT cite
  spec/05 §1 step 6's rationale (deliberate operator visibility / rewind counterpart of shrink's echo).

### The code line it documents (line 383 — UNCHANGED, do not touch)
```
    pi.sendMessage({ customType: "mulligan:note", content, display: true, details });
```

## Why the current comment is thin (the gap)
The spec source-of-truth — `spec/05-tools.md:80` (§1 step 6) — has a BOLDED rationale that the code comment
fails to capture:
> `pi.sendMessage({ customType:"mulligan:note", content: renderedNote, display:true, ... })`.
> **(`display:true` is deliberate — it surfaces the note to the operator as well, so the human can see exactly
> what the model told its resumed self. This is the rewind counterpart of shrink's replacement echo: every
> self-directed payload is operator-visible.)**

And `spec/05-tools.md:16` (§1 Purpose) frames the note as:
> **The structured self-authored note is Mulligan's flagship UX** — it is what turns a hide into a
> *better-informed retry*.

The current code comment mentions the UI transcript surface but omits: (a) "deliberate"; (b) "operator sees
exactly what the model told its resumed self"; (c) "rewind counterpart of shrink's replacement echo"; (d) the
spec/05 §1 step 6 citation; (e) the "flagship UX" framing. The fix expands the paragraph to cover all of these.

## The "shrink's replacement echo" it's the counterpart of (cross-ref)
`src/tools/shrink.ts:320-326` (shrink step 5b) — the operator-visible echo added by P1.M2.T1.S2:
```
//      P1.M2.T1.S2: surface a capped copy of the replacement to the operator via ctx.ui.notify so the
...
const capped = cap(params.replacement, config.shrink.notifyMaxChars);
ctx.ui.notify(`Shrunk ${describeTarget(params.target)} — replacement:\n<<<\n${capped}\n>>>`, "info");
```
So: shrink → `ctx.ui.notify` (zero-context-cost operator echo of the replacement); rewind → `display:true`
(note mirrored into the UI transcript). Both make the self-directed payload operator-visible. The expanded
`leaveNote` comment must draw this parallel.

## Verbatim spec citations (with exact line numbers)
- **spec/05-tools.md:80** (§1 "Behavior (step by step)", step 6, Persist) — the bolded `display:true` rationale.
- **spec/05-tools.md:16** (§1 "Purpose") — "the structured self-authored note is Mulligan's flagship UX".
- **spec/04 §3** — the CustomMessage/marker spec (the existing comment already cites this; keep it).

## Proposed expanded paragraph (REPLACE target)
All five required points covered; preserves the "`content` is the rendered note string" fact:
- (a) "is DELIBERATE"  ✓
- (b) "surfaces the note to the OPERATOR … the human sees exactly what the model told its resumed self"  ✓
- (c) "rewind counterpart of shrink's replacement echo (`ctx.ui.notify` in shrink.ts step 5b)"  ✓
- (d) cite spec/05 §1 step 6  ✓
- (e) cite spec/05 §1 Purpose ('flagship UX')  ✓
```
 * `display:true` (spec/04 §3; spec/05 §1 step 6) is DELIBERATE: it surfaces the note to the OPERATOR as well as
 * the model — the human sees exactly what the model told its resumed self via the rewind note (visible in the UI
 * transcript, /tree). This is the rewind counterpart of shrink's replacement echo (`ctx.ui.notify` in shrink.ts
 * step 5b): every self-directed payload is operator-visible, mirroring the note's in-context role for the resumed
 * model (spec/05 §1 Purpose — "the structured self-authored note is Mulligan's flagship UX"). `content` is the
 * rendered note string (notes.renderNote output).
```

## Validation commands (confirmed in package.json)
- `npm run typecheck`  →  `tsc --noEmit` (comments don't affect types; confirms no accidental breakage).
- `npx vitest run test/markers.test.ts`  (or full `npm test` / `npx vitest run`) — comments don't affect
  behavior; suite stays green.
- grep that the new rationale keywords + spec citations are present.

## Parallel-sibling coordination (no file conflict)
- **P1.M2.T1.S3** (parallel, currently implementing): edits `test/tools/shrink.test.ts` + `test/config.test.ts`
  ONLY (test-only). Does NOT touch `src/markers.ts`. No overlap.
- This PRP (P1.M2.T2.S1) edits `src/markers.ts` JSDoc ONLY. No overlap with any sibling.

## Out of scope (do NOT touch)
- `src/tools/shrink.ts` (shrink's `ctx.ui.notify` echo — owned by P1.M2.T1.S2 [complete]; it is the referenced
  counterpart, not a file to edit here).
- `test/*` (no test changes — comment-only).
- `spec/*` (READ-ONLY — spec/05 §1 is the source-of-truth the comment cites).
- The `leaveNote()` function body / the `pi.sendMessage(...)` call / any code line.
- Any other JSDoc paragraph in `leaveNote()` (the C8/triggerTurn paragraph, the Returns/never-throws paragraph,
  the @param lines) — only the `display:true` paragraph changes.