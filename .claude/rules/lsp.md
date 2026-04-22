# LSP Usage

The `LSP` tool provides TypeScript-aware code intelligence. Prefer it over `grep`/`find` for symbol-level queries.

## When to use LSP (not grep)

| Task | LSP operation |
|------|--------------|
| Find where a function/class/type is defined | `goToDefinition` |
| Find all call sites of a function | `findReferences` |
| Check a variable's type or JSDoc | `hover` |
| List all exports in a file | `documentSymbol` |
| Find what implements an interface | `goToImplementation` |
| Trace who calls a function | `incomingCalls` |
| Trace what a function calls | `outgoingCalls` |

## Decision rule

- **Use LSP** when the query is about a *symbol* (function, class, type, variable) — LSP understands TypeScript semantics and won't false-match string occurrences.
- **Use grep** when searching for string literals, comments, config values, or when LSP returns no results (e.g., generated code, `.js` files without types).

## Required: line + character

LSP operations require `line` and `character` (both 1-based). Read the file first to identify the exact position of the symbol, then call LSP.
