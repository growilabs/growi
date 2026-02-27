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
