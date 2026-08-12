# P3.M1.T1.S1 — README v1.1 sweep: touchpoint map

Source of truth: `README.md` (275 lines) read in full; stale-term grep run.
Confirmed v1.1 implementation surface in `src/`:
- `src/index.ts` lines 8-13, 53-64, 83-87 → registers **4** tools (rewind, shrink, audit, cancel) +
  **3** human commands (`/mulligan_checkpoint`, `/mulligan_checkpoint_revoke`, `/mulligan_audit`) +
  `reconcileBanner` on `session_start`.
- `src/tools/checkpoint.ts` still on disk (unregistered dead code) — README must NOT document it as an agent tool.
- `src/commands.ts` descriptions: L164 "Set a Mulligan checkpoint…", L216 "Revoke…", L270 "Run the Mulligan context-bloat diagnostic…".
- `src/banner.ts` L63 verbatim banner line (the `⚠ Mulligan checkpoint active: "<name>"…` string).
- `src/config.ts` `ui.activeCheckpointBanner` default `true`.

## Stale-term occurrences in README (grep `checkpoint|to_previous_prompt|nuclear|five|no human-facing`)
| Line | Stale content | Action |
|------|---------------|--------|
| 5 | `Status: v1.0` | → v1.1 |
| 73 | "All 20 knobs" | → bump count + add `ui.activeCheckpointBanner` row |
| 123 | "all five tools" + "and `checkpoint`" | → "all four tools"; drop checkpoint; note human cmds gated |
| 129 | "registers five agent-callable tools" | → "four" |
| 147 | checkpoint table row "set via `mulligan_checkpoint`" | → "set via `/mulligan_checkpoint`" |
| 149 | to_previous_prompt paragraph | REMOVE → guardrail one-liner |
| 169-176 | `### mulligan_checkpoint` subsection | REMOVE → cross-ref to Human commands |
| 228 | "no human-facing command of its own" | → narrow-surface framing |
| 222-225 (drift) | delta counts all tokens | → note user prompts exempt (D10) |
| 251 | "BUG-001–BUG-006" + "six … 5 Minor" | → BUG-001–BUG-005 / "five … 4 Minor" |
| 255 | BUG-001 "mulligan_checkpoint consumption" | → reframe (consumed by rewind) |
| 259 | BUG-006 bullet | REMOVE (to_previous_prompt gone → moot) |
| 273 | "the five tools' full specification" | → "four" |

## Edits that are DETERMINISTIC old→new string swaps (verbatim strings captured in PRP.md)
All 13 touchpoints map to exact old→new pairs. No judgment calls except:
- config-knob count (verify against `config.ts DEFAULT_CONFIG`).
- placement of new "### Human commands (v1.1)" = after `### mulligan_cancel`, before "## 5. How It Works".

## Validation (grep-based, docs task)
- assert ZERO: `to_previous_prompt`, `nuclear`, `all five tools`, `five agent-callable`, `no human-facing command`, `BUG-006`, `five tools'`.
- assert PRESENT: `four agent-callable tools`, `Human commands (v1.1)`, narrow-surface framing, `/mulligan_checkpoint_revoke`.
- count `^### \`mulligan_` tool headings in §4 == 4.