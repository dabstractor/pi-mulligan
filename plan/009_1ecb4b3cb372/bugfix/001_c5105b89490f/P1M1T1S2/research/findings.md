# Research Findings — P1.M1.T1.S2 (CasBackend restore-time size guard)

**Item**: Accept the walkTree `st` param + add maxFileBytes size guard in `restore()` delete step (belt-and-suspenders).
**Sibling**: P1.M1.T1.S1 (GitBackend `stat` DI seam + size guard) — running in parallel; GitBackend-ONLY, no overlap.

## 1. The change is verified line-exact in src/snapshot/cas.ts

`walkTree` (cas.ts ~411-440) — the `visit` callback type is:
```ts
visit: (rel: string, abs: string, st: { size: number; mtimeMs: number }) => Promise<void>
```
walkTree ALREADY calls `this.fs.stat(abs)` and passes `st` as the THIRD positional arg (line ~437: `await visit(rel, abs, st)`). So `st.size` is computed and available; the restore callback just needs to ACCEPT it.

`restore()` delete step (cas.ts ~1110-1145), the `'cas'`-mode deleteCreatedFiles walk — CURRENT code:
```ts
const spare = new Set(manifest.skipped ?? []);                 // ~1119
const excludeSet = new Set(this.cfg.excludeGlobs.map((g) => g.toLowerCase()));
await this.walkTree(this.cwd, excludeSet, async (rel, abs) => {  // ~1123  ← DROPS st
  if (manifest.files[rel]) return;                              // ~1124  in beforeRef ⇒ not span-created
  if (spare.has(rel)) return;                                   // ~1125  OVERSIZE-DELETE spare (happy path)
  if (isDangerousWorkspaceRel(rel)) return;                     // belt-and-suspenders
  try { await this.fs.unlink(abs); result.deleted.push(rel); }
  catch (e) { const code = (e as NodeJS.ErrnoException)?.code; if (code !== "ENOENT") result.failed.push(rel); }
});
```

**THE EDIT (exactly):**
- Change `async (rel, abs) =>` → `async (rel, abs, st) =>` (cas.ts:1123). TS infers `st: {size:number; mtimeMs:number}` from walkTree's visit type — no annotation needed (a callback may accept fewer OR all params).
- Immediately after `if (spare.has(rel)) return;` (cas.ts:1125), insert:
  ```ts
  if (st.size > this.cfg.maxFileBytes) return; // SPARE — defense-in-depth, independent of manifest
  ```

## 2. Why CAS needs this only as belt-and-suspenders (verified)

- CAS manifest `writeFile` is the LAST step before `return label` (cas.ts ~546-560); a throw there → outer catch → capture returns `null` → no ref to restore from → delete step NEVER runs. **No orphan-ref-without-oversize-record failure mode** (unlike GitBackend's best-effort git note). CAS is immune to R1.
- Capture records oversize files in `manifest.skipped` (cas.ts:617-621: `if (st.size > this.cfg.maxFileBytes) { skipped.push(rel); … return; }`). At restore, `result.skipped.push(...(manifest.skipped ?? []))` (cas.ts:~1065) ALREADY surfaces them, AND the `spare` Set (built from `manifest.skipped` at :1119) already spares them at :1125 (happy path). So the new size guard only adds coverage for the case where a delete-candidate is oversize AT RESTORE yet NOT in `manifest.skipped` (e.g. it was absent/small at capture and grew beyond `maxFileBytes` by restore, or manifest drift). Pure defense-in-depth.

## 3. `result.skipped` visibility — decision: bare `return` (NOT a skipped push)

- The task description AND `residual_risk_analysis.md` both prescribe the bare `return` for CasBackend (no `result.skipped.push`).
- GitBackend (S1) DOES push the spared rel to `result.skipped` (deduped) — but that is the PRIMARY defense for its R1 window. CasBackend's guard is belt-and-suspenders only; happy-path oversize visibility is already handled by the `manifest.skipped → result.skipped` copy at :1065. Keeping the bare `return` achieves the stated "same deterministic safety floor" (the SPARE) without duplicating visibility plumbing. Both backends now spare oversize delete-candidates deterministically.
- The required unit test asserts ONLY: not in `result.deleted` + `unlink` not called — it does NOT assert `result.skipped` membership, so the bare `return` satisfies the contract.

## 4. Test infrastructure (verified — note name correction)

The task's "makeStateFs/makeStateBackend" names are from `system_context.md`; the ACTUAL unit-test helpers in `test/cas.test.ts` are:
- `BASE_CFG` (test/cas.test.ts:46-55): canonical `MulliganConfig["revert"]` — `maxFileBytes: 262144`, `nonGitMode: "cas"`, `allowDeleteCreatedFiles: false`. Override per-test via spread.
- `makeBackend(fs?)` (:59): `new CasBackend("/fake/cwd", BASE_CFG, null, fs ? { fs } : undefined)`.
- The mutable-`CasFs` fake idiom is defined INLINE in the `'cas' mode deleteCreatedFiles` test (:1361) and the `OVERSIZE-DELETE` test (:1441): a `fileEntries: Map<abs,Buffer>` + `childMap: Map<parentAbs, Map<name,"file"|"dir">>` with hand-rolled `readdir/stat/readFile/writeFile/access/unlink`. `stat` returns `{ size: c.length, mtimeMs }`. `unlink` removes from both maps. This is the template to mirror.

**Existing HAPPY-PATH spare test** (`test/cas.test.ts:1441`): `big.bin` = `Buffer.alloc(300)` PRESENT AT CAPTURE → lands in `manifest.skipped` → spared by `spare.has(rel)` at :1125. MUST still pass after the edit (no behavior change — the size guard runs AFTER the spare check).

**Existing integration test** (`test/integration/revert-cas.test.ts:750`): `preexisting-big.bin` = `"X".repeat(1000)` with `maxFileBytes:256` → in `manifest.skipped` → survives; asserts `res.skipped` contains it. MUST still pass.

## 5. The new unit test — exact scenario (belt-and-suspenders path)

Mirror the `OVERSIZE-DELETE` test (:1441) mutable-fake structure, but create the oversize file AFTER capture so it is NOT in `manifest.skipped`:
- cfg: `{ ...BASE_CFG, storageDir: storage, nonGitMode: "cas", allowDeleteCreatedFiles: true, maxFileBytes: 256 }`.
- Capture "turn" with baseline `small.ts` (in manifest.files). NO oversize file at capture.
- AFTER capture: `addFile("created.ts", Buffer.from("created"))` (size 7 ≤ 256) AND `addFile("created-big.bin", Buffer.alloc(300))` (size 300 > 256; NOT present at capture → NOT in manifest.skipped).
- `cb.restore(beforeRef, { revertFileChanges:false, deleteCreatedFiles:true })`.
- ASSERT: `res.deleted` contains `"created.ts"`; `res.deleted` does NOT contain `"created-big.bin"`; `fileEntries.has(absOf("created-big.bin"))` is TRUE (not unlinked); `fileEntries.has(absOf("created.ts"))` is FALSE (unlinked).

This proves the guard fires INDEPENDENTLY of the `manifest.skipped`/spare-Set path (the big file is not in manifest.skipped, yet is still spared). Without the guard, `created-big.bin` would be unlinked (conflated with a span creation) → test fails.

## 6. Optional integration test (real fs)

To exercise the guard on the real filesystem: write `small-at-capture` → capture → overwrite with `"X".repeat(1000)` (now > maxFileBytes=256, still in manifest.files with the OLD small size — wait, this would be in manifest.files so `if (manifest.files[rel]) return;` spares it). So the real-fs scenario must be a file ABSENT at capture that is large at restore — i.e. a genuine large span creation. That is exactly the unit scenario. Optional; the unit test is the contract.

## 7. Scope boundaries (do NOT do)

- DO NOT touch `src/snapshot/git.ts` (S1 owns it) or `store.ts`/`paths.ts`/`config.ts`/`rewind.ts`.
- DO NOT add a DI seam to CasBackend (`st` is already passed by walkTree — no new dep, no constructor change).
- DO NOT change `RestoreResult` shape, `maxFileBytes` config (already exists), or any public/exported type.
- DO NOT re-implement the `spare` Set (already landed, commit `ec5ad32`) — the new guard runs AFTER it.
- DO NOT touch README/spec (P1.M1.T2.S1 owns the Mode-B doc sync).

## 8. Validation (verified against repo)

- `npm run typecheck` → `tsc --noEmit`.
- `npx vitest run test/cas.test.ts` (the new unit test + the existing :1441 spare test).
- `npx vitest run test/integration/revert-cas.test.ts` (the :750 happy-path test still green).
- `npm test` (full suite).