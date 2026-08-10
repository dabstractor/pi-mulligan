# System Context — Delta 006 (Note Consolidation + Nudge Text Shortening)

## Project Overview

**pi-mulligan** is a Pi extension providing autonomous context-rewind for a coding agent.
The agent can shed context it produced by mistake (bloated tool results, wrong-direction turns)
and redo a turn with a self-authored note.

**Baseline:** Post-005 codebase, v1.0. All 956 tests pass.

## Delta 006 Scope

Two localized, independent changes against existing code. **No new architecture, no new files,
no new mechanisms.**

### Cluster 1 — Rewind note consolidation (4 fields → 3 fields)
Remove `NoteInput.avoid`; fold its lesson into `what_happened`.

### Cluster 2 — Nudge text re-shortening
Shorten `renderBloatReminder` and `renderDriftNudge` text strings.

---

## Touchpoint Map (files that must change)

### Source files

| File | Cluster | Changes |
|------|---------|---------|
| `src/notes.ts` | 1+2 | `NoteInput` interface (remove `avoid`); `NOTE_FIELDS` array; `renderNote` (drop `**Avoid:**` line); `readNoteField` key union; all JSDocs ("four" → "three"); `renderBloatReminder` body text; `renderDriftNudge` tail text + bloat-fallback; both JSDoc FORMAT blocks |
| `src/tools/rewind.ts` | 1 | `RewindParams.note` typebox schema (remove `avoid` field, update `what_happened`/`true_current_state` descriptions, change "All four" → "All three"); file-header comment ("four-field" → "three-field"); `RWIND_DESC` line 136 ("disappears from your view permanently" → "hidden from your context going forward") |
| `src/markers.ts` | 1 (verify only) | Imports `NoteInput` by type only (`import type { NoteInput }`, `note: NoteInput` on `RewindMarker`). Removing `avoid` flows through automatically. **No edit needed.** |
| `src/nudges.ts` | 2 (verify only) | `bloatReminderHandler` calls `renderBloatReminder(event.toolName, bytes)` — 2-arg call site already correct from 005 M4. `injectNudge` calls `renderDriftNudge(metric)`. Both auto-adapt to the new text. **No call-site change.** |

### Test files

| File | Cluster | Changes |
|------|---------|---------|
| `test/notes.test.ts` | 1+2 | `VALID_NOTE` fixture (merge `avoid` into `what_happened`); `FIELDS` array (drop `avoid`); parametrized empty/whitespace cases (repoint `avoid`-specific cases); `renderNote` section assertions (drop `**Avoid:**` line); type assertion (drop `avoid`); `DRIFT_TAIL` const; `renderBloatReminder` assertions + inline snapshots; `renderDriftNudge` assertions + inline snapshots |
| `test/tools/rewind.test.ts` | 1 | `VALID_NOTE` fixture (lines ~54-55, ~844-845); refusal parametrized table (line ~332 "whitespace-only avoid" → repoint); type assertion on `RewindArgs.note` |
| `test/edge-cases.test.ts` | 1 | **CRITICAL FINDING:** This file also has `avoid` references not explicitly called out in the PRD's M1.T1.S3: (a) inline note in marker factory (line 286); (b) `VALID_NOTE` fixture (line 307); (c) field loop `["what_happened", "avoid", "true_current_state", "next"]` (line 685); (d) `validateNote({ ...VALID_NOTE, avoid: "  " })` (line 701). All must be updated. |
| `test/nudges.test.ts` | 2 (verify only) | Uses `renderBloatReminder("read", OVER_BYTES)` for byte-for-byte comparison (line 299) — auto-adapts to new text. No pinned-text assertions. **No edit needed.** |
| `test/drift_nudge.test.ts` | 2 (verify only) | Only checks `startsWith("Previous turn")` and `not.toContain("[mulligan]")` (line 151) — both still true with new text. **No edit needed.** |

### Documentation

| File | Cluster | Changes |
|------|---------|---------|
| `README.md` | 1+2 | Line ~151: "four-field note" → "three-field note"; list `avoid` removal. Line ~224: "~30 tokens" → "~20 tokens". Line ~225: drift nudge example → new short form (drop `mulligan_audit` clause). |

---

## Verification of PRD Claims

1. **"markers.ts references NoteInput by type only"** — ✅ CONFIRMED. `import type { NoteInput }` and `note: NoteInput` on `RewindMarker`. Type-only, no runtime field access on `avoid`.

2. **"The nudges.ts call site is already 2-arg"** — ✅ CONFIRMED. `renderBloatReminder(event.toolName, bytes)` at line 71 of nudges.ts.

3. **"No migration needed (forward-compat)"** — ✅ CONFIRMED. Old markers persisted `avoid`; `validateNote`/`renderNote` run only at tool-call time, never on read-back. Unknown keys are ignored.

4. **"M1 and M2 both edit src/notes.ts (disjoint functions)"** — ✅ CONFIRMED. M1 touches `NoteInput`, `NOTE_FIELDS`, `validateNote`, `renderNote`, `readNoteField`. M2 touches `renderBloatReminder`, `renderDriftNudge`. Disjoint code regions, same file.

5. **PRD says only `test/notes.test.ts` and `test/tools/rewind.test.ts` need test updates** — ⚠️ **INCOMPLETE.** `test/edge-cases.test.ts` also has 4 `avoid` references (lines 286, 307, 685, 701) that must be updated for the suite to stay green after the `avoid` field is removed from `NoteInput`. This is folded into M1's test subtask.

6. **`test/nudges.test.ts` and `test/drift_nudge.test.ts` auto-adapt** — ✅ CONFIRMED. nudges.test.ts compares against `renderBloatReminder(...)` return value (not pinned text); drift_nudge.test.ts uses loose `startsWith`/`not.toContain` checks.

---

## Architectural Patterns (for downstream agents)

1. **Pure-helper tier (notes.ts):** No Pi imports for validateNote; type-only imports (FileLedger, Granularity) for renderNote/renderers. Unit-testable in isolation.

2. **Never-throws discipline:** All functions in notes.ts are defensive (isRecord/readOwn guards). This discipline must be preserved.

3. **JSDoc as documentation:** The JSDoc FORMAT blocks in notes.ts ARE the inline documentation. They serve as both developer docs and spec cross-references. They must be updated alongside the code.

4. **Test idiom:** Vitest with `expectTypeOf` for type assertions, hand-rolled fakes (no vi.fn()), `.js` import paths. Inline snapshots use `toMatchInlineSnapshot()`.

5. **Single-writer constraint:** M2 depends on M1 because both edit `notes.ts`. M3 depends on both.