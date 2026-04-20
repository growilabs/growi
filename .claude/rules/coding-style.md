# Coding Style

General coding standards for all code in the GROWI monorepo.

## Immutability (CRITICAL)

ALWAYS create new objects, NEVER mutate:

```typescript
// ❌ WRONG: Mutation
user.name = name;
pages[index].title = newTitle;

// ✅ CORRECT: Immutable update
return { ...user, name };
const updatedPages = pages.map(p => (p.id === id ? { ...p, title: newTitle } : p));
```

## File Organization

MANY SMALL FILES > FEW LARGE FILES:

- **High cohesion, low coupling** — every symbol in a file should share a single responsibility; if you struggle to name the file, it probably has too many
- 200–400 lines typical, 800 max
- Functions < 50 lines
- Extract utilities from large components
- Organize by feature/domain, not by type

## Module Design: Separation of Concerns

### Pure Function Extraction

When a framework-specific wrapper (React hook, Express middleware, CodeMirror extension handler, etc.) contains non-trivial logic, extract the core logic as a **pure function** and reduce the wrapper to a thin adapter. This enables reuse across contexts and makes unit testing straightforward.

```typescript
// ✅ Pure function — testable, reusable from hooks, keymaps, shortcuts, etc.
// services-internal/markdown-utils/toggle-markdown-symbol.ts
export const toggleMarkdownSymbol = (view: EditorView, prefix: string, suffix: string): void => {
  // Pure logic
};

// React hook wrapper
export const useInsertMarkdownElements = (view?: EditorView) => {
  return useCallback((prefix, suffix) => {
    if (view == null) return;
    toggleMarkdownSymbol(view, prefix, suffix);
  }, [view]);
};

// Emacs command wrapper
EmacsHandler.addCommands({
  markdownBold(handler: { view: EditorView }) {
    toggleMarkdownSymbol(handler.view, '**', '**');
  },
});
```

**Applies to**: React hooks, Express/Koa middleware, CLI command handlers, CodeMirror extension callbacks, test fixtures — any framework-specific adapter that wraps reusable logic.

### Data-Driven Control over Hard-Coded Mode Checks

Replace conditional branching on mode/variant names with **declared metadata** that consumers filter generically. This eliminates the need to update consumers when adding new modes.

```typescript
// ❌ WRONG: Consumer knows mode-specific behavior
if (keymapModeName === 'emacs') {
  return sharedKeyBindings;
}
return [formattingBindings, ...sharedKeyBindings];

// ✅ CORRECT: Module declares its overrides, consumer filters generically
// Keymap module returns: { overrides: ['formatting', 'structural'] }
const activeBindings = allGroups
  .filter(group => group.category === null || !overrides?.includes(group.category))
  .flatMap(group => group.bindings);
```

### Factory Pattern with Encapsulated Metadata

When a module produces a value that needs consumer-side configuration (precedence, feature flags, etc.), **bundle the metadata alongside the value** in a structured return type. This keeps decision-making inside the module that has the knowledge.

```typescript
// ❌ WRONG: Consumer decides precedence based on mode name
const wrapWithPrecedence = mode === 'vim' ? Prec.high : Prec.low;
codeMirrorEditor.appendExtensions(wrapWithPrecedence(keymapExtension));

// ✅ CORRECT: Factory encapsulates its own requirements
interface KeymapResult {
  readonly extension: Extension;
  readonly precedence: (ext: Extension) => Extension;
  readonly overrides: readonly ShortcutCategory[];
}
// Consumer applies generically:
codeMirrorEditor.appendExtensions(result.precedence(result.extension));
```

### Responsibility-Based Submodule Decomposition

When a module grows beyond ~200 lines or accumulates multiple distinct responsibilities, split into submodules **by responsibility domain** (not by arbitrary size). Each submodule should be independently understandable.

```
// ❌ WRONG: One large file with mixed concerns
keymaps/emacs.ts  (400+ lines: formatting + structural + navigation + save)

// ✅ CORRECT: Split by responsibility
keymaps/emacs/
├── index.ts          ← Factory: composes submodules
├── formatting.ts     ← Text styling commands
├── structural.ts     ← Document structure commands
└── navigation.ts     ← Movement and editing commands
```

## Module Public Surface: Barrel Files & Directory Boundaries

Treat a directory as a **module with a single public entry point** (`index.ts`). The barrel declares the public API; everything else is an implementation detail.

### Rules

1. **One barrel per module directory.** `index.ts` is the sole export surface. Siblings/parents import only from the barrel, never reach into internal files.
2. **Re-export only what callers need.** If a symbol has no external caller, do not add it to the barrel. Expanding the surface is a deliberate decision, not a default.
3. **Nest subdirectories for cohesive internals.** When a module has a cluster of related files (DOM rendering, parsers, adapters), move them into a subdirectory with its own barrel. The parent barrel imports from that subdirectory without leaking its internals.
4. **Prefer `import { X } from './dom'` over `import { X } from './dom/widget'`.** Reaching through a barrel keeps the coupling at the module level, not the file level.

### Example (from `y-rich-cursors/` refactor)

```
y-rich-cursors/
├── index.ts                      ← Public API: only yRichCursors() + YRichCursorsOptions
├── plugin.ts                     ← Internal orchestrator
├── activity-tracker.ts           ← Internal
├── local-cursor.ts               ← Internal
├── viewport-classification.ts    ← Internal
└── dom/
    ├── index.ts                  ← Sub-barrel: exposes widget/theme/indicator to siblings only
    ├── widget.ts
    ├── theme.ts
    └── off-screen-indicator.ts
```

Before the refactor, `index.ts` re-exported `RichCaretWidget`, `createOffScreenIndicator`, `ScrollCallbackRef`, etc. — internal details leaked as public API. After: the top-level barrel exposes the single `yRichCursors` entry point, and DOM concerns live behind `dom/index.ts` so that sibling modules (`plugin.ts`) can consume them without making them part of the module's external contract.

**When adding a new file, ask**: is this intended for external callers? If no, it does not belong in the top-level barrel. If it is one of several related internals, consider a subdirectory.

## Naming Conventions

- **camelCase** — variables, functions
- **PascalCase** — classes, interfaces, types, React components
- **UPPER_SNAKE_CASE** — constants
- **PascalCase** file — React components (`Button.tsx`)
- **kebab-case** file — utilities (`page-utils.ts`)
- **lowercase** directory — `features/page-tree/`, `utils/`

## Export Style

**Prefer named exports** over default exports:

```typescript
// ✅ Good
export const MyComponent = () => { };

// ❌ Avoid (exception: Next.js pages)
export default MyComponent;
```

Named exports give reliable IDE rename, better tree shaking, and unambiguous import names.

## Type Safety

Always provide explicit types for function parameters and return values. Use `import type` for type-only imports.

```typescript
function createPage(path: string, body: string): Promise<Page> { /* ... */ }

import type { PageData } from '~/interfaces/page';
```

## Error Handling

Handle errors comprehensively — log with context, rethrow with a user-friendly message:

```typescript
try {
  return await riskyOperation();
} catch (error) {
  logger.error('Operation failed:', { error, context });
  throw new Error('Detailed user-friendly message');
}
```

## Async/Await

Prefer `async/await` over `.then()` chains.

## Comments

**Write comments in English.** Only comment when the WHY is non-obvious (hidden constraints, invariants, workarounds). Do not restate what the code does — let naming do that work.

## Test File Placement

Co-locate tests with source files.

- Unit: `*.spec.{ts,js}`
- Integration: `*.integ.ts`
- Component: `*.spec.{tsx,jsx}`

## Git Commit Messages

Conventional commits:

```
<type>(<scope>): <subject>

<body>
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.

## Cross-Platform Compatibility

GROWI must work on Windows, macOS, and Linux. Never use platform-specific shell commands in npm scripts.

```json
// ❌ WRONG: Unix-only
"clean": "rm -rf dist"

// ✅ CORRECT: Cross-platform
"clean": "rimraf dist"
```

- Use `rimraf` instead of `rm -rf`
- Use Node.js one-liners or cross-platform tools (`cpy-cli`, `cpx2`) instead of `cp`, `mv`, `echo`, `ls`
- Never assume a POSIX shell in npm scripts

## Code Quality Checklist

Before marking work complete:

- [ ] Code is readable and well-named
- [ ] Functions are small (<50 lines)
- [ ] Files are focused (<800 lines) and **highly cohesive** (one responsibility per file; filename describes all symbols)
- [ ] No deep nesting (>4 levels)
- [ ] Proper error handling
- [ ] No `console.log` (use logger)
- [ ] No mutation (immutable patterns used)
- [ ] Named exports (except Next.js pages)
- [ ] English comments
- [ ] Co-located tests
- [ ] Non-trivial logic extracted as pure functions from framework wrappers
- [ ] No hard-coded mode/variant checks in consumers (use declared metadata)
- [ ] Modules with multiple responsibilities split by domain
- [ ] **Module public surface is minimal** — `index.ts` re-exports only what external callers need; internals stay unexported
- [ ] **Cohesive internals are grouped in subdirectories** with their own barrel, not flattened into the parent
