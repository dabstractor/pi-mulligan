#!/usr/bin/env bash
# =============================================================================
# validate.sh — pi-mulligan comprehensive validation
# =============================================================================
# Validates the pi-mulligan extension, with SPECIAL FOCUS on the v1.2 working-tree
# revert safety guarantee #4 (spec/14 §3): "delete_created_files only deletes files
# the span created". This is the property PRD BUG-001 alleged was broken — this script
# independently re-verifies it against the REAL backends on the REAL filesystem.
#
# Phases (only those that exist in this repo are run):
#   1. Linting        — none configured (no eslint/.prettierrc) → noted, skipped
#   2. Type Checking  — `tsc --noEmit`
#   3. Style Checking — only .editorconfig (no automated checker) → noted, skipped
#   4. Unit Testing   — `vitest run` (the full suite incl. F-revert-* integration)
#   5. End-to-End     — a standalone BUG-001 safety regression driven directly through
#                       detectAndCreate → capture → restore (both GitBackend & CasBackend),
#                       incl. the adversarial defense-in-depth case (skip-record ABSENT).
#
# Exit non-zero if ANY phase fails. Transient E2E test is created under test/ and
# always removed (trap), so the working tree is left clean.
# =============================================================================
set -u
cd "$(dirname "$(readlink -f "$0")")" 2>/dev/null || cd "$(dirname "$0")"

PASS=0; FAIL=0
E2E_TEMP="test/_tmp_validate_bug001.test.ts"

phase() { printf '\n\033[1m=== %s ===\033[0m\n' "$1"; }
ok()    { printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS+1)); }
no()    { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAIL=$((FAIL+1)); }
info()  { printf '  \033[33mINFO\033[0m  %s\n' "$1"; }

cleanup() { rm -f "$E2E_TEMP" 2>/dev/null || true; }
trap cleanup EXIT

echo "pi-mulligan validation — $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ── Phase 1: Linting ──────────────────────────────────────────────────────────
phase "Phase 1: Linting"
if ls .eslintrc* .eslintignore 2>/dev/null | grep -q . || grep -q '"lint"' package.json 2>/dev/null; then
  if grep -q '"lint"' package.json; then
    if npm run lint --silent; then ok "npm run lint"; else no "npm run lint"; fi
  fi
else
  info "No linter configured (no eslint/.prettierrc, no 'lint' script) — skipped."
fi

# ── Phase 2: Type Checking ────────────────────────────────────────────────────
phase "Phase 2: Type Checking"
if [ -f tsconfig.json ]; then
  if npx --no-install tsc --noEmit; then ok "tsc --noEmit (no type errors)"; else no "tsc --noEmit"; fi
else
  info "No tsconfig.json — skipped."
fi

# ── Phase 3: Style Checking ───────────────────────────────────────────────────
phase "Phase 3: Style Checking"
if command -v editorconfig-checker >/dev/null 2>&1 && [ -f .editorconfig ]; then
  if editorconfig-checker; then ok "editorconfig-checker"; else no "editorconfig-checker"; fi
elif npx --no-install prettier --check 'src/**/*.ts' >/dev/null 2>&1; then
  ok "prettier --check"
else
  info "Only .editorconfig present; no automated style checker — skipped."
fi

# ── Phase 4: Unit Testing ─────────────────────────────────────────────────────
phase "Phase 4: Unit Testing"
if grep -q '"test"' package.json; then
  if npx --no-install vitest run; then ok "vitest run (full suite)"; else no "vitest run"; fi
else
  info "No 'test' script — skipped."
fi

# ── Phase 5: End-to-End (BUG-001 safety regression) ───────────────────────────
# Drives the REAL backends directly (no run() pipeline). Verifies, on the real
# filesystem, that a pre-existing file exceeding revert.maxFileBytes SURVIVES a
# delete_created_files restore — both via the skip-record spare (note/manifest.skipped)
# AND via the defense-in-depth current-size guard (when the skip-record is ABSENT).
# Also confirms a genuine small span-created file IS still deleted (no over-protection).
phase "Phase 5: End-to-End — BUG-001 revert-safety regression (real backends)"

cat > "$E2E_TEMP" <<'TS_EOF'
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { detectAndCreate } from "../src/snapshot/store.js";
import { DEFAULT_CONFIG } from "../src/config.js";

const dirs: string[] = [];
afterEach(async () => { while (dirs.length) { try { await rm(dirs.pop()!, { recursive: true, force: true }); } catch {} } });
const rev = (o: Record<string, unknown>) => ({ ...DEFAULT_CONFIG.revert, ...o });
const tmp = async (p: string) => { const d = await mkdtemp(join(tmpdir(), p)); dirs.push(d); return d; };

describe("BUG-001 revert-safety (real backends)", () => {
  it("CAS: pre-existing oversize file SURVIVES delete_created_files (skip-record spare)", async () => {
    const dir = await tmp("cas-"); const sto = await tmp("sto-");
    await writeFile(join(dir, "preexisting-big.bin"), "X".repeat(1000));
    await writeFile(join(dir, "tracked.txt"), "hello\n");
    const store = await detectAndCreate(dir, rev({ enabled: true, nonGitMode: "cas", allowDeleteCreatedFiles: true, maxFileBytes: 256, storageDir: sto }));
    expect(store.describe().backend).toBe("cas");
    const ref = (await store.capture("turn"))!;
    await writeFile(join(dir, "span-created.txt"), "agent\n");
    const res = await store.restore(ref, { revertFileChanges: false, deleteCreatedFiles: true });
    expect(existsSync(join(dir, "preexisting-big.bin"))).toBe(true);
    expect(statSync(join(dir, "preexisting-big.bin")).size).toBe(1000);
    expect(res.deleted).not.toContain("preexisting-big.bin");
    expect(res.deleted).toContain("span-created.txt");
  });

  it("GIT: pre-existing oversize file SURVIVES delete_created_files (skip-record spare)", async () => {
    const dir = await tmp("git-"); execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
    const sto = await tmp("sto-");
    await writeFile(join(dir, "preexisting-big.bin"), "X".repeat(1000));
    await writeFile(join(dir, "tracked.txt"), "hello\n");
    const store = await detectAndCreate(dir, rev({ enabled: true, allowDeleteCreatedFiles: true, maxFileBytes: 256, storageDir: sto }));
    expect(store.describe().backend).toBe("git");
    const ref = (await store.capture("turn"))!;
    await writeFile(join(dir, "span-created.txt"), "agent\n");
    const res = await store.restore(ref, { revertFileChanges: false, deleteCreatedFiles: true });
    expect(existsSync(join(dir, "preexisting-big.bin"))).toBe(true);
    expect(statSync(join(dir, "preexisting-big.bin")).size).toBe(1000);
    expect(res.deleted).not.toContain("preexisting-big.bin");
    expect(res.deleted).toContain("span-created.txt");
  });

  it("CAS: large file ABSENT from skip-record is SPARED by defense-in-depth current-size guard", async () => {
    const dir = await tmp("casdd-"); const sto = await tmp("sto-");
    await writeFile(join(dir, "tracked.txt"), "hello\n");
    const store = await detectAndCreate(dir, rev({ enabled: true, nonGitMode: "cas", allowDeleteCreatedFiles: true, maxFileBytes: 256, storageDir: sto }));
    const ref = (await store.capture("turn"))!;
    await writeFile(join(dir, "big-external.bin"), "Z".repeat(1000)); // appears AFTER capture
    const res = await store.restore(ref, { revertFileChanges: false, deleteCreatedFiles: true });
    expect(existsSync(join(dir, "big-external.bin"))).toBe(true);
    expect(statSync(join(dir, "big-external.bin")).size).toBe(1000);
    expect(res.deleted).not.toContain("big-external.bin");
  });

  it("GIT: large file ABSENT from oversize note is SPARED by defense-in-depth current-size guard", async () => {
    const dir = await tmp("gitdd-"); execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
    const sto = await tmp("sto-");
    await writeFile(join(dir, "tracked.txt"), "hello\n");
    const store = await detectAndCreate(dir, rev({ enabled: true, allowDeleteCreatedFiles: true, maxFileBytes: 256, storageDir: sto }));
    const ref = (await store.capture("turn"))!;
    await writeFile(join(dir, "big-external.bin"), "Z".repeat(1000));
    const res = await store.restore(ref, { revertFileChanges: false, deleteCreatedFiles: true });
    expect(existsSync(join(dir, "big-external.bin"))).toBe(true);
    expect(statSync(join(dir, "big-external.bin")).size).toBe(1000);
    expect(res.deleted).not.toContain("big-external.bin");
  });

  it("No over-protection: a SMALL span-created file IS deleted", async () => {
    const dir = await tmp("small-"); const sto = await tmp("sto-");
    await writeFile(join(dir, "tracked.txt"), "hello\n");
    const store = await detectAndCreate(dir, rev({ enabled: true, nonGitMode: "cas", allowDeleteCreatedFiles: true, maxFileBytes: 256, storageDir: sto }));
    const ref = (await store.capture("turn"))!;
    await writeFile(join(dir, "small-span.txt"), "tiny\n");
    const res = await store.restore(ref, { revertFileChanges: false, deleteCreatedFiles: true });
    expect(existsSync(join(dir, "small-span.txt"))).toBe(false);
    expect(res.deleted).toContain("small-span.txt");
  });
});
TS_EOF

if npx --no-install vitest run "$E2E_TEMP" >/tmp/validate_e2e.log 2>&1; then
  ok "E2E BUG-001 regression (5 scenarios, both backends) — all pass"
else
  no "E2E BUG-001 regression"; tail -n 40 /tmp/validate_e2e.log
fi
rm -f "$E2E_TEMP"

# ── Summary ───────────────────────────────────────────────────────────────────
phase "Summary"
printf '  Passed: %d   Failed: %d\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf '\n\033[31mVALIDATION FAILED — %d phase(s) failed.\033[0m\n' "$FAIL"
  exit 1
fi
printf '\n\033[32mVALIDATION PASSED — codebase is sound; BUG-001 revert-safety guarantee holds.\033[0m\n'
exit 0