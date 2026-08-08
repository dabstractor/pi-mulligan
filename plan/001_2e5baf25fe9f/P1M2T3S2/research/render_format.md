# Research — P1.M2.T3.S2: `renderNote(note, ledger, granularity)`

## 1. The format — spec/04-data-model.md §2.3 (verbatim, authoritative)

The rendered note is the `content` of the `mulligan:note` `CustomMessage` (appended via `pi.sendMessage`,
spec/04 §3; spec/05 §1 step 6). Exact shape (the `<granularity>` and field values are interpolated):

```md
## 🔄 Mulligan rewind (<granularity>)

**What happened:** <what_happened>

**Avoid:** <avoid>

**Current true state:** <true_current_state>

<files-read>
path/a.ts
path/b.ts
</files-read>

<files-modified>
path/c.ts
</files-modified>

<bash-side-effects>
git commit -m "wip"
</bash-side-effects>

**Next:** <next>
```

### Structural facts (load-bearing for snapshot tests)
- **Every "section" is separated by exactly ONE blank line** = joined with `"\n\n"`.
  Sections in order: header → What happened → Avoid → Current true state → (ledger blocks) → Next.
- **Header:** `## 🔄 Mulligan rewind (<granularity>)` — granularity interpolated VERBATIM
  (`last_tool_call_group` / `last_turn` / `checkpoint`), NOT prettified.
- **Body fields:** `**What happened:** <x>` etc. — bold label + space + value, one line each.
- **Ledger block** = `<tag>\n` + `items.join("\n")` + `\n</tag>` (multi-line; one item per line).
  Order is fixed: `files-read` → `files-modified` → `bash-side-effects` (matches FileLedger field order).
- **Block omitted entirely when its list is empty** (spec/04 §2.3: "If a ledger list is empty, omit its block").
  Empty list ⇒ NO blank line is left for it — the surrounding sections stay separated by exactly one blank line.
- **No trailing newline** (the spec markdown block has none; `join("\n\n")` produces none).
- **Block tags mirror Pi's compaction summary convention** (spec/04 §2.3) — a model used to compaction parses
  them naturally. Do not rename/reformat the tags.

### Cleanest implementation (verified against the spec)
Build a `sections: string[]`, push the 4 fixed lines + (conditionally) each ledger block + the Next line,
then `return sections.join("\n\n")`. This automatically yields: blank-line separation everywhere; a missing
ledger block leaves no orphan blank line; the all-empty-ledger case collapses cleanly to
`[header, What, Avoid, Current, Next].join("\n\n")`.

## 2. Type seams (what renderNote consumes)

| Input | Source module | Export | Notes |
|---|---|---|---|
| `NoteInput` | `src/notes.ts` (S1, EXISTS) | `export interface NoteInput` | 4 fields: `what_happened`, `avoid`, `true_current_state`, `next` (all `string`). |
| `FileLedger` | `src/ledger.ts` (EXISTS) | `export interface FileLedger` | `{ readFiles: string[]; modifiedFiles: string[]; bashSideEffects: string[] }` (spec/04 §2.2). |
| `Granularity` | `src/config.ts` (EXISTS) | `export type Granularity` | `"last_tool_call_group" \| "last_turn" \| "checkpoint"` (spec/12, spec/05 §1). |

- `import type` only (erased at compile time) ⇒ notes.ts stays Pi-FREE and unit-testable in isolation.
  notes.ts is the PURE-HELPER tier (spec/11 §1), NOT the foundation permanent-zero-imports tier
  (tokens.ts/ledger.ts). S1 explicitly anticipated these S2 imports (S1 PRP GOTCHA #2).
- renderNote REUSES S1's module-private `isRecord` / `readOwn` (already in `src/notes.ts`). Do not redefine.

## 3. Consumer contract (spec/05-tools.md §1, steps 2 + 5 + 6)

`tools/rewind.ts` (`mulligan_rewind`, P1.M5.T1.S1) calls, in order:
1. step 2 — `validateNote(note)` ⇒ refuses vacuous notes (DONE in S1).
2. step 5 — compose ledger, then `renderNote(note, ledger, granularity)` ⇒ the note string.
3. step 6 — `pi.appendEntry("mulligan:rewind", { ..., note, ledger, ... })` AND
   `pi.sendMessage({ customType:"mulligan:note", content: <rendered>, display:true, details:{...} })`.

⇒ **By the time renderNote runs, the note is ALREADY validated.** renderNote does NOT re-validate; it just renders.
The returned string is consumed VERBATIM as `CustomMessage.content` (an agent-facing LLM context message).

## 4. Defensive discipline (consistent with the pure-helper tier)

- renderNote sits on the rewind-tool hot path ⇒ **NEVER throws** (E13-style discipline, like validateNote /
  extractFileLedger / estimateTokens).
- Read note fields via `readOwn` (Proxy-safe); read ledger lists via an `Array.isArray` guard. A malformed
  note or non-array list renders gracefully (empty string / empty block) rather than crashing.
- Keep the PUBLIC signature EXACTLY `renderNote(note: NoteInput, ledger: FileLedger, granularity: Granularity):
  string` — do NOT widen to `| null`. Internal `readOwn` guards handle type-violating callers (mirrors S1's
  `validateNote(note: NoteInput)` + internal `isRecord`).
- granularity is a string-literal union ⇒ interpolate directly. Do NOT add `typeof granularity === "string"`
  (TS flags it as always-true; the typebox schema guarantees the value at the tool boundary).

## 5. Test contract (spec/10-testing.md §1.8)

> "All four fields present → renders with ledger blocks; empty ledger lists → their blocks omitted.
>  Any empty field → validation refuses (returns a structured error, not a rendered note).
>  Snapshot tests for representative notes."

- "Any empty field → validation refuses" = validateNote (S1) — NOT renderNote's concern.
- renderNote tests cover: (a) pinned EXACT format via `.toBe(<full expected string>)` — header interpolation,
  block omission per empty list, block ordering read→modified→bash, no trailing newline; (b) snapshot-style
  representative notes via `toMatchInlineSnapshot()` (matches `test/tokens.test.ts:48` convention; vitest
  auto-writes new inline snapshots on first run).
- Convention (verified in `test/tokens.test.ts` + `test/ledger.test.ts`): `import { describe, it, expect,
  expectTypeOf } from "vitest"`; import from `"../src/notes.js"` (.js ext, Bundler resolution); NO
  `beforeEach`; `describe`/`it`/`expect`.

## 6. Baseline (verified live before writing)

- `npx tsc --noEmit -p tsconfig.json` → **exit 0**.
- `npx vitest run` → **6 files / 171 tests green** (config 21, ledger 39, log 15, notes 25, runtime 20, tokens 51).
  - The 25 notes tests come from S1 (validateNote). S2 APPENDS renderNote tests ⇒ grows to 25+N.
- No eslint/prettier/biome configured (devDeps = typescript + vitest + @types/node only) ⇒ the type+style gate
  is `tsc --noEmit` under `strict`. Do NOT invent a lint/format command.
- `src/notes.ts` EXISTS (S1 landed it). S2 APPENDS to it; it does NOT rewrite the file.