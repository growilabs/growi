# Coding Style

General coding standards and best practices. These rules apply to all code in the GROWI monorepo.

## Immutability (CRITICAL)

ALWAYS create new objects, NEVER mutate:

```typescript
// ❌ WRONG: Mutation
function updateUser(user, name) {
  user.name = name  // MUTATION!
  return user
}

// ✅ CORRECT: Immutability
function updateUser(user, name) {
  return {
    ...user,
    name
  }
}

// ✅ CORRECT: Array immutable update
const updatedPages = pages.map(p => p.id === id ? { ...p, title: newTitle } : p);

// ❌ WRONG: Array mutation
pages[index].title = newTitle;
```

## File Organization

MANY SMALL FILES > FEW LARGE FILES:

- High cohesion, low coupling
- 200-400 lines typical, 800 max
- Functions < 50 lines
- Extract utilities from large components
- Organize by feature/domain, not by type

## Module Design: Separation of Concerns

### Pure Function Extraction

When a framework-specific wrapper (React hook, Express middleware, CodeMirror extension handler, etc.) contains non-trivial logic, extract the core logic as a **pure function** and reduce the wrapper to a thin adapter. This enables direct reuse across different contexts and makes unit testing straightforward.

```typescript
// ❌ WRONG: Business logic locked inside a framework-specific wrapper
export const useToggleSymbol = (view?: EditorView) => {
  return useCallback((prefix, suffix) => {
    // 30 lines of symbol-toggling logic here...
  }, [view]);
};

// ✅ CORRECT: Pure function + thin wrappers for each context
// services-internal/markdown-utils/toggle-markdown-symbol.ts
export const toggleMarkdownSymbol = (view: EditorView, prefix: string, suffix: string): void => {
  // Pure logic — testable, reusable from hooks, keymaps, shortcuts, etc.
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
  return sharedKeyBindings; // exclude formatting
}
return [formattingBindings, ...sharedKeyBindings];

// ✅ CORRECT: Module declares its overrides, consumer filters generically
// Keymap module returns: { overrides: ['formatting', 'structural'] }
const activeBindings = allGroups
  .filter(group => group.category === null || !overrides?.includes(group.category))
  .flatMap(group => group.bindings);
```

### Factory Pattern with Encapsulated Metadata

When a module produces a value that requires configuration from the consumer (precedence, feature flags, etc.), **bundle the metadata alongside the value** in a structured return type. This keeps decision-making inside the module that has the knowledge.

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

When a single module grows beyond ~200 lines or accumulates multiple distinct responsibilities, split into submodules **by responsibility domain** (not by arbitrary size). Each submodule should be independently understandable.

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

## Naming Conventions

### Variables and Functions

- **camelCase** for variables and functions
- **PascalCase** for classes, interfaces, types, React components
- **UPPER_SNAKE_CASE** for constants

```typescript
const pageId = '123';
const MAX_PAGE_SIZE = 1000;

function getPageById(id: string) { }
class PageService { }
interface PageData { }
type PageStatus = 'draft' | 'published';
```

### Files and Directories

- **PascalCase** for React components: `Button.tsx`, `PageTree.tsx`
- **kebab-case** for utilities: `page-utils.ts`
- **lowercase** for directories: `features/page-tree/`, `utils/`

## Export Style

**Prefer named exports** over default exports:

```typescript
// ✅ Good: Named exports
export const MyComponent = () => { };
export function myFunction() { }
export class MyClass { }

// ❌ Avoid: Default exports
export default MyComponent;
```

**Why?**
- Better refactoring (IDEs can reliably rename across files)
- Better tree shaking
- Explicit imports improve readability
- No ambiguity (import name matches export name)

**Exception**: Next.js pages require default exports.

## Type Safety

**Always provide explicit types** for function parameters and return values:

```typescript
// ✅ Good: Explicit types
function createPage(path: string, body: string): Promise<Page> {
  // ...
}

// ❌ Avoid: Implicit any
function createPage(path, body) {
  // ...
}
```

Use `import type` for type-only imports:

```typescript
import type { PageData } from '~/interfaces/page';
```

## Error Handling

ALWAYS handle errors comprehensively:

```typescript
try {
  const result = await riskyOperation();
  return result;
} catch (error) {
  logger.error('Operation failed:', { error, context });
  throw new Error('Detailed user-friendly message');
}
```

## Async/Await

Prefer async/await over Promise chains:

```typescript
// ✅ Good: async/await
async function loadPages() {
  const pages = await fetchPages();
  const enriched = await enrichPageData(pages);
  return enriched;
}

// ❌ Avoid: Promise chains
function loadPages() {
  return fetchPages()
    .then(pages => enrichPageData(pages))
    .then(enriched => enriched);
}
```

## Comments

**Write comments in English** (even for Japanese developers):

```typescript
// ✅ Good: English comment
// Calculate the total number of pages in the workspace

// ❌ Avoid: Japanese comment
// ワークスペース内のページ総数を計算
```

**When to comment**:
- Complex algorithms or business logic
- Non-obvious workarounds
- Public APIs and interfaces

**When NOT to comment**:
- Self-explanatory code (good naming is better)
- Restating what the code does

## Test File Placement

**Co-locate tests with source files** in the same directory:

```
src/utils/
├── helper.ts
└── helper.spec.ts        # Test next to source

src/components/Button/
├── Button.tsx
└── Button.spec.tsx       # Test next to component
```

### Test File Naming

- Unit tests: `*.spec.{ts,js}`
- Integration tests: `*.integ.ts`
- Component tests: `*.spec.{tsx,jsx}`

## Git Commit Messages

Follow conventional commit format:

```
<type>(<scope>): <subject>

<body>
```

**Types**: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`

**Example**:
```
feat(page-tree): add virtualization for large trees

Implemented react-window for virtualizing page tree
to improve performance with 10k+ pages.
```

## Cross-Platform Compatibility

GROWI must work on Windows, macOS, and Linux. Never use platform-specific shell commands in npm scripts.

```json
// ❌ WRONG: Unix-only commands in npm scripts
"clean": "rm -rf dist",
"copy": "cp src/foo.ts dist/foo.ts",
"move": "mv src dist"

// ✅ CORRECT: Cross-platform tools
"clean": "rimraf dist",
"copy": "node -e \"require('fs').cpSync('src/foo.ts','dist/foo.ts')\"",
"move": "node -e \"require('fs').renameSync('src','dist')\""
```

**Rules**:
- Use `rimraf` instead of `rm -rf`
- Use Node.js one-liners or cross-platform tools (`cpy-cli`, `cpx2`) instead of `cp`, `mv`, `echo`, `ls`
- Never assume a POSIX shell in npm scripts

## Code Quality Checklist

Before marking work complete:

- [ ] Code is readable and well-named
- [ ] Functions are small (<50 lines)
- [ ] Files are focused (<800 lines)
- [ ] No deep nesting (>4 levels)
- [ ] Proper error handling
- [ ] No console.log statements (use logger)
- [ ] No mutation (immutable patterns used)
- [ ] Named exports (except Next.js pages)
- [ ] English comments
- [ ] Co-located tests
- [ ] Non-trivial logic extracted as pure functions from framework wrappers
- [ ] No hard-coded mode/variant checks in consumers (use declared metadata)
- [ ] Modules with multiple responsibilities split by domain
