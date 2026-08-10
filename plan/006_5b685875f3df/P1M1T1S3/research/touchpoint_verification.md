# Research: Verified touchpoint map for the 3-field note test updates

All line numbers VERIFIED by direct read + `npx tsc --noEmit` + `npx vitest run` on 2025-08-10
(post-S1 `src/notes.ts`; S2 `src/tools/rewind.ts` assumed-landing per its PRP).

## Current state observed
- `npx tsc --noEmit` (S1 done, S2 not yet): 13 errors, ALL in test files. `src/*` is clean.
- `npx vitest run` (the `npm test` gate): **12 tests failed | 944 passed** in **3 files**:
  `test/notes.test.ts`, `test/tools/rewind.test.ts`, `test/edge-cases.test.ts`. (956 total.)
- vitest does NOT type-check (esbuild strips types) → tsc-only excess-property errors do NOT fail vitest
  unless a runtime assertion (snapshot / expectTypeOf / validateNote result) depends on them.

## The two touchpoints the ITEM DESCRIPTION MISSED

### MISS #1 — test/tools/rewind.test.ts:290 (REWIND_DESC verbatim snapshot) — FAILS vitest
The describe block "mulligan_rewind — registration metadata" asserts `expect(REWIND_DESC).toBe("...the
OLD string with 'disappears from your view permanently'...")`. S2 (rewind.ts PRP Task 3) changes that
substring to "hidden from your context going forward". Because S3 OWNS rewind.test.ts, S3 MUST update
this snapshot to the new string. **This is a vitest-failing touchpoint** — without it `npm test` stays red.
Item only listed ~lines 54/332/845 (the `avoid` ones); line 290 is the DESC-text one.

### MISS #2 — test/markers.test.ts:126 (RewindMarkerInput.note.avoid) — FAILS tsc only
`const REWIND_DATA: RewindMarkerInput = { ..., note: { ..., avoid: "...", ... } }`. `RewindMarkerInput.note`
is typed `NoteInput` (markers.ts line 79), now 3-field. This is a tsc TS2353 excess-property error. It does
NOT fail vitest (line 177 `expect(entry.note).toEqual(REWIND_DATA.note)` is self-symmetric → passes). BUT the
item's OUTPUT criterion says "no references to NoteInput.avoid" — markers.test.ts:126 IS such a reference, and
`npm run typecheck` stays red until it's fixed. S2's PRP GOTCHA #4 also attributes "test/* tsc errors" to S3.

## Verified touchpoints — test/notes.test.ts
| Line | What | Current | Target |
|---|---|---|---|
| 20 | VALID_NOTE.avoid | `"Do not run grep without --quiet, -c, or piping to head; prefer the built-in grep tool which truncates."` | DELETE; merge into what_happened (line ~16) as `"<what>; <avoid>"` |
| 42 | FIELDS array | `["what_happened","avoid","true_current_state","next"]` | `["what_happened","true_current_state","next"]` (3) |
| 67 | `validateNote({...VALID_NOTE, avoid: null as unknown as string})` | asserts invalid via avoid:null | repoint to `true_current_state: null as unknown as string` |
| 87 | same pattern (a second case) | same | repoint to another field |
| 98 | `avoid: " don't grep without filters "` in an inline note | 4-field inline note | drop avoid (or merge) |
| 107 | `validateNote({what_happened:"x", avoid:"y", true_current_state:"z", next:"w"})` | 4-field literal | drop avoid → 3-field literal |
| 149 | `expectTypeOf<NoteInput>().toEqualTypeOf<{what_happened,avoid,true_current_state,next}>` | 4-field type | drop avoid → 3-field (vitest expectTypeOf FAILS on mismatch) |
| 187 | renderNote snapshot (empty ledger) — array.join includes `**Avoid:**` | has `...,\n**Avoid:** ${VALID_NOTE.avoid},\n...` | remove the `""` + `**Avoid:**` entry + one `""` (keep ONE blank sep between What happened & Current true state) |
| 215 | renderNote snapshot (full ledger) — same `**Avoid:**` block | same | same removal |
| 323 | `avoid: "don't run wide grep; use **-l** or pipe to head"` in a note fixture | 4-field | drop avoid (or merge) |

## Verified touchpoints — test/tools/rewind.test.ts
| Line | What | Current | Target |
|---|---|---|---|
| 54-55 | VALID_NOTE.avoid | `"Don't grep without -l; use the built-in grep tool which truncates."` | DELETE; merge into what_happened (line ~53) |
| **290** | `expect(REWIND_DESC).toBe("...disappears from your view permanently...")` | OLD DESC text | NEW text "...hidden from your context going forward (it stays on disk for the human)..." (S2 PRP Task 3) — **MISS #1** |
| 332 | `["whitespace-only avoid", {...VALID_NOTE, avoid: "   "}]` | repoint | `["whitespace-only true_current_state", {...VALID_NOTE, true_current_state: "   "}]` |
| 843-848 | `expectTypeOf(args.note).toEqualTypeOf<{what_happened,avoid,true_current_state,next}>` | 4-field | drop avoid → 3-field |

## Verified touchpoints — test/edge-cases.test.ts
| Line | What | Current | Target |
|---|---|---|---|
| 286 | marker factory `note: {what_happened:"p", avoid:"h", true_current_state:"n", next:"e"}` | inside a SessionEntry-shaped object | remove `avoid: "h"` (tsc didn't flag — likely cast; still a stale ref) |
| 307 | VALID_NOTE.avoid | `"Don't grep without -l; use the built-in grep tool which truncates."` | DELETE; merge into what_happened (line ~305) |
| 685 | field loop `["what_happened","avoid","true_current_state","next"]` | 4-field loop | drop "avoid" → 3-field |
| 701 | `expect(validateNote({...VALID_NOTE, avoid: "  "}).valid).toBe(false)` | repoint | `validateNote({...VALID_NOTE, true_current_state: "  "})` |

## Additional touchpoint — test/markers.test.ts (MISS #2)
| Line | What | Current | Target |
|---|---|---|---|
| 126 | `REWIND_DATA.note.avoid` | `"Don't grep without -l; use the built-in grep tool which truncates."` | DELETE (or merge into what_happened at ~line 123). The fixture is `RewindMarkerInput` (typed) → tsc TS2353. |

## Files that contain `avoid` but do NOT break (confirmed — leave alone unless linting)
- `test/tools/audit.test.ts:230` — `note:{...,avoid:"",...}` inside `as unknown as SessionEntry` (cast erases
  check; validateNote never called on it). SAFE.
- `test/tools/cancel.test.ts:175` — rewind marker fixture `avoid:"y"` inside `as unknown as SessionEntry`. SAFE.
- `test/drift_nudge.test.ts:48` — `note:{...} as never` (cast erases; loose assertions). SAFE.
- `test/integration/smoke.ts:67` — `SMOKE_NOTE.avoid`; smoke.ts is NOT a *.test.ts → vitest ignores it; run via
  `npm run smoke` separately. The `avoid` key is ignored by validateNote at runtime (forward-compat). OPTIONAL
  cleanup (stale "4-field" comment at line 66); not required for `npm test` or `npm run typecheck` green.