---
name: "P4.M1.T2.S1 — Per-prompt retry budget guard (E22 hard backstop #1)"
description: "Add a module-local defensive helper `countRetriesAtLatestPrompt(ctx)` to src/tools/rewind.ts (mirrors the shipped `countRewindMarkers` defensive-scan model) and insert a per-prompt retry-budget guard into `rewindExecute` between the maxDepth guard (step 4) and the read-only ledger preview (step 5). The guard refuses — before persisting — when the count of `mulligan:rewind` markers appended AFTER the latest user-prompt entry reaches `config.rewind.maxRetriesPerPrompt` (default 5). Refusal uses the existing `refusal(reason, granularity)` helper with the exact reason string from the item contract. No config change (P4.M1.T1.S1 already shipped the knob). No new tests in this task (the loop-driving test matrix is P4.M1.T3.S1). Keep `npx tsc --noEmit` + `npm test` green."
---

## Goal

**Feature Goal**: Harden `mulligan_rewind` (src/tools/rewind.ts) against the E22 same-prompt retry loop — the most severe Mulligan failure mode (a loop that re-lands at the same user prompt and grows the session until the provider rejects the next request as "Prompt too long", at which point the human cannot even send a new message). This task implements the **marker-counting per-prompt retry budget** — the first of the two independent E22 hard backstops. The rewind tool will refuse, before persisting, once the number of `mulligan:rewind` markers appended after the **latest user-prompt entry** reaches `config.rewind.maxRetriesPerPrompt`.

**Deliverable**: Two additive edits to a single source file, `src/tools/rewind.ts`:
1. A new module-local function `countRetriesAtLatestPrompt(ctx: ExtensionContext): number` (defensive, never throws), placed immediately after the existing `countRewindMarkers` helper.
2. A new guard block inside `rewindExecute`, placed after the maxDepth guard and before the read-only ledger preview (step 5), that calls the helper and returns a `refusal(...)` when the budget is exhausted.

No new files. No config change. No test files written here (the dedicated test matrix is P4.M1.T3.S1 — a separate, downstream task). No changes to spec/ or README/ (Mode A).

**Success Definition**:
- `config.rewind.maxRetriesPerPrompt` is read (it already exists from P4.M1.T1.S1) and honored by the rewind tool.
- With default budget 5: the first 5 `mulligan_rewind` calls that re-land at the same latest user prompt all **succeed**; the **6th** such call is **refused before persisting** with text beginning `"Mulligan: refused — hit the per-prompt retry budget (5/5 rewinds re-landing at this prompt)..."` and **nothing is persisted** (no marker, no note).
- `countRetriesAtLatestPrompt` **never throws** (E13): a throwing `getEntries()`, a non-array return, a throwing-Proxy entry, or a malformed entry all yield a safe count (0 / skip) and never break the tool.
- Advancing to a new user prompt resets the budget to 0 (a rewind at the new prompt succeeds even after the previous prompt exhausted its budget) — this falls out of the "count rewinds after the LATEST user message" algorithm for free.
- A **zero-hide rewind** (K=0, "nothing matched to hide") still counts toward the budget — it is the canonical loop vector. No special-casing.
- The full existing `npm test` suite stays green (the new guard does not fire on any existing test — verified) and `npx tsc --noEmit` is clean.

## Why

- **Business value / blast radius**: E22 is *the* catastrophic Mulligan failure mode — observed in live use, a single "update the spec" prompt left the agent retrying the same turn for **hours**, each loop enlarging the session, until the provider rejected the next request and the human was locked out. The retry budget is the **hard backstop**: a self-authored rewind note can encode the loop's cause as its own `next` instruction (note → resume → re-trigger → rewind → note → …), so the note cannot be trusted to self-correct. Only a budget that counts rewinds and refuses can arrest it.
- **Scope position**: This is the **first guard** of P4.M1.T2 (Rewind tool guards). P4.M1.T1.S1 (the config knob) **already shipped** in this tree — `config.rewind.maxRetriesPerPrompt` (default 5) is present and validated in src/config.ts, so this task consumes it directly. P4.M1.T2.S2 (the out-of-band context-fraction stop) shares the same insertion neighborhood but is an **independent** task; this PRP leaves its spot free. P4.M1.T2.S3 (suppress the drift nudge for a refused turn) depends on this guard existing. P4.M1.T3.S1 writes the loop-driving test that asserts this guard's exact boundary.
- **Problems solved / for whom**: protects the agent (and the human) from an unrecoverable "Prompt too long" hard stop caused by a same-prompt rewind loop. The agent-facing refusal text ("Commit to the current state, ask the human, or use mulligan_shrink instead of rewinding again") steers it to a non-looping recovery.

## What

User-visible behavior: after this task, an agent that repeatedly rewinds at the **same latest user message** is allowed exactly `config.rewind.maxRetriesPerPrompt` (default 5) such rewinds; the next one is refused with the budget text, and **nothing is persisted** (the marker/appended state is untouched). All other Mulligan operations (`mulligan_shrink`, `mulligan_audit`, `mulligan_checkpoint`, `mulligan_cancel`) and ordinary non-rewind tool work remain fully callable — only prompt-re-landing `mulligan_rewind` calls are gated. The refusal text IS the agent-facing documentation (Mode A — no README/spec change).

### Success Criteria

- [ ] New module-local `countRetriesAtLatestPrompt(ctx: ExtensionContext): number` exists in src/tools/rewind.ts, placed immediately after `countRewindMarkers`, mirroring its defensive-scan model (try/catch around `getEntries()`, `Array.isArray` guard, per-entry try/catch, returns 0 on any failure).
- [ ] `countRetriesAtLatestPrompt` finds the INDEX of the LAST entry whose `type === "message"` AND whose `message.role === "user"` (the latest user prompt), then counts entries at index > that index where `type === "custom" && customType === "mulligan:rewind"`. Returns 0 if there is no user-message entry.
- [ ] A code comment on `countRetriesAtLatestPrompt` documents it as a **v1 entry-position over-approximation** (counts a `last_tool_call_group`/`checkpoint` rewind issued this turn even if its target was a prior turn's group; the spec's intent — arrest the loop — is met; message-list resolution is a future refinement).
- [ ] `rewindExecute` has a new guard block, placed AFTER the maxDepth guard (`if (depth >= config.rewind.maxDepth) {...}`) and BEFORE the `(5) read-only ledger + K preview` step, that runs `const retries = countRetriesAtLatestPrompt(ctx);` and, when `retries >= config.rewind.maxRetriesPerPrompt`, returns `refusal(<exact reason>, granularity)` WITHOUT persisting.
- [ ] The refusal reason string is VERBATIM: `` `hit the per-prompt retry budget (${retries}/${config.rewind.maxRetriesPerPrompt} rewinds re-landing at this prompt). Commit to the current state, ask the human, or use mulligan_shrink instead of rewinding again` `` (no trailing period — `refusal()` adds it).
- [ ] `countRetriesAtLatestPrompt` never throws (E13): it does NOT rely on the execute body's outer try/catch — it is defensively self-contained.
- [ ] `npx tsc --noEmit` passes; `npm test` passes (zero regressions).
- [ ] spec/08-edge-cases.md, spec/09-configuration.md, and README.md are NOT modified (Mode A).

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement this successfully?_ **Yes** — every edit location is given with the exact anchor text, the exact code to write is specified, the sibling helper to mirror is quoted verbatim, the entry-shape used to detect a user prompt is documented (role lives under `.message.role`), the config knob to read is confirmed to already exist, and the one genuinely tricky thing (the off-by-one vs E22 acceptance (a)) is called out with the resolution.

### Documentation & References

```yaml
# MUST READ — the spec that defines this feature
- url: spec/08-edge-cases.md §E22 (heading "Same-prompt rewind retry loop — runaway growth")
  why: E22 defines the per-prompt retry budget, its semantics, the exact refusal text, and the
       acceptance criteria. The "Required behavior — per-prompt retry budget" block is authoritative.
  critical: E22 body says 'When that count reaches maxRetriesPerPrompt, refuse before persisting' and the
       CONTRACT (this item) gives exact code `if (retries >= config.rewind.maxRetriesPerPrompt)`. With
       default 5 that means rewinds 1-5 SUCCEED and the 6TH is refused (refusal text reads "5/5"). E22
       acceptance (a) literally says "first maxRetriesPerPrompt−1 succeed; Nth==budget refuses" (4 succeed
       / 5th refuses / "4/5") — these differ by ONE. This PRP implements the CONTRACT's `>=` code verbatim
       (it is self-consistent: "5/5" at refusal = budget fully consumed). See Known Gotchas #1. The
       downstream test task (P4.M1.T3.S1) MUST assert the implemented boundary, not acceptance (a)'s literal.
- url: spec/08-edge-cases.md §E13 ("Tool throws internally")
  why: E13 mandates every tool body + helper is wrapped try/catch and never breaks a turn. The new helper
       must be defensive ITSELF (the contract: "the helper MUST be defensive itself (E13 hot-path)"), not
       rely on the execute body's single outer try/catch.
- url: spec/05-tools.md §1 "mulligan_rewind" → "Behavior (step by step)" step 4 (the per-prompt retry budget bullet)
  why: Restates the refusal text + the "advancing to a new user prompt resets the budget" + "zero-hide rewind
       still counts" invariants the guard must satisfy. (The selected_prd_content block quotes this verbatim.)

# MUST READ — the file you are editing (primary deliverable)
- file: src/tools/rewind.ts
  why: The ONLY source file to change. Contains the `rewindExecute` body (where the guard goes), the
       `countRewindMarkers` helper (the EXACT model to mirror), and the `refusal()` helper (to call).
  pattern: `countRewindMarkers(ctx)` (quoted verbatim in research/findings.md §2) is the defensive-scan
           template: try/catch around `ctx.sessionManager.getEntries()`, `Array.isArray` guard, per-entry
           try/catch, return 0 on any failure. `countRetriesAtLatestPrompt` is that + an index walk.
  gotcha: `refusal(reason, granularity)` (the helper you must call) ALREADY adds the "Mulligan: refused — "
          prefix AND the trailing ".". Pass the reason with NO trailing period. The `granularity` arg is in
          scope inside rewindExecute (declared at the top of the function).

# MUST READ — the previous task's PRP (the contract this task consumes)
- docfile: plan/004_d3d84055c5b2/P4M1T1S1/PRP.md
  why: Defines the config knob this guard reads. VERIFIED ALREADY SHIPPED in this tree (src/config.ts
       L45/L131/L239-243: `config.rewind.maxRetriesPerPrompt: number`, default 5, validated integer>=1).
       No further config work is needed or permitted by this task.

# Grounded research (verified current-tree line numbers + the off-by-one analysis + breakage check)
- docfile: plan/004_d3d84055c5b2/architecture/codebase_patterns.md §2
  why: Confirms countRewindMarkers as the model, the refusal() prefix/suffix behavior, the insertion point
       (after maxDepth guard / before step 5), the single-try/catch execute body, and the entry shapes.
- docfile: plan/004_d3d84055c5b2/P4M1T2S1/research/findings.md
  why: This task's own research: config knobs confirmed present, entry shape (role under .message.role),
       existing-tests-won't-break proof, the off-by-one resolution, zero-hide-counts proof, scope boundary.

# Reference — how the downstream test will drive this (NOT this task's work, but informs the boundary)
- file: test/tools/rewind.test.ts
  why: The test harness for this tool. Shows the fakes the loop-driving test (P4.M1.T3.S1) will reuse:
       `makeCtx({ entries: [...] })` scripts getEntries(); `rewindEntry(seq)` = {type:"custom",customType:
       "mulligan:rewind",data:{seq}}; user-message entries are {type:"message",id,message:{role:"user",...}}.
  pattern: the "depth guard" describe block (lines ~343-378) is the template: script N rewindEntry()s in
           `entries`, call the tool, assert `firstText(res)` contains the refusal substring. The retry-budget
           test will additionally interleave a user-message entry and assert the count-after-prompt logic.
  gotcha: This task writes NO tests — only the helper + guard. Do not add test cases here.
```

### Current Codebase tree (relevant subset)

```bash
pi-mulligan/
├── package.json          # "test": "vitest run" ; NO tsc/eslint/prettier scripts (call tsc directly)
├── tsconfig.json         # strict:true, moduleResolution:Bundler, include:["src","test"]
├── spec/
│   ├── 05-tools.md       # §1 mulligan_rewind behavior (READ-ONLY)
│   └── 08-edge-cases.md  # §E22 (the feature), §E13 (never throws) (READ-ONLY)
├── src/
│   ├── config.ts         # config.rewind.maxRetriesPerPrompt ALREADY EXISTS (P4.M1.T1.S1) — READ-ONLY here
│   └── tools/
│       └── rewind.ts     # ← EDIT: add countRetriesAtLatestPrompt helper + the (4b) guard block
└── test/
    └── tools/
        └── rewind.test.ts # ← NOT modified by this task (test matrix = P4.M1.T3.S1)
```

### Desired Codebase tree (files touched)

```bash
src/tools/rewind.ts   # MODIFIED — +1 module-local helper (~20 lines) + 1 guard block (~6 lines)
```
No new files. No other files change.

### Known Gotchas of our codebase & Library Quirks

```ts
// ⚠ CRITICAL #1 — OFF-BY-ONE between the contract code and E22 acceptance (a). IMPLEMENT THE CONTRACT.
//   The item contract (authoritative) gives EXACT code: `if (retries >= config.rewind.maxRetriesPerPrompt)`.
//   countRetriesAtLatestPrompt counts PRIOR mulligan:rewind markers after the latest user prompt (the current
//   rewind is NOT yet persisted at the guard point). So with default budget 5:
//     rewind 1 → retries=0 → 0>=5? no → SUCCEED (now 1 marker)
//     rewind 2 → retries=1 → SUCCEED ... rewind 5 → retries=4 → SUCCEED (now 5 markers)
//     rewind 6 → retries=5 → 5>=5? YES → REFUSE, text "Mulligan: refused — hit the per-prompt retry budget
//                                                                   (5/5 rewinds ...). ..."
//   i.e. 5 succeed, 6TH refuses, refusal reads "5/5". This is SELF-CONSISTENT (budget fully consumed = 5/5).
//   E22 acceptance (a) literally says "first maxRetriesPerPrompt−1 succeed; Nth==budget refuses" → 4 succeed
//   / 5th refuses / "4/5". DO NOT "fix" the contract to match acceptance (a) — implement `>=` exactly as
//   specified. The P4.M1.T3.S1 test must assert the implemented (5 succeed / 6th refuses / "5/5") boundary.

// CRITICAL #2 — the latest-user-message entry: role lives under `.message.role`, NOT on the entry top level.
//   A user-prompt entry is `{ type:"message", id, message:{ role:"user", content:... } }`. So the detection is
//   `(e as any).type === "message"` AND the role is read off `(e as any).message?.role === "user"`. A
//   type:"message" entry whose message.role !== "user" (e.g. assistant/toolResult) is NOT a prompt. Mirror the
//   cautious cast style of countRewindMarkers (`(e as { type?: unknown }).type === ...`).

// CRITICAL #3 — countRetriesAtLatestPrompt MUST be defensively self-contained (E13).
//   Do NOT rely on rewindExecute's single outer try/catch. Wrap getEntries() in try/catch → return 0; guard
//   Array.isArray; wrap each per-entry access in try/catch → skip. This is the EXACT shape of countRewindMarkers
//   (the shipped, unit-tested sibling). The contract: "the helper MUST be defensive itself (E13 hot-path)".

// CRITICAL #4 — refusal() adds the prefix AND the trailing period. Pass a reason with NO trailing period.
//   The reason string ends with "...instead of rewinding again" (no "."). refusal() produces
//   `Mulligan: refused — ${reason}.`. Do NOT add your own period.

// GOTCHA #5 — the guard runs BEFORE step 5 (preview) and BEFORE step 6 (persist). So on refusal NOTHING is
//   persisted (no marker, no note) — `appendRewindMarker` / `leaveNote` are never reached. This satisfies
//   E22 "refuse *before persisting*" and E22 acceptance (the marker count never grows on a refused call).
//   Place the guard AFTER the maxDepth guard (which also refuses before persisting) — both must run in
//   order; maxDepth is the cumulative cap, the retry budget is the per-prompt cap. They are independent:
//   whichever fires first wins. (The context-fraction stop, P4.M1.T2.S2, will go in this same neighborhood
//   as a third independent guard — leave room; do not implement it here.)

// GOTCHA #6 — `granularity` and `config` are ALREADY in scope inside rewindExecute. The function declares
//   `const granularity: Granularity = ...` at its top and `const config = getConfig();` at step 1. Reference
//   them directly; do not re-declare.

// GOTCHA #7 — zero-hide rewinds count automatically (no special-case). A K=0 rewind still reaches step 7 and
//   persists a mulligan:rewind marker (K=0 is just reported honestly in the success text). So countRetriesAtLatest
//   Prompt counts it like any other marker. The contract: "do NOT special-case it — it is the canonical loop
//   vector". Do not add any K-aware branch.

// GOTCHA #8 — countRetriesAtLatestPrompt is NOT exported. It is module-local (like countRewindMarkers,
//   checkpointExists, resolvePreview). The downstream test exercises it via the tool's execute path (script
//   getEntries() entries, call the tool, assert the refusal text), NOT by importing the helper. Do not export it.

// LIBRARY QUIRK — vitest does NOT type-check (esbuild transpile only). `npm test` passing does NOT prove
//   types. Run `npx tsc --noEmit` explicitly to gate types. package.json has no tsc script — call it directly.
```

## Implementation Blueprint

### Data models and structure

No data-model change. The helper is a pure `(ctx: ExtensionContext) => number`. It reads the already-shipped
`config.rewind.maxRetriesPerPrompt` (number, default 5). The guard returns an `AgentToolResult<RewindDetails>`
via the existing `refusal(reason, granularity)` builder. No new types, no new exports.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/tools/rewind.ts — ADD module-local `countRetriesAtLatestPrompt(ctx)` helper
  - FIND: the END of the `countRewindMarkers` function. Its exact closing lines are:
        } catch {
          // a throwing-Proxy entry → skip (never throw on the tool hot path)
        }
      }
      return count;
    }
    followed immediately by the `/** checkpointExists — ... */` JSDoc comment.
  - INSERT, BETWEEN countRewindMarkers's closing `}` and the checkpointExists JSDoc, this function:
    (see "Implementation Patterns & Key Details" below for the VERBATIM body to paste)
  - NAMING: countRetriesAtLatestPrompt (camelCase, matches countRewindMarkers). Module-local (NO export).
  - PLACEMENT: directly after countRewindMarkers — they are the defensive-scan family (depth count vs
    per-prompt-retry count). Keeps related code together.
  - DEFENSIVE: mirror countRewindMarkers EXACTLY for the getEntries/Array.isArray/per-entry-try-catch shape;
    ADD an index walk (see pattern). Returns 0 on: throwing getEntries, non-array, no user-message entry,
    any per-entry throw.
  - JSDoc/comment MUST document: (a) it is the E22 per-prompt retry-budget counter; (b) it finds the LAST
    type:"message"+message.role:"user" entry and counts mulligan:rewind markers AFTER it; (c) the v1
    entry-position OVER-APPROXIMATION note (counts a last_tool_call_group/checkpoint rewind issued this turn
    even if its target was a prior turn's group — the spec's intent to arrest the loop is met; message-list
    resolution is a future refinement); (d) never throws (E13).

Task 2: EDIT src/tools/rewind.ts — ADD the (4b) per-prompt retry-budget guard block in rewindExecute
  - FIND: the maxDepth guard block, whose exact text is:
        // (4) depth guard (step 4; E4). Markers are permanent → ALL persisted rewind markers count toward maxDepth.
        const depth = countRewindMarkers(ctx);
        if (depth >= config.rewind.maxDepth) {
          return refusal(
            `max rewind depth (${config.rewind.maxDepth}) reached — ${depth} active rewind marker(s). Consider mulligan_shrink or just continuing; if stuck in a loop, the human should intervene`,
            granularity,
          );
        }
    followed by a blank line then:
        // (5) read-only ledger + K preview (step 5; best-effort — GOTCHA #6). ...
  - INSERT, BETWEEN the maxDepth guard's closing `}` and the `(5) read-only ledger` comment, this block:
        // (4b) per-prompt retry budget (step 4; E22 hard backstop #1). The marker-counting budget: count
        //     mulligan:rewind markers appended AFTER the latest user-prompt entry (rewinds re-landing at this
        //     prompt). Refuse BEFORE persisting when the count reaches the budget — a self-authored note can
        //     re-instruct the loop's cause, so the note cannot self-correct; only a hard count can arrest it.
        //     Independent of the maxDepth cumulative cap (4) and the context-fraction stop (4c, P4.M1.T2.S2):
        //     all three apply; first refusal wins. countRetriesAtLatestPrompt is defensive (never throws — E13).
        const retries = countRetriesAtLatestPrompt(ctx);
        if (retries >= config.rewind.maxRetriesPerPrompt) {
          return refusal(
            `hit the per-prompt retry budget (${retries}/${config.rewind.maxRetriesPerPrompt} rewinds re-landing at this prompt). Commit to the current state, ask the human, or use mulligan_shrink instead of rewinding again`,
            granularity,
          );
        }
  - VERIFY the reason string is VERBATIM (no trailing period — refusal() adds it). The template literal embeds
    `${retries}` and `${config.rewind.maxRetriesPerPrompt}` (both in scope: `retries` just declared, `config`
    from step 1, `granularity` from the function top).
  - PRESERVE: the maxDepth guard above it, the `(5) read-only ledger` block below it, and the single outer
    try/catch around the whole rewindExecute body (do NOT add a second try/catch — the helper is defensive
    itself and the body's catch is the last-resort E13 net).
  - DO NOT implement the (4c) context-fraction stop here — that is P4.M1.T2.S2. Leave the (4c) spot free
    (it will insert between this (4b) block and the (5) comment in its own task).

Task 3: VERIFY (no edit) — type-check + full suite green
  - RUN: `npx tsc --noEmit` (expect zero errors — the edits are additive; no type change).
  - RUN: `npm test` (expect zero failures — see research/findings.md §6 proof that no existing test places a
    user-message entry in getEntries() with rewind markers after it, so countRetriesAtLatestPrompt returns 0
    for all existing tests and the new guard never fires on them).
```

### Implementation Patterns & Key Details

```ts
// ── countRetriesAtLatestPrompt — VERBATIM body to paste after countRewindMarkers (Task 1) ──
// Mirrors countRewindMarkers' defensive shape; ADDS an index walk to scope the count to rewinds AFTER the
// latest user-prompt entry. The role read is off `.message.role` (NOT the entry top level) — see GOTCHA #2.
//
//   ALGORITHM (the v1 entry-position over-approximation that catches the canonical last_turn loop vector,
//   needs no message-list resolution, and passes §1.10 acceptance):
//     1. try { entries = ctx.sessionManager.getEntries(); } catch { return 0; }
//     2. if (!Array.isArray(entries)) return 0;
//     3. walk entries IN ORDER; record the INDEX of the LAST entry that is type:"message" with
//        message.role:"user" (the latest user prompt). If none, return 0 (no prompt → no budget consumption).
//     4. count entries at index > that index where type==="custom" && customType==="mulligan:rewind"
//        (rewind markers appended after the latest user message = rewinds during this turn that re-land
//        at the prompt). Per-entry access wrapped in try/catch (mirrors countRewindMarkers — E13).
//
//   OVER-APPROXIMATION (v1): for last_tool_call_group/checkpoint rewinds this counts a rewind issued THIS
//   turn even if its resolved target was a PRIOR turn's group (the marker is appended at the end regardless).
//   The spec's intent — arrest the same-prompt loop — is met; precise message-list resolution (excluding a
//   tool-group rewind whose target precedes the latest prompt) is a future refinement. Advancing to a new
//   user prompt naturally resets the count (the new prompt becomes the latest → prior rewinds are before it).

function countRetriesAtLatestPrompt(ctx: ExtensionContext): number {
  let entries: unknown;
  try {
    entries = ctx.sessionManager.getEntries();
  } catch {
    return 0; // never let the retry-budget guard throw (E13)
  }
  if (!Array.isArray(entries)) return 0;

  // Find the INDEX of the LAST user-prompt entry (type:"message" with message.role:"user").
  let latestPromptIndex = -1;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
    try {
      const ee = e as { type?: unknown; message?: { role?: unknown } };
      if (ee.type === "message" && ee.message?.role === "user") latestPromptIndex = i;
    } catch {
      // a throwing-Proxy entry → skip (never throw on the tool hot path)
    }
  }
  if (latestPromptIndex === -1) return 0; // no user prompt → no budget consumption

  // Count mulligan:rewind markers appended AFTER the latest user prompt.
  let count = 0;
  for (let i = latestPromptIndex + 1; i < entries.length; i++) {
    const e = entries[i];
    if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
    try {
      const ee = e as { type?: unknown; customType?: unknown };
      if (ee.type === "custom" && ee.customType === "mulligan:rewind") count++;
    } catch {
      // a throwing-Proxy entry → skip (never throw on the tool hot path)
    }
  }
  return count;
}

// ── The guard block — VERBATIM (Task 2) — placed after the maxDepth guard, before step 5 ──
// (see Implementation Tasks Task 2 for the exact insertion + the reason string)

// ── What NOT to do ──
// ✗ Do NOT change the refusal boundary to `retries >= maxRetriesPerPrompt - 1` to match E22 acceptance (a).
//   The contract specifies `>=`. See Known Gotchas #1 / research/findings.md §7.
// ✗ Do NOT read role off the entry top level — it is under `.message.role`. See GOTCHA #2.
// ✗ Do NOT add a second try/catch around the guard in rewindExecute — the helper is defensive itself and
//   the body's single outer try/catch is the E13 last resort.
// ✗ Do NOT export countRetriesAtLatestPrompt — it is module-local (exercised via the tool execute path).
// ✗ Do NOT special-case zero-hide rewinds — they persist a marker and count naturally. See GOTCHA #7.
// ✗ Do NOT implement the (4c) context-fraction stop — that is P4.M1.T2.S2.
// ✗ Do NOT write tests here — the loop-driving matrix is P4.M1.T3.S1.
```

### Integration Points

```yaml
CONFIG (READ-ONLY here — P4.M1.T1.S1 already shipped the knob):
  - The guard reads `config.rewind.maxRetriesPerPrompt` off the `config` already fetched at rewindExecute
    step 1 (`const config = getConfig();`). No wiring change. No new config field.

PERSISTENCE (the whole point of placing the guard before step 5/6):
  - On refusal: `appendRewindMarker` / `leaveNote` (step 6/7) are NEVER reached → no marker, no note,
    no in-memory seq increment. The branch marker count does not grow on a refused call. This is what
    makes the budget a true hard backstop (the loop cannot grow the session past the budget).

TESTS (NOT this task — consumed downstream):
  - P4.M1.T3.S1 will drive a loop (interleave a user-message entry + N rewindEntry()s in makeCtx entries,
    call the tool N+1 times, assert the 6th refuses with "5/5" text; then add a new user-message entry and
    assert the budget resets). This task only ensures the helper + guard exist for that test to exercise.
  - P4.M1.T2.S3 (suppress drift nudge on a refused turn) consumes the fact that a refusal is returned.

DOCS (Mode A — no external doc surface):
  - The refusal text IS the agent-facing documentation. spec/08, spec/05, spec/09, README: UNCHANGED.
```

## Validation Loop

### Level 1: Syntax & Type (Immediate Feedback)

```bash
# TypeScript strict type-check. vitest does NOT type-check; run tsc explicitly.
# (package.json has no `tsc` script — call it directly.)
npx tsc --noEmit
# Expected: zero errors. The edits are additive (a new module-local function + a new guard block that
# reuses existing in-scope vars). countRetriesAtLatestPrompt takes ExtensionContext (already imported)
# and returns number; refusal() and config.rewind.maxRetriesPerPrompt already exist. If tsc errors on a
# stale reference, re-check that `granularity`/`config`/`ctx` are the exact names in rewindExecute.

# (No formatter/linter configured in package.json — skip ruff/eslint/prettier equivalents.)
```

### Level 2: Unit Tests (Regression — this task writes NO new tests)

```bash
# Confirm the new guard does not break ANY existing test. Per research/findings.md §6, no existing test
# places a user-message entry in the getEntries() entries array with rewind markers after it, so
# countRetriesAtLatestPrompt returns 0 for every existing test and the guard never fires on them.
npx vitest run test/tools/rewind.test.ts   # the tool's own suite (all green)
npm test                                   # == `vitest run` — the WHOLE suite (all green)
# Expected: zero failures. If a failure appears, it is almost certainly a test that DID put a user-message
# entry in getEntries() entries — re-read it; the guard correctly fires there (count rewinds after the
# prompt). If that test asserts success, the test's entries must be adjusted (but per research, none do).
```

### Level 3: Behavioral spot-check (no harness — confirms the boundary manually)

```bash
# This task ships no test, so the authoritative boundary confirmation is the downstream P4.M1.T3.S1 test.
# A quick manual reasoning check (documented for the implementer):
#   budget = config.rewind.maxRetriesPerPrompt = 5 (default)
#   entries at a stuck prompt (after 5 successful rewinds):
#     [ {type:"message",message:{role:"user",...}},           <- latestPromptIndex = 0
#       rewindEntry(1), rewindEntry(2), rewindEntry(3),
#       rewindEntry(4), rewindEntry(5) ]                       <- 5 markers after the prompt
#   countRetriesAtLatestPrompt → 5   →   5 >= 5  →  REFUSE, text "...per-prompt retry budget (5/5 ...)."
# After advancing to a NEW user prompt (a new type:"message" role:"user" entry appended):
#   latestPromptIndex moves to the new entry; the 5 prior rewind markers are now BEFORE it → count 0 → succeeds.
```

### Level 4: E13 / Defensive Validation (the never-throws invariant)

```bash
# The new helper must never throw — even on a throwing getEntries() / throwing-Proxy entry / non-array.
# The existing "never throws" test in test/tools/rewind.test.ts (~line 643: "a THROWING getEntries (depth
# guard) → execute resolves to a text result, no throw") exercises the SAME getEntries() surface. Because
# countRetriesAtLatestPrompt wraps getEntries() identically (try/catch → return 0), the rewind tool still
# resolves to a text result and never throws. Confirm that test still passes:
npx vitest run test/tools/rewind.test.ts -t "never throws"
# Expected: passes. (The helper's own try/catch returns 0 on a throwing getEntries; the guard then sees
# retries=0 < budget → proceeds normally. The execute body's outer try/catch is the last-resort E13 net.)
```

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` passes (zero errors).
- [ ] `npm test` passes (zero failures across the whole suite).
- [ ] `npx vitest run test/tools/rewind.test.ts` passes in isolation.
- [ ] The "never throws" E13 test still passes (helper is defensively self-contained).

### Feature Validation
- [ ] `countRetriesAtLatestPrompt(ctx)` exists, is module-local, placed after `countRewindMarkers`.
- [ ] It finds the LAST `type:"message"` + `message.role:"user"` entry and counts `mulligan:rewind` markers AFTER it; returns 0 when no user-prompt entry exists.
- [ ] It is defensively self-contained (try/catch around getEntries, Array.isArray guard, per-entry try/catch, returns 0 on any failure) — never throws.
- [ ] Its JSDoc documents the v1 entry-position over-approximation (tool-group/checkpoint rewinds issued this turn count even if their target was a prior turn).
- [ ] `rewindExecute` has the (4b) guard AFTER the maxDepth guard and BEFORE step 5; it calls `refusal(...)` with the VERBATIM reason (no trailing period) when `retries >= config.rewind.maxRetriesPerPrompt`.
- [ ] On refusal NOTHING is persisted (the guard precedes the preview + persist steps).
- [ ] The boundary is `>=` (5 succeed / 6th refuses / "5/5" at default budget 5) — matches the contract code exactly (NOT acceptance (a)'s literal count).
- [ ] spec/08-edge-cases.md, spec/05-tools.md, spec/09-configuration.md, and README.md are UNCHANGED.

### Code Quality Validation
- [ ] `countRetriesAtLatestPrompt` mirrors the shipped `countRewindMarkers` defensive-scan conventions (same cast style, same try/catch comments).
- [ ] The guard block matches the existing refusal-block style (comment citing the spec section + E-number, `return refusal(...)`).
- [ ] No new exports, no new types, no new imports, no second try/catch in the execute body.
- [ ] Zero-hide rewinds are NOT special-cased (they count naturally).

### Documentation & Scope Boundaries
- [ ] The refusal text is the agent-facing doc (Mode A).
- [ ] No config change (P4.M1.T1.S1 already shipped the knob).
- [ ] No (4c) context-fraction stop implemented (P4.M1.T2.S2).
- [ ] No drift-nudge suppression (P4.M1.T2.S3).
- [ ] No loop-driving test matrix (P4.M1.T3.S1) — only the helper + guard.

---

## Anti-Patterns to Avoid

- ❌ Don't change the refusal boundary to satisfy E22 acceptance (a)'s literal "budget−1 succeed" — implement the contract's `retries >= config.rewind.maxRetriesPerPrompt` exactly (5 succeed / 6th refuses / "5/5"). The acceptance (a) wording is off-by-one relative to the contract's self-consistent code; the test task reconciles to the implemented boundary.
- ❌ Don't read `role` off the entry top level — a user-prompt entry is `{type:"message", message:{role:"user",...}}`; the role is under `.message.role`.
- ❌ Don't make `countRetriesAtLatestPrompt` rely on the execute body's outer try/catch — it must be defensively self-contained (E13 hot-path), exactly like `countRewindMarkers`.
- ❌ Don't add a trailing period to the refusal reason — `refusal()` appends the `.`.
- ❌ Don't special-case zero-hide rewinds — they persist a marker and count naturally.
- ❌ Don't export `countRetriesAtLatestPrompt` — it is module-local (exercised via the tool execute path).
- ❌ Don't implement the (4c) context-fraction stop (P4.M1.T2.S2) or write the loop-driving tests (P4.M1.T3.S1) — out of scope.
- ❌ Don't trust `npm test` alone for type correctness — vitest uses esbuild and does not type-check; run `npx tsc --noEmit`.

---

**Confidence Score: 9.5/10** for one-pass implementation success. The change is tiny (one ~30-line defensive helper + one ~6-line guard block, both with verbatim code given), every edit anchor is quoted exactly, the sibling to mirror (`countRewindMarkers`) is quoted verbatim, the config knob is confirmed already shipped, and the existing-tests-won't-break claim is proven. The 0.5 deduction is for the genuine off-by-one between the contract's `>=` code and E22 acceptance (a)'s literal count — this PRP resolves it for the IMPLEMENTER (implement the contract verbatim) and flags it loudly for the downstream TEST task (P4.M1.T3.S1), but one-pass success for the whole feature still depends on that test task reading this flag rather than copy-pasting acceptance (a)'s count.