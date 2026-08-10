# Research: renderNote output format (post-S1) + snapshot fix pattern

## Current renderNote (src/notes.ts, post-S1 — VERIFIED by reading the function)

```ts
export function renderNote(note: NoteInput, ledger: FileLedger, granularity: Granularity): string {
  const sections: string[] = [
    `## 🔄 Mulligan rewind (${granularity})`,
    `**What happened:** ${readNoteField(note, "what_happened")}`,
    `**Current true state:** ${readNoteField(note, "true_current_state")}`,
  ];
  for (const [tag, field] of LEDGER_BLOCKS) {
    const items = readLedgerList(ledger, field);
    if (items.length > 0) sections.push(`<${tag}>\n${items.join("\n")}\n</${tag}>`);
  }
  sections.push(`**Next:** ${readNoteField(note, "next")}`);
  return sections.join("\n\n");
}
```

## The NEW 3-section rendered note (what the snapshots must assert)

```
## 🔄 Mulligan rewind (last_turn)

**What happened:** <merged what_happened>

**Current true state:** <true_current_state>

[<files-read>...</files-read>  ← only if non-empty]

[<files-modified>...</files-modified>]

[<bash-side-effects>...</bash-side-effects>]

**Next:** <next>
```

Sections joined by `\n\n`. NO `**Avoid:**` line anywhere. The order is strictly:
header → What happened → Current true state → ledger blocks (read, modified, bash — only non-empty) → Next.

## Exact snapshot fix pattern (test/notes.test.ts lines ~187 and ~215)

CURRENT (broken — the array.join still includes the Avoid block):
```ts
expect(out).toBe([
  "## 🔄 Mulligan rewind (last_turn)",
  "",
  `**What happened:** ${VALID_NOTE.what_happened}`,
  "",
  `**Avoid:** ${VALID_NOTE.avoid}`,          // ← REMOVE this line
  "",                                         // ← REMOVE this blank (one of the two surrounding "")
  `**Current true state:** ${VALID_NOTE.true_current_state}`,
  "",
  `**Next:** ${VALID_NOTE.next}`,
].join("\n"));
```

TARGET (matches renderNote's new output — keep exactly ONE blank between What happened & Current true state):
```ts
expect(out).toBe([
  "## 🔄 Mulligan rewind (last_turn)",
  "",
  `**What happened:** ${VALID_NOTE.what_happened}`,
  "",
  `**Current true state:** ${VALID_NOTE.true_current_state}`,
  "",
  `**Next:** ${VALID_NOTE.next}`,
].join("\n"));
```

For the FULL-ledger snapshot (~line 215): same removal of the `**Avoid:**` block; the ledger `<files-read>`
etc. blocks stay AFTER `**Current true state:**` and BEFORE `**Next:**` (renderNote pushes ledger blocks
between true_state and Next).

## The merge strategy for VALID_NOTE.avoid → what_happened

The item says: "merge the avoid content into what_happened as one sentence joined with ';'".

Pattern (apply to EACH file's own VALID_NOTE):
```ts
// BEFORE:
const VALID_NOTE: NoteInput = {
  what_happened: "<original what>",
  avoid: "<original avoid>",          // ← DELETE this line
  true_current_state: "<...>",
  next: "<...>",
};
// AFTER:
const VALID_NOTE: NoteInput = {
  what_happened: "<original what>; <original avoid>",   // avoid folded in with '; ' separator
  true_current_state: "<...>",
  next: "<...>",
};
```

### Per-file merged what_happened (VERIFIED current text → target)

**test/notes.test.ts** (VALID_NOTE ~line 16-22):
- what: "Ran a repo-wide grep that dumped ~38k tokens I didn't need."
- avoid: "Do not run grep without --quiet, -c, or piping to head; prefer the built-in grep tool which truncates."
- MERGED: "Ran a repo-wide grep that dumped ~38k tokens I didn't need; do not run grep without --quiet, -c, or piping to head; prefer the built-in grep tool which truncates."

**test/tools/rewind.test.ts** (VALID_NOTE ~line 53):
- what: "Ran a repo-wide grep that dumped ~38k tokens."
- avoid: "Don't grep without -l; use the built-in grep tool which truncates."
- MERGED: "Ran a repo-wide grep that dumped ~38k tokens; don't grep without -l; use the built-in grep tool which truncates."

**test/edge-cases.test.ts** (VALID_NOTE ~line 305):
- what: "Ran a repo-wide grep that dumped ~38k tokens."
- avoid: "Don't grep without -l; use the built-in grep tool which truncates."
- MERGED: "Ran a repo-wide grep that dumped ~38k tokens; don't grep without -l; use the built-in grep tool which truncates."

**test/markers.test.ts** (REWIND_DATA.note ~line 123-127):
- what: "Ran a repo-wide grep that dumped ~38k tokens."
- avoid: "Don't grep without -l; use the built-in grep tool which truncates."
- MERGED: "Ran a repo-wide grep that dumped ~38k tokens; don't grep without -l; use the built-in grep tool which truncates."

NOTE: the exact merge wording is NOT load-bearing for test correctness (the assertions interpolate
`VALID_NOTE.what_happened`, so whatever you merge will round-trip). What IS load-bearing: (a) `avoid` is
GONE from the type so the literal must not contain it (tsc), and (b) the snapshots must not reference
`VALID_NOTE.avoid` (runtime ReferenceError / it's now undefined).

## expectTypeOf discipline (vitest RUNS these — they fail `npm test` on type mismatch)

`expectTypeOf<X>().toEqualTypeOf<Y>()` is evaluated by vitest's type-aware runner — a mismatch FAILS the
test (not just tsc). So the type-assertion tests at notes.test.ts:149 and rewind.test.ts:843 MUST have
`avoid` dropped from the expected object type, or they fail `npm test`.