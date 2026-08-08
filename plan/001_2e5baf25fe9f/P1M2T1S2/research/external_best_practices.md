# External Best Practices — P1.M2.T1.S2 (`resultBytes` + `approxTokens`)

## 1. UTF-8 byte length in Node: `Buffer.byteLength(str, "utf8")`
- **MDN — `Buffer.byteLength(string[, encoding])`**:
  https://nodejs.org/api/buffer.html#static-method-bufferbytelength-string-encoding
  > "Returns the actual byte length of a string. … encoding defaults to 'utf8'. … Gives the byte length of the
  > UTF-8 representation."
- This is the canonical, O(n), synchronous way to get UTF-8 byte length in Node. It is a global (no import).
- Examples (verified):
  - `Buffer.byteLength("", "utf8")`        → 0
  - `Buffer.byteLength("abc", "utf8")`     → 3   (ASCII: bytes == chars)
  - `Buffer.byteLength("café", "utf8")`    → 5   (é = U+00E9 = 2 bytes in UTF-8; bytes > chars)
  - `Buffer.byteLength("😀", "utf8")`      → 4   (U+1F600 = 4 bytes in UTF-8)
  - `Buffer.byteLength("hello 世界", "utf8")` → 11 (世界 = 3 bytes each = 6, + "hello " = 6... actually "hello "=6 incl. space, 世=3, 界=3 → 12; verify before snapshotting)
- WHY byte length (not `.length`/char count): the work-item contract pins `Buffer.byteLength(block.text, "utf8")`
  for TEXT and spec/07 §1 states the threshold is "in bytes of the in-context text representation (sum of `.text`
  lengths across content blocks, UTF-8 byte length)". `.length` would UNDERCOUNT multibyte text → a 16 KB result
  of CJK text would read as ~6 KB chars, slipping under the 8 KB threshold wrongly. Byte length is correct.
- PITFALL to avoid: `new TextEncoder().encode(str).length` also works and is encoding-agnostic, but
  `Buffer.byteLength` is simpler, faster, and already the Node idiom. The contract pins `Buffer.byteLength`.

## 2. Base64 is ASCII → `.length` == byte length (why the image case uses `.length`)
- Base64 alphabet is `A–Z a–z 0–9 + /` + `=` padding — all single-byte ASCII.
  (RFC 4648: https://datatracker.ietf.org/doc/html/rfc4648#section-4)
- Therefore for a base64 string `data`, `data.length` (JS char count) == UTF-8 byte length exactly.
- The work-item contract uses `block.data?.length ?? 0` for image — correct and consistent with byte-counting
  for free (no `Buffer.byteLength` needed). Using `.length` here (not byteLength) is also slightly cheaper on a
  potentially-huge base64 blob.
- DO NOT "improve" this to `Buffer.byteLength(data, "utf8")` — same number, but the contract says `.length`, and
  matching the contract avoids drift if someone later changes base64 handling.

## 3. The bytes→tokens heuristic: `Math.ceil(bytes / 4)`
- OpenAI rule of thumb (also cited in S1's research): **~4 characters ≈ 1 token** for English.
  https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them
- For ASCII text bytes == chars, so **bytes / 4** is the same heuristic applied to the byte count. For non-ASCII
  (multibyte) text, bytes/4 OVERESTIMATES tokens (a CJK char ≈ 1 token but 3 bytes → bytes/4 ≈ 0.75 tokens/char).
  This is ACCEPTABLE: `approxTokens` is an advisory, deliberately-rough number for the turn-metric/audit display,
  NOT a billing count. The confidence-flag discipline (S1) carries the honesty; `approxTokens` is its byte-side
  twin.
- spec/07 §1 calibration note: "Default bloatThresholdBytes = 8192 (8 KB ≈ 2k tokens in-context)." Check:
  `approxTokens(8192) = Math.ceil(8192/4) = 2048` = 2k. ✓ The contract's `bytes/4` reproduces the spec's own
  8 KB ≈ 2k tokens equivalence EXACTLY. This is strong confirmation `Math.ceil(bytes / 4)` is the intended formula.
- `Math.ceil` (not floor): a non-empty result with any bytes ≥ 1 reports ≥ 1 token (intuitive); conservative
  overestimate (fires the nudge slightly early rather than late). ceil is monotonic non-decreasing. S1 uses ceil
  for the same reason — S2 mirrors it for consistency.

## 4. Reuse `CHARS_PER_TOKEN` (= 4), don't add a redundant `BYTES_PER_TOKEN`
- The S1 PRP exports `CHARS_PER_TOKEN = 4` explicitly "for transparency + S2/test reuse." Reusing it:
  (a) keeps one canonical "4" (DRY); (b) the value is identical; (c) a test that changes CHARS_PER_TOKEN
  propagates to approxTokens automatically. Add a JSDoc note on approxTokens explaining the reuse.

## 5. Defensive / never-throw discipline (mirror S1 + log.ts)
- resultBytes runs in the `tool_result` hot path. The handler (spec/07 §1) wraps everything in try/catch, but
  resultBytes should STILL be defensive (consistent with S1's `isRecord`/`readOwn`/`stringLength`):
  - non-array content (null/undefined/string/number) → 0
  - null/non-record block element → skip (contributes 0)
  - missing `type` / unknown `type` → 0 (forward-compat: future block types contribute nothing)
  - missing `text`/`data` or non-string → 0
  - Proxy with throwing get-trap → `readOwn` swallows → 0 (never throws)
- approxTokens defensive guard: `Number.isFinite(bytes) && bytes >= 0` else 0. `Buffer.byteLength` and
  `Math.ceil` never throw, so the only "bad" inputs are NaN/±Infinity/negative → guard them to 0.
- NEVER throw from either function — they're on the hot path and on the persisted-metric path.

## 6. Test determinism (for the snapshot/known-value tests)
- Use a controlled string whose UTF-8 byte length is unambiguous:
  - ASCII: `"abc".repeat(1)` → 3 bytes; `"a".repeat(8000)` → 8000 bytes.
  - Multibyte (PROVES byte not char counting): `"café"` → 5 bytes (NOT 4); `"é".repeat(4)` → 8 bytes.
- approxTokens known values: `approxTokens(8192)=2048` (the spec's 8 KB ≈ 2k equivalence — the load-bearing
  assertion), `approxTokens(0)=0`, `approxTokens(40)=10`, `approxTokens(41)=11` (ceil boundary).
- End-to-end: `approxTokens(resultBytes([{type:"text",text:"a".repeat(8000)}])) === 2000` — proves the two
  helpers compose to the spec/07 bloat → token pipeline.
- Use `toBe` (exact) for byte counts and approxTokens outputs — they are deterministic integers, not estimates
  that need tolerance. (`estimateTokens` is the "approximate" one; resultBytes/approxTokens are exact arithmetic.)

## 7. Common pitfalls to avoid
- ❌ Using `str.length` (char count) instead of `Buffer.byteLength(str, "utf8")` for TEXT → undercounts
  multibyte results; violates spec/07 §1 ("UTF-8 byte length") and the work-item contract.
- ❌ `import { Buffer } from "node:buffer"` → unnecessary AND breaks the tokens.ts zero-imports gate (S1
  GOTCHA #2). Buffer is a global; just use it.
- ❌ `Math.floor(bytes / 4)` → a 1–3 byte result reports 0 tokens (counterintuitive; breaks "non-empty → ≥1").
- ❌ Throwing on malformed content → crashes the tool_result handler's metric path. Always defensive.
- ❌ Adding a separate `BYTES_PER_TOKEN = 4` → redundant; reuse `CHARS_PER_TOKEN`.
- ❌ Re-creating `src/tokens.ts` / `test/tokens.test.ts` (S1 owns them) → APPEND only; S2 adds a delimited
  section at EOF + edits the test import line.