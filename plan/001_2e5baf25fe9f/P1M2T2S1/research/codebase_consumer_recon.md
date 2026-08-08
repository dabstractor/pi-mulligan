# Codebase Recon — P1.M2.T2.S1 (extractFileLedger)

First-hand findings from reading the pi-mulligan repo. Authoritative answers to the seven
recon questions, with exact `file:line` references and verbatim snippets.

---

## TL;DR (what the implementer needs to know)

1. **No reusable ledger/scanning logic exists anywhere.** `looper-smoke.proto.ts` is a
   rewind/context-filter *feasibility harness* — it scans messages by `customType` only,
   never classifies tool calls. `extractFileLedger` is greenfield.
2. **`range` is a `number[]` of message indices** (NOT a `[start,end)` tuple). It is produced
   by the rewind resolver (`resolveLastToolCallGroup` → `number[] | null`, the unit's
   `indices`; `resolveLastTurn` → `{ remove: number[] }`). The indices include BOTH
   assistant AND toolResult messages (a "unit" groups them), but `extractFileLedger` only
   inspects the **assistant** messages' `toolCall` blocks.
3. **ToolCall block shape confirmed:** `{ type:"toolCall"; id:string; name:string;
   arguments:Record<string,unknown> }` (spec/01 §5; tokens.ts:31-37;
   api_verification.md:257).
4. **Mirror `tokens.ts`'s defensive pattern exactly:** `isRecord` / `readOwn` / `stringLength`
   + a never-throws/fail-open/zero-imports discipline. `ledger.ts` should define its OWN local
   structural `MessageLike`-style types (do not import `tokens.ts` — both are foundation-tier).
5. **Test conventions:** vitest `describe/it/expect/expectTypeOf`, import from
   `../src/ledger.js`, no `beforeEach` (pure helper, no module state).

---

## Q1. looper-smoke.proto.ts — existing ledger/scanning logic?

**Finding: NONE reusable.** `spec/reference/looper-smoke.proto.ts` is a Pi extension harness
that proves rewind/context-filter *plumbing* (markers, notes, `navigateTree`, the
`context`-event canary drop). It performs **no tool-call classification, no path extraction,
no bash read/write heuristic, and no `FileLedger`**.

The only message-scanning it does is by `customType` string match — pattern worth noting only
as the SHAPE of "iterate `event.messages`", not as logic to copy:

- `looper-smoke.proto.ts:53-58` — finds canary by `customType`:
  ```ts
  const canaryIdx = msgs.findIndex((m) => m?.customType === "looper_canary");
  ```
- `looper-smoke.proto.ts:62-78` — context-filter drops one index (`msgs.filter((_, i) => i !== canaryIdx)`).
- `looper-smoke.proto.ts:112-122` — `tool_result` handler scans `event.content` text blocks:
  ```ts
  const text = (event.content || [])
    .map((c: any) => (c?.type === "text" ? c.text : ""))
    .join("");
  ```

**Conclusion:** Greenfield. Do not copy from looper-smoke. The only transferable idea is "walk
the message array by index." `extractFileLedger` must inspect `AssistantMessage.content[]`
`toolCall` blocks (which looper-smoke never does).

---

## Q2. Edge cases that affect ledger extraction (spec/08-edge-cases.md)

| Edge case | ID | Lines | Application to `extractFileLedger` |
|---|---|---|---|
| Side-effectful span (writes/bash) | **E5** | 08:28-31 | **This is THE reason FileLedger exists.** "the note's `true_current_state` + the deterministic `FileLedger` exist." The ledger's non-empty `modifiedFiles`/`bashSideEffects` triggers the mutation warning. So extraction MUST be robust — a missed write here means the agent blindly redoes a `mkdir`/`git commit`. |
| Orphaned toolResult (no matching toolCall) | **E1** | 08:6-9 | A `range` from the resolver may include a toolResult whose toolCall was compacted/removed. `extractFileLedger` only reads assistant `toolCall` blocks, so an orphan toolResult is naturally ignored — but the helper must not assume every index in `range` is an assistant message. **Iterate `range` defensively: skip any non-assistant / unreadable message.** |
| Tool throws / handler fail-open | **E13** | 08:73-78 | "every tool body and every handler is wrapped in try/catch… never throws." `extractFileLedger` sits in the rewind-tool hot path → must NEVER throw on malformed input (circular `arguments`, throwing Proxy, missing fields). Fail-open → return an (empty/partial) ledger, never crash the turn. |
| Marker targets nothing (compacted/removed) | **E8** | 08:55-59 | "resolver returns null/empty → the operation is a no-op." When the resolver yields an **empty `range`**, `extractFileLedger` must return `{readFiles:[],modifiedFiles:[],bashSideEffects:[]}` cleanly. |
| Parallel-tool siblings | **E6** | 08:45-50 + 06:§9 | One assistant message may carry `mulligan_rewind` + sibling tool calls. The resolved `range`/unit may include sibling `toolCall` blocks (e.g. a sibling `read`/`edit`). The ledger should classify ALL toolCall blocks in the scanned assistant messages — there is no requirement to skip the rewind's own call (the ledger is about *what happened in the span*, so a sibling edit belongs in `modifiedFiles`). |

**Additional cross-reference (NOT in 08, but load-bearing):** the ledger is explicitly
**advisory / best-effort**. `spec/05-tools.md:73-75` (rewind step 5): *"Resolve the target
span preview read-only to extract the file ledger… If resolution is ambiguous (e.g. before
compaction settles), extract over the available span best-effort; the ledger is advisory."*
→ extraction must degrade gracefully, never block the rewind.

---

## Q3. The `range` shape (spec/06-context-filter.md)

**CONFIRMED: `range` is a `number[]` of message indices — NOT a `[start,end)` tuple.**

The rewind resolvers that produce the span:

- **`resolveLastToolCallGroup`** — spec/06:§3 (lines ~75-90). Signature:
  ```ts
  function resolveLastToolCallGroup(
    units: Unit[], messages: AgentMessage[], excludeToolCallId?: string
  ): number[] | null
  ```
  "Return its indices" / "Return its `indices`." A `Unit` is `{ indices: number[]; kind:
  "plain" | "toolGroup" }` (spec/06:§2, lines ~40-50). So the return is the **`number[]`** of
  message indices in that toolGroup unit.

- **`resolveLastTurn`** — spec/06:§4 (lines ~95-115). Returns `{ remove: number[] }` — again a
  `number[]` of message indices (`remove = indices j where j > iLastUser AND …`).

**What the `range` contains:** a `Unit` (toolGroup) = "the assistant message at
`assistantIndex` **plus all `resultIndex`** whose `toolCallId` maps to that assistant"
(spec/06:§2 step 3). Therefore the index list contains **BOTH assistant AND toolResult
indices**. `extractFileLedger` must:
- Iterate only the indices in `range`.
- Inspect only the messages that are `assistant` (skip toolResult/user/custom/etc. — those
  carry no `toolCall` blocks).
- For each assistant message, walk its `content[]` for `toolCall` blocks.

`spec/03-architecture.md:67` states the contract verbatim:
> `extractFileLedger(messages, range)` — deterministic `readFiles`/`modifiedFiles` extraction
> over a span.

And `tasks.json` (P1.M2.T2.S1 `context_scope`) pins the type:
> **INPUT:** `range (number[] of indices) defining the span to scan.`
> **LOGIC:** `extractFileLedger(messages: AgentMessage[], range: number[]): FileLedger. Iterate
> messages[range indices].`

---

## Q4. PRP.md for P1M3T1S1 / P1M3T2S1 — return shapes

**The PRP files do NOT exist yet.** There are **no `P1M3*` directories** under
`plan/001_2e5baf25fe9f/` (verified via `find`). Existing PRPs only go up to `P1M2T1S2`
(`P1M1T1S1 … P1M2T1S2`).

However, `tasks.json` (the work-item backlog, authoritative for contracts) **confirms the
resolver return shapes**, so `extractFileLedger`'s `range` parameter aligns with what will be
built in P1M3:

From `tasks.json` (the `P1.M3` transforms.ts work-item `context_scope`):
> `resolveLastToolCallGroup(units, messages, excludeToolCallId): number[] | null. Walk units
> from last to first… First non-skipped toolGroup → **return its indices**. None found →
> **return null**.`
> `…resolveLastToolCallGroup (find the most recent tool-call group, excluding the rewind's own
> call) and resolveLastTurn (find the last user message and compute the removal range). Both
> return index ranges for applyRewind.`
> **OUTPUT:** `Exported resolveLastToolCallGroup function returning number[]|null.`

**Alignment conclusion:** the resolver yields `number[] | null`. The caller (rewind tool)
passes the `number[]` (indices) to `extractFileLedger(messages, range)`; if `null`, pass `[]`
→ empty ledger. **`range: number[]` is correct.** Do NOT model range as `[start,end)` or as a
`Unit` object.

---

## Q5. AssistantMessage `toolCall` block shape (spec/01 §5/§6/§7)

**CONFIRMED verbatim.** spec/01 §5 ("AgentMessage union" + "Content blocks"):
```ts
{ type:"toolCall", id: string, name: string, arguments: Record<string,unknown> }
```
- AssistantMessage content is `(Text|Thinking|ToolCall)[]`: `spec/01:§5`
  (`{ role:"assistant", content: (Text|Thinking|ToolCall)[] }`).

`api_verification.md:257` (verified against installed .d.ts) — note `any` vs `unknown`:
```ts
interface ToolCall { type: "toolCall"; id: string; name: string; arguments: Record<string, any>; }
```
spec/01 uses `Record<string,unknown>`; api_verification uses `Record<string,any>`;
**tokens.ts:31-37 uses `Record<string, unknown>`** — match `tokens.ts` (the foundation sibling).

`tokens.ts:31-37` (the exact structural type to mirror):
```ts
interface ToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}
```

**How to read a string field defensively** (the tokens.ts pattern — `readOwn` + `typeof`):
`arguments` may be absent, non-record, or a throwing Proxy; a field like `path` may be missing
or mistyped. Defensive read = `isRecord(arguments) && readOwn(arguments,"path")` then
`typeof === "string"`. See `tokens.ts` helpers in §7 below.

---

## Q6. Vitest test conventions (test/tokens.test.ts)

**Confirmed — `test/ledger.test.ts` must match these exactly:**

- Imports (test/tokens.test.ts:1-9):
  ```ts
  import { describe, it, expect, expectTypeOf } from "vitest";
  import { /* exports */ } from "../src/tokens.js";
  ```
  → for ledger: `import { extractFileLedger, type FileLedger } from "../src/ledger.js";`
- **No `beforeEach`** — explicit comment at test/tokens.test.ts:11:
  > `// No beforeEach needed: tokens.ts has NO module-scoped mutable state`
  (ledger.ts is also a pure, stateless helper → no `beforeEach`).
- `describe` blocks titled `"<fn> — <spec> §<n> contract (<keywords>)"` and one `describe("types", …)`.
- Assertions use `expect(x).toBe(...)`, `toMatchInlineSnapshot()`, and **`expectTypeOf<…>().toEqualTypeOf<…>()`** for
  type-level checks (test/tokens.test.ts:178-210). Add a `describe("types")` asserting
  `FileLedger` shape and `extractFileLedger` return type.
- Defensive-cases `describe` block asserts `expect(() => fn(...)).not.toThrow()` (e.g.
  test/tokens.test.ts:140-160) — mirror for circular `arguments`, throwing-Proxy messages,
  non-array content, non-record blocks.
- Run: `npm test` = `vitest run` (package.json:scripts). tsconfig is `strict`+`noImplicitAny`,
  ESM (`"type":"module"`, `moduleResolution":"Bundler"`).
- **Tier-1 test case is pinned** (spec/10-testing.md §1.6, lines 37-39) — implement exactly:
  > A span with `read(path="a.ts")`, `edit(path="b.ts")`, `bash(command="git commit")`,
  > `bash(command="ls")` → `readFiles:["a.ts"]`, `modifiedFiles:["b.ts"]`,
  > `bashSideEffects:["git commit"]` (`ls` is read-only → omitted). **De-dup + sort.**
  > Empty span → all lists empty.

---

## Q7. Defensive helper pattern to mirror (src/tokens.ts)

`ledger.ts` must mirror `tokens.ts`'s discipline. **These four module-private helpers are the
template** (copy/define the same four in ledger.ts — do NOT import from tokens.ts):

```ts
// src/tokens.ts:151-154 — True for plain records (and Object.create(null)); false for null/primitives/arrays.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/tokens.ts:158-163 — Read an own property without throwing (a Proxy get-trap may throw); undefined if absent/unreadable.
function readOwn(obj: unknown, key: string): unknown {
  if (!isRecord(obj)) return undefined;
  try {
    return obj[key];
  } catch {
    return undefined;
  }
}

// src/tokens.ts:167-169 — Length of a value when it is a string; 0 otherwise.
function stringLength(value: unknown): number {
  return typeof value === "string" ? value.length : 0;
}

// src/tokens.ts:173-179 — Length of JSON.stringify(value); 0 if not stringifiable (circular/BigInt → TypeError).
function safeStringLength(value: unknown): number {
  try {
    const s = JSON.stringify(value);
    return typeof s === "string" ? s.length : 0;
  } catch {
    return 0;
  }
}
```

For ledger.ts, add a **string-value** reader (mirror of `stringLength` but returns the string,
for path extraction):
```ts
function readStringField(obj: unknown, key: string): string {
  const v = readOwn(obj, key);
  return typeof v === "string" ? v : "";   // missing/mistyped/non-string → "" (skip)
}
```

**The "never throws / fail-open / zero-imports" discipline** (verbatim from tokens.ts header):
- tokens.ts:8-11:
  > *"Imports NOTHING — not Pi, not config, not log, not runtime. It is a pure, deterministic,
  > side-effect-free function… honors the work-item contract ('internal pure helper') and is the
  > consumer of NO other module."*
- tokens.ts:15-16:
  > *"a malformed message (missing content, a throwing Proxy trap, circular toolCall.arguments)
  > estimates to ≥0, so it can never crash the context/turn_end/audit hot path (mirrors log.ts's
  > fail-open discipline)."*
- tokens.ts:147-150 ("module-private defensive helpers (never throw — GOTCHA #3)").
- `blockCharLength` already handles `toolCall` defensively (tokens.ts:118-126): reads
  `name`/`arguments` via `readOwn`, sizes `arguments` via `safeStringLength` to survive circular
  refs. **This proves the exact defensive-read path ledger.ts needs for the SAME fields** — the
  only difference is ledger.ts reads `arguments.path`/`arguments.command` rather than sizing them.

**Note on imports:** ledger.ts defines its OWN local structural `MessageLike`/`ToolCallContent`
types (like tokens.ts does at tokens.ts:25-50). It must NOT import tokens.ts — both are
foundation-tier "consumer of NO other module." (`spec/11-build-order.md:28` lists `ledger.ts`
as a sibling pure helper to `tokens.ts`.)

---

## Extraction rules — the authoritative contract (spec/04-data-model.md §2.2, lines 58-74)

```ts
// spec/04-data-model.md:62-67
interface FileLedger {
  readFiles: string[];       // paths appearing in read/grep tool calls in the span
  modifiedFiles: string[];   // paths appearing in write/edit tool calls in the span
  bashSideEffects: string[]; // non-read bash commands (heuristic: commands with >, rm, mv, mkdir, git, curl, etc.)
}
```

Extraction rules (spec/04:70-74) + actionable token lists (tasks.json context_scope):
- **readFiles:** `path`/`file_path` args from tool calls whose `name` ∈ **{`read`, `grep`,
  `rg`, `glob`}**.
- **modifiedFiles:** `path`/`file_path` args from tool calls whose `name` ∈ **{`write`,
  `edit`}** (and `bash` only when command matches a write heuristic AND a path is parseable —
  uncertain bash entries go to `bashSideEffects`).
- **bashSideEffects:** bash `command`s NOT provably read-only. **Read-only (omit):** `ls, cat,
  head, tail, find, wc, echo` (+ safe read-only regex per tasks.json). **Side-effecting
  (include):** `>, >>, rm, mv, cp, mkdir, git, curl, sed` (spec/04:66 names `>, rm, mv, mkdir,
  git, curl` as examples). **"When in doubt, include"** (spec/04:73).
- **Post-process:** de-duplicated + sorted, relative to `cwd` (spec/04:74).

**⚠ Open design question (no exact regex in spec):** the read-only vs side-effecting bash
classification is described as a "regex heuristic" with EXAMPLE token lists only (spec/04:66,
spec/10:38, tasks.json). There is **no canonical regex/word-list frozen anywhere.** The
implementer must choose a heuristic that (a) passes the pinned Tier-1 test
(`ls`→omit, `git commit`→include), (b) errs toward inclusion ("when in doubt, include"), and
(c) never throws. Recommend: a side-effecting keyword/redirect regex; everything not matching
→ included in `bashSideEffects`. Flag this as a residual risk / decision point.

---

## Files Retrieved (exact ranges)

1. `spec/reference/looper-smoke.proto.ts` (full, 1-256) — feasibility harness; **no ledger
   logic**; message-scan-by-customType pattern at lines 53-78, 112-122 (not reusable).
2. `src/tokens.ts` (full, 1-291) — the foundation sibling to mirror: defensive helpers
   `isRecord`/`readOwn`/`stringLength`/`safeStringLength` (151-179), `ToolCallContent` type
   (31-37), zero-imports/never-throws discipline (8-16, 118-126, 147-150).
3. `test/tokens.test.ts` (full, 1-291) — vitest conventions: imports (1-9), no-beforeEach (11),
   `expectTypeOf` types block (178-210), defensive `not.toThrow()` cases (140-160).
4. `spec/08-edge-cases.md` (full, 1-110) — E5 (28-31), E1 (6-9), E13 (73-78), E8 (55-59), E6
   (45-50) applicability to ledger.
5. `spec/06-context-filter.md` (full, 1-295) — resolver return shapes: `Unit`/`partitionIntoUnits`
   (§2), `resolveLastToolCallGroup(): number[] | null` (§3), `resolveLastTurn(): { remove:
   number[] }` (§4), parallel-tool mode (§9).
6. `spec/01-pi-context-internals.md` (full, 1-200) — ToolCall block shape (§5, §6, §7).
7. `spec/04-data-model.md` (1-140) — `FileLedger` interface (62-67) + extraction rules (70-74).
8. `spec/05-tools.md` (1-115) — rewind step 5: ledger is "advisory"/best-effort (73-75).
9. `spec/10-testing.md` (30-79) — §1.6 pinned Tier-1 test (37-39).
10. `spec/03-architecture.md` (55-84) — `extractFileLedger(messages, range)` contract (line 67).
11. `plan/001_2e5baf25fe9f/tasks.json` — P1.M2.T2.S1 contract (`range: number[]`,
    read/write/bash token lists) + P1.M3 resolver return `number[] | null`.
12. `plan/001_2e5baf25fe9f/architecture/api_verification.md:257` — verified `ToolCall` shape.

---

## Start Here

Open **`src/tokens.ts`** first (esp. lines 25-50 for the structural `ToolCallContent` type to
re-declare, and 147-179 for the four defensive helpers to copy). Then **`spec/04-data-model.md`
§2.2 (lines 58-74)** for the exact `FileLedger` shape + extraction rules. Then
**`test/tokens.test.ts`** to mirror the test file structure for `test/ledger.test.ts`. Create
`src/ledger.ts` as a zero-import, never-throws pure helper exporting `FileLedger` +
`extractFileLedger(messages, range: number[])`.