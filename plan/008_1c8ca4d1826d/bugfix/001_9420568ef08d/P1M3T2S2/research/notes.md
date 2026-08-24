# Research notes — P1.M3.T2.S2 (README.md sweep)

## README.md structure (300 lines, current)
- L52: `### Zero-config smoke (the acceptance check)` — names `pi -e ./src/index.ts` + spec/11 §2 Step 9; does NOT state a scenario count (count lives in VERIFICATION.md; P1.M3.T2.S1 records 19/19 there).
- L129: `## 4. Tools` — L133 `### mulligan_rewind` blurb (blockquote ~L135-137 + prose to ~L150). Checkpoint mention exists at L176 (shrink section tail) and in granularity notes but the rewind blurb does not spell out consent/hides-user-prompts semantics matching the new REWIND_DESC.
- L194-205: `### Human commands (v1.1)` — /mulligan_checkpoint, /mulligan_checkpoint_revoke, /mulligan_audit, active-checkpoint banner (verbatim banner text incl. "Revoke: /mulligan_checkpoint_revoke <name>").
- §5 L176 already documents checkpoint targeting — the rewind tool blurb is the gap.
- §7 Known Limitations: three historical resolved-bugs subsections with DISJOINT numbering:
  - "Resolved bugs (BUG-001–BUG-005)" — v1.0 hunt (1 Major, 4 Minor)
  - "Resolved bugs — v1.1 validation pass (BUG-001–BUG-004)"
  - "Resolved bugs — field reports (BUG-001)" — prepareArguments string-coercion fix
  - NAMING HAZARD: the PRD's BUG-001..003 are a THIRD, newer round. Do NOT renumber history; add a new dated subsection.

## Shipped changes to sync against
1. P1.M1.T1.S1 — REWIND_DESC now ends: "granularity 'checkpoint' rewinds back to a checkpoint a user set — and may hide the user's prompts after it (they consented by setting it)." (src/tools/rewind.ts:127-129); checkpoint param desc (rewind.ts:113) now says "/mulligan_checkpoint command".
2. P1.M1.T2.S1/S2 — E22 identical-note advisory ("⚠ You have rewound with an identical note — the re-attempt is reproducing the mistake. Change approach or shrink the offending result rather than rewinding again.") appended on second consecutive same-prompt identical-note rewind.
3. P1.M2.T6.S1 — smoke suite now 19/19 (14 + F-consent, F-ckptcmd, F-banner, F-useraudit, F-drift-userexempt).
4. P1.M3.T1.S1 — src/tools/checkpoint.ts agent-tool surface (@deprecated JSDoc on makeCheckpointTool/CKPT_DESC/CheckpointParams/CheckpointDetails), zero behavior change; index.ts registers only rewind/shrink/audit/cancel.

## Sibling contract (P1.M3.T2S1)
VERIFICATION.md will record: smoke 19/19, new section "v2.0 post-validation fixes — BUG-001 through BUG-003". README must NOT duplicate the full remediation table — cross-reference VERIFICATION.md (existing pattern: each resolved-bugs subsection ends with "see VERIFICATION.md ... for the full engineering record").