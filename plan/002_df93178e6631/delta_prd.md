# pi-mulligan — Delta PRD 002: Per-Tool Bloat Threshold

**Status:** Draft · **Parent PRD:** `spec/SPEC.md` (master, v1.0) · **Scope:** Single-feature refinement of the bloated-result reminder (Nudge A).

---

## 0. What this delta is

A **small, surgical change**: the `tool_result` bloated-result reminder currently uses one global byte threshold (`bloatThresholdBytes`, default `8192`). It must instead resolve the threshold **per tool** — looking up `event.toolName` in an optional override map and falling back to the global default — and the global default is raised from `8192` (8 KB) to `16384` (16 KB). Shipped per-tool defaults: `bash` → `32768` (32 KB), `read` → `20480` (20 KB).

Rationale (from the updated spec): legitimate output size differs sharply by tool — a `bash` build/`git log` run routinely and legitimately produces tens of KB, while an `lsp_hover` payload is a few hundred bytes. One global threshold either over-nags the noisy tools or under-catches the quiet ones. The 8 KB default was also nagging on every routine source-file read (9–17 KB).

**This is a ~6-line behavioral change touching exactly one feature (Nudge A) and one config family.** No architecture change, no new module, no new event, no new marker kind. The diff between the previous and current master PRD is confined to two sentences (§6 "Bloated-result reminder" and §7 "Configuration surface").

---

## 1. Spec is already the source of truth — code is behind

The companion specs were **already updated** to describe the target design in full. This delta session is a **pure implementation catch-up**: bring the code, tests, and README up to the spec. Do **not** re-derive the design — it is locked in:

- `spec/07-preventive-and-nudges.md` §1 — defines the exact resolution helper `bloatThresholdFor(toolName, config)` and the per-tool rationale + limitation (keyed by `toolName`, not sub-command).
- `spec/09-configuration.md` §2 (defaults: `bloatThresholdBytes: 16384`, `bloatThresholdBytesByTool: { "bash": 32768, "read": 20480 }`), §3 (rationale), §4 (validation rules for the new map field).

**Current code state (verified):**
- `src/config.ts` — `MulliganConfig.nudges.bloatThresholdBytes` is a single `number`; `DEFAULT_CONFIG` has `8192`; there is **no** `bloatThresholdBytesByTool` field; `validateConfig` has no handling for it.
- `src/nudges.ts` — `bloatReminderHandler` reads `config.nudges.bloatThresholdBytes` directly as the threshold.
- `src/notes.ts` — `renderBloatReminder(toolName, bytes, thresholdBytes)` **already takes the threshold as a parameter** (no change needed — it will display whatever threshold is resolved).
- `test/config.test.ts` — asserts the default is `8192` in ~8 places; no coverage for the map.
- `test/integration/smoke.ts` — comments/assert on the `8192` default.
- `README.md` — config table shows `8192`; no per-tool row; example uses `8192`.

---

## 2. Requirements

### 2.1 Add `bloatThresholdBytesByTool` to the config surface (modified requirement)

Extend the configuration model, defaults, and validation to support an optional per-tool override map alongside the (raised) global default.

- **`src/config.ts` — `MulliganConfig` interface:** add `bloatThresholdBytesByTool?: Record<string, number>` to the `nudges` block. Update the `bloatThresholdBytes` JSDoc to note the new default (16384) and that per-tool overrides take precedence.
- **`src/config.ts` — `DEFAULT_CONFIG`:** change `bloatThresholdBytes` from `8192` → `16384`; add `bloatThresholdBytesByTool: { bash: 32768, read: 20480 }`.
- **`src/config.ts` — `validateConfig`:** add coercion for the new field per `spec/09 §4`:
  - Absent/`undefined` → keep default map (`{ bash: 32768, read: 20480 }`), no warn.
  - Present but not a record (null/primitive/array) → discard entirely, use the default map, warn once.
  - Present as a record: keep only entries whose value is a finite number `> 0` (drop invalid values with a per-value warn; keep the rest). Unknown tool-name keys are permitted (forward-compat).
  - Never throws (existing fail-open wrapper already covers it).
  - *Documentation impact (Mode A):* update the JSDoc on `bloatThresholdBytes` and the new `bloatThresholdBytesByTool` field in `src/config.ts` — these ride with the code change.

### 2.2 Resolve the bloat threshold per tool in Nudge A (modified requirement)

The `tool_result` reminder must look up the threshold by tool name, not use the global directly.

- **`src/nudges.ts`:** add the pure helper `bloatThresholdFor(toolName, config): number` exactly as specified in `spec/07 §1`:
  ```ts
  function bloatThresholdFor(toolName: string | undefined, config: MulliganConfig): number {
    const global = config.nudges.bloatThresholdBytes;
    if (!toolName) return global;
    const byTool = config.nudges.bloatThresholdBytesByTool ?? {};
    return byTool[toolName] ?? global;
  }
  ```
- **`src/nudges.ts` — `bloatReminderHandler`:** replace `const threshold = config.nudges.bloatThresholdBytes;` with `const threshold = bloatThresholdFor(event.toolName, config);`. No other change to the handler — `renderBloatReminder(event.toolName, bytes, threshold)` and the bloat-hit recording (`pendingBloatHits`) are already parameterized on the resolved threshold.
- **No change** to `src/notes.ts` (`renderBloatReminder` already accepts `thresholdBytes`), `src/tokens.ts`, or any transform/marker/filter code.

### 2.3 Sync changeset-level documentation (Mode B)

Cross-cutting docs that summarize the feature once the code is in place:

- **`README.md`** — update the configuration table: change `nudges.bloatThresholdBytes` default to `16384` (with the raised-from-8KB note); add a `nudges.bloatThresholdBytesByTool` row (`{ "bash": 32768, "read": 20480 }`) with the per-tool rationale. Update the JSON example block (currently shows `"bloatThresholdBytes": 8192`). Update the "How It Works" bloated-result reminder bullet to mention per-tool resolution.

---

## 3. Test updates (ride with the implementing tasks)

- **`test/config.test.ts`** — update existing assertions from `8192` → `16384` (the default-equality, invalid-value-fallback, and warn-naming tests all reference the literal). Add coverage:
  - default `bloatThresholdBytesByTool` equals `{ bash: 32768, read: 20480 }`;
  - a user override merges (e.g. `{ bash: 99999 }` overrides bash, `read` keeps default) — confirm the map is **not** blindly replaced when partially provided (merge semantics per `spec/09 §4`: valid entries kept, invalid dropped, defaults preserved for unmentioned tools);
  - invalid map values are dropped with a warn while valid siblings survive;
  - non-object map → discarded, default used, one warn.
- **`src/nudges.ts` / `test/`** — add a focused unit test for `bloatThresholdFor`: `bash` → 32768, `read` → 20480, unknown tool → 16384, `undefined` toolName → 16384, an empty override map present → global. (Export the helper, or test via a thin pure seam — `bloatThresholdFor` takes `(toolName, config)` and is Pi-free, so a direct unit test is cleanest.)
- **`test/integration/smoke.ts`** — update the `>8KB` comment / any threshold-dependent assertion to reflect the new `16 KB` global default (a `bash` result in the harness will now resolve to the 32 KB override, so a deterministic-bloat scenario should either target a tool whose threshold it knows, or produce >32 KB for `bash`).

---

## 4. What is NOT in scope

- No change to the drift nudge (Nudge B), the context filter, rewind/shrink/checkpoint/audit tools, markers, or any transform logic.
- No change to the `tool_result` event contract or to `renderBloatReminder`'s rendered text format.
- No new config knobs beyond `bloatThresholdBytesByTool`; sub-command-level sensitivity (e.g. distinguishing `git log` from `echo` within `bash`) is explicitly out of scope per `spec/07 §1` (limitation).
- Removed requirements: **none.** This delta only modifies the existing threshold behavior; the previous single-threshold design is superseded, not coexisting.

---

## 5. Definition of done

1. `nudges.bloatThresholdBytes` defaults to `16384`; `bloatThresholdBytesByTool` defaults to `{ bash: 32768, read: 20480 }`.
2. `bloatReminderHandler` resolves the threshold via `bloatThresholdFor(event.toolName, config)`; a `bash` result fires only above 32 KB, a `read` above 20 KB, everything else above 16 KB.
3. `validateConfig` coerces the map per `spec/09 §4` and never throws on malformed input.
4. `npm test` is green; the new per-tool resolution has explicit unit coverage; the existing config tests reflect the new defaults.
5. `README.md` config table + example reflect the new defaults and the per-tool map.

---

## 6. Task breakdown

**Phase P2 — Per-Tool Bloat Threshold (single milestone, two tasks)**

- **Milestone P2.M1 — Implement per-tool bloat threshold**
  - **Task P2.M1.T1 — Config model, defaults, and validation** (`src/config.ts`): raise `bloatThresholdBytes` default to `16384`; add `bloatThresholdBytesByTool` field + default map to the interface and `DEFAULT_CONFIG`; add map coercion to `validateConfig`. *(Mode A doc: JSDoc on the two fields.)*
  - **Task P2.M1.T2 — Per-tool resolution + tests + README** (`src/nudges.ts`, `test/`, `README.md`): add `bloatThresholdFor`; wire it into `bloatReminderHandler`; update `test/config.test.ts` defaults + add map-merge/invalid-value coverage; add a `bloatThresholdFor` unit test; update `test/integration/smoke.ts` threshold comments/scenario; update `README.md` config table, example, and How-It-Works bullet. *(Mode B changeset-level docs live here.)*

*Dependency: P2.M1.T2 depends on P2.M1.T1 (resolution reads the new config field). Both are small (≈0.5–1 SP each).* All prior work (P1.*) is **Complete** and is referenced, not re-implemented.