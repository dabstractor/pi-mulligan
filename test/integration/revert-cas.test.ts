/**
 * revert-cas.test.ts — F-revert-cas + F-revert-dirtyguard integration tests
 * (spec/10-testing.md §2.1 scenario table F-revert-cas / F-revert-dirtyguard;
 * spec/14-working-tree-revert.md §4.1 ("cas" default — comprehensive whole-tree capture+restore),
 * §6 restore/refuse-on-dirty semantics; spec/08-edge-cases.md E30 (dirty guard REFUSES — file not
 * overwritten) + E27 (revert best-effort, never blocks the rewind)).
 *
 * NOTE: the third scenario, F-revert-explicit (spec/14 §4.2 "explicit-paths" mode), MOVED to
 * test/integration/revert-explicit.test.ts in P1.M3.T1.S3. That file now drives the REAL
 * toolCallCaptureHandler / appendExplicitPath hook chain end-to-end (the previous block here was a
 * direct-drive workaround whose comment asserted "there is NO tool_call hook" — now false as of
 * P1.M3.T1.S1/S2). See the SUPERSEDED note inside the describe below.
 *
 * Drives the REAL v1.2 working-tree-revert CasBackend subsystem end-to-end against REAL temporary
 * NON-GIT directories (real files; real `sed`):
 *   - `detectAndCreate` (real `CasBackend` — no fakes, no makeFakeStore)
 *   - the REAL `turnStartCaptureHandler` / `agentEndCaptureHandler` capture hooks (cas-mode scenarios —
 *     whole-tree capture works through them)
 *   - the REAL `makeRewindTool` (the v1.2 step-6b revert decision tree)
 *
 * Two scenarios (mirror spec/10 §2.1 scenario table; F-revert-explicit moved out):
 *   F-revert-cas        — nonGitMode "cas": mutate via write+edit+bash sed → ALL three files restored
 *                         via the whole-tree manifest (incl. the sed file); backend "cas"; marker's
 *                         revert.revertedFiles ⊇ {a.ts,b.ts,c.ts}.
 *   F-revert-dirtyguard — after agent_end, edit a file externally → file-revert REFUSED (file NOT
 *                         overwritten), context rewind still happens (marker persisted), and the
 *                         marker's data.revert is undefined (the refuse branch assigns no revert
 *                         block — CRITICAL FINDING #2).
 *
 * ── CRITICAL FINDINGS (from research/findings.md) ──
 *  #1 — HISTORICAL: at the time, there was NO `pi.on("tool_call",…)` hook, so the (now-removed)
 *       F-revert-explicit block drove capture DIRECTLY. As of P1.M3.T1.S1/S2 the REAL
 *       toolCallCaptureHandler IS wired + CasBackend.appendExplicitPath exists; the real-hook
 *       F-revert-explicit test now lives in revert-explicit.test.ts. This finding no longer applies.
 *  #2 — the REFUSE branch of step 6b does NOT assign revertBlock and does NOT call store.restore. So
 *       the persisted mulligan:rewind marker has data.revert === undefined on refuse, and refusedFiles
 *       is NEVER populated. F-revert-dirtyguard asserts the OBSERVABLE refuse contract instead:
 *       firstText(res) contains "refused"; the externally-edited file is NOT overwritten; the rewind
 *       persisted its marker (context rewind happened); data.revert === undefined.
 *
 * House idiom (mirror test/integration/revert-git.test.ts + test/tools/rewind.test.ts): vitest,
 * hand-rolled makePi()/makeCtx() fakes (NO vi.fn()), `.js` import paths, clearAll() + setConfig(undefined)
 * before/after each, REAL `sed` via promisified execFile, temp dirs rm'd in afterEach. NO production-
 * source changes (test-only item).
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

import { detectAndCreate } from "../../src/snapshot/store.js";
import { CasBackend } from "../../src/snapshot/cas.js";
import {
  turnStartCaptureHandler,
  agentEndCaptureHandler,
} from "../../src/capture.js";
import {
  makeRewindTool,
  type RewindArgs,
  type RewindDetails,
} from "../../src/tools/rewind.js";
import { setConfig, getConfig } from "../../src/config.js";
import { getRuntime, clearAll } from "../../src/runtime.js";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const execFile = promisify(execFileCb);

// ── temp-dir + sed helpers ──────────────────────────────────────────────────

/** Run `sed -i <expr> <path>` (real, in-place). Universally available on Linux/macOS CI. */
async function sed(path: string, expr: string): Promise<void> {
  await execFile("sed", ["-i", expr, path]);
}

/** True iff `sed` is on PATH (the skip-guard for every scenario). */
async function sedAvailable(): Promise<boolean> {
  try {
    await execFile("sed", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

/** A fresh temp dir that is a NON-git workspace (NO `git init` — this is the non-git case). */
function makeNonGitDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** A SEPARATE fresh temp dir for snapshot storage (MUST NOT be inside the repo — config rejects that
 *  → NoOpStore, backend "none"; see store.ts resolveStorageDir containment guard). */
function makeStorage(): string {
  return mkdtempSync(join(tmpdir(), "mulligan-store-"));
}

// ── the canonical valid note (3 non-empty fields — copied from rewind.test.ts) ──

const VALID_NOTE = {
  what_happened:
    "Ran a repo-wide grep that dumped ~38k tokens; don't grep without -l; use the built-in grep tool which truncates.",
  true_current_state: "No files changed on the abandoned span.",
  next: "Re-run as grep -rl auth src/ and read only the 3 relevant files.",
};

// ── fakes (copied VERBATIM in shape from test/integration/revert-git.test.ts + rewind.test.ts) ──

/** A minimal fake ExtensionAPI capturing appendEntry + sendMessage + setLabel (hand-rolled, no vi.fn()). */
function makePi() {
  const appended: { customType: string; data: unknown }[] = [];
  const sent: unknown[] = [];
  const labels: { entryId: string; label: string | undefined }[] = [];
  const pi = {
    appendEntry(customType: string, data?: unknown) {
      appended.push({ customType, data });
    },
    sendMessage(message: unknown, options?: unknown) {
      sent.push({ ...(message as object), options });
    },
    setLabel(entryId: string, label: string | undefined) {
      labels.push({ entryId, label });
    },
  };
  return { appended, sent, labels, pi: pi as unknown as ExtensionAPI };
}

/** A minimal fake ExtensionContext (sessionId + leafId + buildContextEntries). NO getContextUsage — so
 *  the (4c) context-fraction guard is SKIPPED (windowTokens 0 → no-op), matching the unit-test idiom.
 *  The capture hooks read ctx.sessionManager.getSessionId() FRESH (C12); the rewind tool reads
 *  buildContextEntries for the ledger. ONE ctx per scenario is used for BOTH (hooks ignore
 *  contextEntries; the rewind tool reads them). */
function makeCtx(opts: {
  sessionId: string;
  contextEntries: unknown[];
  leafId?: string;
}) {
  const sessionId = opts.sessionId;
  const leafId = opts.leafId ?? "leaf-1";
  const contextEntries = opts.contextEntries;
  const sessionManager = {
    getSessionId() {
      return sessionId;
    },
    getLeafId() {
      return leafId;
    },
    getEntries() {
      return [];
    },
    getLabel() {
      return undefined;
    },
    getBranch() {
      return [];
    },
    buildContextEntries() {
      return contextEntries;
    },
  };
  const ctx = { sessionManager };
  return { ctx: ctx as unknown as ExtensionContext };
}

/** A message-as-entry in the buildContextEntries() snapshot (the ledger/K preview flattens these). */
function msgEntry(message: Record<string, unknown>): {
  type: "message";
  id: string;
  message: Record<string, unknown>;
} {
  return {
    type: "message",
    id: `e-${Math.random().toString(36).slice(2)}`,
    message,
  };
}

/** Build an assistant message whose content is a list of toolCall blocks with the given ids. */
function asst(...callIds: string[]): Record<string, unknown> {
  return {
    role: "assistant",
    content: callIds.map((id) => ({
      type: "toolCall",
      id,
      name: "tool",
      arguments: {},
    })),
  };
}

/** Build a toolResult message. */
function result(toolCallId: string): Record<string, unknown> {
  return {
    role: "toolResult",
    toolCallId,
    toolName: "tool",
    content: [{ type: "text", text: "..." }],
    isError: false,
  };
}

/** Build an assistant message whose toolCall is a `write` to a path (ledger → modifiedFiles). */
function asstWrite(callId: string, file_path: string): Record<string, unknown> {
  return {
    role: "assistant",
    content: [
      { type: "toolCall", id: callId, name: "write", arguments: { file_path } },
    ],
  };
}

/** Build an assistant message whose toolCall is an `edit` to a path (ledger → modifiedFiles, same as write). */
function asstEdit(callId: string, file_path: string): Record<string, unknown> {
  return {
    role: "assistant",
    content: [
      { type: "toolCall", id: callId, name: "edit", arguments: { file_path } },
    ],
  };
}

/** Build an assistant message whose toolCall is a mutating bash command (bashSideEffects). */
function asstBash(callId: string, command: string): Record<string, unknown> {
  return {
    role: "assistant",
    content: [
      { type: "toolCall", id: callId, name: "bash", arguments: { command } },
    ],
  };
}

/** Build a user message. */
function user(text: string): Record<string, unknown> {
  return { role: "user", content: text };
}

/** Invoke the REAL rewind tool's execute with the fakes. toolCallId defaults to "call-1". */
async function run(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  params: RewindArgs,
  toolCallId = "call-1",
): Promise<AgentToolResult<RewindDetails>> {
  const tool = makeRewindTool(pi);
  return tool.execute(toolCallId, params, undefined, undefined, ctx);
}

/** Extract the text from a result's first content block. */
function firstText(res: AgentToolResult<RewindDetails>): string {
  const block = res.content[0];
  if (!block || block.type !== "text") {
    throw new Error(`expected a text content block, got ${block?.type ?? "none"}`);
  }
  return block.text;
}

/** Read the persisted `mulligan:rewind` marker entry from the captured appendEntry stream. */
function rewindMarker(appended: { customType: string; data: unknown }[]) {
  const rw = appended.find((e) => e.customType === "mulligan:rewind");
  expect(rw).toBeTruthy();
  return rw!.data as {
    revert?: {
      revertedFiles: string[];
      deletedFiles: string[];
      failedFiles: string[];
      refusedFiles: string[];
      skipped: boolean;
      backend: "git" | "cas" | "none";
    };
  };
}

// ── shared scaffolding: reset + temp-dir cleanup ────────────────────────────

/** Tracks temp dirs created per-test for rm in afterEach. */
const dirs: string[] = [];

beforeEach(() => {
  clearAll();
  setConfig(undefined); // reset the config cache to validated DEFAULT_CONFIG (CRITICAL #8: partial merge)
});

afterEach(() => {
  clearAll();
  setConfig(undefined);
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
  dirs.length = 0;
});

// ── the scenarios ───────────────────────────────────────────────────────────

describe("F-revert-cas/dirtyguard integration (spec/10 §2.1 / spec/14 §4/§6) [F-revert-explicit → revert-explicit.test.ts]", () => {
  // ── F-revert-cas (spec/10 §2.1 row F-revert-cas / spec/14 §4.1) ─────────────
  //
  // nonGitMode "cas": mutate via write+edit+bash sed → ALL three files restored via the whole-tree
  // manifest (incl. the sed file — CRITICAL #4: cas-mode whole-tree capture captured it). The REAL
  // capture hooks work here (whole-tree walk, no explicitPaths needed).
  it("F-revert-cas: non-git, cas mode — write+edit+bash sed ALL restored (incl. sed file); backend 'cas'; revertedFiles ⊇ {a,b,c}.ts", async () => {
    if (!(await sedAvailable())) {
      console.warn("[revert-cas] sed not on PATH — skipping F-revert-cas");
      return;
    }

    // SETUP: a real NON-git temp dir with three pre-span files.
    const repoDir = makeNonGitDir("rev-cas-");
    dirs.push(repoDir);
    writeFileSync(join(repoDir, "a.ts"), "A1\n");
    writeFileSync(join(repoDir, "b.ts"), "B1\n");
    writeFileSync(join(repoDir, "c.ts"), "C1\n");
    // Prove non-git-ness (no .git — detectAndCreate must NOT find a git repo).
    expect(existsSync(join(repoDir, ".git"))).toBe(false);

    const preSpan = {
      a: readFileSync(join(repoDir, "a.ts"), "utf8"),
      b: readFileSync(join(repoDir, "b.ts"), "utf8"),
      c: readFileSync(join(repoDir, "c.ts"), "utf8"),
    };

    // SEPARATE storage dir (must NOT resolve inside cwd — config rejects that → NoOpStore).
    const storageDir = makeStorage();
    dirs.push(storageDir);

    // CONFIG + STORE + RUNTIME. 'cas' is the default nonGitMode; set it explicitly for clarity.
    setConfig({ revert: { enabled: true, nonGitMode: "cas", storageDir } });
    const store = await detectAndCreate(repoDir, getConfig().revert);
    expect(store.describe().backend).toBe("cas"); // CRITICAL #3: "cas" in BOTH non-git modes

    // WIRE the store into the runtime BEFORE the capture hooks (they self-gate on rt.store — CRITICAL #11).
    const sid = "s1";
    const rt = getRuntime(sid);
    rt.store = store;

    const { appended, pi } = makePi();

    // The span contextEntries (ledger source) — repo-relative POSIX paths (extractFileLedger records
    // file_path verbatim). Put the toolCalls AFTER the user msg or the ledger is empty (CRITICAL #6:
    // last_turn removes everything AFTER the last user message). Built here; read at execute time.
    const contextEntries = [
      msgEntry(user("rewrite the files")),
      msgEntry(asstWrite("w1", "a.ts")),
      msgEntry(result("w1")),
      msgEntry(asstEdit("e1", "b.ts")),
      msgEntry(result("e1")),
      msgEntry(asstBash("s1", "sed -i s/C1/C2-edited/ c.ts")),
      msgEntry(result("s1")),
      msgEntry(asst("final")),
      msgEntry(result("final")),
    ];
    const { ctx } = makeCtx({ sessionId: sid, contextEntries });

    // CAPTURE turn_start (REAL hook — cas-mode whole-tree walk; NO explicitPaths arg).
    await turnStartCaptureHandler(
      { type: "turn_start", turnIndex: 0, timestamp: Date.now() },
      ctx,
    );
    expect(rt.snapshots?.get("turn")?.beforeRef).toBe("turn");

    // MUTATE the span (the abandoned work): write a.ts, edit b.ts, bash sed c.ts.
    writeFileSync(join(repoDir, "a.ts"), "A2-rewritten\n");
    writeFileSync(join(repoDir, "b.ts"), "B2-rewritten\n");
    await sed(join(repoDir, "c.ts"), "s/C1/C2-edited/");

    // CAPTURE agent_end (REAL hook — whole-tree afterRef; mutates the "turn" entry's afterRef in place).
    await agentEndCaptureHandler({ type: "agent_end", messages: [] }, ctx);
    expect(rt.snapshots?.get("turn")?.afterRef).toBe("turn-after");

    // DRIVE the REAL rewind tool (revert_file_changes → step 6b PROCEED branch → store.restore).
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_turn", revert_file_changes: true },
      "final",
    );

    // ASSERT success + files restored (incl. the sed file — CRITICAL #4: cas-mode whole-tree restore).
    expect(firstText(res)).toContain("Reverted");
    expect(readFileSync(join(repoDir, "a.ts"), "utf8")).toBe(preSpan.a);
    expect(readFileSync(join(repoDir, "b.ts"), "utf8")).toBe(preSpan.b);
    expect(readFileSync(join(repoDir, "c.ts"), "utf8")).toBe(preSpan.c); // sed file RESTORED in cas mode

    // ASSERT backend + marker (CRITICAL #3: backend "cas" in BOTH non-git modes).
    const marker = rewindMarker(appended);
    expect(marker.revert?.backend).toBe("cas");
    expect(marker.revert?.revertedFiles).toEqual(
      expect.arrayContaining(["a.ts", "b.ts", "c.ts"]),
    );
  });

  // ── F-revert-explicit — SUPERSEDED by test/integration/revert-explicit.test.ts ──
  //
  // This describe previously held a DIRECT-DRIVE workaround `it()` block that drove capture DIRECTLY
  // (store.capture("turn",[...]) + store.notifyBashUsed()) because its comment asserted "there is NO
  // tool_call hook". As of P1.M3.T1.S1/S2 that is FALSE: the REAL toolCallCaptureHandler is wired and
  // CasBackend.appendExplicitPath exists, so the REAL-hook end-to-end test now lives in
  // revert-explicit.test.ts (F-revert-explicit-write + F-revert-explicit-bash). The stale workaround
  // block was deleted to avoid a misleading test whose header comment became false.

  // ── F-revert-dirtyguard (spec/10 §2.1 row F-revert-dirtyguard / spec/14 §6 + E30) ─
  //
  // After agent_end, edit a file externally (the human/other-process drift) → the dirty guard REFUSES
  // the file-revert (file NOT overwritten — E30), the context rewind still happens (marker persisted),
  // and data.revert is undefined (CRITICAL #2: the refuse branch never assigns revertBlock and never
  // calls store.restore). Uses the REAL capture hooks (cas-mode whole-tree capture works through them).
  //
  // NOTE: spec/10 §2.1's literal "drifted path in revert.refusedFiles" is NOT how the current
  // implementation signals refusal (refusedFiles is only populated on the PROCEED branch by
  // store.restore). The refusal is observable via the revertClause TEXT + the file-not-overwritten
  // state + the absent revert block. Asserting refusedFiles would always fail — do NOT assert it.
  it("F-revert-dirtyguard: post-agent_end external edit → file-revert REFUSED (file NOT overwritten); context rewind still happens; data.revert undefined", async () => {
    if (!(await sedAvailable())) {
      console.warn("[revert-cas] sed not on PATH — skipping F-revert-dirtyguard");
      return;
    }

    // SETUP: a real NON-git temp dir with one pre-span file.
    const repoDir = makeNonGitDir("rev-dirty-");
    dirs.push(repoDir);
    writeFileSync(join(repoDir, "a.ts"), "A1\n");

    const storageDir = makeStorage();
    dirs.push(storageDir);

    // CONFIG + STORE + RUNTIME. cas mode → real hooks work (whole-tree capture through them).
    setConfig({ revert: { enabled: true, nonGitMode: "cas", storageDir } });
    const store = await detectAndCreate(repoDir, getConfig().revert);
    expect(store.describe().backend).toBe("cas");

    const sid = "s1";
    const rt = getRuntime(sid);
    rt.store = store; // before the capture hooks (they self-gate on rt.store)
    const { appended, pi } = makePi();

    // BUILD ctx + SPAN (write a.ts — so a.ts ∈ ledger.modifiedFiles → dirtyCheck is asked about a.ts,
    // CRITICAL #5: affectedPaths = ledger.modifiedFiles feeds ONLY the dirty guard).
    const contextEntries = [
      msgEntry(user("edit a.ts")),
      msgEntry(asstWrite("w1", "a.ts")),
      msgEntry(result("w1")),
      msgEntry(asst("final")),
      msgEntry(result("final")),
    ];
    const { ctx } = makeCtx({ sessionId: sid, contextEntries });

    // CAPTURE turn_start (REAL hook — whole-tree beforeRef).
    await turnStartCaptureHandler(
      { type: "turn_start", turnIndex: 0, timestamp: Date.now() },
      ctx,
    );
    expect(rt.snapshots?.get("turn")?.beforeRef).toBe("turn");

    // MUTATE (the agent's span).
    writeFileSync(join(repoDir, "a.ts"), "A2-agent\n");

    // CAPTURE agent_end (REAL hook — afterRef captures the AGENT's mutated state).
    await agentEndCaptureHandler({ type: "agent_end", messages: [] }, ctx);
    expect(rt.snapshots?.get("turn")?.afterRef).toBe("turn-after");

    // EXTERNAL EDIT AFTER agent_end (the human/other-process drift — E30). NOT the agent's "A2-agent\n".
    writeFileSync(join(repoDir, "a.ts"), "HUMAN-EDIT\n");

    // DRIVE the REAL rewind tool (revert_file_changes → step 6b REFUSE branch — drift detected).
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_turn", revert_file_changes: true },
      "final",
    );

    // ASSERT REFUSE (CRITICAL #2 — the observable contract, NOT refusedFiles):
    //   (a) firstText contains "refused" (the revertClause text set by the refuse branch);
    expect(firstText(res)).toContain("refused");
    //   (b) the externally-edited file is NOT overwritten (still the external-edit content — E30);
    expect(readFileSync(join(repoDir, "a.ts"), "utf8")).toBe("HUMAN-EDIT\n");
    //   (c) the rewind STILL persisted its mulligan:rewind marker (context rewind happened);
    const marker = rewindMarker(appended);
    expect(marker).toBeTruthy();
    //   (d) the refuse branch left NO revert block (never assigns revertBlock / never calls restore).
    expect(marker.revert).toBeUndefined();
  });

  // ── F-revert-failopen (spec/10 §2.1 row F-revert-failopen / E27 — cas backend) ──
  //
  // CasBackend.restore writes pre-existing manifest files back IN PLACE via fs.writeFile(abs, content)
  // (cas.ts:1050). To make that write fail → chmod the FILE 0o444 (open(O_WRONLY|O_CREAT|O_TRUNC)
  // returns EACCES → failed[] push at cas.ts:1053). The git failopen test (revert-git:494) locks a
  // SUBDIR because `git checkout` unlinks+recreates (only a read-only DIR stops the unlink) — that
  // rationale does NOT transfer to cas (a read-only dir does NOT block an in-place writeFile to an
  // existing file). LOCK THE FILE here, not the dir.
  it("F-revert-failopen (cas): read-only-locked file lands in failedFiles; the rest reverted; rewind SUCCEEDS (E27 — CasBackend.restore best-effort)", async () => {
    // chmod is a no-op for root (root ignores the read-only bit → the file WOULD revert and
    // failedFiles would be empty). Guard: skip under root so the assertions stay faithful.
    if (process.getuid && process.getuid() === 0) {
      console.warn(
        "[revert-cas] running as root — skipping F-revert-failopen (chmod is ineffective for root)",
      );
      return;
    }

    // SETUP: a real NON-git temp dir with two pre-span files (NO makeRepo, NO git commit — non-git).
    const repoDir = makeNonGitDir("rev-cas-failopen-");
    dirs.push(repoDir);
    writeFileSync(join(repoDir, "a.ts"), "A1\n");
    writeFileSync(join(repoDir, "b.ts"), "B1\n");

    const preSpan = {
      a: readFileSync(join(repoDir, "a.ts"), "utf8"),
      b: readFileSync(join(repoDir, "b.ts"), "utf8"),
    };

    // SEPARATE storage dir (must NOT resolve inside cwd — config rejects that → NoOpStore).
    const storageDir = makeStorage();
    dirs.push(storageDir);

    // CONFIG + STORE + RUNTIME. cas mode → real hooks work (whole-tree capture through them).
    setConfig({ revert: { enabled: true, nonGitMode: "cas", storageDir } });
    const store = await detectAndCreate(repoDir, getConfig().revert);
    expect(store.describe().backend).toBe("cas");

    const sid = "s-cas-failopen";
    const rt = getRuntime(sid);
    rt.store = store; // before the capture hooks (they self-gate on rt.store)
    const { appended, pi } = makePi();

    // Two writes so ledger.modifiedFiles = [a.ts, b.ts] (the dirty guard checks both).
    const contextEntries = [
      msgEntry(user("rewrite the files")),
      msgEntry(asstWrite("w1", "a.ts")),
      msgEntry(result("w1")),
      msgEntry(asstWrite("w2", "b.ts")),
      msgEntry(result("w2")),
      msgEntry(asst("final")),
      msgEntry(result("final")),
    ];
    const { ctx } = makeCtx({ sessionId: sid, contextEntries });

    // CAPTURE turn_start (REAL hook — cas-mode whole-tree walk).
    await turnStartCaptureHandler(
      { type: "turn_start", turnIndex: 0, timestamp: Date.now() },
      ctx,
    );
    expect(rt.snapshots?.get("turn")?.beforeRef).toBe("turn");

    // MUTATE both files in-span (the abandoned work).
    writeFileSync(join(repoDir, "a.ts"), "A2\n");
    writeFileSync(join(repoDir, "b.ts"), "B2\n");
    // LOCK b.ts (the failopen target) read-only — cas restore writes the FILE in place, so a 0o444
    // file blocks the open(O_WRONLY) → EACCES → failed[] (cas.ts:1053). Lock the FILE, not the dir.
    chmodSync(join(repoDir, "b.ts"), 0o444);

    // CAPTURE agent_end (REAL hook — whole-tree afterRef).
    await agentEndCaptureHandler({ type: "agent_end", messages: [] }, ctx);
    expect(rt.snapshots?.get("turn")?.afterRef).toBe("turn-after");

    // DRIVE + ASSERT inside a try/finally so the read-only b.ts is always restored to 0o644 for the
    // afterEach rmSync cleanup (a leaked read-only file can make rmSync fail with EACCES on strict
    // platforms).
    try {
      const res = await run(
        pi,
        ctx,
        { note: VALID_NOTE, granularity: "last_turn", revert_file_changes: true },
        "final",
      );

      // ASSERT rewind SUCCEEDS (fail-open, E27 — the op NEVER throws; best-effort). NOTE: the revert
      // summary line contains "0 refused (see log)" even on success, so check the REFUSAL PREFIX,
      // not the bare word "refused".
      expect(firstText(res)).not.toContain("Mulligan: refused");
      expect(firstText(res)).toContain("Reverted");

      // ASSERT a.ts (the unlocked one) REVERTED.
      expect(readFileSync(join(repoDir, "a.ts"), "utf8")).toBe(preSpan.a);

      // ASSERT b.ts (the locked one) NOT reverted (stays mutated — the read-only file blocked the
      // in-place writeFile).
      expect(readFileSync(join(repoDir, "b.ts"), "utf8")).not.toBe(preSpan.b);
      expect(readFileSync(join(repoDir, "b.ts"), "utf8")).toBe("B2\n");

      // ASSERT the marker: b.ts in failedFiles, a.ts in revertedFiles.
      const revert = rewindMarker(appended).revert;
      expect(revert?.backend).toBe("cas");
      expect(revert?.failedFiles).toEqual(expect.arrayContaining(["b.ts"]));
      expect(revert?.revertedFiles).toEqual(expect.arrayContaining(["a.ts"]));
    } finally {
      // Restore perms so afterEach rmSync(repoDir) does not EACCES on the read-only file.
      chmodSync(join(repoDir, "b.ts"), 0o644);
    }
  });

  // ── F-revert-delete (spec/10 §2.1 row F-revert-delete — the double-gate, cas backend) ──

  it("F-revert-delete (cas, off): deletion REFUSED when allowDeleteCreatedFiles is false (file stays; deletedFiles empty)", async () => {
    // SETUP: a real NON-git temp dir with one pre-existing file (so the tree is non-empty).
    const repoDir = makeNonGitDir("rev-cas-delete-off-");
    dirs.push(repoDir);
    writeFileSync(join(repoDir, "existing.txt"), "E1\n");

    const storageDir = makeStorage();
    dirs.push(storageDir);
    // config gate OFF + per-call flag ON → the cas double-gate (cas.ts:1057/1078) refuses deletion.
    setConfig({
      revert: { enabled: true, nonGitMode: "cas", allowDeleteCreatedFiles: false, storageDir },
    });

    const store = await detectAndCreate(repoDir, getConfig().revert);
    expect(store.describe().backend).toBe("cas");

    const sid = "s-cas-delete-off";
    const rt = getRuntime(sid);
    rt.store = store;
    const { appended, pi } = makePi();
    const contextEntries = [
      msgEntry(user("create a file")),
      msgEntry(asstWrite("w1", "new.ts")),
      msgEntry(result("w1")),
      msgEntry(asst("final")),
      msgEntry(result("final")),
    ];
    const { ctx } = makeCtx({ sessionId: sid, contextEntries });

    // CAPTURE turn_start (beforeRef — new.ts does NOT exist yet; cas whole-tree walk records it absent).
    await turnStartCaptureHandler(
      { type: "turn_start", turnIndex: 0, timestamp: Date.now() },
      ctx,
    );
    expect(rt.snapshots?.get("turn")?.beforeRef).toBe("turn");

    // CREATE the file IN-SPAN (after turn_start so it is absent from the beforeRef manifest —
    // CRITICAL #7: a file present at turn_start IS in the manifest and would NOT be deleted).
    writeFileSync(join(repoDir, "new.ts"), "CREATED\n");

    // CAPTURE agent_end.
    await agentEndCaptureHandler({ type: "agent_end", messages: [] }, ctx);
    expect(rt.snapshots?.get("turn")?.afterRef).toBe("turn-after");

    // DRIVE: per-call delete_created_files:true — but the config gate is OFF → the double-gate
    // blocks the unlink ⇒ file stays, deletedFiles empty.
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_turn", delete_created_files: true },
      "final",
    );

    // ASSERT the created file STILL EXISTS (NOT deleted).
    expect(existsSync(join(repoDir, "new.ts"))).toBe(true);

    // ASSERT marker.deletedFiles is empty (the config gate blocked the double-gate).
    const revert = rewindMarker(appended).revert;
    expect(revert?.deletedFiles).toEqual([]);

    // ASSERT rewind succeeds (not a refusal).
    expect(firstText(res)).not.toContain("Mulligan: refused");
  });

  it("F-revert-delete (cas, on): deletion PERFORMED when allowDeleteCreatedFiles is true (file gone; deletedFiles populated)", async () => {
    // SEPARATE repo + store + runtime (do NOT reuse the off-sub-case's captured refs — a second
    // turn_start on the same runtime would GC the prior turn/* refs).
    const repoDir = makeNonGitDir("rev-cas-delete-on-");
    dirs.push(repoDir);
    writeFileSync(join(repoDir, "existing.txt"), "E1\n");

    const storageDir = makeStorage();
    dirs.push(storageDir);
    // config gate ON + per-call flag ON → the cas double-gate permits deletion.
    setConfig({
      revert: { enabled: true, nonGitMode: "cas", allowDeleteCreatedFiles: true, storageDir },
    });

    const store = await detectAndCreate(repoDir, getConfig().revert);
    expect(store.describe().backend).toBe("cas");

    const sid = "s-cas-delete-on";
    const rt = getRuntime(sid);
    rt.store = store;
    const { appended, pi } = makePi();
    const contextEntries = [
      msgEntry(user("create a file")),
      msgEntry(asstWrite("w1", "new.ts")),
      msgEntry(result("w1")),
      msgEntry(asst("final")),
      msgEntry(result("final")),
    ];
    const { ctx } = makeCtx({ sessionId: sid, contextEntries });

    // CAPTURE turn_start.
    await turnStartCaptureHandler(
      { type: "turn_start", turnIndex: 0, timestamp: Date.now() },
      ctx,
    );
    expect(rt.snapshots?.get("turn")?.beforeRef).toBe("turn");

    // CREATE the file IN-SPAN (after turn_start so it is absent from the beforeRef manifest).
    writeFileSync(join(repoDir, "new.ts"), "CREATED\n");

    // CAPTURE agent_end.
    await agentEndCaptureHandler({ type: "agent_end", messages: [] }, ctx);
    expect(rt.snapshots?.get("turn")?.afterRef).toBe("turn-after");

    // DRIVE: per-call delete_created_files:true AND config gate ON → the cas tree-walk delete
    // (cas.ts:1073-1094: walk present-not-in-beforeRef files + unlink) removes new.ts.
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_turn", delete_created_files: true },
      "final",
    );

    // ASSERT the created file is GONE (deleted).
    expect(existsSync(join(repoDir, "new.ts"))).toBe(false);

    // ASSERT marker.deletedFiles ⊇ {new.ts}.
    const revert = rewindMarker(appended).revert;
    expect(revert?.deletedFiles).toEqual(expect.arrayContaining(["new.ts"]));

    // sanity: not a refusal.
    expect(firstText(res)).not.toContain("Mulligan: refused");
  });
});