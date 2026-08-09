# Documentation & Spec Research — Configuration Surface

**Scope:** Documents EXACTLY what the README and the `spec/` directory promise about the
configuration surface (`settings.json` read, `enabled:false` master switch, all knobs, lazy
loading, `/reload` re-read, global vs project-local precedence). This is reference material for
downstream PRP agents planning the BUG-001 fix (settings.json is never actually read). No source
code was changed; this is a research artifact.

---

## 1. README.md — promised configuration behavior (verbatim, with line numbers)

The README is the most prominent user-facing contract. Section `## 3. Configuration` spans
lines 67–124.

### 1.1 Configuration section header + load contract (README.md:67-71)

```
67: ## 3. Configuration
69: Mulligan reads a `mulligan` object from Pi `settings.json` — the global
   `~/.pi/agent/settings.json` and/or the project-local `.pi/settings.json`
   (project-local overrides global). It is loaded lazily on first use, cached for the
   session, and re-read on `/reload`. See `spec/09-configuration.md` §1.
71: > **Zero configuration.** Every option has a safe default. Unknown keys are ignored;
   type-mismatched values fall back to the default with a `warn`; **validation never
   throws.** The extension works with an empty or absent `mulligan` block.
```

**Key promise (line 69):** Three explicit guarantees that are NOT honored by the code today:
1. Reads from BOTH `~/.pi/agent/settings.json` (global) AND `.pi/settings.json` (project-local).
2. **Project-local overrides global** (precedence rule).
3. **Loaded lazily on first use, cached for the session, re-read on `/reload`.**

### 1.2 The 17 documented knobs (README.md:73-104, "Defaults table")

The README advertises "All 17 knobs (source of truth: `src/config.ts` `DEFAULT_CONFIG`)" and a
defaults table. Every one of these is documented as user-settable but, per BUG-001, NONE of them
are actually read from settings.json today (the factory hard-codes `setConfig(undefined)`).

| Knob | Default (per README) | README line |
|------|----------------------|-------------|
| `enabled` | `true` | 80 |
| `rewind.enabled` | `true` | 82 |
| `rewind.protectedRoles` | `["first:user","latest:user"]` | 84 |
| `rewind.maxDepth` | `5` | 86 |
| `rewind.maxRetriesPerPrompt` | `5` | 88 |
| `rewind.abortContextFraction` | `0.9` | 90 |
| `rewind.requireMutationWarning` | `true` | 92 |
| `shrink.enabled` | `true` | 89 |
| `shrink.maxActive` | `32` | 95 |
| `shrink.staleAfterFires` | `3` | 97 |
| `nudges.bloatReminder` | `true` | 100 |
| `nudges.perTurnDrift` | `true` | 101 |
| `nudges.bloatThresholdBytes` | `16384` | 102 |
| `nudges.bloatThresholdBytesByTool` | `{ "bash": 32768, "read": 20480 }` | 103 |
| `nudges.driftThresholdTokens` | `6000` | 105 (table) |
| `nudges.driftWindowTurns` | `3` | 106 (table) |
| `nudges.highWaterFraction` | `0.7` | 108 (table) |
| `audit.estimateConfidence` | `"medium"` | 111 (table) |
| `log.file` | `null` | 114 (table) |

### 1.3 The master `enabled:false` off-switch + "Disabling" subsection (README.md:120-122)

```
120: #### Disabling
122: `enabled: false` makes the **entire extension a no-op**: no context transform
   (the filter passes messages through untouched), the nudges are inert, and the tools
   refuse cleanly with `Mulligan: refused — Mulligan is disabled.`. The human can disable
   Mulligan without uninstalling it.
```

**This is the most user-impactful broken promise.** README.md:80 ties the master switch to
"see [Disabling]", and README.md:122 specifies the EXACT disable semantics that the code does
NOT implement:
- no context transform (filter passes through untouched),
- nudges are inert,
- tools refuse cleanly with the literal text `Mulligan: refused — Mulligan is disabled.`.

README.md:29 (Installation) reinforces the zero-config claim: "Works with zero configuration.
No `mulligan` settings are needed — the extension loads with all defaults."

---

## 2. spec/09-configuration.md — the configuration spec (full read)

`spec/09-configuration.md` is the authoritative design source. Its quoted preamble states the
same three-way contract as the README.

### 2.1 Where config is read (spec/09 §1, verbatim)

```
- **Source:** the merged Pi settings object. Mulligan reads `settings.mulligan`
  (project-local wins over global via Pi's normal merge).
- **When:** loaded lazily on first use and cached for the session; re-read on `/reload`.
  `getConfig()` returns the validated, defaulted config.
- **Validation:** unknown keys are ignored (forward-compat). Type-mismatched values fall
  back to the default with a warn log. This must never throw.
```

Spec-derived requirements for the BUG-001 fix:
- **Source = "the merged Pi settings object."** The spec relies on Pi doing the
  global+project-local merge and handing Mulligan `settings.mulligan`. The note
  "project-local wins over global via Pi's normal merge" implies Mulligan expects an ALREADY
  merged object from Pi, not two raw files it merges itself.
- **When = lazy + cached + re-read on `/reload`.** Three distinct lifecycle requirements.
- **`getConfig()` returns the validated, defaulted config** — the existing `getConfig()` already
  does this; the gap is purely in WHAT is fed to `setConfig()`.

### 2.2 Schema & defaults (spec/09 §2) — matches README + `DEFAULT_CONFIG`

The spec/09 §2 `jsonc` block matches `src/config.ts` `DEFAULT_CONFIG` exactly (enabled,
rewind.{enabled,protectedRoles,maxDepth,maxRetriesPerPrompt,abortContextFraction,requireMutationWarning},
shrink.{enabled,maxActive,staleAfterFires}, nudges.{bloatReminder,perTurnDrift,bloatThresholdBytes,
bloatThresholdBytesByTool,driftThresholdTokens,driftWindowTurns,highWaterFraction},
audit.estimateConfidence, log.file). `autoOnBloat` is explicitly reserved/NOT v1.

> **Note (schema drift in spec/04):** `spec/04-data-model.md` §7 (line 246) has an OLDER
> `MulliganConfig` summary that omits several later-added fields (`rewind.maxRetriesPerPrompt`,
> `rewind.abortContextFraction`, `shrink.maxActive`, `shrink.staleAfterFires`,
> `nudges.driftWindowTurns`, `nudges.highWaterFraction`) and lists an obsolete
> `driftThresholdTokens: 3000`. spec/09 §2 and `src/config.ts DEFAULT_CONFIG` are the sources of
> truth and supersede it. PRP agents should rely on spec/09 + `DEFAULT_CONFIG`, NOT spec/04.

### 2.3 Validation rules (spec/09 §4) — already implemented in `config.ts`

All §4 coercion rules (booleans `!!`, numbers finite `>=0`/`>0`, protectedRoles known-selectors,
bloatThresholdBytesByTool map, estimateConfidence enum, log.file string, maxRetriesPerPrompt
integer `>=1`, abortContextFraction `(0,1]`, never-throw) are ALREADY implemented in
`src/config.ts` `validateConfig()` and are unit-tested. **The validation engine is NOT the gap —
it is never fed real user settings.**

### 2.4 Environment overrides (spec/09 §5) — explicitly v1.1, NOT v1

```
Reserved for future: MULLIGAN_DISABLED=1 (force-disable), MULLIGAN_LOG=/path (force log).
Not required for v1; documented as future.
```

These are OUT OF SCOPE for a v1 fix unless the PRD explicitly escalates them.

---

## 3. PRD §7 — Configuration surface (master SPEC.md)

`spec/SPEC.md` §7 (line 151-155) is the PRD-level summary:

```
151: ## 7. Configuration surface (summary)
153: > Full detail: @09-configuration.md.
155: Mulligan reads `mulligan` from Pi `settings.json` (global or project-local). Key knobs:
   bloat threshold (global default + optional per-tool override map), drift threshold,
   protected roles, max rewind depth, and on/off toggles for each nudge. All have safe
   defaults; the extension works with zero configuration.
```

The closing clause "works with zero configuration" is the design principle: **zero-config as a
DEFAULT, but config IS honored when present.** This is the contract BUG-001 breaks — the
extension currently treats config as permanently absent regardless of what the user sets.

---

## 4. Design principle: zero-config-but-honors-config

The "zero configuration" principle appears in three places, and in ALL of them it is
conditioned on "but honors config when present":

- README.md:29 — "Works with zero configuration. No `mulligan` settings are needed — the
  extension loads with all defaults" (does NOT say config is ignored).
- README.md:71 — "Every option has a safe default... The extension works with an empty or
  absent `mulligan` block." (implies a present block IS used).
- spec/SPEC.md:155 — "All have safe defaults; the extension works with zero configuration."
- spec/09 §1 preamble — "It works with **zero configuration** — every option has a safe
  default" (same conditional).

**Interpretation for the fix:** zero-config is the floor, not a replacement for the config
surface. A correct fix must preserve the zero-config path (absent/empty `mulligan` → all
defaults, identical to today) while making a PRESENT `mulligan` block take effect.

---

## 5. `/reload` re-read requirement (lifecycle)

Two sources specify that config is re-read on `/reload`:

- README.md:69 — "It is loaded lazily on first use, cached for the session, and re-read on `/reload`."
- spec/09 §1 — "loaded lazily on first use and cached for the session; re-read on `/reload`."

Cross-reference (spec/08-edge-cases.md E11, line 57-60): on reload/`/resume`, `session_start`
reinitializes the runtime map; markers/notes survive. The index.ts `session_start` handler
currently only calls `resetRuntime(sessionId)` — it does NOT re-call `setConfig`. So the re-read
seam exists conceptually but is unwired for config (it would re-call `setConfig(settings.mulligan)`).

Note from `spec/02-proven-constraints.md` (line 38) and `reference/HANDOFF.md`: session-replacement
flows (`reload`, `fork`, `newSession`) invalidate previously-captured `ctx.sessionManager` handles
(C12). Any `/reload` re-read must obtain the settings source FRESH on session_start, not cache a
handle captured at factory time.

---

## 6. Global vs project-local precedence

Documented precedence rule (project-local overrides global):
- README.md:69 — "project-local overrides global".
- spec/09 §1 — "project-local wins over global via Pi's normal merge".

**Critical nuance for the fix:** the spec explicitly delegates the merge to **"Pi's normal
merge."** This means the intended design is that Pi hands Mulligan an ALREADY-MERGED settings
object, and Mulligan just reads `.mulligan` off it. There is no spec requirement for Mulligan to
read+merge the two files itself. This is directly relevant to BUG-001's root-cause finding: Pi
0.84.1's ExtensionAPI/ExtensionContext expose no settings accessor, so the "merged Pi settings
object" the spec assumes does not (yet) exist on the Pi surface. A fix must either find a
settings accessor, read the file(s) directly (and then it OWNS the merge), or correct the docs.

---

## 7. `getConfig()` / `setConfig()` seam in the spec

spec/09 §1 names `getConfig()` as "the validated, defaulted config" read API. The
implementation contract in `src/config.ts`:
- `getConfig()` — lazy cache, returns defensive structuredClone, defaults if cache empty.
- `setConfig(raw)` — initialize/replace cache from a raw settings object; never throws;
  described in its docstring as "Called from the index.ts factory / session_start handler (and
  again on /reload)." So `setConfig` is DESIGNED to receive real settings — it is simply never
  passed any today (always `undefined`).

spec/06-context-filter.md §1 (line 13) and spec/07-preventive-and-nudges.md (lines 18, 90) both
show `const config = getConfig();` as the consumer pattern. This is implemented and correct;
the missing piece is purely the upstream `setConfig(realSettings)` call.

---

## 8. Summary of contracts a BUG-001 fix must satisfy (from docs/specs)

1. **Master switch** (README:80,122; spec/09 §2): `enabled:false` → entire extension no-op
   (filter passes through, nudges inert, tools refuse with literal `Mulligan: refused — Mulligan
   is disabled.`).
2. **All 17 knobs honored** when present (README:73-114; spec/09 §2/§3).
3. **Source = merged Pi settings**, `settings.mulligan` (README:69; spec/09 §1).
4. **Global `~/.pi/agent/settings.json` + project-local `.pi/settings.json`**, project-local
   wins (README:69; spec/09 §1).
5. **Lazy load + session cache** (README:69; spec/09 §1).
6. **Re-read on `/reload`** — fresh settings source on session_start (README:69; spec/09 §1;
   spec/08 E11; C12 handle-invalidation).
7. **Zero-config preserved** — absent/empty `mulligan` block → identical to today's defaults
   (README:29,71; spec/SPEC §7; spec/09 §1).
8. **Validation never throws** — already implemented in `config.ts` `validateConfig()` (spec/09 §4).

### Known constraint / open question for the parent
spec/09 §1 assumes Pi provides "the merged Pi settings object." Per the PRD root-cause analysis,
Pi 0.84.1's `ExtensionAPI`/`ExtensionContext` expose NO settings accessor. So contract #3/#4 has
no implementation path on the current Pi surface unless either (a) a settings accessor is added
upstream, (b) Mulligan reads+merges the files itself (then it owns the precedence rule), or
(c) the docs/spec are corrected to stop advertising config until an accessor exists. This is a
product/architecture decision the parent must make (it is NOT a docs-only fix).

---

## 9. Files read (evidence)

- README.md (full, lines 1-262) — Configuration §3 (67-124), Disabling (120-122).
- spec/09-configuration.md (full) — §1 source/when/validation, §2 schema, §3 rationale, §4 rules, §5 env (v1.1).
- spec/SPEC.md §7 (151-155) — PRD configuration summary; §9 decision log.
- spec/04-data-model.md §7 (246-285) — MulliganConfig summary (STALE; superseded by spec/09).
- spec/03-architecture.md (full) — module layout, zero-config-as-floor principle.
- spec/01-pi-context-internals.md — modes, no settings accessor documented.
- spec/08-edge-cases.md E11 — reload lifecycle.
- spec/02-proven-constraints.md + reference/HANDOFF.md — C12 session-replacement handle invalidation.
- (Reference only, from inherited context): src/index.ts (setConfig(undefined) call site),
  src/config.ts (validateConfig engine), src/log.ts (setLogFile seam), src/runtime.ts.