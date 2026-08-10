# pi-mulligan — Validation Report

**Validator pass date:** 2026-08-10 · **Target:** Pi `0.84.1` · **Repo:** `/home/dustin/projects/pi-mulligan`

## Executive summary

The codebase is **high-quality and the automated gates are fully green**:

- **Type check:** `tsc --noEmit` (strict + skipLibCheck) — **exit 0**, clean.
- **Unit tests:** `npm test` — **943 / 943 passed** across 21 files (incl. the pairing-invariant property tests, the retry-budget / context-fraction guards, and the `turnHasAdvanced` replay-loop regression).
- **Integration smoke:** `npm run smoke` — **14 / 14 scenarios passed** (9 `F-*` + 5 `E-*`) driven against the real `pi` binary.
- **Zero-config load:** `pi -e ./src/index.ts` loads cleanly with no `mulligan` config (spec/11 §2 Step 9 acceptance).
- **Nudge-leak invariant:** `0` persisted `mulligan:nudge` / `mulligan:high-water` entries across all smoke sessions (DoD #3).
- **Headline features verified live:** the bloat reminder (`tool_result` nudge), the per-turn drift nudge, and the high-water signal all fired correctly on large tool reads *during this validation session itself*. Rewind / shrink / cancel are exercised green by the smoke.

The architecture is sound: pure, Pi-free helpers (`transforms.ts` / `ledger.ts` / `tokens.ts` / `notes.ts`) hold ~all the correctness and are densely unit-tested; the Pi-coupled glue (`filter.ts` / `tools/*` / `nudges.ts`) is thin; every handler and tool body is `try/catch`-wrapped (fail-open, E13). The retry-budget + context-fraction + max-depth backstops (spec/08 E22) are all implemented and tested.

**However**, a targeted code review + manual E2E simulation uncovered **one genuine functional bug cluster** (in a documented low-value feature) plus a few minor hygiene items. They are **not caught by the automated gates** because the relevant code path has only a single-entry unit test that masks it and the smoke asserts the wrong invariant.

---

## Issues found

### 1. [MAJOR] Checkpoint "auto-expiry on consumption" is non-functional (two compounding defects)

**Spec violated:** `spec/05-tools.md` §3 step 5 ("Auto-expiry on consumption (REQUIRED)") and `spec/10-testing.md` §2.1 `F-checkpoint` acceptance ("a second rewind to "x" refuses (not found) unless re-created"; "`mulligan_audit` no longer lists it active").

A checkpoint is supposed to be **consumed** the moment a `mulligan_rewind(granularity:"checkpoint", checkpoint:"<name>")` targets it: its label is cleared so `mulligan_audit` stops listing it and a second rewind by the same name refuses. This does **not** happen in production. Two independent defects:

#### 1a. The consumption clear is never reached (`src/tools/rewind.ts`, step 7b)

The checkpoint-label-clear loop (`rewind.ts` ~lines 577–590) has an **unconditional `break`** as the last statement of the `for` loop body:

```ts
for (const e of entries) {
  if (typeof e !== "object" || e === null || Array.isArray(e)) continue;   // ← only these `continue`
  try { /* compute isMatch / targetId */ } catch { continue; }
  if (isMatch && typeof targetId === "string" && targetId.length > 0) {
    pi.setLabel(targetId, undefined);
  }
  break;   // ← BUG: unconditional, runs after the FIRST valid object entry only
}
```

Because `getEntries()` returns entries in **append order** and the checkpoint label is created mid-session (after at least the original user message), the label is essentially **never** the first object entry. The loop inspects `entries[0]` (e.g. a user message), `isMatch` is false, the `if` is skipped, and `break` exits — so `setLabel(targetId, undefined)` is never called.

- **Reproduced** with a realistic multi-entry fixture (`[user, assistant, toolResult, <checkpoint label>, …]`): the rewind SUCCEEDS ("rewound checkpoint. 3 messages will be hidden") but `setLabel` records **0 calls**.
- **Confirmed in production:** the `F-checkpoint` smoke session JSONL (`…smoke-F-checkpoint-….jsonl`) contains exactly **1** `mulligan:rewind` marker **and** the checkpoint label still intact (`{"type":"label","targetId":"…","label":"mulligan:checkpoint:alpha"}`) — i.e. the clear never ran.
- **Why the suite missed it:** the unit test `test/tools/rewind.test.ts:1119` (scenario (a)) uses `entries: [checkpointLabelEntry("anchor")]` — a **single-element** array where the label *is* first, so the `break` happens to work. The smoke `assertCheckpoint` asserts `countLabel(entries, "mulligan:checkpoint:alpha") >= 1` (label **exists**) but never asserts it is **cleared** after consumption.

#### 1b. The clear checks scan raw entries, not Pi's latest-wins label map (`audit.ts` + `rewind.ts`)

**Even if 1a is fixed**, consumption still wouldn't be reflected. Pi stores labels **append-only** in the raw entry stream: a `setLabel(targetId, undefined)` appends a `{type:"label", targetId, label:undefined}` entry, and `_buildIndex` (in Pi's `session-manager.js`) deletes the target from its in-memory `labelsById` map when it sees a falsy `label`. **`getLabel(targetId)`** correctly returns `undefined` — but Mulligan never uses `getLabel`. Instead:

- `listCheckpoints` (`src/tools/audit.ts`) scans **all** raw entries for `type === "label" && typeof label === "string" && label.startsWith("mulligan:checkpoint:")`.
- `checkpointExists` (`src/tools/rewind.ts`) scans **all** raw entries for `type === "label" && label === needle`.

Both find the **historical string label entry**, which persists in the raw stream alongside the clear entry.

- **Reproduced:** `listCheckpoints([{type:"label",targetId:"m1",label:"mulligan:checkpoint:alpha"}, {type:"label",targetId:"m1",label:undefined}])` returns `["alpha"]` instead of `[]`.

**Net consequence:** a consumed checkpoint stays listed in `mulligan_audit`, and a second `mulligan_rewind(granularity:"checkpoint", checkpoint:"x")` **re-targets the stale checkpoint** instead of refusing "not found" — directly violating the `F-checkpoint` acceptance criterion.

**Suggested fix direction (for the fixer):**
1. Move the `break` *inside* the `if (isMatch …)` block (or remove it and `break` only after a successful clear).
2. Resolve checkpoints via Pi's latest-wins map (`ctx.sessionManager.getLabel(id)`) instead of scanning raw `getEntries()` for any string match — i.e. walk entries, and for each candidate `label` target call `getLabel(targetId)` to decide whether it's *currently* active. (Equivalently: maintain a `Set<targetId>` of cleared targets from the falsy-label entries and subtract.)
3. Add a regression test with a **realistic multi-entry** session that asserts (a) the label is cleared, (b) `listCheckpoints` drops it, and (c) a second checkpoint rewind refuses.

**Severity context:** the checkpoint feature is itself documented as low-value / near-zero spontaneous adoption (`spec/05` §3 design note; `spec/08` E23 — "exposed to the wrong actor"), and v1 explicitly does **not** depend on it for correctness (the per-prompt retry budget is the real backstop). So the real-world impact is limited, but it is a confirmed deviation from a `REQUIRED` spec step and an explicit acceptance criterion.

---

### 2. [MINOR] No LICENSE file

`README.md` §8 declares the project **MIT** and states "Adding a top-level `LICENSE` file with the MIT text is recommended but not yet present in this repo." Confirmed: no `LICENSE` / `LICENSE.md` / `COPYING` exists at the repo root. Adding the standard MIT text closes this.

### 3. [MINOR] No automated lint / style gates

The repo has **no** eslint, prettier, or editorconfig config (Phase 1 and Phase 3 of `validate.sh` are correctly skipped as N/A). Code style is consistent by manual discipline (and the diff is clean), but there is no CI-enforced formatter/linter to prevent drift. `package.json` defines only `test`, `smoke`, `typecheck`. Optional hygiene improvement; not a functional issue.

### 4. [MINOR] `VERIFICATION.md` contains stale references

`VERIFICATION.md` (a historical process artifact, not a user-facing deliverable) references a "**12-knob** table" and "**the four tools**". The actual configuration surface is **20 knobs** (README §3 table, verified against `DEFAULT_CONFIG` in `src/config.ts`) and there are **5** agent-callable tools (`rewind`, `shrink`, `checkpoint`, `audit`, `cancel` — `grep -c registerTool src/index.ts` → 5). The README is correct; only the stale internal doc drifts. Consider deleting or updating `VERIFICATION.md`.

### 5. [MINOR] Test-gap that masked Issue #1

Neither test tier exercises checkpoint consumption against a realistic session:
- The unit test (`test/tools/rewind.test.ts:1115`) uses a 1-element `entries` array, which masks defect 1a.
- The smoke `assertCheckpoint` asserts the checkpoint label **exists** after the rewind (`countLabel >= 1`) but never asserts it is **cleared**, and never asserts a second rewind refuses.

The drift-nudge windowing (`spec/07` §5.1) and high-water signal (§5.2) are likewise only **soft**-asserted in the smoke (`⚠ SOFT: … model-driven`); they are unit-tested but not hard-asserted at integration. Closing this gap (multi-entry consumption test + hard smoke assertions for the nudge refinements) would have caught Issue #1 and would protect the nudge refinements.

---

## What works well (for confidence)

- **Soft-delete / audit-trail guarantee holds:** hidden content remains on disk and visible in `/tree` (verified by smoke JSONL — `mulligan:rewind`/`mulligan:shrink` are `custom` control entries, never `custom_message`; originals persist).
- **Fail-open is thorough:** an intentional malformed-marker smoke scenario (`F-failopen`) passes — the filter passes through and the turn survives (10 dedicated fail-open unit tests green).
- **Loop backstops present and tested:** per-prompt retry budget (`maxRetriesPerPrompt`), out-of-band context-fraction stop (`abortContextFraction`), and `maxDepth` are all implemented in `tools/rewind.ts` and unit-tested (including the zero-hide-loop and same-prompt vectors from `spec/08` E22).
- **Pinning fix for the historical BUG-001/002 replay loop** (`hideEntryIds` + `resolvePinnedHide` + the `turnHasAdvanced` legacy gate) is in place and regression-tested (`test/bug-replay-repro.test.ts`).
- **Marker retraction (`mulligan_cancel`)** works by both target-hint and explicit `markerId` (spec/08 E21), with idempotent no-ops and stale/cap auto-retirement.
- **`config.enabled = false`** makes the extension a clean no-op (5 master-switch gates verified by inspection: `filter.ts`, `rewind.ts`, `shrink.ts`, `nudges.ts` ×2; `audit`/`checkpoint` intentionally always-on).
- **Zero-config** load and operation confirmed.

---

## Reproduction artifacts

- The two checkpoint-consumption reproductions were run as temporary `test/_tmp_repro{1,2}.test.ts` files inside the repo and **deleted immediately after** (no repo changes left behind). Their logic is documented inline above for the fixer to re-create.
- All commands used are captured in `validate.sh` and the `/tmp/mulligan-validate-*.log` outputs.

## Verdict

**Issues found: 5** (1 Major-in-a-low-value-feature functional bug cluster + 4 Minor hygiene/doc/test-gap items). The automated validation gates are all green; the product's headline capabilities (rewind, shrink, cancel, both nudges, audit) are functional end-to-end. The checkpoint auto-expiry feature is broken and should be fixed before relying on it, but it is not on the v1 correctness path.