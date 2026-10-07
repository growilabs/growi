# Testing Rules

## Package Manager (CRITICAL)

**NEVER use `npx` to run tests. ALWAYS use `pnpm`.**

```bash
# ❌ WRONG
npx vitest run yjs.integ

# ✅ CORRECT
pnpm vitest run yjs.integ
```

## Test Execution Commands

### Individual Test File (from package directory)

```bash
# Use partial file name - Vitest auto-matches
pnpm vitest run yjs.integ
pnpm vitest run helper.spec
pnpm vitest run Button.spec

# Flaky test detection
pnpm vitest run yjs.integ --repeat=10
```

- Use **partial file name** (no `src/` prefix or full path needed)
- No `--project` flag needed (Vitest auto-detects from file extension)

### All Tests for a Package (from monorepo root)

```bash
turbo run test --filter @growi/app
```

## Essential Test Skills (MANDATORY)

Whenever you **write** a test OR **review** a change that adds/modifies tests, you
MUST consult both skills first — they are not optional background reading:

| Skill | Apply it to |
|-------|-------------|
| **essential-test-design** (`.claude/skills/essential-test-design/SKILL.md`) | *What* to assert — test the observable contract, not the mechanism. Catches brittle implementation-spies and assertion-free "it didn't throw" tests. |
| **essential-test-patterns** (`.claude/skills/essential-test-patterns/SKILL.md`) | *How* to build the test — Vitest globals, RTL, Jotai scopes, type-safe mocking, module mocking strategy. |

This applies in every context, including review-time skills (`kiro-review`,
`kiro-validate-impl`, `kiro-verify-completion`): a test diff is not "good" until it
has been checked against essential-test-design (contract) and essential-test-patterns
(mechanics).

## Type-Safe Mocks — avoid type assertions (`as any`, `as unknown as T`, `as T`)

Mocking an interface/class? Use `mock<T>()` / `mock<T>({ ...overrides })` from
`vitest-mock-extended` (already a dependency). It returns a real `T` (no cast),
type-checks the overrides against the type, and auto-stubs everything you don't
specify — so it is both **type-safe** and **shorter** than a hand-built object.

Every assertion form defeats the type checker in some way and lets the mock drift
out of sync with the real type silently — prefer `mock<T>()` over all of them:

```typescript
// ❌ all of these escape type checking — the mock can rot as Crowi changes
const crowi = { searchService: { searchKeyword: vi.fn() } } as unknown as Crowi;
const crowi = { searchService: { searchKeyword: vi.fn() } } as Crowi;
const crowi = { searchService: { searchKeyword: vi.fn() } } as any;

// ✅ type-checked against Crowi, auto-stubs the rest
const crowi = mock<Crowi>({ searchService: { searchKeyword: vi.fn() } });
```

A type assertion in a test is only acceptable when removing it would cost more than
it saves (no type exists for the target, or one field needs real behavior). For the
full tolerance framework (4 tiers) and the `mock<T>` patterns, see the **Type-Safe
Mocking** section of the `essential-test-patterns` skill.
