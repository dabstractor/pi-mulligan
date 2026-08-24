# P1.M3.T2.S3 research notes

## Ground truth (verified 2025-06)
- test/integration/scenarios.md = 715 lines (workitem said 473 — stale; file grew with Mode-A sections).
- run-smoke.mjs SCENARIOS (L30-50): 14 F-* driven — rewind-core, shrink-persist, shrink-preventive,
  nudge-drift, protected, maxdepth, checkpoint, ckptcmd, banner, consent, drift-userexempt, useraudit,
  failopen, reload — then E7/E11/E12/E15/E20. Total 19.
- Five v1.1 sections ALREADY landed Mode-A: F-ckptcmd (~L321), F-banner (~L357), F-consent (~L410),
  F-drift-userexempt (~L459), F-useraudit (~L504).
- context.fire sample (L56-73) ALREADY includes banner/userMsgCount/firstUserPresent/highWater observables
  (P1.M2.T1.S1/S2).
- F-retrycap (~L258) / F-abortfraction (~L280): documented-not-auto-run callouts already accurate.
- NO F-cancel section exists anywhere in the file (grep confirmed).

## Stale overview items (the entire task)
1. L98 heading: "## The F-* scenarios (10)" → must become (14) + name the five additions.
2. L707 footer: "Runs all 14 deterministic scenarios (9 F-* + 5 E*)" → 19 (14 F-* + 5 E*).
3. "How the harness works" lacks: two-run same-session-id /resume pattern (F-banner/F-reload/E11),
   the `-ne` flag (global-old-build defense, used by F-banner/F-ckptcmd runs at L367/L374),
   multi-prompt flows (F-shrink-persist 3-p; F-consent split-phase).
4. Optional overview caveat: F-cancel spec-only (no section), retrycap/abortfraction manual paths.

## Hazards
- Count arithmetic: 14 driven + 2 documented = 16 '### F-' headings; heading count = DRIVEN = 14.
- Doc section order ≠ SCENARIOS array order — do not reorder.
- Diff must be confined to overview/footer; per-scenario sections byte-identical.
- Cross-doc: VERIFICATION.md (S1) and README.md (S2) both record 19/19 and the same five names.

## Environment note
Live harness received prescribing drift nudge from GLOBALLY-INSTALLED older mulligan build
(PRD h2.0 confounder) — exactly what `-ne` defends against; document as environment defense.
