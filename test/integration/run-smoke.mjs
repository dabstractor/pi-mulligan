/**
 * run-smoke.mjs — Mulligan integration smoke orchestrator (plain Node ESM, NOT type-checked).
 *
 * For each F-* scenario in SCENARIOS:
 *   1. Set MULLIGAN_SMOKE_LOG to a per-scenario path under a temp dir.
 *   2. Spawn `pi -e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-<scenario>-<RUN_ID>
 *      (RUN_ID is unique per `npm run smoke` invocation — see below — so the session JSONL never accumulates
 *      prior runs; F-reload/E11 share it across their two spawns WITHIN one run).
 *      -p "/mulligan_smoke <scenario>" -p "Reply with exactly: OK"`.
 *      ─ The FIRST prompt dispatches the deterministic command (sets up markers via the REAL tools).
 *      ─ The SECOND prompt triggers the observing model turn (fires context → the filter runs → smoke logs
 *        context.fire; and the model reply persists the session JSONL for the §2.3 assertions).
 *   3. Parse the smoke JSONL log (the PRIMARY assertion source) +, when available, the session JSONL.
 *   4. Run the scenario's assertion function; print PASS/FAIL.
 *   5. F-reload = TWO spawns sharing --session-id smoke-F-reload-<RUN_ID>.
 *
 * Exits 0 if all scenarios pass, 1 otherwise. Detects "EXTENSION LOAD FAILED" (non-zero pi exit + empty
 * smoke log → src/index.ts failed to load; GOTCHA #12) distinctly from a scenario-assertion failure.
 *
 * DESIGN: shell-like glue. Defensive (handles missing files, empty logs, non-zero pi exits, model timeouts).
 * The deterministic command path persists markers BEFORE any model call, so the core assertions hold even
 * when the model times out (the session JSONL may be missing on a timeout — those assertions are skipped
 * with a note; the smoke log is always available).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SCENARIOS = [
  "F-rewind-core",
  "F-shrink-persist",
  "F-shrink-preventive",
  "F-nudge-drift",
  "F-protected",
  "F-maxdepth",
  "F-checkpoint",
  "F-ckptcmd",
  "F-banner",
  "F-consent",
  "F-drift-userexempt",
  "F-useraudit",
  "F-failopen",
  "F-reload",
  // Edge cases (spec/08 E7/E11/E12/E15/E20 — Pi-dependent; added by P1.M7.T3.S1).
  "E7",
  "E11",
  "E12",
  "E15",
  "E20",
];

const SMOKE_TMP_DIR = join(tmpdir(), "mulligan-smoke");
mkdirSync(SMOKE_TMP_DIR, { recursive: true });
const PI_TIMEOUT_MS = 120_000;

// RUN_ID — a per-invocation suffix appended to every scenario's --session-id (FINDING 1 fix). It is stable FOR
// THE DURATION of one `npm run smoke` (module load) so the two spawns of F-reload/E11 share a session, but UNIQUE
// across invocations so the session JSONL never accumulates prior runs' seed replies / markers. This makes the
// suite IDEMPOTENT (re-running `npm run smoke` no longer flakes F-rewind-core / F-checkpoint with false
// "LEAKED BACK" / "seed LEAKED" failures from unpinned leftover seed replies).
const RUN_ID = `${process.pid}-${Date.now().toString(36)}`;

// SEED-canary string literals for the deterministic HIDING assertions (P1.M3.T2.S1). MUST be byte-identical to the
// consts in smoke.ts (GOTCHA #8 — there is no shared module; a mismatch → seed never matches → K=0 → fail).
const SEED_ANCHOR = "MULLIGAN-SMOKE-SEED-ANCHOR";
const SEED_HIDDEN = "MULLIGAN-SMOKE-SEED-HIDDEN";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * runPi — spawn pi for a scenario. Returns { status, stdout, stderr, logPath }. By default it drives the
 * 2-prompt deterministic flow (`/mulligan_smoke <scenario>` then `Reply with exactly: OK`); pass { prompts } to
 * drive a custom prompt sequence (the SEED flows for F-rewind-core / F-checkpoint — P1.M3.T2.S1).
 */
function runPi(scenario, { prompts, extraArgs = [] } = {}) {
  const logPath = join(SMOKE_TMP_DIR, `${scenario}.log`);
  // Default = the existing 2-prompt deterministic flow (unchanged for the 12 non-seeded scenarios).
  const ps = prompts ?? [`/mulligan_smoke ${scenario}`, "Reply with exactly: OK"];
  const argv = [
    // -ne: disable extension discovery so globally-installed mulligan variants can't collide with
    // our explicitly -e-loaded tools (M-1). Explicit -e paths still load.
    "-ne",
    "-e", "./src/index.ts",
    "-e", "./test/integration/smoke.ts",
    // Run-scoped session id (RUN_ID): unique per `npm run smoke` invocation → no cross-run JSONL accumulation
    // (FINDING 1). F-reload/E11 share this id across their two spawns WITHIN one run (reloads reopen it).
    "--session-id", `smoke-${scenario}-${RUN_ID}`,
    ...ps.flatMap((p) => ["-p", p]),
    ...extraArgs,
  ];
  const res = spawnSync("pi", argv, {
    encoding: "utf8",
    env: { ...process.env, MULLIGAN_SMOKE_LOG: logPath },
    timeout: PI_TIMEOUT_MS,
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "", logPath };
}

/**
 * parseSmokeLog — read the smoke JSONL log; return { lines, contextFires, sessionFile }.
 * - lines: all parsed JSON lines (excluding the leading "# " comment header).
 * - contextFires: the parsed `detail` objects from context.fire lines.
 * - sessionFile: the sessionFile from the session.start line (for reading the session JSONL).
 */
function parseSmokeLog(path) {
  const result = { lines: [], contextFires: [], sessionFile: null };
  if (!existsSync(path)) return result;
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    try {
      const obj = JSON.parse(trimmed);
      result.lines.push(obj);
      if (obj.test === "context.fire") result.contextFires.push(obj.detail);
      if (obj.test === "session.start" && obj.detail?.sessionFile) {
        result.sessionFile = obj.detail.sessionFile;
      }
    } catch {
      /* skip unparseable lines */
    }
  }
  return result;
}

/**
 * readSessionEntries — read the session JSONL (one JSON object per line); return [] if missing/unreadable.
 */
function readSessionEntries(sessionFile) {
  if (!sessionFile || !existsSync(sessionFile)) return [];
  try {
    return readFileSync(sessionFile, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

/**
 * assert — collect a pass/fail. Returns true if cond is true.
 */
function assert(results, label, cond, detail) {
  results.push({ pass: !!cond, label, detail: detail ?? "" });
  return !!cond;
}

/**
 * countCustom — count session entries matching a customType (and optionally a data.kind).
 */
function countCustom(entries, customType, kind) {
  return entries.filter((e) => {
    if (e.type !== "custom" || e.customType !== customType) return false;
    if (kind !== undefined && e.data?.kind !== kind) return false;
    return true;
  }).length;
}

/**
 * countCustomMessage — count session entries of type custom_message with a customType.
 */
function countCustomMessage(entries, customType) {
  return entries.filter((e) => e.type === "custom_message" && e.customType === customType).length;
}

/**
 * countLabel — count session entries of type label with a given label prefix.
 */
function countLabel(entries, labelPrefix) {
  return entries.filter((e) => e.type === "label" && typeof e.label === "string" && e.label.startsWith(labelPrefix)).length;
}

/**
 * labelActive — Pi's LATEST-WINS label resolution applied to the raw entry stream (validation issue #1b/#5).
 * A `setLabel(id, undefined)` appends a `{type:"label", targetId, label:undefined}` clear entry; Pi's
 * `_buildIndex` then deletes the id from its in-memory map, so getLabel(id) returns undefined for a CONSUMED
 * checkpoint. We mirror that here: walk entries in order, keep the LAST `label` per targetId (undefined on a
 * clear), and return true iff SOME target's final value is exactly `label` (the checkpoint is still active).
 */
function labelActive(entries, label) {
  const latest = new Map();
  for (const e of entries) {
    if (e.type !== "label") continue;
    const id = e.targetId;
    if (typeof id !== "string" || id.length === 0) continue;
    latest.set(id, e.label); // last writer wins (undefined on a clear entry)
  }
  for (const v of latest.values()) {
    if (v === label) return true;
  }
  return false;
}

/**
 * hasText — true if any session entry's stringified form includes the needle (for "original canary still on disk").
 */
function entryIncludes(entries, needle) {
  return entries.some((e) => JSON.stringify(e).includes(needle));
}

/**
 * §2.3 global invariants — run for every marker-creating scenario. Asserts the entry-type rules + ZERO nudges.
 * Returns true if all hold.
 */
function assertGlobalInvariants(results, entries) {
  // mulligan:rewind / mulligan:shrink / mulligan:turn-metric must be type "custom"
  for (const ct of ["mulligan:rewind", "mulligan:shrink", "mulligan:turn-metric"]) {
    const bad = entries.filter((e) => e.customType === ct && e.type !== "custom");
    assert(results, `§2.3 ${ct} entries are type:custom`, bad.length === 0, bad.length ? `${bad.length} wrong-type` : "");
  }
  // mulligan:note must be type "custom_message"
  const badNotes = entries.filter((e) => e.customType === "mulligan:note" && e.type !== "custom_message");
  assert(results, "§2.3 mulligan:note entries are type:custom_message", badNotes.length === 0, badNotes.length ? `${badNotes.length} wrong-type` : "");
  // mulligan:checkpoint: labels must be type "label"
  const badLabels = entries.filter((e) => typeof e.label === "string" && e.label.startsWith("mulligan:checkpoint:") && e.type !== "label");
  assert(results, "§2.3 mulligan:checkpoint: labels are type:label", badLabels.length === 0, badLabels.length ? `${badLabels.length} wrong-type` : "");
  // ZERO mulligan:nudge entries (ephemeral — §2.3)
  const nudgeCount = entries.filter((e) => e.customType === "mulligan:nudge").length;
  assert(results, "§2.3 ZERO mulligan:nudge entries on disk", nudgeCount === 0, nudgeCount ? `${nudgeCount} found` : "");
}

/**
 * assertFlush — [v2.1 rewrite budget] assert the scenario drove an explicit queue→flush transition
 * (the ops queue INERT first; flushQueued() in smoke.ts activates them via the "audit" trigger).
 * Guards against the harness silently regressing back to inert-queue mode (all marker/hiding
 * assertions would then fail confusingly downstream).
 */
function assertFlush(results, smoke) {
  const flushLines = smoke.lines.filter((l) => l.test === "rewrite.flush");
  const last = flushLines[flushLines.length - 1];
  assert(
    results,
    "rewrite.flush activated the queued op (count≥1, ok)",
    !!last && last.status !== "fail" && last.detail?.count >= 1 && last.detail?.ok === true,
    JSON.stringify(last?.detail ?? "no rewrite.flush line"),
  );
}

// ── Per-scenario assertion functions ─────────────────────────────────────────

/**
 * Each assert function takes { smoke, piRes } where smoke = parseSmokeLog output, piRes = runPi result.
 * It pushes { pass, label, detail } entries to a local results array and returns { results, sessionEntries }.
 */

function assertRewindCore({ smoke, piRes }) {
  const results = [];
  const sessionFile = smoke.sessionFile;
  const entries = readSessionEntries(sessionFile);
  const rewindLines = smoke.lines.filter((l) => l.test === "tool.rewind");
  const lastRewind = rewindLines[rewindLines.length - 1];
  const text = lastRewind?.detail?.text ?? "";
  assert(results, "tool.rewind ran", rewindLines.length >= 1, rewindLines.length ? "" : "no tool.rewind line");
  assert(results, "tool.rewind succeeded (not refused)", lastRewind && !/refused/i.test(text), text.slice(0, 80));
  // NEW (P1.M3.T2.S1): the seed flow commits a hideable assistant reply BEFORE the command, so the rewind MUST pin
  // ≥1 message. K=0 means the seed did not commit (model timeout) OR the resolver found nothing — either way the
  // hiding assertion below is meaningless, so fail here with a clear message.
  assert(results, "tool.rewind hid content (K≥1; not '0 messages will be hidden')", !/0 messages will be hidden/i.test(text), text.slice(0, 80));
  // context.fire shows the filter sees the persisted marker + note.
  const cf = smoke.contextFires[smoke.contextFires.length - 1];
  assert(results, "context.fire observed", !!cf, cf ? "" : "no context.fire");
  assert(results, "context.fire hasRewindMarker:true", cf?.hasRewindMarker === true, String(cf?.hasRewindMarker));
  assert(results, "context.fire notePresent:true", cf?.notePresent === true, String(cf?.notePresent));
  assertFlush(results, smoke);
  // NEW: the seed reply MUST be hidden on the observing inference (BUG-001/002 regression guard). Read back the HARD
  // smokeLog verdict emitted by the context handler (GOTCHA #7 — logging alone does not fail a scenario).
  const hidingLines = smoke.lines.filter((l) => l.test === "F-rewind-core.hiding");
  const lastHiding = hidingLines[hidingLines.length - 1];
  assert(results, "seed reply HIDDEN on observing inference (BUG-001/002 guard)", lastHiding && lastHiding.status === "pass", JSON.stringify(lastHiding?.detail ?? {}));
  // JSONL: mulligan:rewind (custom) + mulligan:note (custom_message)
  if (entries.length > 0) {
    assert(results, "JSONL has mulligan:rewind (custom)", countCustom(entries, "mulligan:rewind", "rewind") >= 1, "");
    assert(results, "JSONL has mulligan:note (custom_message)", countCustomMessage(entries, "mulligan:note") >= 1, "");
    assertGlobalInvariants(results, entries);
  } else {
    console.log(`  ⚠ JSONL unavailable (model may have timed out) — smoke-log assertions are primary`);
  }
  return { results, entries }; // NOTE: no `soft` — hiding is now DETERMINISTIC (seed flow), not model-driven.
}

function assertShrinkPersist({ smoke, piRes }) {
  const results = [];
  const sessionFile = smoke.sessionFile;
  const entries = readSessionEntries(sessionFile);
  const shrinkLines = smoke.lines.filter((l) => l.test === "tool.shrink");
  assert(results, "tool.shrink ran", shrinkLines.length >= 1, "");
  // Setup guard: the setup turn (first -p prompt) must have committed a REAL mulligan_smoke_big toolResult
  // (RESULT_CANARY). If the model did not call the tool, the in-span shrink target does not exist and every
  // downstream assertion is meaningless — fail HERE with a message pointing at the setup turn, not the shrink.
  if (entries.length === 0 || !entryIncludes(entries, "MULLIGAN-SMOKE-RESULT-CANARY")) {
    assert(results, "setup turn committed mulligan_smoke_big toolResult (RESULT_CANARY)", false,
      "model did not call mulligan_smoke_big on the setup turn — re-run; see PRP Task 2b");
    return { results, entries };
  }
  // Success shrink: the current-turn variant ran and was NOT refused.
  const currentTurnLines = shrinkLines.filter((l) => l.detail?.variant === "current-turn");
  const currentTurn = currentTurnLines[currentTurnLines.length - 1];
  const currentTurnText = currentTurn?.detail?.text ?? "";
  assert(results, "current-turn shrink ran", !!currentTurn, "no variant:current-turn shrink line");
  assert(results, "current-turn shrink succeeded (not refused)", currentTurn && !/refused/i.test(currentTurnText), currentTurnText.slice(0, 80));
  // Refusal variant (replaces the MOOT E19 user-message case): an out-of-turn/no-match target must
  // hard-refuse end-to-end AND append nothing (no second mulligan:shrink marker).
  const refusalLines = shrinkLines.filter((l) => l.detail?.variant === "refusal");
  const refusal = refusalLines[refusalLines.length - 1];
  const refusalText = refusal?.detail?.text ?? "";
  assert(results, "out-of-turn shrink REFUSES (v2.0)", refusal && /refused/i.test(refusalText), refusalText.slice(0, 80) || "no variant:refusal shrink line");
  assert(results, "refusal text mentions 'previous turn'", /previous turn/i.test(refusalText), refusalText.slice(0, 80));
  // Two-signal persistence assertion on the observing fire (smoke loads SECOND → post-filter view):
  // the substitution IS present AND the original canary is NOT.
  const cf = smoke.contextFires[smoke.contextFires.length - 1];
  assert(results, "context.fire observed", !!cf, "");
  assert(results, "fire: substitution present AND original canary absent", cf?.shrunkInContext === true && cf?.resultCanaryPresent === false, JSON.stringify(cf ?? {}));
  assertFlush(results, smoke);
  // JSONL: mulligan:shrink (custom) count === the number of SUCCESSFUL shrink log lines (the refusal
  // appends NOTHING); the ORIGINAL canary still on disk (shrink is a view-substitution, NOT a rewrite).
  if (entries.length > 0) {
    const successCount = shrinkLines.filter((l) => !/refused/i.test(l.detail?.text ?? "")).length;
    const shrinkCount = countCustom(entries, "mulligan:shrink", "shrink");
    assert(results, "JSONL mulligan:shrink count === successful shrinks (refusal appended nothing)", shrinkCount >= 1 && shrinkCount === successCount, `markers=${shrinkCount} successful=${successCount}`);
    const originalOnDisk = entryIncludes(entries, "MULLIGAN-SMOKE-RESULT-CANARY");
    assert(results, "JSONL original canary still on disk (view-substitution, not rewrite)", originalOnDisk, "");
    assertGlobalInvariants(results, entries);
  } else {
    console.log(`  ⚠ JSONL unavailable (model may have timed out) — smoke-log assertions are primary`);
  }
  return { results, entries };
}

function assertShrinkPreventive({ smoke, piRes }) {
  const results = [];
  const sessionFile = smoke.sessionFile;
  const entries = readSessionEntries(sessionFile);
  // Deterministic: the smoke_big log line fired + a turn-metric exists. bloatHit:true is model-driven (documented).
  assert(results, "tool.smoke_big logged", smoke.lines.some((l) => l.test === "tool.smoke_big"), "");
  if (entries.length > 0) {
    const turnMetrics = countCustom(entries, "mulligan:turn-metric", "turn-metric");
    assert(results, "JSONL has turn-metric (custom)", turnMetrics >= 1, `${turnMetrics} found`);
    assertGlobalInvariants(results, entries);
  } else {
    console.log(`  ⚠ JSONL unavailable (model may have timed out) — smoke-log assertions are primary`);
  }
  return { results, entries, soft: "bloatHit:true requires the model to call mulligan_smoke_big (model-driven); see scenarios.md" };
}

function assertNudgeDrift({ smoke, piRes }) {
  const results = [];
  const sessionFile = smoke.sessionFile;
  const entries = readSessionEntries(sessionFile);
  // Deterministic: config.driftLow logged + turn-metric exists + ZERO nudge entries (the §2.3 invariant).
  assert(results, "config.driftLow logged", smoke.lines.some((l) => l.test === "config.driftLow"), "");
  if (entries.length > 0) {
    const turnMetrics = countCustom(entries, "mulligan:turn-metric", "turn-metric");
    assert(results, "JSONL has turn-metric (custom)", turnMetrics >= 1, `${turnMetrics} found`);
    // The §2.3 invariant: ZERO mulligan:nudge on disk (nudges are ephemeral, constructed in the filter copy only).
    const nudgeCount = entries.filter((e) => e.customType === "mulligan:nudge").length;
    assert(results, "§2.3 ZERO mulligan:nudge entries on disk", nudgeCount === 0, nudgeCount ? `${nudgeCount} found` : "");
    assertGlobalInvariants(results, entries);
  } else {
    console.log(`  ⚠ JSONL unavailable (model may have timed out) — smoke-log assertions are primary`);
  }
  return { results, entries, soft: "hasNudge:true requires a >3000-token turn (model-driven); see scenarios.md" };
}

function assertProtected({ smoke, piRes }) {
  const results = [];
  const sessionFile = smoke.sessionFile;
  const entries = readSessionEntries(sessionFile);
  // v1.1: the discarded-latest-user-message rewind drive no longer exists — last_turn now
  // keeps the latest user message by construction (the resolver loop starts at iLastUser + 1). The F-protected
  // scenario is therefore a no-op drive here; the first:user protection is covered by the filter's protectedOk
  // defense-in-depth, asserted in transforms.test.ts / edge-cases.test.ts. We record that the scenario ran and
  // that global invariants still hold.
  assert(results, "pi exited 0 (turn survived)", piRes.status === 0, `exit=${piRes.status}`);
  if (entries.length > 0) {
    assertGlobalInvariants(results, entries);
  }
  return { results, entries, note: "F-protected v1.1: first:user protection moved to unit tests (protectedOk); scenario is a no-op drive" };
}

function assertMaxdepth({ smoke, piRes }) {
  const results = [];
  const sessionFile = smoke.sessionFile;
  const entries = readSessionEntries(sessionFile);
  const rewindLines = smoke.lines.filter((l) => l.test === "tool.rewind");
  // 5 rewinds succeeded; the 6th refused with a depth message.
  const sixth = rewindLines[rewindLines.length - 1];
  assert(results, "6+ tool.rewind attempts logged", rewindLines.length >= 6, `${rewindLines.length} logged`);
  const sixthText = sixth?.detail?.text ?? "";
  assert(results, "6th rewind refused with depth message", /depth|refused/i.test(sixthText), sixthText.slice(0, 100));
  if (entries.length > 0) {
    const rewindCount = countCustom(entries, "mulligan:rewind", "rewind");
    assert(results, "JSONL has exactly 5 mulligan:rewind (6th refused)", rewindCount === 5, `${rewindCount} found`);
    assertGlobalInvariants(results, entries);
  } else {
    console.log(`  ⚠ JSONL unavailable (model may have timed out) — smoke-log assertions are primary`);
  }
  return { results, entries };
}

function assertCheckpoint({ smoke, piRes }) {
  const results = [];
  const sessionFile = smoke.sessionFile;
  const entries = readSessionEntries(sessionFile);
  const cpLines = smoke.lines.filter((l) => l.test === "tool.checkpoint");
  const rwLines = smoke.lines.filter((l) => l.test === "tool.rewind");
  const cpLine = cpLines[cpLines.length - 1];
  const cpText = cpLine?.detail?.text ?? "";
  const rwLine = rwLines[rwLines.length - 1];
  const rwText = rwLine?.detail?.text ?? "";
  // setCheckpoint RAN + SUCCEEDED (not refused). This is the baseline-breakage fix: a fresh 2-prompt session made
  // setCheckpoint refuse "no conversation message to checkpoint"; the seed flow commits SEED_ANCHOR first so it succeeds.
  assert(results, "tool.checkpoint ran", cpLines.length >= 1, "");
  assert(results, "checkpoint SET succeeded (not refused — baseline-breakage fix)", cpLine && !/refused/i.test(cpText), cpText.slice(0, 80));
  // checkpoint rewind RAN + K>0. K=0 (or refusal) is the BUG-003 signature (resolveCheckpoint → remove=[]). The seed
  // flow commits SEED_HIDDEN AFTER the checkpoint so the rewind hides it (K>0).
  assert(results, "checkpoint rewind ran", rwLines.length >= 1, "");
  assert(results, "checkpoint rewind K>0 (BUG-003 guard)", rwLine && !/refused|0 messages will be hidden/i.test(rwText), rwText.slice(0, 80));
  // The post-checkpoint seed MUST be hidden AND the anchor MUST survive (read back the HARD context-handler verdict).
  const hidingLines = smoke.lines.filter((l) => l.test === "F-checkpoint.hiding");
  const lastHiding = hidingLines[hidingLines.length - 1];
  assert(results, "post-checkpoint seed hidden + anchor survives (BUG-003/001 guard)", lastHiding && lastHiding.status === "pass", JSON.stringify(lastHiding?.detail ?? {}));
  assertFlush(results, smoke);
  if (entries.length > 0) {
    assert(results, "JSONL has label mulligan:checkpoint:alpha", countLabel(entries, "mulligan:checkpoint:alpha") >= 1, "");
    assert(results, "JSONL has mulligan:rewind (custom)", countCustom(entries, "mulligan:rewind", "rewind") >= 1, "");
    // REGRESSION (validation issue #1b/#5): the checkpoint 'alpha' was CONSUMED by the rewind — a clear entry
    // must follow the set, so Pi's latest-wins label map no longer lists it active. The raw SET entry still
    // exists on disk (audit trail), which is why the countLabel>=1 assertion above still holds; this assertion
    // closes the test-gap that masked the broken auto-expiry by checking the CONSUMED state directly.
    assert(results, "checkpoint 'alpha' CONSUMED by rewind (auto-expiry; spec/05 §3 step 5)", !labelActive(entries, "mulligan:checkpoint:alpha"), "checkpoint still active post-rewind");
    assertGlobalInvariants(results, entries);
  } else {
    assert(results, "JSONL available", false, "session JSONL missing — model may have timed out");
  }
  return { results, entries };
}

// F-ckptcmd (BUG-003 / spec @10-testing.md §2.1): the HUMAN slash commands drive the label lifecycle.
// Template for P1.M2.T2.S2 (F-banner) / P1.M2.T4.S1 (F-useraudit) — keep this shape clean and commented.
// Deliberate deviation from the skip-with-⚠ convention: every assertion here is JSONL-based and the label
// writes are DETERMINISTIC (no model needed to set/clear) — a missing JSONL means the spawn itself failed,
// so fail hard instead of silently passing.
function assertCkptcmd({ smoke, piRes }) {
  const results = [];
  const entries = readSessionEntries(smoke.sessionFile);
  const ckpt = "mulligan:checkpoint:x";
  if (entries.length > 0) {
    const labelEntries = entries.filter((e) => e.type === "label");
    const setEntries = labelEntries.filter((e) => e.label === ckpt);
    const clearEntries = labelEntries.filter((e) => e.label === undefined);
    // (a) set happened and was active at the post-set point (the clear comes after the set)
    assert(results, "(a) label 'mulligan:checkpoint:x' SET (label entry exists)", setEntries.length >= 1, `${setEntries.length} set entries`);
    assert(
      results,
      "(a) labelActive at post-set point (clear comes after set)",
      setEntries.length >= 1 &&
        (clearEntries.length === 0 ||
          labelEntries.findIndex((e) => e.label === ckpt) < labelEntries.findIndex((e) => e.label === undefined)),
      "",
    );
    // (b) revoke cleared it (latest-wins) on the SAME target
    assert(results, "(b) revoke wrote a clear entry (label:undefined)", clearEntries.length >= 1, `${clearEntries.length} clears`);
    assert(
      results,
      "(b) clear targets the SAME entry the set labeled",
      setEntries.length >= 1 && clearEntries.some((c) => c.targetId === setEntries[0].targetId),
      "",
    );
    assert(results, "(b) labelActive(entries, ckpt) === false after revoke", labelActive(entries, ckpt) === false, "");
    // (c) checkpoints are Pi LabelEntries — no custom control entry
    assert(results, "(c) ZERO custom 'mulligan:checkpoint' entries (labels only)", countCustom(entries, "mulligan:checkpoint") === 0, "");
    // (d) no agent mulligan_checkpoint tool invocation (label prefix 'mulligan:checkpoint:' never matches
    //     '"mulligan_checkpoint"' — no false positive)
    assert(
      results,
      "(d) ZERO mulligan_checkpoint TOOL invocations in the JSONL",
      !entries.some((e) => {
        const s = JSON.stringify(e);
        return s.includes("toolCall") && s.includes('"mulligan_checkpoint"');
      }),
      "",
    );
    // (e) global invariants (incl. "mulligan:checkpoint: labels are type:label")
    assertGlobalInvariants(results, entries);
  } else {
    console.log(`  ⚠ JSONL unavailable — F-ckptcmd core assertions are JSONL-based; treat as FAIL`);
    assert(results, "session JSONL available", false, "no entries read");
  }
  return { results, entries };
}

// F-banner (BUG-003 / spec @10-testing.md §2.1): banner persists across turns, clears within ONE fire of
// a revoke, is restored on /resume (second spawn, same --session-id), and contributes ZERO banner bytes to
// the filtered view. Signature mirrors assertReload/assertE11 (receives the whole `run`). All assertions are
// smoke-log based (contextFires' banner observable = {activeCount, names} — the P1.M2.T1.S1 recompute) — no
// session-JSONL dependence, so there is no entries-skip caveat.
function assertBanner(run) {
  const results = [];
  const f1 = run.smoke.contextFires; // run-1 fires only (parsed between spawns; run 2 truncates the log)
  const f2 = run.smoke2.contextFires; // run-2 fires ONLY (factory truncated the log at run-2 spawn time)
  const allFires = f1.concat(f2);
  const total = allFires.length;
  // Expected: 4 run-1 fires (seed + 2 pre-revoke + 1 post-revoke) + ≥1 run-2 fire. HARD guard against a
  // vacuous pass: zero fires across both runs means the spawns/model failed — never a vacuous pass.
  assert(results, "context fires observed across both runs (≥4 expected in run 1, ≥1 in run 2)", total >= 4, `${total} fires (run1=${f1.length}, run2=${f2.length})`);
  assert(results, "run-1 produced ≥4 fires (seed + 2 pre-revoke + 1 post-revoke)", f1.length >= 4, `run-1 fires=${f1.length} (model may have timed out early)`);
  if (total === 0 || f1.length < 4) return { results };
  // (a) PERSISTS across turns: the two run-1 fires between set and revoke (after the seed fire) show the
  //     banner active with 'beta' on EVERY fire (not just the first).
  assert(
    results,
    "(a) banner PERSISTS across turns (pre-revoke fires: activeCount ≥ 1, names include 'beta')",
    f1[1]?.banner?.activeCount >= 1 && f1[2]?.banner?.activeCount >= 1 &&
      (f1[1]?.banner?.names ?? []).includes("beta") && (f1[2]?.banner?.names ?? []).includes("beta"),
    `fire2=${JSON.stringify(f1[1]?.banner)} fire3=${JSON.stringify(f1[2]?.banner)}`,
  );
  // (b) CLEARS within ONE fire: the first fire after the revoke has activeCount === 0 and no later run-1 fire is active.
  const f3 = f1[3];
  const postRevokeClear = f3 && f3.banner?.activeCount === 0 && !(f3.banner?.names ?? []).includes("beta");
  const noLaterActive = f1.slice(3).every((f) => (f.banner?.activeCount ?? 0) === 0);
  assert(
    results,
    "(b) banner CLEARS within one fire of /mulligan_checkpoint_revoke (activeCount === 0, no later run-1 active fire)",
    !!postRevokeClear && noLaterActive,
    f3 ? `post-revoke fire banner=${JSON.stringify(f3.banner)}` : "no post-revoke fire (run-1 fires=" + f1.length + ")",
  );
  // (c) RESTORED on /resume: a run-2 fire shows the checkpoint set on the REOPENED session as active.
  assert(
    results,
    "(c) banner RESTORED on /resume (run-2 fire: activeCount ≥ 1, names include 'gamma')",
    f2.some((f) => (f.banner?.activeCount ?? 0) >= 1 && (f.banner?.names ?? []).includes("gamma")),
    `run-2 fires=${f2.length} banners=${JSON.stringify(f2.map((f) => f.banner))}`,
  );
  // (d) ZERO banner bytes in the filtered view: the banner is UI-ONLY (never injected into event.messages —
  //     E26 acceptance (d)); the observable field holds only {activeCount, names} (never the rendered line),
  //     so a whole-detail JSON grep for the verbatim banner fragment cannot false-positive off the observable.
  assert(
    results,
    "(d) ZERO banner bytes in filtered view (no fire detail contains 'Mulligan checkpoint active:')",
    allFires.every((f) => !JSON.stringify(f).includes("Mulligan checkpoint active:")),
    "banner text leaked into a fire detail",
  );
  assert(
    results,
    "(d) hasNudge === false on every fire (belt-and-braces)",
    allFires.every((f) => f.hasNudge === false),
    "a fire showed hasNudge:true",
  );
  // (e) exit sanity — soft-tolerant like F-reload (logs may still be present on a non-zero exit).
  const exitsOk = run.piRes.status === 0 && run.r2.status === 0;
  assert(results, "(e) both spawns exited 0", exitsOk, `run1=${run.piRes.status} run2=${run.r2.status}`);
  return { results, note: exitsOk ? undefined : "⚠ non-zero pi exit(s) with logs present — tolerated like F-reload" };
}

function assertFailopen({ smoke, piRes }) {
  const results = [];
  // The turn SURVIVED (pi exit 0) despite a malformed marker. context.fire still logged (the filter ran
  // fail-open). This is the deterministic pass-through proof; the authoritative "handler never throws" proof
  // is the unit test in filter.test.ts (GOTCHA #9).
  assert(results, "malformed marker appended", smoke.lines.some((l) => l.test === "failopen.marker"), "");
  assert(results, "pi exited 0 (turn survived — filter fail-open)", piRes.status === 0, `exit=${piRes.status}`);
  assert(results, "context.fire still logged (filter ran, no crash)", smoke.contextFires.length >= 1, `${smoke.contextFires.length} fires`);
  return { results, entries: [], note: "F-failopen verifies pass-through; the handler-never-throws unit test in filter.test.ts is authoritative (GOTCHA #9)" };
}

function assertReload(run1, run2) {
  const results = [];
  // Run 1: rewind marker persisted. Run 2 (same --session-id): the marker survived reload.
  const r1Rewind = run1.smoke.lines.filter((l) => l.test === "tool.rewind");
  assert(results, "run-1 tool.rewind ran", r1Rewind.length >= 1, "");
  // The session JSONL is shared (same --session-id) — read entries from run 1's session file (both runs append).
  const entries = readSessionEntries(run1.smoke.sessionFile);
  if (entries.length > 0) {
    assert(results, "JSONL has mulligan:rewind (persisted across reload)", countCustom(entries, "mulligan:rewind", "rewind") >= 1, "");
    assertGlobalInvariants(results, entries);
  }
  // Run 2 context.fire should show hasRewindMarker:true (the marker survived the reload into a new process).
  const r2cf = run2.smoke.contextFires[run2.smoke.contextFires.length - 1];
  assert(results, "run-2 context.fire hasRewindMarker:true (survived reload)", r2cf?.hasRewindMarker === true, String(r2cf?.hasRewindMarker));
  return { results, entries };
}

function assertE7({ smoke, piRes }) {
  // E7 is a KNOWN LIMITATION (compaction leak). The scenario documents it + asserts NO CRASH + the note
  // persists. PASS-with-note is the accepted outcome (v1 accepts the limitation).
  const results = [];
  const e7Lines = smoke.lines.filter((l) => l.test === "E7");
  assert(results, "E7 known-limitation note logged", e7Lines.length >= 1, e7Lines.length ? "" : "no E7 line");
  assert(results, "pi exited 0 (no crash)", piRes.status === 0, `exit=${piRes.status}`);
  // the rewind marker + note persisted (JSONL invariants).
  const entries = readSessionEntries(smoke.sessionFile);
  if (entries.length > 0) {
    assert(results, "JSONL has mulligan:rewind", countCustom(entries, "mulligan:rewind", "rewind") >= 1, "");
    assert(results, "JSONL has mulligan:note", countCustomMessage(entries, "mulligan:note") >= 1, "");
    assertGlobalInvariants(results, entries);
  }
  return { results, entries, note: "E7 is a v1-accepted known limitation (compaction may transiently reference hidden content)" };
}

function assertE11(run1, run2) {
  // E11 (reload mid-task): run-1 created a rewind marker; run-2 (same --session-id) reopens the session.
  // Assert run-2's first context.fire hasRewindMarker:true (the marker survived the reload into a new process).
  const results = [];
  const r1Rewind = run1.smoke.lines.filter((l) => l.test === "tool.rewind");
  assert(results, "run-1 tool.rewind ran", r1Rewind.length >= 1, "");
  const entries = readSessionEntries(run1.smoke.sessionFile);
  if (entries.length > 0) {
    assert(results, "JSONL has mulligan:rewind (persisted across reload)", countCustom(entries, "mulligan:rewind", "rewind") >= 1, "");
    assertGlobalInvariants(results, entries);
  }
  const r2cf = run2.smoke.contextFires[0];
  assert(results, "run-2 context.fire observed", !!r2cf, r2cf ? "" : "no run-2 context.fire");
  assert(results, "run-2 context.fire hasRewindMarker:true (survived reload)", r2cf?.hasRewindMarker === true, String(r2cf?.hasRewindMarker));
  return { results, entries, soft: "deltaTokens:null (baseline lost on reload) is drift-nudge fallback, not asserted here" };
}

function assertE12({ smoke, piRes }) {
  // E12 (getContextUsage undefined — pre-first-inference audit). The audit ran as the FIRST action on a fresh
  // session (no prior assistant message). Assert: no crash (pi exit 0); the audit ran + its E16 fallback path
  // produced a result.
  const results = [];
  const auditLines = smoke.lines.filter((l) => l.test === "E12.audit");
  assert(results, "E12.audit ran", auditLines.length >= 1, auditLines.length ? "" : "no E12.audit line");
  assert(results, "pi exited 0 (no crash — E16 fallback succeeded)", piRes.status === 0, `exit=${piRes.status}`);
  const last = auditLines[auditLines.length - 1];
  assert(results, "E12.audit not failed", last && last.status !== "fail", last?.detail?.error ?? "");
  // SOFT: a turn-metric is persisted after the observing turn (the turn_end handler ran).
  return { results, entries: [], soft: "turn-metric persisted on the observing turn (turn_end ran)" };
}

function assertE15({ smoke, piRes }) {
  // E15 (50 markers): 50 rewind markers seeded via the RAW wrapper. The filter must TERMINATE (context.fire
  // present, time-bounded) + no crash. v1 does no GC — markers persist intentionally.
  const results = [];
  const seedLines = smoke.lines.filter((l) => l.test === "E15.seed");
  assert(results, "E15.seed ran", seedLines.length >= 1, "");
  const seed = seedLines[seedLines.length - 1];
  assert(results, "seeded 50 markers (RAW wrapper bypasses the depth guard)", seed?.detail?.appended === 50, `appended=${seed?.detail?.appended}`);
  assert(results, "pi exited 0 (filter terminated, no crash)", piRes.status === 0, `exit=${piRes.status}`);
  assert(results, "context.fire present (filter terminated, time-bounded)", smoke.contextFires.length >= 1, `${smoke.contextFires.length} fires`);
  const entries = readSessionEntries(smoke.sessionFile);
  if (entries.length > 0) {
    const rewindCount = countCustom(entries, "mulligan:rewind", "rewind");
    // >= 50 (not ===) for robustness: the run-scoped --session-id (RUN_ID) gives a FRESH JSONL per `npm run smoke`
    // invocation, so the count is exactly 50 this run; >= 50 stays tolerant of any later in-run seeding variance.
    // The seed asserts exactly 50 THIS run (above); the JSONL assert proves they persisted (at least 50).
    assert(results, "JSONL has ≥50 mulligan:rewind markers", rewindCount >= 50, `${rewindCount} found`);
    assertGlobalInvariants(results, entries);
  }
  return { results, entries, note: "E15: markers persist intentionally (audit trail); v1 does no GC." };
}

function assertE20({ smoke, piRes }) {
  // E20 (appendEntry/sendMessage ordering): the mulligan:rewind (type:custom) entry must appear BEFORE the
  // mulligan:note (type:custom_message) entry in FILE ORDER. The synchronous append-then-send in the rewind
  // tool guarantees this.
  const results = [];
  assert(results, "pi exited 0", piRes.status === 0, `exit=${piRes.status}`);
  const entries = readSessionEntries(smoke.sessionFile);
  if (entries.length === 0) {
    assert(results, "JSONL available", false, "session JSONL missing — model may have timed out");
    return { results, entries };
  }
  const rewindIdx = entries.findIndex((e) => e.type === "custom" && e.customType === "mulligan:rewind");
  const noteIdx = entries.findIndex((e) => e.type === "custom_message" && e.customType === "mulligan:note");
  assert(results, "mulligan:rewind entry present", rewindIdx >= 0, `idx=${rewindIdx}`);
  assert(results, "mulligan:note entry present", noteIdx >= 0, `idx=${noteIdx}`);
  assert(results, "rewind (custom) BEFORE note (custom_message) in file order", rewindIdx >= 0 && noteIdx >= 0 && rewindIdx < noteIdx, `rewind=${rewindIdx} note=${noteIdx}`);
  assertGlobalInvariants(results, entries);
  return { results, entries };
}

// ── Main ─────────────────────────────────────────────────────────────────────

// F-consent (BUG-003 / spec @10-testing.md §2.1 :101): the v1.1 CONSENT model end-to-end — a user-set
// checkpoint consents to having SUBSEQUENT prompts hidden by a checkpoint rewind, while last_turn NEVER
// hides a user message (the guardrail).
function assertConsent({ smoke, piRes }) {
  const results = [];
  const entries = readSessionEntries(smoke.sessionFile);
  // Sanity: exit 0 + ≥4 fires (ideal 5; a model timeout on the observing prompt is the flake mode).
  assert(results, "pi exited 0", piRes.status === 0, `exit=${piRes.status}`);
  assert(results, "context fires observed (≥4 of the ideal 5)", smoke.contextFires.length >= 4, `${smoke.contextFires.length} fires (model may have timed out)`);
  if (smoke.contextFires.length < 4) return { results, entries };
  // (a) checkpoint rewind succeeded: K>0, not refused (same guard as assertCheckpoint).
  const rwLines = smoke.lines.filter((l) => l.test === "tool.rewind");
  const cpRw = rwLines.find(
    (l) => l.detail?.granularity === "checkpoint" && !/refused|0 messages will be hidden/i.test(l.detail?.text ?? ""),
  );
  assert(results, "(a) checkpoint rewind ran K>0 (not refused)", !!cpRw, rwLines.map((l) => l.detail?.text?.slice(0, 60)).join(" | "));
  // (d-side) the guard rewind (last_turn) also ran and was not refused.
  const guardRw = rwLines.find(
    (l) => l.detail?.granularity === "last_turn" && !/refused/i.test(l.detail?.text ?? ""),
  );
  assert(results, "(d) guard last_turn rewind ran (not refused)", !!guardRw, "");
  const final = smoke.contextFires[smoke.contextFires.length - 1];
  // (b) consented user-prompt hiding: BOTH post-checkpoint user prompts (U1/U2) hidden on the final fire,
  //     while pre-checkpoint user prompts remain visible (SETANCHOR prompt + the GUARD prompt → ≥2 user msgs).
  assert(results, "(b) U1 hidden on final fire (consented)", final.consent?.u1 === false, JSON.stringify(final.consent));
  assert(results, "(b) U2 hidden on final fire (consented)", final.consent?.u2 === false, JSON.stringify(final.consent));
  assert(results, "(b) pre-checkpoint user prompts still visible (userMsgCount ≥ 2 + firstUserPresent)", final.userMsgCount >= 2 && final.firstUserPresent === true, `userMsgCount=${final.userMsgCount} firstUserPresent=${final.firstUserPresent}`);
  // (b-side) anti-vacuous-pass guard: at least one EARLIER fire showed U1/U2 PRESENT (canaries were
  //     committed and visible BEFORE the rewind — otherwise the hiding assertions would pass vacuously).
  const earlier = smoke.contextFires.slice(0, -1);
  assert(results, "(b) U1 was visible on ≥1 pre-rewind fire (no vacuous pass)", earlier.some((f) => f.consent?.u1 === true), "");
  assert(results, "(b) U2 was visible on ≥1 pre-rewind fire (no vacuous pass)", earlier.some((f) => f.consent?.u2 === true), "");
  // (c) first:user is NEVER hidden — on EVERY fire (before and after both rewinds).
  assert(results, "(c) firstUserPresent === true on EVERY fire (first:user never hidden)", smoke.contextFires.every((f) => f.firstUserPresent === true), "");
  // (d) guardrail: the GUARD user prompt REMAINS visible after the last_turn rewind (which hid only the
  //     model turn after it).
  assert(results, "(d) GUARD user message visible after last_turn rewind (guardrail)", final.consent?.guard === true, JSON.stringify(final.consent));
  // (e) JSONL: delta label set + consumed by the checkpoint rewind; ≥2 rewind markers; global invariants.
  if (entries.length > 0) {
    assert(results, "(e) JSONL has label mulligan:checkpoint:delta", countLabel(entries, "mulligan:checkpoint:delta") >= 1, "");
    assert(results, "(e) JSONL has ≥2 mulligan:rewind markers (checkpoint + guard)", countCustom(entries, "mulligan:rewind", "rewind") >= 2, `${countCustom(entries, "mulligan:rewind", "rewind")} found`);
    assert(results, "(e) checkpoint 'delta' CONSUMED by the rewind (auto-expiry)", !labelActive(entries, "mulligan:checkpoint:delta"), "checkpoint still active post-rewind");
    assertGlobalInvariants(results, entries);
  } else {
    assert(results, "JSONL available", false, "session JSONL missing — every write here is deterministic; a missing JSONL means the spawn failed");
  }
  return { results, entries };
}

// F-useraudit (BUG-003 / spec @10-testing.md §2.1): report PARITY + sink SEPARATION on a real pi -p run.
// (a) the agent tool's report (useraudit.tool smoke line) and the command's captured notify output
//     (useraudit.command line) are IDENTICAL after normalization — both driven back-to-back inside the
//     prompt-1 command dispatch, so renderAuditReport sees the exact same session state.
// (b) the command made ZERO session writes: no mulligan:rewind/shrink/cancel entries, and the report bytes
//     NEVER persist outside the agent toolResult sink (notify is a one-shot human sink).
// (c) the agent tool's result DID reach the model: the observing turn calls mulligan_audit for real, so a
//     toolResult entry mentioning mulligan_audit IS in the session JSONL (the sanctioned agent sink —
//     excluded from (b)'s report-bytes grep BY DESIGN: a tool call in the agent loop is the one legitimate
//     path by which report bytes may appear on disk).
// (d) the real headless /mulligan_audit dispatch (prompt 2) early-returned on !ctx.hasUI without throwing:
//     covered by pi exit 0 + no crash/fail lines + (b)'s zero writes.
// (e) assertGlobalInvariants.
function assertUseraudit({ smoke, piRes }) {
  const results = [];
  const entries = readSessionEntries(smoke.sessionFile);
  // ── Sanity ──
  assert(results, "pi exited 0", piRes.status === 0, `exit=${piRes.status}`);
  assert(results, "context fires observed (≥1)", smoke.contextFires.length >= 1, `${smoke.contextFires.length} fires`);
  const started = smoke.lines.some((l) => l.test === "scenario.start" && l.detail?.scenario === "F-useraudit");
  const done = smoke.lines.some((l) => l.test === "scenario.done" && l.detail?.scenario === "F-useraudit");
  const crashed = smoke.lines.filter((l) => l.test === "scenario.crash");
  assert(results, "scenario start/done pair for F-useraudit", started && done, "");
  assert(results, "no scenario.crash", crashed.length === 0, JSON.stringify(crashed[0]?.detail ?? {}));
  // ── Evidence lines ──
  const toolLines = smoke.lines.filter((l) => l.test === "useraudit.tool");
  const cmdLines = smoke.lines.filter((l) => l.test === "useraudit.command");
  const lastTool = toolLines[toolLines.length - 1];
  const lastCmd = cmdLines[cmdLines.length - 1];
  assert(results, "useraudit.tool ran (not failed)", toolLines.length >= 1 && lastTool?.status !== "fail", lastTool?.detail?.error ?? "");
  assert(results, "useraudit.command ran (not failed)", cmdLines.length >= 1 && lastCmd?.status !== "fail", lastCmd?.detail?.error ?? "");
  const toolText = String(lastTool?.detail?.text ?? "");
  const cmdText = String(lastCmd?.detail?.text ?? "");
  assert(results, "command notify fired ≥1 (info)", Number(lastCmd?.detail?.notifyCount ?? 0) >= 1, JSON.stringify({ notifyCount: lastCmd?.detail?.notifyCount, types: lastCmd?.detail?.types }));
  // ── (a) Report PARITY (normalized FULL texts, non-vacuity first — a real report is long) ──
  assert(results, "(a) non-vacuous: tool report is a real report (>200 chars)", toolText.length > 200, `len=${toolText.length}`);
  const norm = (s) =>
    String(s ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !/^[-=─═]+$/.test(l)) // drop blank + rule lines (rendered layout only)
      .join("\n");
  const nt = norm(toolText);
  const nc = norm(cmdText);
  let diffDetail = `len ${nt.length} vs ${nc.length}`;
  if (nt !== nc) {
    const a = nt.split("\n");
    const b = nc.split("\n");
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        diffDetail = `first divergent line ${i}: tool=${String(a[i] ?? "").slice(0, 200)} | cmd=${String(b[i] ?? "").slice(0, 200)}`;
        break;
      }
    }
  }
  assert(results, "(a) normalized tool report === normalized command-captured report (report parity)", nt === nc, diffDetail);
  // ── JSONL-dependent checks (hard-fail on availability — (b)/(c) are meaningless without it) ──
  assert(results, "session JSONL available", entries.length > 0, "model may have timed out");
  if (entries.length > 0) {
    // (b) zero marker writes — this scenario's flow creates NO markers anywhere.
    const markerWrites =
      countCustom(entries, "mulligan:rewind") +
      countCustom(entries, "mulligan:shrink") +
      countCustom(entries, "mulligan:cancel");
    assert(results, "(b) ZERO mulligan:rewind/shrink/cancel entries", markerWrites === 0, `${markerWrites} found`);
    // (b) report bytes NEVER persist outside the agent toolResult sink (the notify sink never wrote).
    // Needle: renderAuditReport's exact title line (src/tools/audit.ts renderAuditReport — verified stable).
    const TITLE = "Mulligan audit — context you are currently carrying";
    const isToolResult = (e) => e.type === "message" && e?.message?.role === "toolResult";
    const leaked = entries.filter((e) => !isToolResult(e) && JSON.stringify(e).includes(TITLE));
    assert(results, "(b) report bytes NEVER persisted outside the agent toolResult sink", leaked.length === 0, `${leaked.length} leaked entries`);
    // (c) the agent tool's result DID reach the model — a real toolResult for mulligan_audit in the JSONL
    //     (the observing turn calls the tool; the direct executes in the command dispatch CANNOT persist a
    //     toolResult — pi only persists toolResults issued by the agent loop).
    const reached = entries.some((e) => JSON.stringify(e).includes("mulligan_audit") && isToolResult(e));
    assert(results, "(c) mulligan_audit toolResult reached the model (persisted in JSONL)", reached, "the observing turn did not call mulligan_audit (model non-compliance)");
    // (d) headless /mulligan_audit dispatch survival is covered by exit-0 + no-crash + (b)'s zero writes.
    assertGlobalInvariants(results, entries);
  }
  return { results, entries };
}

function assertDriftUserexempt({ smoke, piRes }) {
  const results = [];
  const entries = readSessionEntries(smoke.sessionFile);
  const fires = smoke.lines.filter((l) => l.test === "context.fire");
  // (a) HARD: the drift nudge must NOT fire — the paste is user-attributable and excluded from the
  // delta (estimateAgentTokens D10, src/tokens.ts:126-143). hasNudge false on EVERY fire + ZERO
  // mulligan:nudge in the JSONL.
  assert(results, "pi exited 0 (turn survived)", piRes.status === 0, `exit=${piRes.status}`);
  assert(results, "context.fire lines exist (paste turn + observing turn)", fires.length >= 1, `${fires.length} fires`);
  const nudgeFires = fires.filter((l) => l.detail?.hasNudge === true);
  assert(results, "hasNudge===false on every fire (D10 user-exemption)", nudgeFires.length === 0,
    nudgeFires.length ? `${nudgeFires.length} fires show hasNudge:true` : "");
  const pasteFires = fires.filter((l) => l.detail?.pasteCanaryPresent === true);
  assert(results, "paste is in the filtered context on post-paste fires", pasteFires.length >= 1, `${pasteFires.length} fires`);
  if (entries.length > 0) {
    const nudgeCount = entries.filter((e) => e.customType === "mulligan:nudge").length;
    assert(results, "ZERO mulligan:nudge entries on disk (§2.3 + exemption)", nudgeCount === 0,
      nudgeCount ? `${nudgeCount} found` : "");
    assertGlobalInvariants(results, entries);
  } else {
    console.log(`  ⚠ JSONL unavailable (model may have timed out) — smoke-log assertions are primary`);
  }
  // (b) high-water arm (window-dependent → SOFT when the window is too large for 60k to cross 0.7 —
  // follow the F-nudge-drift soft convention). Compute; assert only when satisfied; else SOFT.
  const hwOk = pasteFires.some((l) => l.detail?.highWater?.latch === true || (typeof l.detail?.highWater?.fraction === "number" && l.detail.highWater.fraction >= 0.7));
  const hwFraction = pasteFires.map((l) => l.detail?.highWater?.fraction).filter((f) => typeof f === "number").sort((a, b) => b - a)[0];
  let soft;
  if (hwOk) {
    assert(results, "high-water observed the paste (latch or fraction>=0.7)", true, `fraction=${hwFraction}`);
  } else {
    soft = `highWater did not cross 0.7 (max fraction ${hwFraction ?? "null"} — provider window too large for a 60k-token paste; cf. F-nudge-drift's model-dependent arm)`;
  }
  // (c) contrast criterion: agent-attributable growth DOES fire the drift nudge — proven by the
  // existing green F-nudge-drift scenario (its model-driven arm). Cross-reference only; no duplication.
  return { results, entries, soft,
    note: "contrast arm (agent reads fire the drift nudge) is covered by F-nudge-drift — see scenarios.md" };
}

const ASSERTERS = {
  "F-rewind-core": assertRewindCore,
  "F-shrink-persist": assertShrinkPersist,
  "F-shrink-preventive": assertShrinkPreventive,
  "F-nudge-drift": assertNudgeDrift,
  "F-protected": assertProtected,
  "F-maxdepth": assertMaxdepth,
  "F-checkpoint": assertCheckpoint,
  "F-ckptcmd": assertCkptcmd,
  "F-consent": assertConsent,
  "F-drift-userexempt": assertDriftUserexempt,
  "F-useraudit": assertUseraudit,
  "F-failopen": assertFailopen,
  "E7": assertE7,
  "E12": assertE12,
  "E15": assertE15,
  "E20": assertE20,
};

function runScenario(scenario) {
  // F-shrink-persist: 3-prompt flow (v2.0 current-turn semantics). Prompt 1 is a real model-driven SETUP turn
  // that commits an assistant + mulligan_smoke_big toolResult (RESULT_CANARY) inside the current turn span (a
  // toolResult cannot be synthesized — ReadonlySessionManager has no mutator). Prompt 2 dispatches the
  // /mulligan_smoke command, which is NOT a user message (pi command dispatch bypasses the agent loop) — so
  // the toolResult is still "current turn" at command time and the two-arm shrink matches IN-SPAN. Do NOT add
  // a prompt between setup and command (it would push the toolResult out of the current-turn span). The
  // command drives the success shrink + the v2.0 refusal variant. Prompt 3 is the observing inference — the
  // substitution must be visible (the filter bound is the marker's issuing turn; scope_guard_design.md §1–2).
  if (scenario === "F-shrink-persist") {
    const piRes = runPi(scenario, {
      prompts: [
        "Call the mulligan_smoke_big tool once, then reply with exactly: DONE", // setup: real toolResult in current turn
        "/mulligan_smoke F-shrink-persist", // drives success shrink + refusal variant
        "Reply with exactly: OK", // observing inference — substitution must be visible
      ],
    });
    const smoke = parseSmokeLog(piRes.logPath);
    return { piRes, smoke };
  }
  // F-rewind-core: 3-prompt SEED flow. A seed model turn commits a hideable assistant reply BEFORE the command, so the
  // last_turn rewind pins it (K≥1) and the observing inference shows it HIDDEN. (The 2-prompt path gives K=0 — nothing
  // after the user message at command time.)
  if (scenario === "F-rewind-core") {
    const piRes = runPi(scenario, {
      prompts: [
        `Reply with exactly: ${SEED_HIDDEN}`,
        `/mulligan_smoke F-rewind-core`,
        "Reply with exactly: OK",
      ],
    });
    const smoke = parseSmokeLog(piRes.logPath);
    return { piRes, smoke };
  }
  // F-checkpoint: 5-prompt SET/SEED/REWIND flow. SEED_ANCHOR → set checkpoint (labels the anchor) → SEED_HIDDEN
  // (post-checkpoint content) → rewind to 'alpha' (K>0) → observing turn. Fixes the baseline breakage (setCheckpoint
  // refused on a fresh 2-prompt session) AND asserts hiding (the single-handler set+rewind always gave K=0).
  if (scenario === "F-checkpoint") {
    const piRes = runPi(scenario, {
      prompts: [
        `Reply with exactly: ${SEED_ANCHOR}`,
        `/mulligan_smoke F-checkpoint-set`,
        `Reply with exactly: ${SEED_HIDDEN}`,
        `/mulligan_smoke F-checkpoint-rewind`,
        "Reply with exactly: OK",
      ],
    });
    const smoke = parseSmokeLog(piRes.logPath);
    return { piRes, smoke };
  }
  // F-ckptcmd (BUG-003): the REAL slash-command path. Prompt 1 is a SEED model turn — slash-command
  // prompts do NOT create user message entries (command dispatch bypasses the agent loop), so on a fresh
  // session setCheckpoint would have NO real message to label (the same baseline breakage F-checkpoint
  // fixed with SEED_ANCHOR); the seed assistant reply is the anchor. Then /mulligan_checkpoint x (set) and
  // /mulligan_checkpoint_revoke x (clear: setLabel(id, undefined), latest-wins) — deterministic, no model
  // call for those two steps. Prompt 4 is the observing inference that commits the session JSONL.
  if (scenario === "F-ckptcmd") {
    const piRes = runPi(scenario, {
      prompts: [
        "Reply with exactly: SETANCHOR", // seed — the real message the checkpoint labels
        "/mulligan_checkpoint x", // set
        "/mulligan_checkpoint_revoke x", // revoke — latest-wins
        "Reply with exactly: OK", // observing inference — persists the session JSONL for assertions
      ],
    });
    const smoke = parseSmokeLog(piRes.logPath);
    return { piRes, smoke };
  }
  // F-banner (BUG-003 / spec @10-testing.md §2.1): two-run scenario proving the active-checkpoint banner
  // state PERSISTS across turns, CLEARS within one fire of a revoke, is RESTORED on /resume (run 2 reuses the
  // SAME --session-id — runPi derives it from the scenario name + RUN_ID, stable per invocation), and
  // contributes ZERO banner bytes to the filtered view. Run 1: SEED model turn (a fresh session has no real
  // message for the checkpoint to label — the same baseline breakage F-ckptcmd fixed) → set 'beta' →
  // 2 observing fires (persistence) → revoke → 1 observing fire (cleared). Run 2 (same session): set
  // 'gamma' → 1 observing fire (restored). NOTE: smoke.ts's factory TRUNCATES the log per spawn, so smoke2
  // contains ONLY run-2 lines (no slicing); run 1 must be parsed BETWEEN the spawns. Run 2 passes EXPLICIT
  // prompts (starting with its own command), NOT the extraArgs-append shape of F-reload.
  if (scenario === "F-banner") {
    const r1 = runPi(scenario, {
      prompts: [
        "Reply with exactly: BANNERSEED", // seed — the real message the checkpoint labels
        "/mulligan_checkpoint beta",
        "Reply with exactly: OK", // fire 1 → banner active (beta)
        "Reply with exactly: OK again", // fire 2 → STILL active (persists across turns)
        "/mulligan_checkpoint_revoke beta",
        "Reply with exactly: OK3", // fire 3 → activeCount === 0 (cleared within one fire)
      ],
    });
    const smoke1 = parseSmokeLog(r1.logPath); // parsed BETWEEN spawns → run-1 lines only (run 2 truncates)
    // Run 2 (same --session-id → pi reopens/resumes it): set a checkpoint, observe it on the resumed session.
    const r2 = runPi(scenario, {
      prompts: ["/mulligan_checkpoint gamma", "Reply with exactly: OK4"],
    });
    const smoke2 = parseSmokeLog(r2.logPath); // run-2 lines only (factory truncated the log at spawn time)
    return { piRes: r1, smoke: smoke1, r2, smoke2 };
  }
  if (scenario === "F-consent") {
    // F-consent (BUG-003 / spec @10 §2.1 :101): 8-prompt CONSENT flow.
    // 1) seed-anchor model turn (setCheckpoint's anchor — slash prompts create no message entries);
    // 2) /mulligan_checkpoint delta — REAL slash command, deterministic label write;
    // 3+4) TWO user prompts U1/U2 with distinct canaries (post-checkpoint content the rewind will hide);
    // 5) /mulligan_smoke F-consent-rewind — drives the REAL makeRewindTool checkpoint rewind;
    // 6) a user prompt with the GUARD canary + reply (the turn a last_turn rewind will re-land on);
    // 7) /mulligan_smoke F-consent-guard — drives the REAL last_turn rewind (guardrail arm);
    // 8) observing inference — ALL hiding/visibility verdicts read off this fire.
    const piRes = runPi(scenario, {
      prompts: [
        "Reply with exactly: SETANCHOR",
        "/mulligan_checkpoint delta",
        "User says: MULLIGAN-SMOKE-CONSENT-U1 — reply with exactly: OK",
        "User says: MULLIGAN-SMOKE-CONSENT-U2 — reply with exactly: OK",
        "/mulligan_smoke F-consent-rewind",
        "User says: MULLIGAN-SMOKE-CONSENT-GUARD — reply with exactly: OK",
        "/mulligan_smoke F-consent-guard",
        "Reply with exactly: OK",
      ],
    });
    const smoke = parseSmokeLog(piRes.logPath);
    return { piRes, smoke };
  }
  // F-drift-userexempt (BUG-003 / spec @10 §2.1): D10 user-exemption, end-to-end. The paste is REAL
  // user prompt(s) delivered via -p (no /mulligan_smoke dispatch — the exemption is about genuine user
  // input). Generated at runtime: ~60k tokens ≈ 240KB of argv total; never a repo fixture. NOTE: Linux
  // MAX_ARG_STRLEN caps a SINGLE argv argument at 128KB, so the paste is split into CHUNKS of ~20k
  // tokens (~80KB argv each) — every chunk is still a genuine user prompt, all user-attributable, so
  // the D10 exemption point and the total ~60k-token context growth are preserved.
  // estimateAgentTokens (src/tokens.ts:126-143) excludes role==='user' from the drift delta
  // → the nudge must NOT fire even though total context grows ~60k. The highWater observables
  // (P1.M2.T1.S2) count the FULL filtered context → they SHOULD observe the paste when the window
  // is small enough for 60k to cross 0.7 of it.
  if (scenario === "F-drift-userexempt") {
    const PASTE_TOKENS_TARGET = 60_000;
    const CHUNKS = 3; // 3 × ~20k tokens ≈ 80KB argv each — under the 128KB per-arg kernel limit
    const CHARS_PER_TOKEN = 4; // must match src/tokens.ts CHARS_PER_TOKEN (= 4; verified by grep)
    const line = "MULLIGAN-SMOKE-PASTE-FILLER-0123456789abcdef "; // ~48 chars incl. space
    const repeat = Math.ceil(PASTE_TOKENS_TARGET * CHARS_PER_TOKEN / line.length / CHUNKS);
    const pasteChunk = (n) =>
      `Ignore the filler below; it is part ${n + 1} of a large document paste (D10 user-exemption smoke).\n` +
      (n === 0 ? `MULLIGAN-SMOKE-PASTE-CANARY\n` : "") +
      Array.from({ length: repeat }, (_, i) => `${n}-${i} ${line}`).join("\n");
    const piRes = runPi(scenario, {
      prompts: [
        ...Array.from({ length: CHUNKS }, (_, n) => pasteChunk(n)),
        "Reply with exactly: OK",
      ],
    });
    const smoke = parseSmokeLog(piRes.logPath);
    return { piRes, smoke };
  }
  // F-useraudit (BUG-003 / spec @10-testing.md §2.1): report PARITY + sink SEPARATION.
  // Prompt 1: /mulligan_smoke F-useraudit — deterministic command; the smoke.ts case drives BOTH the real
  //   agent auditTool AND the real makeAuditCommand handler via a wrapper ctx that captures ui.notify
  //   (headless pi -p has no UI — the raw command would early-return on !ctx.hasUI, so we wrap). Both report
  //   strings smokeLog'd back-to-back on the SAME session state (parity is exact after normalization).
  // Prompt 2: -p /mulligan_audit — the REAL headless dispatch path: hasUI:false → early return, MUST not
  //   throw, MUST not write (a genuine pi command dispatch through index.ts registration).
  // Prompt 3: the observing turn CALLS mulligan_audit for real — pi only persists toolResult entries issued
  //   by the agent loop (a direct execute inside the command dispatch persists NOTHING — verified empirically),
  //   so the "tool result reached the model" positive arm (spec @10 §2.1) requires a genuine model tool call
  //   (the F-shrink-persist "Call the mulligan_smoke_big tool once…" setup pattern). The resulting toolResult
  //   entry is the SANCTIONED agent sink — the (b) report-bytes grep excludes it by design.
  if (scenario === "F-useraudit") {
    const piRes = runPi(scenario, {
      prompts: [
        "/mulligan_smoke F-useraudit",
        "/mulligan_audit",
        "Use the mulligan_audit tool with top 8 now, then reply with exactly: OK",
      ],
    });
    const smoke = parseSmokeLog(piRes.logPath);
    return { piRes, smoke };
  }
  if (scenario === "F-reload" || scenario === "E11") {
    // Two spawns sharing --session-id smoke-<scenario> (run 2 reopens the same session).
    const r1 = runPi(scenario);
    const smoke1 = parseSmokeLog(r1.logPath);
    // Run 2: just trigger an observing turn on the SAME session (--session-id reopens it).
    const r2 = runPi(scenario, { extraArgs: ["-p", "Reply with exactly: OK"] }); // a third prompt for run 2's observing turn
    const smoke2 = parseSmokeLog(r2.logPath);
    return { piRes: r1, smoke: smoke1, r2, smoke2 };
  }
  const piRes = runPi(scenario);
  const smoke = parseSmokeLog(piRes.logPath);
  return { piRes, smoke };
}

function main() {
  console.log("════════════════════════════════════════════════════════════");
  console.log("  Mulligan integration smoke harness (deterministic suite)");
  console.log("════════════════════════════════════════════════════════════\n");

  let totalPass = 0;
  let totalFail = 0;
  const failed = [];

  for (const scenario of SCENARIOS) {
    const run = runScenario(scenario);
    const smoke = run.smoke;
    const piRes = run.piRes;

    // GOTCHA #12: detect EXTENSION LOAD FAILED (non-zero pi exit + empty smoke log → src/index.ts failed).
    if (piRes.status !== 0 && smoke.lines.length === 0) {
      console.log(`FAIL ${scenario} — EXTENSION LOAD FAILED (check src/index.ts; pi exit=${piRes.status})`);
      totalFail++;
      failed.push(scenario);
      continue;
    }

    let outcome;
    if (scenario === "F-reload") {
      outcome = assertReload(run, { smoke: run.smoke2 });
    } else if (scenario === "E11") {
      outcome = assertE11(run, { smoke: run.smoke2 });
    } else if (scenario === "F-banner") {
      outcome = assertBanner(run);
    } else {
      outcome = ASSERTERS[scenario]({ smoke, piRes });
    }

    let scenarioPass = true;
    for (const r of outcome.results) {
      if (!r.pass) {
        scenarioPass = false;
        console.log(`  ✗ ${r.label}${r.detail ? ` — ${r.detail}` : ""}`);
      }
    }
    if (outcome.soft) console.log(`  ⚠ SOFT: ${outcome.soft}`);
    if (outcome.note) console.log(`  ℹ NOTE: ${outcome.note}`);

    if (scenarioPass) {
      console.log(`PASS ${scenario}`);
      totalPass++;
    } else {
      console.log(`FAIL ${scenario}`);
      totalFail++;
      failed.push(scenario);
    }
    console.log("");
  }

  console.log("──────────────────────────────────────────────────────────");
  console.log(`  ${totalPass}/${SCENARIOS.length} scenarios passed`);
  if (totalFail > 0) {
    console.log(`  FAILED: ${failed.join(", ")}`);
  }
  console.log("──────────────────────────────────────────────────────────");
  process.exit(totalFail === 0 ? 0 : 1);
}

main();