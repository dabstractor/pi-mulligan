# Research Notes — P1.M2.T1.S1: Fix nudges config block in spec/04-data-model.md (BUG-002)

> Documentation-only (Mode A) edit to ONE file: `spec/04-data-model.md`, the `MulliganConfig.nudges` block
> (lines 240–244). No code, no tests, no build. Mirrors the parallel code fix's surface exactly.

## 1. The defect (verified verbatim — `cat -A` for exact alignment)

`spec/04-data-model.md` lines 240–244 (the `nudges:` block inside the `interface MulliganConfig`):
```
  nudges: {
    bloatReminder: boolean;          // tool_result annotation; default true
    perTurnDrift: boolean;           // context nudge; default true
    bloatThresholdBytes: number;     // default 8192 (in-context bytes of a single result)
    driftThresholdTokens: number;    // default 3000 (turn delta that triggers the nudge)
  };
```
Two problems:
- (a) Line 242: `// default 8192` — STALE (global was raised 8192 → 16384 in P2).
- (b) The block has NO `bloatThresholdBytesByTool` field at all (P2 added per-tool overrides).

## 2. Source-of-truth facts (verified directly)

### `src/config.ts` — the shipped config (the shape the spec must mirror)
- **Interface field, line 68:** `bloatThresholdBytesByTool?: Record<string, number>;` ← the `?` makes it OPTIONAL.
- **DEFAULT_CONFIG, line 109:** `bloatThresholdBytes: 16384,`
- **DEFAULT_CONFIG, line 110:** `bloatThresholdBytesByTool: { bash: 32768, read: 20480 },`
- **DEFAULT_CONFIG, line 111:** `driftThresholdTokens: 3000,`
- So the spec must read: default `16384` (16 KB) and an optional `bloatThresholdBytesByTool?` map defaulting to `{ bash: 32768, read: 20480 }`.

### `spec/09-configuration.md:66–67` — the authoritative defaults table (already correct)
- Line 66: `| nudges.bloatThresholdBytes | 16384 (16 KB) | Global catch-all … Raised from 8 KB … |`
- Line 67: `| nudges.bloatThresholdBytesByTool | { "bash": 32768, "read": 20480 } | … on miss, use bloatThresholdBytes. |`

### `spec/07-preventive-and-nudges.md:52` — the nudge spec (already correct)
- "Default `bloatThresholdBytes = 16384` (16 KB ≈ 4k tokens in-context) … The previous default was 8192 (8 KB);
  it was raised …"

→ spec/04 must AGREE with config.ts / spec/09 / spec/07 (all currently disagree with spec/04).

## 3. Alignment analysis (the `//` column — verified with byte counts)

The existing four lines column-align their `//` comments: 38 characters precede `//` (so `//` sits at column 39).
- `    bloatReminder: boolean;` = 27 chars → 11 padding spaces → `//`
- `    perTurnDrift: boolean;` = 26 chars → 12 padding spaces → `//`
- `    bloatThresholdBytes: number;` = 32 chars → 6 padding spaces → `//`
- `    driftThresholdTokens: number;` = 34 chars → 4 padding spaces → `//`

**The new line cannot align to column 39** because its declaration is too long:
`    bloatThresholdBytesByTool?: Record<string, number>;` = 53 chars (4-indent + 49). This EXCEEDS the
alignment column. Therefore its inline comment follows the `;` with a **single space** (the natural fallback
when a declaration is wider than the block's alignment width). This is exactly what the task contract's INPUT
example shows (`...number>; // per-tool overrides; default { bash: 32768, read: 20480 }`).

## 4. The exact desired result (post-edit, lines 240–245)

```
  nudges: {
    bloatReminder: boolean;          // tool_result annotation; default true
    perTurnDrift: boolean;           // context nudge; default true
    bloatThresholdBytes: number;     // default 16384 (in-context bytes of a single result; 16 KB)
    bloatThresholdBytesByTool?: Record<string, number>; // per-tool overrides; default { bash: 32768, read: 20480 }
    driftThresholdTokens: number;    // default 3000 (turn delta that triggers the nudge)
  };
```
Two edits:
- **(A)** line 242 comment: `8192` → `16384 ...; 16 KB`.
- **(B)** insert a new line 243 (`bloatThresholdBytesByTool?: ...`) AFTER `bloatThresholdBytes` and BEFORE
  `driftThresholdTokens`.

## 5. Parallel-item conflict check
- The parallel item P1.M1.T1.S1 (BUG-001) modifies **`src/nudges.ts`** (1 line + JSDoc) and
  **`test/nudges.test.ts`** (1 test). It does NOT touch any `spec/` file.
- This item modifies **`spec/04-data-model.md`** only.
→ **Zero file overlap.** The two can land independently and in either order.

## 6. Scope discipline (do NOT touch)
- `src/config.ts`, `src/nudges.ts`, `src/tools/audit.ts` → code (out of scope; P1.M1.* / read-only).
- `spec/07`, `spec/09`, `spec/10`, `spec/01` → already-correct or owned by P1.M2.T2.S1/S2 (BUG-003).
- `README.md` → P1.M2.T3.S1 sweep (separate).
- `test/*` → no tests for a doc change.
- This PRP edits ONLY `spec/04-data-model.md`, the `nudges:` block (lines ~240–244).

## 7. Validation approach
No build / no tests for a markdown schema-block edit. Validation = grep consistency checks:
- no `8192` left in spec/04's nudges block;
- `bloatThresholdBytesByTool` present in spec/04;
- cross-check the cited numbers (16384 / 32768 / 20480) match `src/config.ts:109-110` and `spec/09:66-67`.