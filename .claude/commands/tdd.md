---
name: tdd
description: Enforce test-driven development workflow. Scaffold interfaces, generate tests FIRST, then implement minimal code to pass. Ensure 80%+ coverage.
---

# TDD Command

This command enforces test-driven development methodology for GROWI.

## What This Command Does

1. **Scaffold Interfaces** - Define types/interfaces first
2. **Generate Tests First** - Write failing tests (RED)
3. **Implement Minimal Code** - Write just enough to pass (GREEN)
4. **Refactor** - Improve code while keeping tests green (REFACTOR)
5. **Verify Coverage** - Ensure 80%+ test coverage

## When to Use

Use `/tdd` when:
- Implementing new features
- Adding new functions/components
- Fixing bugs (write test that reproduces bug first)
- Refactoring existing code
- Building critical business logic

## TDD Cycle

```
RED → GREEN → REFACTOR → REPEAT

RED:      Write a failing test
GREEN:    Write minimal code to pass
REFACTOR: Improve code, keep tests passing
REPEAT:   Next feature/scenario
```

## Example Usage

```
User: /tdd I need a function to validate page paths

Agent:
```

# TDD Session: Page Path Validator

## Step 1: Define Interface (SCAFFOLD)

```typescript
// src/utils/page-path-validator.ts
export interface ValidationResult {
  isValid: boolean;
  errorMessage?: string;
}

export function validatePagePath(path: string): ValidationResult {
  throw new Error('Not implemented');
}
```

## Step 2: Write Failing Test (RED)

```typescript
// src/utils/page-path-validator.spec.ts
describe('validatePagePath', () => {
  it('should return valid for correct path', () => {
    const result = validatePagePath('/user/docs/page');
    expect(result.isValid).toBe(true);
  });

  it('should reject path without leading slash', () => {
    const result = validatePagePath('user/docs');
    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toBeDefined();
  });

  it('should reject empty path', () => {
    const result = validatePagePath('');
    expect(result.isValid).toBe(false);
  });
});
```

## Step 3: Run Tests - Verify FAIL

```bash
turbo run test --filter @growi/app -- src/utils/page-path-validator.spec.ts

FAIL src/utils/page-path-validator.spec.ts
  ✕ should return valid for correct path
    Error: Not implemented
```

✅ Tests fail as expected. Ready to implement.

## Step 4: Implement Minimal Code (GREEN)

```typescript
export function validatePagePath(path: string): ValidationResult {
  if (!path) {
    return { isValid: false, errorMessage: 'Path cannot be empty' };
  }
  if (!path.startsWith('/')) {
    return { isValid: false, errorMessage: 'Path must start with /' };
  }
  return { isValid: true };
}
```

## Step 5: Run Tests - Verify PASS

```bash
turbo run test --filter @growi/app -- src/utils/page-path-validator.spec.ts

PASS  ✓ All tests passing!
```

## Step 6: Check Coverage

```bash
pnpm --filter @growi/app vitest run --coverage src/utils/page-path-validator.spec.ts

Coverage: 100% ✅ (Target: 80%)
```

## TDD Best Practices

**DO:**
- ✅ Write the test FIRST, before any implementation
- ✅ Run tests and verify they FAIL before implementing
- ✅ Write minimal code to make tests pass
- ✅ Refactor only after tests are green
- ✅ Add edge cases and error scenarios
- ✅ Aim for 80%+ coverage (100% for critical code)
- ✅ Use `vitest-mock-extended` for type-safe mocks

**DON'T:**
- ❌ Write implementation before tests
- ❌ Skip running tests after each change
- ❌ Write too much code at once
- ❌ Ignore failing tests
- ❌ Test implementation details (test behavior)
- ❌ Mock everything (prefer integration tests)

## Test Types to Include

**Unit Tests** (`*.spec.ts`):
- Happy path scenarios
- Edge cases (empty, null, max values)
- Error conditions
- Boundary values

**Integration Tests** (`*.integ.ts`):
- API endpoints
- Database operations
- External service calls

**Component Tests** (`*.spec.tsx`):
- React components with hooks
- User interactions
- Jotai state integration

## Coverage Requirements

- **80% minimum** for all code
- **100% required** for:
  - Authentication/authorization logic
  - Security-critical code
  - Core business logic (page operations, permissions)
  - Data validation utilities

## Important Notes

**MANDATORY**: Tests must be written BEFORE implementation. The TDD cycle is:

1. **RED** - Write failing test
2. **GREEN** - Implement to pass
3. **REFACTOR** - Improve code

Never skip the RED phase. Never write code before tests.

## Related Skills

This command uses patterns from:
- **growi-testing-patterns** - Vitest, React Testing Library, vitest-mock-extended
