# Research Notes — P1.M3.T1.S2 (spec/09-configuration.md implementation note)

**Task**: Add an implementation note to `spec/09-configuration.md §1` clarifying that Mulligan reads
settings files directly from disk (because Pi 0.84.1's extension API exposes no settings accessor)
and does its own deep-merge — WITHOUT changing the spec's semantic contract.

---

## A. The exact target text (verified byte-for-byte)

`spec/09-configuration.md` §1, line 9 (the "Source" bullet):

```
- **Source:** the merged Pi settings object. Mulligan reads `settings.mulligan` (project-local wins over global via Pi's normal merge).
```

This is the ONLY line in the spec that contains the phrase `Pi's normal merge`
(`grep -n "Pi's normal merge" spec/09-configuration.md` → line 9, single match). It is the sole edit
target. No other line in §1 (or anywhere in spec/09) needs touching.

The full §1 block (lines 7–12) for context:
- Line 7: `## 1. Where config is read`
- Line 9: the Source bullet (the edit target).
- Line 10: the "When" bullet (lazy/cached/re-read — OUT OF SCOPE, leave untouched).
- Line 11: the "Validation" bullet (OUT OF SCOPE, leave untouched).

## B. Why the spec's current wording is *slightly* misleading (but not wrong)

The current Source bullet implies Pi **hands Mulligan an already-merged settings object** ("the merged
Pi settings object … via Pi's normal merge"). In reality:

1. **Pi 0.84.1's `ExtensionAPI` and `ExtensionContext` expose NO settings accessor.** Verified by reading
   the complete interface definitions in
   `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts` (architecture/pi_api_research.md
   §A enumerates every member — there is no `getSettings`/`getConfig`/`settings`/`loadConfig` field).
2. **Mulligan therefore reads the files directly from disk** (`src/settings.ts`):
   - Global: `join(getAgentDir(), "settings.json")` (respects `PI_CODING_AGENT_DIR`).
   - Project-local: `join(cwd ?? process.cwd(), ".pi", "settings.json")`.
3. **Mulligan does its OWN deep-merge** via `deepMergeSettings(global, project)` in `src/settings.ts`.
4. **The merge semantics are IDENTICAL to Pi's own `deepMergeObjects`** — confirmed by reading Pi's
   source at `node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js:11-34`:
   - `isMergeableObject(v) = typeof v === "object" && v !== null && !Array.isArray(v)`.
   - Both sides mergeable plain object → recurse; otherwise `overrides` value replaces.
   - Result starts as `{ ...base }`; iterates `Object.keys(overrides)`; skips `undefined` override values.
   - Mulligan's `deepMergeSettings` mirrors this exactly (own-key iteration, plain-object recurse,
     arrays/primitives/null replace, project wins) — the only cosmetic difference: Mulligan does NOT
     special-case `undefined` override values, which is harmless because `readSettingsFile` never
     produces an `undefined` leaf (JSON has no `undefined`).
5. **User-visible behavior is identical**: project-local wins over global, nested objects merge
   recursively, the result is then handed to `setConfig(merged.mulligan)` → `validateConfig`.

So the spec's *contract* (what the user sees: project-local wins, merged) is **correct**. Only the
*mechanism description* ("via Pi's normal merge") is imprecise. The fix is a purely additive
implementation note — do NOT delete or weaken the existing contract sentence.

## C. Scope discipline — what NOT to touch

- **The "When" bullet (line 10)**: "loaded lazily on first use and cached for the session; re-read on
  `/reload`." The implementation actually loads EAGERLY at factory time
  (`src/index.ts` factory body calls `setConfig(loadMulliganConfig(process.cwd()))`), then re-reads on
  every `session_start` reason (startup|reload|new|resume|fork). User-facing behavior ("cached for the
  session; re-read on /reload") is identical. **This task does NOT touch line 10** — the contract says
  only add the §1 implementation note about the file-read mechanism. (S1 flagged the "lazy" word as a
  README judgment call; for spec/09 it is explicitly out of scope for S2.) Changing it would risk
  scope-creep and is not requested.
- **The "Validation" bullet (line 11)**: accurate and untouched.
- **§2 Schema, §3 Rationale table, §4 Validation rules, §5, §6**: all accurate post-fix, untouched.
- **README.md**: owned by sibling S1 — do not touch.
- **src/settings.ts, src/config.ts, src/index.ts**: production code — READ-ONLY (source of the
  mechanism the note describes).
- **package.json, test/**: not in scope.

## D. The recommended edit (contract step 2c, verbatim wording)

Append an **implementation note** to the Source bullet. The contract's exact required wording (from
the work item, step 2b):

> "Implementation: Pi's extension API (v0.84.x) does not expose a settings accessor to extensions.
> Mulligan therefore reads the settings.json files directly from disk (via getAgentDir() for the
> global path and the session cwd for project-local), deep-merges them internally (matching Pi's own
> deepMergeObjects semantics), and extracts settings.mulligan. The user-visible merge behavior is
> identical to Pi's normal merge."

Two acceptable placements (implementer picks one; both preserve the existing contract sentence):
1. **Sub-bullet** (preferred — clean, scannable): keep line 9 verbatim, add an indented sub-bullet
   immediately after beginning with `> **Implementation note:**` or `_Implementation:_`.
2. **Parenthetical** (more compact): append a parenthetical to line 9 after "...Pi's normal merge).".

The PRP's "Implementation Tasks" Task 1 gives exact markdown for the sub-bullet form (preferred).

## E. Validation gates (confirmed green at research time)

- `npm run typecheck` (= `tsc --noEmit`, script added by P1.M2.T1.S2): exits 0. (A markdown edit
  cannot break this, but run it as the final regression check per contract step e.)
- `npx vitest run`: 912 tests pass (≥882 baseline). Unaffected by a spec doc edit.
- `grep -n "Pi's normal merge" spec/09-configuration.md`: still prints line 9 (the contract sentence
  is PRESERVED, not deleted — the note clarifies, it does not remove).
- `git status --short`: only `spec/09-configuration.md` modified (scope guard).

## F. Cross-references used

- `spec/09-configuration.md` §1 — the edit target.
- `src/settings.ts` — `loadMulliganConfig`, `readSettingsFile`, `deepMergeSettings` (the mechanism).
- `node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js:11-34` — Pi's
  `deepMergeObjects` (proves the merge semantics match).
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts` — proves no settings
  accessor on ExtensionAPI/ExtensionContext (architecture/pi_api_research.md §A).
- `plan/.../architecture/docs_spec_research.md §2.1` — catalogues this exact line as the spec gap.
- `plan/.../architecture/pi_api_research.md §C.4` — recommends the direct-file-read approach.
- Sibling P1.M3.T1.S1 PRP — confirms README is its scope, spec/09 is S2's; both gates green.