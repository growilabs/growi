# LSP Usage

The `LSP` tool provides TypeScript-aware code intelligence. Prefer it over `grep`/`find` for symbol-level queries.

## Tool availability (read before concluding LSP is unavailable)

The way `LSP` is exposed differs between the main session and sub-agents. Check which context you are in before concluding it is unavailable.

**Main session (this file is in your system prompt):**
`LSP` is registered as a **deferred tool** — its schema is not loaded at session start, so it will NOT appear in the initial top-level tool list. It instead shows up by name inside the session-start `<system-reminder>` listing deferred tools.

Do not conclude LSP is unavailable just because it isn't in the initial tool list. To use it:

1. Confirm `LSP` appears in the deferred-tool list in the session-start system-reminder.
2. Load its schema with `ToolSearch` using `query: "select:LSP"`.
3. After that, call `LSP` like any other tool.

Only if `LSP` is missing from the deferred-tool list AND `ToolSearch` with `select:LSP` returns no match should you treat LSP as disabled and fall back to `grep`.

**Sub-agents (Explore, general-purpose, etc.):**
`LSP` is provided directly in the initial tool list — no `ToolSearch` step needed. `ToolSearch` itself is not available in sub-agents. Just call `LSP` as a normal tool.

Note: `.claude/rules/` files are NOT injected into sub-agent system prompts. A sub-agent will not know the guidance in this file unless the parent includes it in the `Agent` prompt. When delegating symbol-level research (definition lookup, caller search, type inspection) to a sub-agent, restate the key rules inline — at minimum: "prefer LSP over grep for TypeScript symbol queries; use `incomingCalls` for callers, `goToDefinition` for definitions".

## Auto-start behavior

The `typescript-language-server` starts automatically when the LSP tool is first invoked — no manual startup or health check is needed. If the server isn't installed, the tool returns an error; in that case fall back to `grep`.

In the devcontainer, `typescript-language-server` is pre-installed globally via `postCreateCommand.sh`. It auto-detects and uses the workspace's `node_modules/typescript` at runtime.

## When to use LSP (not grep)

| Task | Preferred LSP operation |
|------|------------------------|
| Find where a function/class/type is defined | `goToDefinition` |
| Find all call sites **including imports** | `findReferences` (see caveat below) |
| Find which functions call a given function | `incomingCalls` ← prefer this over `findReferences` for callers |
| Check a variable's type or JSDoc | `hover` |
| List all exports in a file | `documentSymbol` |
| Find what implements an interface | `goToImplementation` |
| Trace what a function calls | `outgoingCalls` |

## Decision rule

- **Use LSP** when the query is about a *symbol* (function, class, type, variable) — LSP understands TypeScript semantics and won't false-match string occurrences or comments.
- **Use grep** when searching for string literals, comments, config values, or when LSP returns no results (e.g., generated code, `.js` files without types).

## `findReferences` — lazy-loading caveat

TypeScript LSP loads files **on demand**. On a cold server (first query after devcontainer start), calling `findReferences` from the *definition file* may return only the definition itself because consumer files haven't been loaded yet.

**Mitigation strategies (in order of preference):**

1. **Prefer `incomingCalls`** over `findReferences` when you want callers. It correctly resolves cross-file call sites even on a cold server.
2. If you need `findReferences` with full results, call it from a **known call site** (not the definition). After any file in the consumer chain is queried, the server loads it and subsequent `findReferences` calls return complete results.
3. As a last resort, run a `hover` on an import statement in the consumer file first to warm up that file, then retry `findReferences` from the definition.

## Required: line + character

LSP operations require `line` and `character` (both 1-based). Read the file first to identify the exact position of the symbol, then call LSP.

```
# Example: symbol starts at col 14 on line 85
export const useCollaborativeEditorMode = (
             ^--- character 14
```
