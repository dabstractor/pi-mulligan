# Research: Test Landscape for P2.M3.T1.S3 (Banner Hook Wiring)

## Summary

S3 adds `reconcileBanner(ctx)` calls at two hook points. This research confirms both are
**provably safe** against the existing test suite: every test fake-ctx omits `hasUI`
(`undefined` → falsy), so `reconcileBanner` no-ops immediately at its `!ctx.hasUI` guard.
No test can break from the new calls.

---

## A) test/index.test.ts — session_start handler

**How tested:** the extension factory (`indexFactory(pi)`) is invoked with a `makePi()` fake
that captures `.on` / `.registerTool` / `.registerCommand`. The `session_start` handler is
fetched from `handlers["session_start"]` and invoked directly:

```ts
handlers["session_start"]!(makeStartEvent("new"), makeCtx(sid));
```

**Fake ctx (makeCtx, ~L64-75) — NO `hasUI`, NO `ui`, NO `getEntries`:**
```ts
function makeCtx(sessionId = "sess-test", cwd = "/test/cwd") {
  const sessionManager = {
    getSessionId() { return sessionId; },
  };
  return {
    sessionManager: sessionManager as unknown as ExtensionContext["sessionManager"],
    cwd,
  } as ExtensionContext;
}
```

**Will a bare `reconcileBanner(ctx)` at the session_start tail break this test?**
**NO.** `ctx.hasUI` is `undefined` (falsy) → `reconcileBanner` returns at the `!ctx.hasUI`
guard before touching `ctx.ui`. `reconcileBanner` is also whole-body try/catch (never throws),
so the unprotected session_start body is safe.

---

## B) test/filter.test.ts — contextHandler

**How tested:** `contextHandler` is imported and called directly:
`contextHandler(pi, event, ctx)`.

**Fake ctx (makeCtx, ~L104-132) — NO `hasUI`, NO `ui`, HAS `getEntries`:**
```ts
function makeCtx(opts: { sessionId?: string; entries?: SessionEntry[]; branch?: SessionEntry[];
  throwOnGetEntries?: boolean; throwOnGetBranch?: boolean; throwOnGetSessionId?: boolean;
  getContextUsage?: () => ... } = {}) {
  const sessionId = opts.sessionId ?? "s1";
  const sessionManager = {
    getSessionId() { ... return sessionId; },
    getEntries() { ... return opts.entries ?? []; },
    getBranch() { ... return opts.branch ?? []; },
  };
  const ctx: { sessionManager: unknown; getContextUsage?: () => unknown } = { sessionManager };
  if (opts.getContextUsage !== undefined) ctx.getContextUsage = opts.getContextUsage;
  return ctx as unknown as ExtensionContext;
}
```

**Will `try { reconcileBanner(ctx); } catch {}` at the contextHandler tail break this test?**
**NO.** `ctx.hasUI` is `undefined` (falsy) → `reconcileBanner` no-ops at the guard. Triple
protection: (1) `!ctx.hasUI` no-op, (2) `reconcileBanner`'s own whole-body try/catch,
(3) the explicit outer `try { } catch { }`. The already-computed `{ messages }` return is
preserved in every existing case.

---

## C) Commands (package.json scripts)

- `npm test` → `vitest run`
- `npm run typecheck` → `tsc --noEmit`
- `npm run prepublishOnly` → `tsc --noEmit && vitest run`

---

## D) edge-cases.test.ts & audit.test.ts

**edge-cases.test.ts** has its own `makeCtx` (~L178+): minimal fake with `getSessionId` +
`leafId` + `getEntries` + `getBranch`. **NO `hasUI`, NO `ui`.** Calls `contextHandler` at
~L734-752, L846. Safe — same reasoning: `!ctx.hasUI` no-op.

**audit.test.ts** has its own `makeCtx` (~L92+): `getEntries` on sessionManager, **NO
`hasUI`/`ui`**. References to `contextHandler` in comments only; no direct invocation with a
ctx that has `hasUI`. Safe.

---

## Key Takeaway for the PRP

The change is **2 file edits + 1 verification**:
1. `commands.ts` (hook a) — **ALREADY DONE** (verify only: import present at L35, calls at
   L187 SET + L228 REVOKE).
2. `index.ts` (hook b) — add import + bare `reconcileBanner(ctx)` after `resetRuntime(...)`.
3. `filter.ts` (hook c) — add import + `try { reconcileBanner(ctx); } catch {}` between the
   stale-retirement block and `return { messages }`.

Validation gates: `npm run typecheck` (clean) + `npm test` (green). No test can break because
no fake-ctx has `hasUI`. The committed banner/filter tests are owned by S4.