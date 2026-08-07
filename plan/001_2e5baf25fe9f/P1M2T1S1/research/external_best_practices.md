# External Best Practices — P1.M2.T1.S1 (estimateTokens)

## 1. The "~4 chars ≈ 1 token" heuristic is industry-standard for English

Primary source — OpenAI's official tokenizer guidance:
- **OpenAI Help — "What are tokens and how to count them?"** https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them
  > "Helpful rules of thumb for English: **1 token ≈ 4 characters**, 1 token ≈ ¾ of a word, 100 tokens ≈ 75 words. Tokenization varies by model and encoding."

Corroboration (all agree on ~4 chars/token for English prose + code):
- tokenx (heuristic estimator, "no tokenizer library"): https://github.com/johannschopplich/tokenx — "Estimates the number of tokens … using heuristic rules that work across multiple languages."
- Winder.ai — "Calculating LLM Token Counts": https://winder.ai/calculating-token-counts-llm-context-windows-practical-guide/ — "a token typically represents about 4 characters or roughly three-quarters of a word."
- iternal.ai Token Usage Guide: https://iternal.ai/token-usage-guide — "1 token ≈ 0.75 words (about 4 characters of English)."

**Conclusion**: `CHARS_PER_TOKEN = 4` is the correct, defensible constant. It is an APPROXIMATION (non-English, code, base64 all skew it) — hence the mandatory confidence flag.

## 2. Why a heuristic (not a tokenizer library) is the RIGHT call here

- **Tokenizers are model-specific.** tiktoken (OpenAI BPE) does not match Claude/Gemini/Grok encodings. Mulligan is model-agnostic (`model?: unknown`); shipping one tokenizer would be wrong for half the models.
- **The use-cases are monotonic/advisory, not billing.** Mulligan uses tokens for: (a) audit "how big is my context" display, (b) per-turn drift delta vs a threshold, (c) bloat flags. ALL of these need a **monotonic, stable, cheap** proxy — NOT an exact count. spec/01 §7 + spec/04 §5 + spec/05 §4 confirm estimates are reported AS estimates with a confidence flag.
- **Determinism + zero-dep.** A char heuristic is O(n), allocation-light, and adds no npm dep. spec (`external_deps.md` line 114) explicitly forbids a tokenizer library.

## 3. Best practices for a character-count estimator (applied in tokens.ts)

1. **Sum first, divide once.** `tokens = ceil(totalChars / 4)`, NOT `sum(ceil(blockChars/4))`. The contract ("Sum character lengths, divide by ~4") mandates total-then-divide — avoids per-block rounding inflation. Per-message estimates come for free via `estimateTokens([msg])`.
2. **`Math.ceil`, not floor.** Non-empty → ≥1 token (intuitive); conservative overestimate (safer for drift/threshold detection — fires the nudge slightly early rather than late). ceil is monotonic non-decreasing in `chars`.
3. **Monotonicity is the load-bearing invariant.** A longer input MUST NEVER estimate fewer tokens. Additivity of `chars` + monotonicity of `ceil`/division guarantees it. Tests assert: longer-string `<` ; adding-a-message `≥`.
4. **Never throw.** A malformed message (missing content, throwing Proxy trap, circular `arguments`) must contribute ≥0, not crash the filter/audit/nudge. Mirror log.ts's fail-open: wrap risky ops (`JSON.stringify`, property reads) in try/catch.
5. **Stringify ALL content-bearing blocks** (text, thinking, toolCall name+args, image base64) so the estimate is honest about size even when approximate. Image base64/4 is a deliberate overestimate — the confidence flag carries the honesty.
6. **Structural typing over nominal imports.** The Pi `AgentMessage` union is unimportable here; define a minimal local `MessageLike` + `ContentBlock` union so real messages assign in with no cast (structural compatibility).

## 4. Common pitfalls to avoid

- ❌ **Per-block ceil then sum** → inflates small messages (each tiny block rounds up to 1). Use total-then-divide.
- ❌ **Importing a tokenizer / pi-agent-core** → unresolvable here (not hoisted) + forbidden by spec.
- ❌ **`floor`** → a 1–3 char message estimates to 0 (counterintuitive; "empty → 0" should be unique to truly empty input).
- ❌ **Throwing on malformed input** → crashes the `context`/`turn_end` hot path. Always defensive.
- ❌ **Letting `model?` change v1 behavior** → the contract fixes the heuristic as model-agnostic; reserve `model?` for FUTURE calibration (leave unused, documented).
- ❌ **Importing config.ts to read the confidence** → breaks the pure-helper tier. Confidence override is the AUDIT TOOL's job (consumer-side).

## 5. Snapshot-stability note

The "known string → stable estimate (snapshot)" test (`spec/10` §1.7) must be DETERMINISTIC. Use a controlled-length string (`"a".repeat(44)` → 44 chars → `ceil(44/4)=11`) rather than hand-counting a prose phrase, so the snapshot value is exact and self-evident.