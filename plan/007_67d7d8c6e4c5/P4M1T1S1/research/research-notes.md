# Research Notes — P4.M1.T1.S1

**Item**: edge-cases.test.ts E19 — assert `applyShrink` is non-mutating (input array's original survives unchanged)
**Mode**: A (test-only — no docs, no source change)

## 1. Target file & insertion site

- File: `test/edge-cases.test.ts` (1023 lines total — E19 is the LAST describe block).
- E19 describe block: lines **989–1023**.
  - Heading: `describe("E19 — Shrink target is a non-toolResult message (role preserved)", () => {`
  - Existing `it()` blocks (3):
    1. "applyShrink on a USER message → role 'user' preserved, content replaced" (L991)
    2. "applyShrink on a text ASSISTANT message → role 'assistant' preserved, content replaced" (L1000)
    3. "filterPipeline pairing is unaffected (no toolResult involved)" (L1010)
  - Closing `});` of the describe = L1022–1023 (EOF).
- **Insertion point**: INSIDE the E19 describe, AFTER the filterPipeline `it()`'s closing `});` and BEFORE the describe's closing `});`.
- Unique anchor for the edit: the last lines of the filterPipeline test:
  ```
      expect(shrunk?.role).toBe("assistant");
    });
  });
  ```
  (the `expect(shrunk?.role)...` line is unique in the file).

## 2. Imports already present (no new imports needed)

`test/edge-cases.test.ts` L25–L30 already imports:
- `applyShrink` (L25)
- `stampShrink` (L26)
- `type MessageLike` (L30)

→ The new tests need NOTHING new at the top of the file.

## 3. LOCAL fixture builders (defined in-file, L76–L115)

These are LOCAL copies (not imported across files) — already in scope inside any `it()`:
- `user(text)` → `{ role: "user", content: text }` ← **content is a STRING**
- `asstText(text)` → `{ role: "assistant", content: [{ type: "text", text }] }` ← **content is an ARRAY**
- `asst(...callIds)`, `result(toolCallId)`, `custom(customType)`
- `summary(units)`, `expectPairingInvariant(messages, units)` (not needed here)

## 4. `applyShrink` non-mutation proof (src/transforms.ts ~L963–L1000)

Signature: `applyShrink(messages, marker: {target, replacement, pinnedEntryId?}, branchEntries?) → MessageLike[]`

Body mechanics that GUARANTEE non-mutation:
- Match resolved to index `i` via `resolveShrinkTarget` (live) or `resolvePinnedShrink` (pinned).
- No-match / out-of-range → `return messages;` (**SAME reference** — this is E8's no-op, already tested).
- On match:
  - `replacement = { ...(orig as MessageLike), content: newContent }` → spread CLONE; `orig` is never assigned to.
  - `return messages.map((m, j) => (j === i ? replacement : m));` → a **NEW array**; index `i` is the clone, every other index is the SAME object ref as the input (passed by reference, never read/written).

⇒ The input array AND its element objects are provably never mutated. The new tests make this invariant EXPLICIT.

## 5. Established non-mutation test idiom (house style)

From `test/drift_nudge.test.ts`:
- L185 `injectNudge`: `expect(result).not.toBe(input)` + `expect(input).toHaveLength(1)` + `expect(input)` UNCHANGED.
- L492 `injectHighWaterNudge`: `expect(before[0]).toEqual({ role: "user", content: "hi" })` (deep-equality on the element).

The task contract additionally specifies a **byte-identical JSON snapshot** (`JSON.parse(JSON.stringify(msgs))`) for the hard-invariant test — stricter than `toEqual` (catches any nested mutation). Use BOTH: the snapshot for the byte-identical guarantee + `expect(out).not.toBe(msgs)` for the new-array guarantee.

## 6. Content-type gotcha (load-bearing for assertions)

- A `user(...)` message has `content: string`.
- After `applyShrink`, the RETURNED replacement has `content: ContentBlock[]` (`[{ type: "text", text: stampShrink(rep) }]`).
- So: input content assertion = string comparison; output content assertion = array-index + cast (the existing E19 tests already cast `out[0].content as Array<Record<string, unknown>>`).
- `stampShrink("X")` returns `"<context-shrunk>\nX\n</context-shrunk>"` — NEVER equals a raw user string, so `expect(msgs[0].content).not.toBe(stampShrink("X"))` is a valid belt-and-suspenders assertion.

## 7. Validation commands (verified present)

- `package.json` scripts: `"test": "vitest run"`, `"typecheck": "tsc --noEmit"`.
- Targeted single-file: `npx vitest run test/edge-cases.test.ts` (vitest filters by filename substring).
- Full suite: `npm test`.
- Typecheck: `npm run typecheck`.

## 8. Scope / parallel-context safety

- P3.M1.T1.S1 (running in parallel) edits ONLY `README.md` — different file, **zero conflict**.
- This task edits ONLY `test/edge-cases.test.ts`. No `src/*.ts`, no `spec/*.md`, no README.
- Mode A = test-only; the spec bullet already landed (commit d5701c8f updated spec/08) — no spec edit.

## 9. Downstream consumers (do not break)

- P4.M1.T1.S2 (integration proof, smoke.ts F-shrink-persist) — builds on this helper-level invariant.
- P4.M1.T1.S3 (README one-line trust note) — may cite these tests.

## 10. Confidence

9/10 — test-only, fully specified, established idiom, no external deps, exact insertion anchor captured. Only residual risk is a TypeScript cast nuance, which the existing E19 tests already model.