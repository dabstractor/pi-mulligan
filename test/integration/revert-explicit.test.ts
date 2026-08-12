/**
 * revert-explicit.test.ts — F-revert-explicit REAL-hook integration test
 * (spec/10-testing.md §2.1 scenario table row F-revert-explicit;
 *  spec/14-working-tree-revert.md §4.2 "explicit-paths" — write/edit paths captured at tool_call time
 *  via the REAL toolCallCaptureHandler, bash NOT captured + warned once per turn via notifyBashUsed).
 *
 * This file SUPERSEDES the stale direct-drive `F-revert-explicit` workaround `it()` block that used to
 * live in revert-cas.test.ts. That old block's header comment asserted "there is NO tool_call hook" and
 * drove capture DIRECTLY (store.capture("turn",[...]) + store.notifyBashUsed()). As of P1.M3.T1.S1/S2
 * that is FALSE: the REAL `toolCallCaptureHandler` is wired (S1) and `appendExplicitPath` exists (S2),
 * so this test drives the REAL hook chain end-to-end:
 *   turnStartCaptureHandler → toolCallCaptureHandler(write/edit) → [mutate] →
 *   toolCallCaptureHandler(bash) → agentEndCaptureHandler → restore.
 *
 * Two scenarios (mirror spec/10 §2.1 row F-revert-explicit, split so the dirty-guard false-refuse
 * gotcha — BUG-004 / P1.M4, out of scope here — does not contaminate the assertions):
 *
 *   F-revert-explicit-write — non-git, explicit-paths mode, NO bash: write+edit reverted end-to-end
 *                             through the REAL capture hooks + the REAL rewind tool. The dirty guard is
 *                             CLEAN (no bash ⇒ ledger.modifiedFiles ⊆ afterRef-manifest paths). backend
 *                             "cas"; marker.revert.revertedFiles ⊇ {a.ts, b.ts}.
 *   F-revert-explicit-bash  — non-git, explicit-paths mode: write reverted (a.ts), bash sed NOT reverted
 *                             (c.ts stays the sed result). Calls store.restore DIRECTLY to assert the
 *                             "bash not captured/not restored" contract cleanly (the rewind tool's dirty
 *                             guard would falsely REFUSE because c.ts exists-now but is absent from the
 *                             afterRef manifest — that is BUG-004, NOT this test's concern). Also
 *                             asserts the once-per-turn `console.warn` fires through the REAL
 *                             toolCallCaptureHandler(bash) (not a direct notifyBashUsed call).
 *
 * House idiom (copied VERBATIM from test/integration/revert-cas.test.ts): vitest, hand-rolled
 * makePi()/makeCtx() fakes (NO vi.fn()), `.js` import paths, clearAll() + setConfig(undefined)
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
  toolCallCaptureHandler,
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
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";

const execFile = promisify(execFileCb);

// ── temp-dir + sed helpers (copied VERBATIM from revert-cas.test.ts) ─────────

/** Run `sed -i <expr> <path>` (real, in-place). Universally available on Linux/macOS CI. */
async function sed(path: string, expr: string): Promise<void> {
  await execFile("sed", ["-i", expr, path]);
}

/** True iff `sed` is on PATH (the skip-guard for every scenario that uses bash). */
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

// ── synthetic ToolCallEvent factory (copied from test/capture.test.ts:936) ────
// input.path for write/edit (NOT file_path — file_path is the LEDGER message-args field, asstWrite).
// event.toolName === "write" does NOT narrow event.input in TS (CustomToolCallEvent.toolName is string),
// so the test builds the literal shape and casts `as ToolCallEvent` (the production handler casts too).
function makeToolCallEvent(
  toolName: string,
  input: Record<string, unknown>,
): ToolCallEvent {
  return { type: "tool_call", toolCallId: "tc1", toolName, input } as ToolCallEvent;
}

// ── fakes (copied VERBATIM in shape from revert-cas.test.ts) ─────────────────

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

describe("F-revert-explicit real-hook integration (spec/14 §4.2 / spec/10 §2.1)", () => {
  // ── F-revert-explicit-write (spec/10 §2.1 row F-revert-explicit / spec/14 §4.2) ──
  //
  // nonGitMode "explicit-paths", NO bash: drive the REAL hook chain
  // (turnStartCaptureHandler → toolCallCaptureHandler(write/edit) → agentEndCaptureHandler) to prove
  // BUG-003's fix — write/edit files ARE captured at tool_call time (appendExplicitPath appends to the
  // "turn" beforeRef manifest) and restored on undo. Then drive the REAL rewind tool. The dirty guard
  // is CLEAN here: with NO bash, ledger.modifiedFiles = {a.ts, b.ts} ⊆ the afterRef-manifest paths
  // (pendingExplicitPaths = {a.ts, b.ts}), so no path is falsely "dirty". (The write+edit+bash-sed
  // combo routed through the rewind tool is BUG-004 / P1.M4 — out of scope; that's why Scenario B
  // separates the bash case and calls store.restore directly.)
  it("F-revert-explicit-write: explicit-paths mode, NO bash — write+edit reverted via REAL hooks + REAL rewind tool; backend 'cas'; revertedFiles ⊇ {a,b}.ts", async () => {
    // SETUP: a real NON-git temp dir with two pre-span files.
    const repoDir = makeNonGitDir("rev-ex-write-");
    dirs.push(repoDir);
    writeFileSync(join(repoDir, "a.ts"), "A0\n");
    writeFileSync(join(repoDir, "b.ts"), "B0\n");
    // Prove non-git-ness (no .git — detectAndCreate must NOT find a git repo).
    expect(existsSync(join(repoDir, ".git"))).toBe(false);

    const preSpan = {
      a: readFileSync(join(repoDir, "a.ts"), "utf8"),
      b: readFileSync(join(repoDir, "b.ts"), "utf8"),
    };

    // SEPARATE storage dir (must NOT resolve inside cwd — config rejects that → NoOpStore).
    const storageDir = makeStorage();
    dirs.push(storageDir);

    // CONFIG + STORE + RUNTIME. explicit-paths mode (the conservative write/edit-only model).
    setConfig({ revert: { enabled: true, nonGitMode: "explicit-paths", storageDir } });
    const store = await detectAndCreate(repoDir, getConfig().revert);
    expect(store.describe().backend).toBe("cas"); // CRITICAL #3: still "cas" (the mode is a config knob)

    // WIRE the store into the runtime BEFORE the capture hooks (they self-gate on rt.store — CRITICAL).
    const sid = "s1";
    const rt = getRuntime(sid);
    rt.store = store; // before any capture call (the store is the capturing backend)

    const { appended, pi } = makePi();

    // The span contextEntries (ledger source) — repo-relative POSIX paths (extractFileLedger records
    // file_path verbatim). Put the toolCalls AFTER the user msg or the ledger is empty (CRITICAL #6:
    // last_turn removes everything AFTER the last user message). Built here; ctx reads them at execute
    // time. NO bash here — that's the whole point (dirty guard stays clean).
    const contextEntries = [
      msgEntry(user("rewrite the files")),
      msgEntry(asstWrite("w1", "a.ts")),
      msgEntry(result("w1")),
      msgEntry(asstEdit("e1", "b.ts")),
      msgEntry(result("e1")),
      msgEntry(asst("final")),
      msgEntry(result("final")),
    ];
    const { ctx } = makeCtx({ sessionId: sid, contextEntries });

    // CAPTURE turn_start (REAL hook — capture("turn") with NO explicitPaths; explicit-paths mode
    // writes an empty placeholder manifest that appendExplicitPath will grow).
    await turnStartCaptureHandler(
      { type: "turn_start", turnIndex: 0, timestamp: Date.now() },
      ctx,
    );
    expect(rt.snapshots?.get("turn")?.beforeRef).toBe("turn");

    // SIMULATE write tool_call (REAL hook, PRE-write capture — Pi awaits this hook in preflight BEFORE
    // the tool runs, so the file is still pre-write). toolCallCaptureHandler pushes "a.ts" into
    // rt.pendingExplicitPaths AND calls appendExplicitPath("turn","a.ts") capturing a.ts='A0\n'.
    await toolCallCaptureHandler(makeToolCallEvent("write", { path: "a.ts" }), ctx);

    // RUN the write tool (the abandoned work — mutate).
    writeFileSync(join(repoDir, "a.ts"), "A1\n");

    // SIMULATE edit tool_call (REAL hook, PRE-edit capture). Captures b.ts='B0\n' pre-edit.
    await toolCallCaptureHandler(makeToolCallEvent("edit", { path: "b.ts" }), ctx);

    // RUN the edit tool (mutate).
    writeFileSync(join(repoDir, "b.ts"), "B1\n");

    // CAPTURE agent_end (REAL hook — capture("turn-after", rt.pendingExplicitPaths /*=["a.ts","b.ts"]*/);
    // mutates the "turn" entry's afterRef in place).
    await agentEndCaptureHandler({ type: "agent_end", messages: [] }, ctx);
    expect(rt.snapshots?.get("turn")?.afterRef).toBe("turn-after");

    // DRIVE the REAL rewind tool (revert_file_changes → step 6b PROCEED branch → store.restore). The
    // dirty guard is CLEAN: ledger.modifiedFiles={a.ts,b.ts} ⊆ afterRef-manifest paths (no bash ⇒ no
    // un-manifested c.ts to falsely flag dirty).
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_turn", revert_file_changes: true },
      "final",
    );

    // ASSERT success + files restored through the REAL hooks.
    expect(firstText(res)).toContain("Reverted");
    expect(readFileSync(join(repoDir, "a.ts"), "utf8")).toBe(preSpan.a); // reverted to 'A0\n'
    expect(readFileSync(join(repoDir, "b.ts"), "utf8")).toBe(preSpan.b); // reverted to 'B0\n'

    // ASSERT backend + marker (CRITICAL #3: backend "cas"; revertedFiles ⊇ {a.ts, b.ts}).
    const marker = rewindMarker(appended);
    expect(marker.revert?.backend).toBe("cas");
    expect(marker.revert?.revertedFiles).toEqual(
      expect.arrayContaining(["a.ts", "b.ts"]),
    );
  });

  // ── F-revert-explicit-bash (spec/10 §2.1 row F-revert-explicit / spec/14 §4.2) ──
  //
  // nonGitMode "explicit-paths": write reverted (a.ts), bash sed NOT reverted (c.ts stays the sed
  // result — CRITICAL #4: explicit-paths never captures bash paths). Plus the once-per-turn bash
  // warning fires through the REAL toolCallCaptureHandler(bash) (which calls notifyBashUsed).
  //
  // DESIGN NOTE — why store.restore DIRECT, not the rewind tool (the dirty-guard false-refuse gotcha,
  // BUG-004 / P1.M4, OUT OF SCOPE here): the rewind tool sets affectedPaths = ledger.modifiedFiles, and
  // the ledger's bash high-precision parser extracts c.ts from `sed ... c.ts`. dirtyCheck then sees c.ts
  // exists-now but has NO entry in the afterRef manifest (c.ts is absent from pendingExplicitPaths ⇒
  // absent from the "turn-after" manifest) ⇒ DIRTY ⇒ REFUSE. That false-refuse is its own bug (BUG-004),
  // not the "bash not captured/not restored" contract THIS test pins. So Scenario B bypasses the rewind
  // tool's dirty guard entirely and asserts store.restore's contract directly: a.ts IS in the manifest
  // (captured via toolCallCaptureHandler(write)) ⇒ reverted; c.ts is NOT in the manifest (bash never
  // pushed it) ⇒ untouched.
  it("F-revert-explicit-bash: explicit-paths mode — write reverted, bash sed NOT reverted (+ once-per-turn warning via REAL hook); restore direct (bypasses dirty guard)", async () => {
    if (!(await sedAvailable())) {
      console.warn(
        "[revert-explicit] sed not on PATH — skipping F-revert-explicit-bash",
      );
      return;
    }

    // SETUP: a real NON-git temp dir with two pre-span files.
    const repoDir = makeNonGitDir("rev-ex-bash-");
    dirs.push(repoDir);
    writeFileSync(join(repoDir, "a.ts"), "A0\n");
    writeFileSync(join(repoDir, "c.ts"), "C0\n");

    const preSpan = {
      a: readFileSync(join(repoDir, "a.ts"), "utf8"),
      c: readFileSync(join(repoDir, "c.ts"), "utf8"),
    };

    const storageDir = makeStorage();
    dirs.push(storageDir);

    // CONFIG + STORE + RUNTIME. explicit-paths mode.
    setConfig({ revert: { enabled: true, nonGitMode: "explicit-paths", storageDir } });
    const store = await detectAndCreate(repoDir, getConfig().revert);
    expect(store.describe().backend).toBe("cas");

    // WIRE the store into the runtime BEFORE the capture hooks (CRITICAL — self-gate on rt.store).
    const sid = "s1";
    const rt = getRuntime(sid);
    rt.store = store; // before any capture call

    // BUILD ctx — contextEntries can be EMPTY (Scenario B does NOT drive the rewind tool; store.restore
    // needs no ctx/ledger). The capture hooks ignore contextEntries (they read sessionManager only).
    const { ctx } = makeCtx({ sessionId: sid, contextEntries: [] });

    // CAPTURE turn_start (REAL hook).
    await turnStartCaptureHandler(
      { type: "turn_start", turnIndex: 0, timestamp: Date.now() },
      ctx,
    );
    expect(rt.snapshots?.get("turn")?.beforeRef).toBe("turn");

    // SIMULATE write tool_call (REAL hook, PRE-write capture). Captures a.ts='A0\n' (the pre-write
    // state) into the "turn" beforeRef manifest + pushes "a.ts" into rt.pendingExplicitPaths.
    await toolCallCaptureHandler(makeToolCallEvent("write", { path: "a.ts" }), ctx);

    // RUN the write tool (the abandoned work — mutate).
    writeFileSync(join(repoDir, "a.ts"), "A1\n");

    // SIMULATE bash tool_call (REAL hook) + ASSERT THE WARNING fires once this turn through the REAL
    // hook (not a direct notifyBashUsed call). toolCallCaptureHandler calls notifyBashUsed internally
    // for toolName==="bash" — which emits the once-per-turn "explicit-paths" warning. c.ts is NOT
    // pushed to pendingExplicitPaths (the explicit-paths guarantee — §4.2: bash NOT captured).
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await toolCallCaptureHandler(
      makeToolCallEvent("bash", { command: "sed -i s/C0/C1/ c.ts" }),
      ctx,
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("explicit-paths"));
    warn.mockRestore();

    // RUN the bash mutation (c.ts now 'C1\n').
    await sed(join(repoDir, "c.ts"), "s/C0/C1/");

    // CAPTURE agent_end (REAL hook — capture("turn-after", rt.pendingExplicitPaths /*=["a.ts"]*/);
    // c.ts is ABSENT from the manifest).
    await agentEndCaptureHandler({ type: "agent_end", messages: [] }, ctx);
    expect(rt.snapshots?.get("turn")?.afterRef).toBe("turn-after");

    // RESTORE DIRECTLY — bypass the rewind tool's dirty guard (see DESIGN NOTE above: the guard would
    // falsely REFUSE because c.ts exists-now but is absent from the afterRef manifest — BUG-004, not
    // this test's contract). The point here is capture-doesn't-include-bash, not dirty-guard behavior.
    const rr = await (store as unknown as CasBackend).restore("turn", {
      revertFileChanges: true,
      deleteCreatedFiles: false,
    });

    // ASSERT: a.ts IS in the manifest (captured via the write tool_call hook) ⇒ reverted; c.ts is NOT
    // in the manifest (bash never pushed it) ⇒ untouched.
    expect(rr.reverted).toContain("a.ts");
    expect(rr.reverted).not.toContain("c.ts");
    expect(readFileSync(join(repoDir, "a.ts"), "utf8")).toBe(preSpan.a); // reverted to 'A0\n'
    expect(readFileSync(join(repoDir, "c.ts"), "utf8")).toBe("C1\n"); // NOT reverted (never captured)
  });
});