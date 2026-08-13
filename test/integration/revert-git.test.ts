/**
 * revert-git.test.ts — F-revert-git + F-revert-failopen + F-revert-delete integration tests
 * (spec/10-testing.md §2.1 scenario table; spec/14-working-tree-revert.md §3 the FIVE git-safety
 * guarantees + §6 restore semantics; spec/08-edge-cases.md E27 fail-open + E30 dirty-guard refuse).
 *
 * Drives the REAL v1.2 working-tree-revert subsystem end-to-end against REAL temp git repos:
 *   - `detectAndCreate` (real `GitBackend` — no fakes)
 *   - the REAL `turnStartCaptureHandler` / `agentEndCaptureHandler` capture hooks (no fakes)
 *   - the REAL `makeRewindTool` (no `makeFakeStore`)
 *
 * Three scenarios (mirror the spike table in spec/10 §2.1 / the PRD §10 F-revert-* rows):
 *   F-revert-git     — mutate via write+edit+bash sed; rewind last_turn with revert_file_changes; assert
 *                      ALL three files restored (incl. the sed file, reverted via the git index diff even
 *                      though the ledger never names it), the user's `.git` byte-identical, the shadow ref
 *                      present then cleared by retire, and marker.revert.revertedFiles populated.
 *   F-revert-failopen — lock a directory read-only (git checkout unlinks+recreates the file, so a
 *                      read-only FILE doesn't stop it; a read-only DIRECTORY blocks the unlink → EACCES);
 *                      rewind still SUCCEEDS (fail-open, E27), the locked file lands in failedFiles, the
 *                      other file is still reverted.
 *   F-revert-delete  — allowDeleteCreatedFiles double-gate: deletion REFUSED when config off (file stays),
 *                      deleted when config on (deletedFiles populated).
 *
 * House idiom (mirror test/tools/rewind.test.ts + test/store.test.ts): vitest, hand-rolled
 * `makePi()`/`makeCtx()` fakes (NO vi.fn()), `.js` import paths, `clearAll()` + `setConfig(undefined)`
 * before/after each, REAL `git` via promisified execFile, temp dirs chmod-restored + rm'd in afterEach.
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
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";

import { detectAndCreate } from "../../src/snapshot/store.js";
import {
  turnStartCaptureHandler,
  agentEndCaptureHandler,
} from "../../src/capture.js";
import { makeRewindTool, type RewindArgs, type RewindDetails } from "../../src/tools/rewind.js";
import { setConfig, getConfig } from "../../src/config.js";
import { getRuntime, clearAll } from "../../src/runtime.js";
import type { RevertCheckpoint } from "../../src/markers.js";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const execFile = promisify(execFileCb);

// ── git helpers ─────────────────────────────────────────────────────────────

/** Run a git command in `cwd`, returning {stdout}. Mirrors the store.test.ts idiom. */
async function git(cwd: string, args: string[]): Promise<{ stdout: string }> {
  return execFile("git", args, { cwd, maxBuffer: 1 << 22 });
}

/** True iff `git` is on PATH (the skip-guard for every scenario — real `git init` needs the binary). */
async function gitAvailable(): Promise<boolean> {
  try {
    await execFile("git", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * hashDir — deterministic recursive SHA-256 over every regular file under `dir` (sort paths; concat
 * `<relpath>\0<sha256(filebytes)>\n`; return createHash). USED to assert the user's `.git` is
 * byte-identical before vs after the whole capture+mutate+rewind sequence (git-safety guarantee #3).
 */
function hashDir(dir: string): string {
  const out: string[] = [];
  const walk = (d: string, rel = "") => {
    for (const name of readdirSync(d).sort()) {
      const abs = join(d, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = statSync(abs);
      if (st.isDirectory()) {
        walk(abs, r);
      } else {
        out.push(
          `${r}\0${createHash("sha256").update(readFileSync(abs)).digest("hex")}\n`,
        );
      }
    }
  };
  walk(dir);
  return createHash("sha256").update(out.join("")).digest("hex");
}

/**
 * shadowKey — mirror GitBackend's repo-root key (src/snapshot/git.ts shadowKey). GitBackend resolves
 * repoRoot via `git rev-parse --show-toplevel` (may canonicalize symlinks), so we re-derive the SAME
 * way to locate the shadow repo dir inside `storageDir`.
 */
async function shadowKey(repoDir: string): Promise<string> {
  const { stdout } = await git(repoDir, ["rev-parse", "--show-toplevel"]);
  return createHash("sha256").update(stdout.trim()).digest("hex").slice(0, 16);
}

// ── temp-dir helpers ────────────────────────────────────────────────────────

/** A fresh temp dir that is a REAL git repo (`git init`), with an initial commit. */
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

// ── fakes (copied VERBATIM in shape from test/tools/rewind.test.ts) ──────────

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

/** A minimal fake ExtensionContext (sessionId + leafId + buildContextEntries). NO getContextUsage — so the
 *  (4c) context-fraction guard is SKIPPED (windowTokens 0 → no-op), matching the unit-test idiom. */
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

/** Read the persisted `mulligan:rewind` marker's `revert` block from the captured entries. */
function rewindRevert(appended: { customType: string; data: unknown }[]) {
  const rw = appended.find((e) => e.customType === "mulligan:rewind");
  expect(rw).toBeTruthy();
  return (rw!.data as { revert?: Record<string, unknown> }).revert;
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

describe("F-revert-* integration (spec/10 §2.1 / spec/14)", () => {
  // ── F-revert-git (spec/10 §2.1 row F-revert-git) ─────────────────────────

  it("F-revert-git: write+edit+bash sed all reverted; .git byte-identical; shadow ref present then cleared; marker.revert.revertedFiles populated", async () => {
    if (!(await gitAvailable())) {
      console.warn("[revert-git] git not on PATH — skipping F-revert-git");
      return;
    }

    // SETUP: a real git repo with an initial commit (so .git is populated).
    const repoDir = await makeRepo("rev-git-");
    dirs.push(repoDir);
    writeFileSync(join(repoDir, "a.ts"), "A1\n");
    writeFileSync(join(repoDir, "b.ts"), "B1\n");
    writeFileSync(join(repoDir, "c.ts"), "C1\n");
    await git(repoDir, ["add", "-A"]);
    // set git identity for the commit (CI may have none).
    await git(repoDir, ["config", "user.email", "test@example.com"]);
    await git(repoDir, ["config", "user.name", "Test"]);
    await git(repoDir, ["commit", "-m", "init"]);

    const preSpan = {
      a: readFileSync(join(repoDir, "a.ts"), "utf8"),
      b: readFileSync(join(repoDir, "b.ts"), "utf8"),
      c: readFileSync(join(repoDir, "c.ts"), "utf8"),
    };

    // SEPARATE storage dir (must NOT resolve inside cwd — config rejects that → NoOpStore).
    const storageDir = makeStorage();
    dirs.push(storageDir);
    setConfig({ revert: { enabled: true, storageDir } });

    // REAL store via detectAndCreate (GitBackend).
    const store = await detectAndCreate(repoDir, getConfig().revert);
    expect(store.describe().backend).toBe("git");

    // WIRE the store into the runtime BEFORE the capture hooks (they self-gate on rt.store).
    const sid = "s-git";
    const rt = getRuntime(sid);
    rt.store = store;

    const { appended, pi } = makePi();

    // The span contextEntries (ledger source) — repo-relative POSIX paths (extractFileLedger records
    // file_path verbatim; GitBackend restores repo-relative). Built here; read at execute time.
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

    // .git BYTE-IDENTICAL baseline (git-safety guarantee #3) — captured BEFORE the whole sequence.
    const dotGitBefore = hashDir(join(repoDir, ".git"));

    // CAPTURE turn_start (REAL hook) → rt.snapshots?.get("turn").beforeRef.
    await turnStartCaptureHandler(
      { type: "turn_start", turnIndex: 0, timestamp: Date.now() },
      ctx,
    );
    const turnCp = rt.snapshots?.get("turn");
    expect(turnCp?.beforeRef).toBeTruthy();

    // MUTATE the span (the three changes the rewind will later undo):
    //   a.ts via write, b.ts via edit (both recorded in ledger.modifiedFiles),
    //   c.ts via a REAL bash sed (recorded under bashSideEffects, NOT modifiedFiles — reverted via
    //   the git index diff in GitBackend.restore, which is the central assertion of this scenario).
    writeFileSync(join(repoDir, "a.ts"), "A2-rewritten\n");
    writeFileSync(join(repoDir, "b.ts"), "B2-rewritten\n");
    try {
      await execFile("sed", ["-i", "s/C1/C2-edited/", join(repoDir, "c.ts")]);
    } catch {
      // sed missing — fall back to a write (the scenario name prefers real sed, but the revert
      // behavior is identical: GitBackend.restore reverts it via the index diff regardless).
      writeFileSync(join(repoDir, "c.ts"), "C2-edited\n");
    }
    // sanity: the mutations took
    expect(readFileSync(join(repoDir, "c.ts"), "utf8")).toBe("C2-edited\n");

    // CAPTURE agent_end (REAL hook) → mutates the turn checkpoint's .afterRef in place.
    await agentEndCaptureHandler({ type: "agent_end", messages: [] }, ctx);
    expect(rt.snapshots?.get("turn")?.afterRef).toBeTruthy();

    // DRIVE the REAL rewind tool with revert_file_changes:true.
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_turn", revert_file_changes: true },
      "final",
    );

    // ASSERT success (not a refusal) + the revert clause.
    expect(firstText(res)).not.toContain("Mulligan: refused");
    expect(firstText(res)).toContain("Reverted");
    expect(firstText(res)).toContain("rewound last_turn");

    // ASSERT FILES RESTORED — INCLUDING the sed-edited c.ts (reverted via the git index diff even
    // though it was never in ledger.modifiedFiles).
    expect(readFileSync(join(repoDir, "a.ts"), "utf8")).toBe(preSpan.a);
    expect(readFileSync(join(repoDir, "b.ts"), "utf8")).toBe(preSpan.b);
    expect(readFileSync(join(repoDir, "c.ts"), "utf8")).toBe(preSpan.c);

    // ASSERT .git BYTE-IDENTICAL (git-safety guarantee #3 — all git writes carried GIT_DIR=shadow).
    expect(hashDir(join(repoDir, ".git"))).toEqual(dotGitBefore);

    // ASSERT shadow ref present, then cleared by retire. (store.has(SHA) verifies the OBJECT exists
    // via `git rev-parse --verify <SHA>`, which stays true even after retire — retire only deletes the
    // REF, the commit object lingers until gc. So the robust retire check is `for-each-ref` scoped to
    // the snapshot namespace: present before retire, absent after.)
    const turnSnapshot = rt.snapshots?.get("turn");
    expect(turnSnapshot).toBeTruthy();
    const beforeRef = (turnSnapshot as RevertCheckpoint).beforeRef;
    expect(await store.has(beforeRef)).toBe(true); // object resolvable

    const shadowDir = join(storageDir, await shadowKey(repoDir));
    const listSnapRefs = async (): Promise<string[]> => {
      const out = (
        await execFile(
          "git",
          ["for-each-ref", "--format=%(refname)", "refs/mulligan/snapshots/"],
          { env: { ...process.env, GIT_DIR: shadowDir } },
        )
      ).stdout.trim();
      return out.split("\n").filter(Boolean);
    };
    // before retire: the shadow repo holds a protected ref under refs/mulligan/snapshots/
    expect((await listSnapRefs()).length).toBeGreaterThan(0);

    await store.retire(beforeRef);
    // after retire: the ref pointing at beforeRef is gone (update-ref -d); the object lingers until gc.
    const refsAfter = await listSnapRefs();
    expect(refsAfter.filter((rn) => rn.endsWith("turn/turn"))).toHaveLength(0);

    // ASSERT the persisted marker carries revertedFiles ⊇ {a.ts,b.ts,c.ts}.
    const revert = rewindRevert(appended);
    expect(revert?.revertedFiles).toEqual(
      expect.arrayContaining(["a.ts", "b.ts", "c.ts"]),
    );
  });

  // ── F-revert-failopen (spec/10 §2.1 row F-revert-failopen / E27) ──────────

  it("F-revert-failopen: chmod-locked file lands in failedFiles; the rest still reverted; rewind SUCCEEDS (not a refusal)", async () => {
    if (!(await gitAvailable())) {
      console.warn("[revert-git] git not on PATH — skipping F-revert-failopen");
      return;
    }
    // chmod is a no-op for root (root ignores the read-only bit → the file WOULD revert and failedFiles
    // would be empty). Guard: skip under root so the assertions stay faithful.
    if (process.getuid && process.getuid() === 0) {
      console.warn(
        "[revert-git] running as root — skipping F-revert-failopen (chmod is ineffective for root)",
      );
      return;
    }

    const repoDir = await makeRepo("rev-failopen-");
    dirs.push(repoDir);
    writeFileSync(join(repoDir, "a.ts"), "A1\n");
    // b.ts lives in a SUBDIR so we can lock the directory (git checkout unlinks+recreates the file, so a
    // read-only FILE does not stop it — but a read-only DIRECTORY blocks the unlink → EACCES → failed[]).
    const subDir = join(repoDir, "sub");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "b.ts"), "B1\n");
    await git(repoDir, ["add", "-A"]);
    await git(repoDir, ["config", "user.email", "test@example.com"]);
    await git(repoDir, ["config", "user.name", "Test"]);
    await git(repoDir, ["commit", "-m", "init"]);

    const preSpan = {
      a: readFileSync(join(repoDir, "a.ts"), "utf8"),
      b: readFileSync(join(subDir, "b.ts"), "utf8"),
    };

    const storageDir = makeStorage();
    dirs.push(storageDir);
    setConfig({ revert: { enabled: true, storageDir } });

    const store = await detectAndCreate(repoDir, getConfig().revert);
    expect(store.describe().backend).toBe("git");

    const sid = "s-failopen";
    const rt = getRuntime(sid);
    rt.store = store;

    const { appended, pi } = makePi();
    // Two writes so ledger.modifiedFiles = [a.ts, sub/b.ts] (the dirty guard checks both).
    const contextEntries = [
      msgEntry(user("rewrite the files")),
      msgEntry(asstWrite("w1", "a.ts")),
      msgEntry(result("w1")),
      msgEntry(asstWrite("w2", "sub/b.ts")),
      msgEntry(result("w2")),
      msgEntry(asst("final")),
      msgEntry(result("final")),
    ];
    const { ctx } = makeCtx({ sessionId: sid, contextEntries });

    // CAPTURE turn_start.
    await turnStartCaptureHandler(
      { type: "turn_start", turnIndex: 0, timestamp: Date.now() },
      ctx,
    );
    expect(rt.snapshots?.get("turn")?.beforeRef).toBeTruthy();

    // MUTATE both files, then LOCK the sub directory read-only (blocks `git checkout -- sub/b.ts`'
    // unlink step → EACCES → failed[]; git checkout unlinks+recreates, so only a read-only DIR stops it).
    writeFileSync(join(repoDir, "a.ts"), "A2\n");
    writeFileSync(join(subDir, "b.ts"), "B2\n");
    chmodSync(subDir, 0o555);

    // CAPTURE agent_end.
    await agentEndCaptureHandler({ type: "agent_end", messages: [] }, ctx);
    expect(rt.snapshots?.get("turn")?.afterRef).toBeTruthy();

    // DRIVE the REAL rewind tool with revert_file_changes:true.
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_turn", revert_file_changes: true },
      "final",
    );

    // ASSERT rewind SUCCEEDS (fail-open, E27 — the op NEVER throws; best-effort). NOTE: the revert
    // summary line contains "0 refused (see log)" even on success, so check the REFUSAL PREFIX, not the
    // bare word "refused".
    expect(firstText(res)).not.toContain("Mulligan: refused");
    expect(firstText(res)).toContain("Reverted");

    // ASSERT a.ts (the unlocked one) REVERTED.
    expect(readFileSync(join(repoDir, "a.ts"), "utf8")).toBe(preSpan.a);

    // ASSERT sub/b.ts (the locked one) NOT reverted (still mutated — the read-only dir blocked the checkout).
    expect(readFileSync(join(subDir, "b.ts"), "utf8")).not.toBe(preSpan.b);

    // ASSERT the marker: sub/b.ts in failedFiles, a.ts in revertedFiles.
    const revert = rewindRevert(appended);
    expect(revert?.failedFiles).toEqual(expect.arrayContaining(["sub/b.ts"]));
    expect(revert?.revertedFiles).toEqual(expect.arrayContaining(["a.ts"]));
  });

  // ── F-revert-delete (spec/10 §2.1 row F-revert-delete — the double-gate) ──

  it("F-revert-delete: deletion REFUSED when allowDeleteCreatedFiles is false (file stays; deletedFiles empty)", async () => {
    if (!(await gitAvailable())) {
      console.warn("[revert-git] git not on PATH — skipping F-revert-delete (off)");
      return;
    }

    const repoDir = await makeRepo("rev-delete-off-");
    dirs.push(repoDir);
    writeFileSync(join(repoDir, "existing.txt"), "E1\n");
    await git(repoDir, ["add", "-A"]);
    await git(repoDir, ["config", "user.email", "test@example.com"]);
    await git(repoDir, ["config", "user.name", "Test"]);
    await git(repoDir, ["commit", "-m", "init"]);

    const storageDir = makeStorage();
    dirs.push(storageDir);
    // config gate OFF + per-call flag ON → double-gate refuses deletion.
    setConfig({ revert: { enabled: true, allowDeleteCreatedFiles: false, storageDir } });

    const store = await detectAndCreate(repoDir, getConfig().revert);
    expect(store.describe().backend).toBe("git");

    const sid = "s-delete-off";
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

    // CAPTURE turn_start (beforeRef — new.ts does NOT exist yet).
    await turnStartCaptureHandler(
      { type: "turn_start", turnIndex: 0, timestamp: Date.now() },
      ctx,
    );
    expect(rt.snapshots?.get("turn")?.beforeRef).toBeTruthy();

    // CREATE the file in-span (after turn_start's snapshot, before agent_end's).
    writeFileSync(join(repoDir, "new.ts"), "CREATED\n");

    // CAPTURE agent_end.
    await agentEndCaptureHandler({ type: "agent_end", messages: [] }, ctx);
    expect(rt.snapshots?.get("turn")?.afterRef).toBeTruthy();

    // DRIVE: per-call delete_created_files:true — but the config gate is OFF → deletion refused.
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_turn", delete_created_files: true },
      "final",
    );

    // ASSERT the created file still exists (NOT deleted).
    expect(existsSync(join(repoDir, "new.ts"))).toBe(true);

    // ASSERT marker.deletedFiles is empty (the config gate blocked the double-gate).
    const revert = rewindRevert(appended);
    expect(revert?.deletedFiles).toEqual([]);
  });

  it("F-revert-delete: deletion PERFORMED when allowDeleteCreatedFiles is true (file gone; deletedFiles populated)", async () => {
    if (!(await gitAvailable())) {
      console.warn("[revert-git] git not on PATH — skipping F-revert-delete (on)");
      return;
    }

    // SEPARATE repo + store + runtime (do NOT reuse the off-sub-case's captured refs — a second
    // turn_start would GC the prior turn/* refs).
    const repoDir = await makeRepo("rev-delete-on-");
    dirs.push(repoDir);
    writeFileSync(join(repoDir, "existing.txt"), "E1\n");
    await git(repoDir, ["add", "-A"]);
    await git(repoDir, ["config", "user.email", "test@example.com"]);
    await git(repoDir, ["config", "user.name", "Test"]);
    await git(repoDir, ["commit", "-m", "init"]);

    const storageDir = makeStorage();
    dirs.push(storageDir);
    // config gate ON + per-call flag ON → double-gate permits deletion.
    setConfig({ revert: { enabled: true, allowDeleteCreatedFiles: true, storageDir } });

    const store = await detectAndCreate(repoDir, getConfig().revert);
    expect(store.describe().backend).toBe("git");

    const sid = "s-delete-on";
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
    expect(rt.snapshots?.get("turn")?.beforeRef).toBeTruthy();

    // CREATE the file in-span.
    writeFileSync(join(repoDir, "new.ts"), "CREATED\n");

    // CAPTURE agent_end.
    await agentEndCaptureHandler({ type: "agent_end", messages: [] }, ctx);
    expect(rt.snapshots?.get("turn")?.afterRef).toBeTruthy();

    // DRIVE: per-call delete_created_files:true AND config gate ON → deletion performed.
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_turn", delete_created_files: true },
      "final",
    );

    // ASSERT the created file is GONE (deleted).
    expect(existsSync(join(repoDir, "new.ts"))).toBe(false);

    // ASSERT marker.deletedFiles ⊇ {new.ts}.
    const revert = rewindRevert(appended);
    expect(revert?.deletedFiles).toEqual(expect.arrayContaining(["new.ts"]));

    // sanity: not a refusal.
    expect(firstText(res)).not.toContain("Mulligan: refused");
  });

  // ── F-revert-dirtyguard (BUG-004 regression: bash/python-mutated file caught by changedPaths) ──
  //
  // The agent mutates b.ts via a `python3 -c` bash call. python3 is NOT in FILE_MUTATING_COMMANDS,
  // so the OLD heuristic (ledger.modifiedFiles) recorded modifiedFiles=[] → the dirty guard inspected
  // NO affected paths → a concurrent human edit to b.ts was silently clobbered (E30). The BUG-004 fix
  // (rewind.ts: `affectedPaths = await store.changedPaths(checkpoint.beforeRef)`) derives the affected
  // set from the git diff instead, so b.ts IS inspected → the guard REFUSES on the human edit.
  it("F-revert-dirtyguard: file mutated via non-heuristic bash (python3) is covered by changedPaths; a concurrent human edit REFUSES the revert (BUG-004)", async () => {
    if (!(await gitAvailable())) {
      console.warn("[revert-git] git not on PATH — skipping F-revert-dirtyguard");
      return;
    }

    // SETUP: a real git repo with an initial commit on b.ts.
    const repoDir = await makeRepo("rev-dirtyguard-");
    dirs.push(repoDir);
    writeFileSync(join(repoDir, "b.ts"), "original\n");
    await git(repoDir, ["add", "-A"]);
    await git(repoDir, ["config", "user.email", "test@example.com"]);
    await git(repoDir, ["config", "user.name", "Test"]);
    await git(repoDir, ["commit", "-m", "init"]);

    // SEPARATE storage dir (must NOT resolve inside cwd — config rejects that → NoOpStore).
    const storageDir = makeStorage();
    dirs.push(storageDir);
    setConfig({ revert: { enabled: true, storageDir } });

    // REAL store via detectAndCreate (GitBackend).
    const store = await detectAndCreate(repoDir, getConfig().revert);
    expect(store.describe().backend).toBe("git");

    // WIRE the store into the runtime BEFORE the capture hooks (they self-gate on rt.store).
    const sid = "s-dirtyguard";
    const rt = getRuntime(sid);
    rt.store = store;

    const { pi } = makePi();

    // The span contextEntries (ledger source). CRITICAL: python3 is NOT in FILE_MUTATING_COMMANDS,
    // so the heuristic ledger.modifiedFiles=[] / the bashSideEffects gap — exactly the BUG-004
    // reproduction. (sed/cp/mv/tee ARE in FILE_MUTATING_COMMANDS and would NOT reproduce the gap.)
    const contextEntries = [
      msgEntry(user("rewrite b.ts via a script")),
      msgEntry(
        asstBash("p1", "python3 -c \"open('b.ts','w').write('agent-version')\""),
      ),
      msgEntry(result("p1")),
      msgEntry(asst("final")),
      msgEntry(result("final")),
    ];
    const { ctx } = makeCtx({ sessionId: sid, contextEntries });

    // CAPTURE turn_start (REAL hook) → rt.snapshots?.get("turn").beforeRef.
    await turnStartCaptureHandler(
      { type: "turn_start", turnIndex: 0, timestamp: Date.now() },
      ctx,
    );
    const turnCp = rt.snapshots?.get("turn");
    expect(turnCp).toBeTruthy();
    const beforeRef = (turnCp as RevertCheckpoint).beforeRef;
    expect(beforeRef).toBeTruthy();

    // THE REAL MUTATION — write b.ts directly (do NOT execute python3; the parse-only bashSideEffects
    // heuristic is what we are exercising, and running an arbitrary python heredoc is brittle on CI).
    writeFileSync(join(repoDir, "b.ts"), "agent-version\n");

    // CAPTURE agent_end (REAL hook) → mutates the turn checkpoint's .afterRef in place.
    await agentEndCaptureHandler({ type: "agent_end", messages: [] }, ctx);
    const afterTurnCp = rt.snapshots?.get("turn");
    expect(afterTurnCp).toBeTruthy();
    const afterRef = (afterTurnCp as RevertCheckpoint).afterRef;
    expect(afterRef).toBeTruthy();

    // STORE MICRO-ASSERTIONS — pin the BUG-004 fix's data sources in isolation:
    //   (a) changedPaths(beforeRef) — the NEW affected set — MUST include b.ts (the file restore would
    //       touch), even though ledger.modifiedFiles missed it.
    //   (b) dirtyCheck(afterRef, []) with an EMPTY path scope returns [] (mirrors the OLD heuristic's
    //       behavior: no paths inspected ⇒ no drift ⇒ would CLOBBER the human edit). This is the guard
    //       the BUG-004 fix replaced.
    expect(await store.changedPaths(beforeRef!)).toContain("b.ts");
    expect(await store.dirtyCheck(afterRef!, [])).toEqual([]);

    // HUMAN EDIT — a concurrent edit DISTINCT from both "original" (pre-span) and "agent-version"
    // (in-span). The dirty guard (now scoped to the changedPaths-derived affected set) MUST catch this
    // drift and REFUSE the revert so the human edit survives.
    writeFileSync(join(repoDir, "b.ts"), "HUMAN-EDIT\n");

    // Confirm the NEW affected set catches the drift (this is what dirtyCheck receives at execute time).
    expect(await store.dirtyCheck(afterRef!, ["b.ts"])).toContain("b.ts");

    // DRIVE the REAL rewind tool. granularity MUST be "last_turn" (checkpoints capture once → no
    // afterRef → the dirty guard is SKIPPED entirely; only last_turn runs it).
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_turn", revert_file_changes: true },
      "final",
    );

    // ASSERT the dirty guard REFUSED the file-revert (context rewind still proceeded — not a top-level
    // refusal). The exact refusal clause from rewind.ts step 6b.
    const text = firstText(res);
    expect(text).toContain(
      "file revert refused: 1 path(s) changed since the turn ended",
    );
    expect(text).not.toContain("Mulligan: refused");

    // ASSERT the concurrent human edit SURVIVED (E30 — never silently clobbered).
    expect(readFileSync(join(repoDir, "b.ts"), "utf8")).toBe("HUMAN-EDIT\n");
  });

  // ── F-revert-delete-oversize (OVERSIZE-DELETE / bug-hunt BUG-001 regression: a pre-existing file > maxFileBytes must SURVIVE
  //    a delete_created_files rewind). The existing F-revert-delete tests only use small in-manifest
  //    files; a pre-existing oversize file is excluded at capture via a `:!` pathspec (NEVER staged
  //    into the shadow index) + recorded in the oversize git note, so `git ls-files --others` lists it
  //    as untracked vs the read-tree'd beforeRef index — and the delete step unlinked it (irreversible
  //    data loss — spec/14 §2 guarantee #4 violation). Drives store.restore() directly (faithful to
  //    the bug-hunt reproduction) against the REAL GitBackend on a real git repo. ──
  it("F-revert-delete-oversize (git): a pre-existing file > maxFileBytes SURVIVES delete_created_files (OVERSIZE-DELETE); span-created file IS deleted; user's .git byte-identical", async () => {
    if (!(await gitAvailable())) {
      console.warn("[revert-git] git not on PATH — skipping F-revert-delete-oversize");
      return;
    }

    const repoDir = await makeRepo("rev-delete-oversize-");
    dirs.push(repoDir);
    // a PRE-EXISTING file larger than maxFileBytes (256) + a normal tracked file.
    writeFileSync(join(repoDir, "small.txt"), "small\n");
    writeFileSync(join(repoDir, "preexisting-big.bin"), "X".repeat(1000));
    await git(repoDir, ["add", "-A"]);
    await git(repoDir, ["config", "user.email", "test@example.com"]);
    await git(repoDir, ["config", "user.name", "Test"]);
    await git(repoDir, ["commit", "-m", "init"]);

    const storageDir = makeStorage();
    dirs.push(storageDir);
    // config gate ON + a TIGHT maxFileBytes so the 1000-byte file is oversize at capture.
    setConfig({
      revert: { enabled: true, allowDeleteCreatedFiles: true, maxFileBytes: 256, storageDir },
    });

    const store = await detectAndCreate(repoDir, getConfig().revert);
    expect(store.describe().backend).toBe("git");

    // the user's .git is byte-identical before vs after the whole capture+restore sequence
    // (git-safety guarantee #2/#3 — restore touches ONLY working-tree files).
    const gitBefore = hashDir(join(repoDir, ".git"));

    // CAPTURE turn_start (beforeRef) — the oversize file is fail-closed SKIPPED → excluded via a
    // `:!` pathspec + recorded in the oversize git note under refs/mulligan/oversize (which restore
    // reads into result.skipped at step a.5). The recorded contract is verified below via res.skipped
    // (proving BOTH capture wrote the note AND restore read it back). The console.warn side-effect is
    // incidental.
    const beforeRef = await store.capture("turn");
    expect(beforeRef).toBeTruthy();

    // Simulate a span-created file (present now, absent from the beforeRef tree).
    writeFileSync(join(repoDir, "span-created.txt"), "agent made this\n");

    // DRIVE restore() directly (faithful to the bug-hunt reproduction): two-flag AND satisfied.
    const res = await store.restore(beforeRef!, {
      revertFileChanges: false,
      deleteCreatedFiles: true,
    });

    // CRITICAL (OVERSIZE-DELETE): the PRE-EXISTING oversize file SURVIVES (was unlinked before the fix).
    expect(existsSync(join(repoDir, "preexisting-big.bin"))).toBe(true);
    expect(res.deleted).not.toContain("preexisting-big.bin");
    // the genuine span creation IS deleted; the captured small file is left alone.
    expect(existsSync(join(repoDir, "span-created.txt"))).toBe(false);
    expect(res.deleted).toContain("span-created.txt");
    expect(existsSync(join(repoDir, "small.txt"))).toBe(true);
    // the oversize file is surfaced into result.skipped (the agent sees the incomplete revert).
    expect(res.skipped).toContain("preexisting-big.bin");
    // git-safety: the user's .git is byte-identical (no new objects/refs/reflog/stash).
    expect(hashDir(join(repoDir, ".git"))).toBe(gitBefore);
  });
});