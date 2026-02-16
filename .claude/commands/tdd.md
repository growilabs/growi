---
name: tdd
description: Enforce test-driven development workflow. Scaffold interfaces, generate tests FIRST, then implement minimal code to pass. Ensure 80%+ coverage.
---

# TDD Command

This command enforces test-driven development methodology for GROWI.

---

## ⚠️ CRITICAL: MANDATORY TDD PROTOCOL

**THIS IS NOT OPTIONAL. THIS IS A TEAM REQUIREMENT.**

### Non-Negotiable Rules

1. **ALL phases of TDD MUST be followed: RED → GREEN → REFACTOR**
2. **Tests MUST be written BEFORE any implementation code (RED phase)**
3. **Implementation MUST be minimal and only to pass tests (GREEN phase)**
4. **Tests MUST remain passing during refactoring (REFACTOR phase)**
5. **NEVER skip any phase of the TDD cycle**
6. **If you believe you cannot follow TDD, STOP and ask the user IMMEDIATELY**

### Violation Protocol

If you find yourself about to deviate from the TDD cycle:

1. **STOP IMMEDIATELY** - Do not proceed with any phase out of order
2. **ASK THE USER** - Explain why you think following TDD is difficult
3. **WAIT FOR APPROVAL** - Do not proceed without explicit user consent
4. **DOCUMENT THE EXCEPTION** - If approved, document why TDD was skipped

**Example of required user confirmation:**

```
"This task requires writing integration tests with complex setup
(database mocks, authentication, etc.).

I have two options:

Option A: Follow strict TDD (recommended)
- RED: Write failing integration test first
- GREEN: Implement minimal code to pass
- REFACTOR: Improve code while keeping tests green
- May take 15-30 minutes for test setup
- Ensures proper test coverage

Option B: Skip TDD for this specific change
- Implement directly
- Verify with existing test suite only
- Risk: No specific test for this change

Which approach would you prefer?"
```

**Never assume. Always ask.**

---

## Pre-Implementation Checklist

Before writing ANY code, confirm:

- [ ] I have read and understood the task requirements
- [ ] I am starting with Step 1: Write a FAILING test (RED phase)
- [ ] I have NOT written any implementation code yet
- [ ] I will follow all phases: RED → GREEN → REFACTOR
- [ ] If I cannot follow the complete TDD cycle, I have ASKED THE USER for guidance

**If any checkbox is unchecked, STOP and ask the user.**

---

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

**⚠️ CHECKPOINT: Confirm you have NOT written any implementation code yet.**

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

**⚠️ MANDATORY: Tests MUST fail before proceeding to implementation.**

```bash
turbo run test --filter @growi/app -- src/utils/page-path-validator.spec.ts

FAIL src/utils/page-path-validator.spec.ts
  ✕ should return valid for correct path
    Error: Not implemented
```

**✅ CHECKPOINT PASSED: Tests fail as expected. Ready to implement.**

**❌ If tests pass or don't run: STOP. Fix the test first.**

## Step 4: Implement Minimal Code (GREEN)

**⚠️ CHECKPOINT: Only write the MINIMUM code needed to pass the tests.**

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

**⚠️ MANDATORY: ALL tests MUST pass before proceeding to refactoring.**

```bash
turbo run test --filter @growi/app -- src/utils/page-path-validator.spec.ts

PASS  ✓ All tests passing!
```

**✅ CHECKPOINT PASSED: Ready to refactor if needed.**

**❌ If tests fail: Fix implementation, do NOT move to refactoring.**

## Step 6: Check Coverage

**⚠️ MANDATORY: Verify test coverage meets requirements (80% minimum).**

```bash
cd {package_dir} && pnpm vitest run --coverage src/utils/page-path-validator.spec.ts

Coverage: 100% ✅ (Target: 80%)
```

**✅ TDD CYCLE COMPLETE: All phases completed successfully.**

- ✅ RED: Failing tests written
- ✅ GREEN: Implementation passes tests
- ✅ REFACTOR: Code improved (if needed)
- ✅ COVERAGE: 80%+ achieved

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

**MANDATORY - NO EXCEPTIONS**: The complete TDD cycle MUST be followed:

1. **RED** - Write failing test FIRST
2. **GREEN** - Implement minimal code to pass the test
3. **REFACTOR** - Improve code while keeping tests green

**Absolute Requirements:**
- ❌ NEVER skip the RED phase
- ❌ NEVER skip the GREEN phase
- ❌ NEVER skip the REFACTOR phase
- ❌ NEVER write implementation code before tests
- ❌ NEVER proceed without explicit user approval if you cannot follow TDD

**If you violate these rules:**
1. STOP immediately
2. Discard any implementation code written before tests
3. Inform the user of the violation
4. Start over with RED phase

**This is a team development standard. Violations are not acceptable.**

## Related Skills

This command uses patterns from:
- **growi-testing-patterns** - Vitest, React Testing Library, vitest-mock-extended
