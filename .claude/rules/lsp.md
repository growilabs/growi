# LSP Usage

The `LSP` tool provides TypeScript-aware code intelligence. Prefer it over `grep`/`find` for symbol-level queries.

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
