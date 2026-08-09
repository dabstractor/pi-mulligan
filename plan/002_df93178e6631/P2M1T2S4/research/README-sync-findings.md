# Research Notes — P2.M1.T2.S4 (README.md Mode B sync)

## Item
Sync README.md to document the new per-tool bloat threshold config shipped by
P2.M1.T1.S1 / P2.M1.T2.S1 (global `bloatThresholdBytes: 16384`; per-tool
`bloatThresholdBytesByTool: { bash: 32768, read: 20480 }`). Mode B = the final
cross-cutting documentation sweep; depends on ALL implementing subtasks (S1–S3).

## Source of truth (verified by direct read)
- `src/config.ts` `DEFAULT_CONFIG`:
  - `nudges.bloatThresholdBytes: 16384`
  - `nudges.bloatThresholdBytesByTool: { bash: 32768, read: 20480 }`
- `src/nudges.ts` `bloatThresholdFor(toolName, config)`:
  `byTool[toolName] ?? global`; falsy toolName → global. (live-confirmed: reading
   src/nudges.ts at ~21 KB actually tripped the read:20480 reminder this session.)

## Exact edit locations in README.md (grep-verified)
1. **L75 — knob count.** `All 12 knobs (...)` → `All 13 knobs (...)`.
   NOT named in the item contract, but REQUIRED: `bloatThresholdBytesByTool` is
   now a real config knob in DEFAULT_CONFIG, so the table grows 12 → 13. Leaving
   "12 knobs" above a 13-row table is an internal inconsistency Mode B exists to fix.
2. **L91 — config table row** (the only `8192` row). `| nudges.bloatThresholdBytes | 8192 | ... (8 KB ...) |`.
3. **NEW row — immediately after L91.** `| nudges.bloatThresholdBytesByTool | { "bash": 32768, "read": 20480 } | ... |`.
4. **L107 — JSON example.** `//   "nudges": { "bloatThresholdBytes": 8192, "driftThresholdTokens": 3000 }`
5. **L203 — How-It-Works bullet.** `... any result exceeding bloatThresholdBytes.`

## Stale references audit
`grep -nE "8192|8 KB|8KB" README.md` → matches ONLY L91 and L107. No others.
L170 (audit tool) says "flags results above the bloat threshold" — generic,
still accurate (a per-tool threshold IS "the bloat threshold"); no change needed.

## Authoritative rationale to mirror (cite in descriptions)
- `spec/07-preventive-and-nudges.md`
  - L52: global default raised 8 KB → 16 KB after 8 KB "nagged on every routine
    source-file read (9–17 KB)"; 16 KB lets a typical source file through while
    still catching catastrophic results (the 50 KB un-redirected grep).
  - L62: "legitimate output size differs sharply by tool. A `bash`
    build/test/`git log` run routinely and legitimately produces tens of KB;
    an `lsp_hover` payload is a few hundred bytes." → one global threshold either
    over-nags or under-catches.
  - L63: limitation — keyed by toolName not subcommand (`git log` vs `echo` both
    look like `bash`); perTurnDrift catches aggregate growth regardless.
- `spec/09-configuration.md`
  - L66-67: canonical table descriptions (mirror wording).
  - L77: validation rule — non-object discarded, per-entry warn on <=0/non-number,
    unknown tool names permitted (forward-compat).

## Table row format (must match existing style)
Cells wrap key + default in single backticks. Complex defaults inline:
`| `rewind.protectedRoles` | `["first:user", "latest:user"]` | ... |`
So the new row: `` `{ "bash": 32768, "read": 20480 }` `` in backticks.

## Out of scope (do NOT touch)
- L170 audit tool description (generic; still correct).
- L92 driftThresholdTokens row (unrelated).
- Any source file (`src/nudges.ts` JSDoc still says "default 8192" — owned by S1,
  intentionally left; NOT a README concern).
- `test/integration/smoke.ts`, `test/nudges.test.ts`, `test/config.test.ts`
  (owned by S1/S2/S3).

## Validation (Markdown-only — no build/test impact)
- `grep -nE "8192|8 KB|8KB" README.md` → must be EMPTY.
- `grep -nE "16384|bloatThresholdBytesByTool|32768|20480" README.md` → 3+ matches.
- `grep -n "13 knobs" README.md` → exactly 1 match (L75 bumped).
- Table pipe-column sanity (eyeball in a renderer / count `|` per row).
- No code imports README; `npm run build` / `npm test` unaffected but run as a
  regression guard.