# External best practices — structured JSONL logger (P1.M1.T3.S1)

All facts below were **empirically verified** in the project's Node runtime
(`node --version` → **v26.7.0**, `type:"module"`, `moduleResolution:"Bundler"`,
`types:["node"]`, vitest 1.x, `@types/node ^22`) by the scout research run, plus
canonical documentation URLs. This feeds the PRP's *Documentation & References*
and *Known Gotchas* sections.

---

## 1. JSONL / NDJSON wire format

**Rule:** one JSON value per line, each terminated by `\n`, **no** enclosing
array/brackets. The correct append unit is exactly `JSON.stringify(obj) + "\n"`.

- jsonlines.org — "a convenient format for storing structured data that may be
  processed one record at a time … each Line is a Valid JSON Value … Line
  Separator is `\n`": <http://jsonlines.org>
- NDJSON (newline-delimited JSON) — identical rule set: <http://ndjson.org>
- **Why append-only is safe:** each line is an independent, self-delimited JSON
  document; appending never has to parse or rewrite prior bytes, so partial
  writes / process kills leave prior lines intact and the file stays parseable
  line-by-line (`split('\n')` → `JSON.parse` each non-empty line).

## 2. `fs.appendFileSync` semantics (Node.js)

Default flag is `'a'`: **creates** the file if absent, **appends** if present.
A `string` argument defaults to `'utf8'` encoding. It is **synchronous/blocking**
— acceptable for a low-volume debug/observability log (a handful of lines per
turn); do not use it in a hot loop.

Doc: <https://nodejs.org/api/fs.html#fsappendfilesyncpath-data-options>
(section `fs.appendFileSync(path, data[, options])`).

**Verified error codes** (each thrown synchronously, each caught by our try/catch
→ stderr fallback):

| code     | when                                                            |
|----------|-----------------------------------------------------------------|
| `ENOENT` | parent directory does not exist (bad path) — **verified**      |
| `EACCES` | permission denied (path under a dir we can't write)            |
| `EISDIR` | `file` path resolves to an existing directory — **verified**   |
| `ENOSPC` | disk full                                                       |

> Verified live: `appendFileSync('/nonexistent/deep/path/x.jsonl', …)` throws
> `ENOENT`; `appendFileSync('/tmp', …)` (a dir) throws `EISDIR`. Both are the
> intended "bad path → never crash the extension" cases (spec/09 §4).

## 3. `JSON.stringify` failure modes (MUST be inside the try/catch)

`JSON.stringify` **throws `TypeError`** on:
- **circular references** — *verified*
- **BigInt values** — *verified*

Doc / Exceptions section:
<https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify#exceptions>

⇒ The `JSON.stringify(line)` call **and** the `appendFileSync` call must both be
inside the **same** `try { … } catch { stderr-fallback }` block, so a malformed
`data` payload (circular ref, BigInt) never escapes the logger. (This is why we
do NOT use a separate `safeStringify` here — the outer fail-open catch is the
safety net, matching the work-item contract step (d).)

## 4. ISO 8601 timestamps

`new Date().toISOString()` → UTC `YYYY-MM-DDTHH:mm:ss.sssZ`
(*verified:* `2026-08-07T23:29:02.481Z`). Sortable, timezone-explicit — the
correct `ts` field for a structured log.

Doc: <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toISOString>

Test-side assertion: `!Number.isNaN(Date.parse(parsed.ts))` and
`parsed.ts.endsWith("Z")`.

## 5. vitest temp-file + cleanup + stderr-spy patterns

vitest runs in **real Node** by default (not jsdom), so `node:fs`, `node:os`,
and `process` are all live.

- Temp dir: `fs.mkdtempSync(path.join(os.tmpdir(), "mulligan-log-"))` in
  `beforeEach` — *verified* (returns a fresh unique dir under `/tmp`).
  `fs.mkdtempSync`: <https://nodejs.org/api/fs.html#fsmkdtempsyncprefix-options>
- Cleanup: `fs.rmSync(dir, { recursive: true, force: true })` in `afterEach` —
  *verified* (cleans up even if the test failed). `fs.rmSync`:
  <https://nodejs.org/api/fs.html#fsrmsyncpath-options>
- Asserting the **stderr fallback**: `vi.spyOn(process.stderr, "write")` with
  `mockImplementation(() => true)` to capture + suppress the noise, then
  `expect(spy).toHaveBeenCalled()` / assert the message fragment. *verified:*
  `process.stderr.write(...)` returns `true` (a boolean). vitest `vi.spyOn`:
  <https://vitest.dev/api/vi.html#vi-spyon>

> The module holds a **mutable module-level `logFile`** (like `config.ts`'s
> cache). Tests MUST reset it — `setLogFile(null)` in `beforeEach` — so a test
> that pointed the logger at a temp file can't leak into the next. (Mirrors
> config.ts GOTCHA #9.)

## 6. ESM `node:` import specifiers

Under `"type":"module"` + `moduleResolution:"Bundler"`,
`import { appendFileSync } from "node:fs"` is the preferred, unambiguous form
(vs bare `"fs"`). `node:` specifiers always resolve to the Node built-in, are
importable from ESM, and are typed by `@types/node`. *Verified* against this
repo's `package.json`/`tsconfig.json`.

Doc: <https://nodejs.org/api/esm.html#node-imports> ("`node:` imports … can be
used to load Node.js built-in modules … always resolves to the Node built-in").