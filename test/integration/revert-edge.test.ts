/**
 * revert-edge.test.ts — F-revert-granularity + F-revert-reload integration tests
 * (spec/14-working-tree-revert.md §6 restore semantics + §2 capture lifecycle; spec/08-edge-cases.md E32
 * cross-reload durability + the granularity-mismatch branch in spec/05 §1 step 6b branch 3).
 *
 * TWO edge scenarios that complement test/integration/revert-git.test.ts:
 *
 *   F-revert-granularity — revert_file_changes:true on granularity:"last_tool_call_group" must NOT touch the
 *     working tree. The 6b decision tree fires branch 3 (granularity-mismatch notice) BEFORE store resolution,
 *     so NO store/checkpoint is needed. The file the agent "mutated" stays mutated; the persisted
 *     mulligan:rewind marker has NO `revert` block (undefined). Asserts the notice text VERBATIM.
 *
 *   F-revert-reload — drives a REAL git repo through the REAL capture hooks (turn_start / agent_end) +
 *     makeCheckpointCommand + makeRewindTool, then SIMULATES a `/resume` (resetRuntime + detectAndCreate on the
 *     SAME storage) and re-issues a checkpoint-rewind to prove E32 cross-reload DURABILITY: the ckpt:* git ref
 *     survives resetRuntime+detectAndCreate (store.has(R0) stays true) and the rebuilt in-memory snapshot
 *     restores the checkpoint. ALSO exercises the real checkpoint file-revert path (BUG-001 regression guard):
 *     a checkpoint captures ONCE (commands.ts sets beforeRef, NEVER afterRef), so per spec/14 §6 step 3 the dirty
 *     guard is SKIPPED for checkpoint granularity (post BUG-001 fix: `afterRef = checkpoint.afterRef` with NO
 *     `?? beforeRef` fallback). The checkpoint-rewind span therefore CAN and DOES contain a real `write` toolCall
 *     to a.ts, which IS reverted — this test FAILS without the BUG-001 fix (the pre-fix fallback afterRef=beforeRef
 *     would flag the agent's own write as drift → REFUSE, a.ts stays A3-resume).
 *
 * House idiom (mirror test/tools/rewind.test.ts + test/integration/revert-git.test.ts): vitest, hand-rolled
 * `makePi()` / `makeCtx()` / `makeSessionCtx()` fakes (NO vi.fn()), `.js` import paths, `clearAll()` +
 * `setConfig(undefined)` before/after each, REAL `git` via promisified execFile, temp dirs chmod-restored + rm'd
 * in afterEach. NO production changes — test-only.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  chmodSync,
  readdirSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

import { makeCheckpointCommand } from "../../src/commands.js";
import {
  turnStartCaptureHandler,
  agentEndCaptureHandler,
  gcTurnSnapshots,
  rebuildCheckpointSnapshots,
} from "../../src/capture.js";
import { detectAndCreate, type SnapshotStore } from "../../src/snapshot/store.js";
import {
  makeRewindTool,
  type RewindArgs,
  type RewindDetails,
} from "../../src/tools/rewind.js";
import { getRuntime, resetRuntime, clearAll } from "../../src/runtime.js";
import { setConfig, getConfig } from "../../src/config.js";
import type { RevertCheckpoint } from "../../src/markers.js";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

const execFile = promisify(execFileCb);

// ── git helpers ─────────────────────────────────────────────────────────────

/** Run a git command in `cwd`, returning {stdout}. Mirrors the revert-git.test.ts idiom. */
async function git(cwd: string, args: string[]): Promise<{ stdout: string }> {
  return execFile("git", args, { cwd, maxBuffer: 1 << 22 });
}

/** True iff `git` is on PATH (the skip-guard for F-revert-reload — real `git init` needs the binary). */
async function gitAvailable(): Promise<boolean> {
  try {
    await execFile("git", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

/** A fresh temp dir that is a REAL git repo (`git init -b main`). */
async function makeRepo(prefix: string): Promise<string> {
  const repoDir = mkdtempSync(join(tmpdir(), prefix));
  await git(repoDir, ["init", "-b", "main"]);
  return repoDir;
}

/** A SEPARATE fresh temp dir for snapshot storage (MUST NOT be inside the repo — config rejects that). */
function makeStorage(): string {
  return mkdtempSync(join(tmpdir(), "mulligan-store-"));
}

/** The canonical valid note (3 non-empty fields). Copied from test/tools/rewind.test.ts. */
const VALID_NOTE = {
  what_happened:
    "Ran a repo-wide grep that dumped ~38k tokens; don't grep without -l; use the built-in grep tool which truncates.",
  true_current_state: "No files changed on the abandoned span.",
  next: "Re-run as grep -rl auth src/ and read only the 3 relevant files.",
};

// ── fakes (copied VERBATIM in shape from test/tools/rewind.test.ts + test/integration/revert-git.test.ts) ──

/**
 * A minimal fake ExtensionAPI capturing appendEntry + sendMessage + setLabel (hand-rolled, no vi.fn()).
 * In makeSessionCtx the SAME `appended` array backs sessionManager reads (see makeSessionCtx).
 */
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

/**
 * A minimal fake ExtensionContext for Scenario 1 (F-revert-granularity). buildContextEntries() returns the
 * snapshot (the ledger/K source); getEntries/getLabel/getBranch are read-only no-ops (the granularity-mismatch
 * branch fires before any store/checkpoint is touched). NO getContextUsage (the 4c context-fraction guard is
 * skipped when windowTokens===0). Mirrors the makeCtx in revert-git.test.ts.
 */
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

/**
 * makeSessionCtx — a RICHER fake whose SHARED mutable `entries` array backs BOTH `pi.appendEntry` (writes) AND
 * `sessionManager.getEntries()/getBranch()/getLabel()` (reads). This is required for Scenario 2: setCheckpoint
 * (via makeCheckpointCommand) anchors on getBranch()'s last real message then setLabel()s it; checkpointExists +
 * countRewindMarkers + the marker persist all scan getEntries(); the marker's id is getLeafId(). So appendEntry's
 * custom/label entries MUST accumulate into the SAME array the sessionManager reads — otherwise the rewind tool's
 * downstream scans see a stale stream and the assertions break.
 *
 * `appendEntry` pushes structural entries that mirror Pi's real CustomEntry/LabelEntry shapes so the rewind tool's
 * defensive `(e as {...})` casts resolve them. `setLabel(entryId, label)` pushes a LabelEntry (label undefined =
 * a CLEAR); `getLabel(id)` is LATEST-WINS (the last entry whose targetId===id wins; undefined once cleared).
 * `getEntries()`/`getBranch()`/`buildContextEntries()` all return the SAME shared array (the branch IS the whole
 * stream for this fake — the rewind tool reads getBranch() for resolveCheckpoint and getEntries() for marker
 * scans). `hasUI:false` (no TUI in the test). Cast to ExtensionCommandContext (the command-handler arg type).
 */
function makeSessionCtx(opts: {
  sessionId: string;
  seedEntries?: unknown[];
  leafId?: string;
}) {
  const sessionId = opts.sessionId;
  const leafId = opts.leafId ?? "leaf-1";
  // SHARED mutable array — backs BOTH pi.appendEntry writes AND sessionManager reads.
  const entries: unknown[] = opts.seedEntries ? [...opts.seedEntries] : [];
  let n = 0; // monotonic entry counter for synthetic ids
  const pi = {
    appendEntry(customType: string, data?: unknown) {
      const id = `e-${++n}`;
      entries.push({ type: "custom", id, customType, data });
    },
    sendMessage(message: unknown, options?: unknown) {
      entries.push({ type: "message", message, options });
    },
    setLabel(targetId: string, label: string | undefined) {
      entries.push({ type: "label", targetId, label });
    },
  };
  const sessionManager = {
    getSessionId() {
      return sessionId;
    },
    getLeafId() {
      return leafId;
    },
    // LATEST-WINS label resolution: scan the stream for label entries whose targetId===id; the LAST wins.
    // undefined once a clear (label:undefined) follows the set. Mirrors Pi's real latest-wins semantics.
    getLabel(id: string): string | undefined {
      let cur: string | undefined = undefined;
      for (const e of entries) {
        if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
        const ee = e as { type?: unknown; targetId?: unknown; label?: unknown };
        if (ee.type === "label" && ee.targetId === id) {
          cur = ee.label as string | undefined;
        }
      }
      return cur;
    },
    getEntries() {
      return entries;
    },
    getBranch() {
      return entries;
    },
    buildContextEntries() {
      return entries;
    },
  };
  const notifies: { msg: string; type: string }[] = [];
  const ctx = {
    hasUI: false, // no TUI in the test; makeCheckpointCommand's notify() is a guarded no-op
    ui: {
      notify(msg: string, type: string) {
        notifies.push({ msg, type });
      },
    },
    sessionManager,
  };
  return {
    appended: entries, // the SHARED array — pi.appendEntry pushes into it
    notifies,
    pi: pi as unknown as ExtensionAPI,
    ctx: ctx as unknown as ExtensionCommandContext,
  };
}

// ── message builders (copied from revert-git.test.ts) ───────────────────────

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

/** Build an assistant message whose toolCall is a `write` to a path (ledger → modifiedFiles). */
function asstWrite(callId: string, file_path: string): Record<string, unknown> {
  return {
    role: "assistant",
    content: [
      { type: "toolCall", id: callId, name: "write", arguments: { file_path } },
    ],
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

/** Read the persisted `mulligan:rewind` marker's `revert` block from the captured entries (undefined if absent). */
function rewindMarker(
  appended: { customType: string; data: unknown }[],
): { data: Record<string, unknown> } {
  const rw = appended.find((e) => e.customType === "mulligan:rewind");
  expect(rw).toBeTruthy();
  return rw as { data: Record<string, unknown> };
}

// ── shared scaffolding: reset + temp-dir cleanup ────────────────────────────

/** Tracks temp dirs created per-test for chmod-restore + rm in afterEach (read-only files block rm). */
const dirs: string[] = [];

beforeEach(() => {
  clearAll();
  setConfig(undefined); // reset the config cache to validated DEFAULT_CONFIG
});

afterEach(() => {
  clearAll();
  setConfig(undefined);
  for (const d of dirs) {
    try {
      // chmod 0o755 recursively so rm can clean up read-only files (chmod 0o444 blocks rm).
      chmodRecursive(d, 0o755);
    } catch {
      /* best-effort */
    }
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
  dirs.length = 0;
});

/** Recursively chmod a dir + all entries (so read-only files/dirs don't block rmSync). */
function chmodRecursive(root: string, mode: number): void {
  try {
    chmodSync(root, mode);
  } catch {
    /* ignore — may not exist */
  }
  try {
    const st = statSync(root);
    if (st.isDirectory()) {
      for (const name of readdirSync(root)) {
        chmodRecursive(join(root, name), mode);
      }
    }
  } catch {
    /* ignore */
  }
}

// ── the scenarios ───────────────────────────────────────────────────────────

describe("F-revert-* edge integration (spec/14 §6 + §2 / spec/08 E32)", () => {
  // ── F-revert-granularity (spec/05 §1 step 6b branch 3) ────────────────────

  it("F-revert-granularity: revert_file_changes on last_tool_call_group SKIPS the working tree (branch 3 fires before store); marker.revert undefined; file unchanged", async () => {
    // A PLAIN (non-git) temp dir + a mutated file. NO store / NO checkpoint is needed: the 6b decision tree
    // fires branch 3 (granularity-mismatch) BEFORE store resolution, so the store field is never read.
    const workDir = mkdtempSync(join(tmpdir(), "rev-gran-"));
    dirs.push(workDir);
    const aPath = join(workDir, "a.ts");
    writeFileSync(aPath, "A1\n");
    // Simulate the agent mutating a.ts in-span (this is the byte sequence the revert would have restored FROM
    // — but it must NOT, because the granularity is last_tool_call_group).
    writeFileSync(aPath, "A1-mutated\n");

    // revert must be ENABLED in config so we reach branch 3 (branch 2 = "disabled" would fire otherwise).
    // setConfig MERGES partial (GOTCHA #11): {revert:{enabled:true}} deep-merges over DEFAULT_CONFIG.
    setConfig({ revert: { enabled: true } });
    expect(getConfig().revert.enabled).toBe(true);

    const sid = "s-gran";
    const { appended, pi } = makePi();

    // The last_tool_call_group span: user → asst(w1 writes a.ts) → result(w1) → asst(final) → result(final).
    // resolveLastToolCallGroup resolves the [asst(final), result(final)] tool-call group as the rewind target;
    // extractFileLedger scans that group for mutating toolCalls. The w1 write is OUTSIDE the group, so even the
    // ledger's modifiedFiles is empty here — but that is IRRELEVANT: branch 3 skips BEFORE ledger-dependent logic.
    const contextEntries = [
      msgEntry(user("edit the file")),
      msgEntry(asstWrite("w1", "a.ts")),
      msgEntry(result("w1")),
      msgEntry(asst("final")),
      msgEntry(result("final")),
    ];
    const { ctx } = makeCtx({ sessionId: sid, contextEntries });

    // DRIVE the REAL rewind tool with revert_file_changes:true + granularity:last_tool_call_group.
    // CRITICAL #1: branch 3 fires before store resolution → rt.store being undefined is fine.
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_tool_call_group", revert_file_changes: true },
      "final",
    );

    // ASSERT the granularity-mismatch notice is in the success text (VERBATIM from spec/05 §1 step 6b branch 3).
    expect(firstText(res)).toContain(
      "File revert applies to last_turn/checkpoint granularity",
    );
    expect(firstText(res)).toContain("rewound last_tool_call_group");

    // ASSERT the file is UNCHANGED — the working tree was NOT touched (branch 3 never reached store.restore).
    expect(readFileSync(aPath, "utf8")).toBe("A1-mutated\n");

    // ASSERT a mulligan:rewind marker WAS persisted (the rewind itself always completes).
    const marker = rewindMarker(appended);

    // ASSERT the marker's `revert` block is ABSENT (undefined) — branch 3 skips before revertBlock assignment.
    // CRITICAL: JSON.stringify omits undefined fields, so `revert` is simply not present on the payload.
    expect(marker.data.revert).toBeUndefined();
  });

  // ── F-revert-reload (spec/08 E32 cross-reload durability + CRITICAL #3 dirty-guard bypass) ─────────

  it("F-revert-reload: ckpt:* ref survives resetRuntime+detectAndCreate (E32); rebuilt snapshot restores checkpoint; checkpoint-rewind bypasses the dirty guard (CRITICAL #3)", async () => {
    if (!(await gitAvailable())) {
      console.warn("[revert-edge] git not on PATH — skipping F-revert-reload");
      return;
    }

    // SETUP: a real git repo with an initial commit (so .git is populated → GitBackend).
    const repoDir = await makeRepo("rev-reload-");
    dirs.push(repoDir);
    writeFileSync(join(repoDir, "a.ts"), "A0\n");
    await git(repoDir, ["add", "-A"]);
    await git(repoDir, ["config", "user.email", "test@example.com"]);
    await git(repoDir, ["config", "user.name", "Test"]);
    await git(repoDir, ["commit", "-m", "init"]);

    // SEPARATE storage dir (CRITICAL #13: MUST NOT be inside repoDir — config rejects inside-cwd → NoOpStore).
    const storageDir = makeStorage();
    dirs.push(storageDir);
    // CRITICAL #11: setConfig MERGES {revert:{...}} over DEFAULT_CONFIG.
    setConfig({ revert: { enabled: true, storageDir } });

    // REAL store via detectAndCreate (GitBackend). Re-create the SAME store after resetRuntime below (E32).
    const store = await detectAndCreate(repoDir, getConfig().revert);
    expect(store.describe().backend).toBe("git");

    const sid = "s-reload";
    // CRITICAL #14: assign rt.store BEFORE any hook/command (they self-gate on rt.store).
    const rt = getRuntime(sid);
    rt.store = store;

    // makeSessionCtx: the SHARED mutable `entries` array backs BOTH pi.appendEntry AND sessionManager reads.
    // CRITICAL #5: setCheckpoint anchors on the LAST REAL message in getBranch() → seed a user+asst BEFORE the
    // checkpoint command so setCheckpoint has a stable anchor (a branch with no message → "no conversation
    // message to checkpoint" refusal).
    const seed = [
      { type: "message", id: "u1", parentId: null, timestamp: 0, message: user("seed the branch") },
      { type: "message", id: "a1", parentId: "u1", timestamp: 0, message: asst("seed-asst") },
    ];
    const { appended, pi, ctx } = makeSessionCtx({ sessionId: sid, seedEntries: seed, leafId: "a1" });

    // ── (a) makeCheckpointCommand("x") — captures ckpt:x + persists mulligan:revert-checkpoint control entry ──
    await makeCheckpointCommand(pi).handler("x", ctx);

    // ASSERT step 4b persisted the mulligan:revert-checkpoint control entry { label, ref, backend }.
    const ckptControl = (appended as unknown[]).find(
      (e) =>
        typeof e === "object" &&
        e !== null &&
        (e as { customType?: string }).customType === "mulligan:revert-checkpoint",
    );
    expect(ckptControl).toBeTruthy();
    const ckptControlData = (ckptControl as { data: Record<string, unknown> }).data;
    expect(ckptControlData.label).toBe("ckpt:x");
    expect(typeof ckptControlData.ref).toBe("string");
    expect(ckptControlData.backend).toBe("git");

    // ASSERT rt.snapshots got the ckpt:x RevertCheckpoint (backend git; beforeRef set; turnIndex -1 sentinel).
    const ckptSnap = rt.snapshots?.get("ckpt:x") as RevertCheckpoint | undefined;
    expect(ckptSnap).toBeTruthy();
    expect(ckptSnap!.backend).toBe("git");
    expect(ckptSnap!.beforeRef).toBe(ckptControlData.ref);
    expect(ckptSnap!.turnIndex).toBe(-1); // sentinel: checkpoint, not turn-bound

    // R0 = the ckpt:x beforeRef — this is the git object that MUST survive the simulated /resume (E32).
    const R0 = ckptSnap!.beforeRef;
    expect(R0).toBeTruthy();

    // ── (b) turn_start capture → rt.snapshots.get("turn").beforeRef set ─────────────────────────────
    await turnStartCaptureHandler(
      { type: "turn_start", turnIndex: 0, timestamp: Date.now() },
      ctx,
    );
    const turnSnap = rt.snapshots?.get("turn") as RevertCheckpoint | undefined;
    expect(turnSnap?.beforeRef).toBeTruthy();

    // ── (c) mutate the file in-span (after turn_start's snapshot, before agent_end's) ────────────────
    writeFileSync(join(repoDir, "a.ts"), "A1\n");

    // ── (d) agent_end capture → turn checkpoint's afterRef set in place ─────────────────────────────
    await agentEndCaptureHandler({ type: "agent_end", messages: [] }, ctx);
    expect((rt.snapshots?.get("turn") as RevertCheckpoint)?.afterRef).toBeTruthy();

    // ── (e) rewind last_turn with revert → "Reverted"; a.ts → "A0\n"; marker.revert.backend git ───────
    //    Build the last_turn span context: a fresh user prompt + the in-span write. (The makeSessionCtx shared
    //    array already carries u1/a1 from the seed + the checkpoint's control entry; push the turn's messages
    //    so resolveLastTurn + extractFileLedger see them.)
    appended.push({ type: "message", id: "u2", parentId: "a1", timestamp: 0, message: user("do it") } as never);
    appended.push({ type: "message", id: "a2", parentId: "u2", timestamp: 0, message: asstWrite("w1", "a.ts") } as never);
    appended.push({ type: "message", id: "r1", parentId: "a2", timestamp: 0, message: result("w1") } as never);

    // The turn checkpoint has a REAL afterRef → clean dirty guard (CRITICAL #8) → PROCEED.
    const res1 = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_turn", revert_file_changes: true },
      "final",
    );
    expect(firstText(res1)).toContain("Reverted");
    expect(firstText(res1)).toContain("rewound last_turn");
    expect(readFileSync(join(repoDir, "a.ts"), "utf8")).toBe("A0\n");

    // The persisted marker's revert block names the git backend + the reverted file.
    // (appended is the makeSessionCtx shared array of MIXED entry types; cast to the marker scan shape.)
    const marker1 = rewindMarker(appended as unknown as { customType: string; data: unknown }[]);
    const revert1 = marker1.data.revert as { backend?: string; revertedFiles?: string[] } | undefined;
    expect(revert1?.backend).toBe("git");

    // ── (f) mutate the file AGAIN (simulating post-reload work) ─────────────────────────────────────
    writeFileSync(join(repoDir, "a.ts"), "A2-postreload\n");
    expect(readFileSync(join(repoDir, "a.ts"), "utf8")).toBe("A2-postreload\n");

    // ── (g) SIMULATE /resume: resetRuntime + detectAndCreate on the SAME storage (E32 durability) ────
    //
    // A real /resume reloads the session AND the Mulligan filter HIDES messages removed by a prior rewind
    // marker. Step (e)'s last_turn rewind hid u2/a2(write)/r1, so in the reloaded (filtered) view those
    // message entries are GONE — the checkpoint-rewind span (from the a1 anchor to leaf) then carries only the
    // surviving seed + the post-/resume messages. Step (h) below pushes a REAL `write` to a.ts onto that span
    // (the BUG-001 regression guard): modifiedFiles=["a.ts"], which post-fix takes the skipped-guard branch
    // (PROCEED → store.restore(R0) → a.ts→A0) and PRE-fix would trip the beforeRef-baseline REFUSE. Our
    // makeSessionCtx.buildContextEntries() returns the raw shared array (no filter), so we
    // SIMULATE the filtered post-/resume view here by excising the rewound message entries (u2/a2/r1),
    // keeping the seed + the checkpoint label + the control entry (the non-message bookkeeping survives).
    const rewoundIds = new Set(["u2", "a2", "r1"]);
    for (let i = appended.length - 1; i >= 0; i--) {
      const e = appended[i];
      if (
        typeof e === "object" &&
        e !== null &&
        (e as { id?: unknown }).id !== undefined &&
        rewoundIds.has((e as { id: unknown }).id as string)
      ) {
        appended.splice(i, 1);
      }
    }

    resetRuntime(sid);
    const rt2 = getRuntime(sid); // fresh runtime: store + snapshots cleared
    expect(rt2.store).toBeUndefined();
    expect(rt2.snapshots?.size ?? 0).toBe(0);

    // Re-create the store on the SAME storage dir — the ckpt:x git ref MUST survive (E32).
    const store2: SnapshotStore = await detectAndCreate(repoDir, getConfig().revert);
    expect(store2.describe().backend).toBe("git");
    rt2.store = store2; // CRITICAL #14: assign BEFORE gcTurnSnapshots (it self-gates on rt.store)

    // gcTurnSnapshots drops turn/* refs (already retired by the prior turn's retire) but EXEMPTS ckpt:*.
    await gcTurnSnapshots(rt2);

    // E32 DURABILITY: the R0 git object is STILL resolvable after resetRuntime + detectAndCreate(same storage).
    expect(await store2.has(R0)).toBe(true);

    // [P1.M2.T1.S2 / BUG-002] Production now rebuilds rt2.snapshots from the persisted control entries —
    // call the SAME exported helper session_start uses (rebuildCheckpointSnapshots in capture.ts) instead
    // of hand-simulating it. This proves the PRODUCTION read-path populates the snapshot, not a test
    // replica. (Previously this block manually iterated `appended` and called rt2.snapshots.set() — a
    // simulation that masked BUG-002. makeSessionCtx exposes the same shared array via getEntries(), so
    // the helper reads identical data.)
    await rebuildCheckpointSnapshots(ctx, rt2);

    // ASSERT the rebuilt snapshot restored ckpt:x's beforeRef === R0.
    const rebuiltCkpt = rt2.snapshots?.get("ckpt:x") as RevertCheckpoint | undefined;
    expect(rebuiltCkpt).toBeTruthy();
    expect(rebuiltCkpt!.beforeRef).toBe(R0);
    expect(rebuiltCkpt!.backend).toBe("git");

    // ── (h) rewind checkpoint "x" with revert → "Reverted"; a.ts "A3-resume\n" → "A0\n" ──────────────
    //    BUG-001 regression guard. The checkpoint span now contains a REAL `write` to a.ts (asstWrite("w2")),
    //    so ledger.modifiedFiles=["a.ts"] (the heuristic picks up a real write toolCall). Two outcomes:
    //    • WITHOUT the BUG-001 fix: `afterRef = checkpoint.afterRef ?? checkpoint.beforeRef` (= R0). Then
    //      dirtyCheck(R0, ["a.ts"]) compares the CURRENT tree to the PRE-checkpoint state R0 — the agent's
    //      OWN in-span write (A3-resume) is flagged as drift → REFUSE → a.ts STAYS "A3-resume\n", and the
    //      result text carries the REFUSE clause ("file revert refused …").
    //    • WITH the fix: `afterRef = checkpoint.afterRef` (undefined — checkpoints never set afterRef). The
    //      `else` branch fires → doRestore() → store.restore(R0) → a.ts → "A0\n" (PROCEED clause "Reverted …").
    //    The on-disk writeFileSync is ALSO required so the real working tree differs from R0 (the ledger is
    //    advisory, but store.restore/dirtyCheck read the REAL tree). parentId chains back to a1 (the surviving
    //    anchor); the "final" rewind toolCallId needs no matching stream message (resolveCheckpoint resolves
    //    to the branch leaf regardless — the prior degenerate step (h) already relied on this).
    writeFileSync(join(repoDir, "a.ts"), "A3-resume\n");
    appended.push({ type: "message", id: "u3", parentId: "a1", timestamp: 0, message: user("resume and reconsider") } as never);
    appended.push({ type: "message", id: "a3", parentId: "u3", timestamp: 0, message: asstWrite("w2", "a.ts") } as never);
    appended.push({ type: "message", id: "r2", parentId: "a3", timestamp: 0, message: result("w2") } as never);

    const res2 = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "checkpoint", checkpoint: "x", revert_file_changes: true },
      "final",
    );
    expect(firstText(res2)).toContain("Reverted"); // PROCEED clause
    expect(firstText(res2)).toContain("rewound checkpoint");
    // REFUSE clause MUST be absent. NOTE: the PROCEED clause ("… N refused (see log).") itself contains the
    // substring "refused", so the absence assertion MUST key on the REFUSE-only string "file revert refused",
    // never bare "refused".
    expect(firstText(res2)).not.toContain("file revert refused");
    // a.ts reverted from "A3-resume\n" back to "A0\n" (the ckpt:x beforeRef state) — FAILS without the BUG-001 fix.
    expect(readFileSync(join(repoDir, "a.ts"), "utf8")).toBe("A0\n");

    // The persisted marker's revert block names the git backend + the reverted file.
    const markers = (appended as unknown[]).filter(
      (e) => typeof e === "object" && e !== null && (e as { customType?: string }).customType === "mulligan:rewind",
    );
    const lastMarker = markers[markers.length - 1] as { data: Record<string, unknown> };
    expect(lastMarker).toBeTruthy();
    const revert2 = lastMarker.data.revert as { backend?: string; revertedFiles?: string[] } | undefined;
    expect(revert2?.backend).toBe("git");
    expect(revert2?.revertedFiles).toEqual(expect.arrayContaining(["a.ts"]));
  });
});