---
name: essential-test-design
description: Write tests that verify observable behavior (contract), not implementation details. Auto-invoked when writing or reviewing tests.
---

## Problem

Tests that are tightly coupled to implementation details cause two failures:

1. **False positives** — Tests pass even when behavior is broken (e.g., delay shortened but test still passes because it only checks `setTimeout` was called)
2. **False negatives** — Tests fail even when behavior is correct (e.g., implementation switches from `setTimeout` to a `delay()` utility, spy breaks)

Both undermine the purpose of testing: detecting regressions in behavior.

## Principle: Test the Contract, Not the Mechanism

A test is "essential" when it:
- **Fails if the behavior degrades** (catches real bugs)
- **Passes if the behavior is preserved** (survives refactoring)
- **Does not depend on how the behavior is implemented** (implementation-agnostic)

Ask: "What does the caller of this function experience?" — test that.

## Anti-Patterns and Corrections

### Anti-Pattern 1: Implementation Spy

```typescript
// BAD: Tests implementation, not behavior
// Breaks if implementation changes from setTimeout to any other delay mechanism
const spy = vi.spyOn(global, 'setTimeout');
await exponentialBackoff(1);
expect(spy).toHaveBeenCalledWith(expect.any(Function), 1000);
```

### Anti-Pattern 2: Arrange That Serves the Assert

```typescript
// BAD: The "arrange" is set up only to make the "assert" trivially pass
// This is a self-fulfilling prophecy, not a meaningful test
vi.advanceTimersByTime(1000);
await promise;
// No assertion — "it didn't throw" is not a valuable test
```

### Correct: Behavior Boundary Test

```typescript
// GOOD: Tests the observable contract
// "Does not resolve before the expected delay, resolves at the expected delay"
let resolved = false;
mailService.exponentialBackoff(1).then(() => { resolved = true });

await vi.advanceTimersByTimeAsync(999);
expect(resolved).toBe(false);  // Catches: delay too short

await vi.advanceTimersByTimeAsync(1);
expect(resolved).toBe(true);   // Catches: delay too long or hangs
```

## Decision Framework

When writing a test, ask these questions in order:

1. **What is the contract?** — What does the caller expect to experience?
   - e.g., "Wait for N ms before resolving"
2. **What breakage should this test catch?** — Define the regression scenario
   - e.g., "Someone changes the delay from 1000ms to 500ms"
3. **Would this test still pass if I refactored the internals?** — If no, you're testing implementation
   - e.g., Switching from `setTimeout` to `Bun.sleep()` shouldn't break the test
4. **Would this test fail if the behavior degraded?** — If no, the test has no value
   - e.g., If delay is halved, `expect(resolved).toBe(false)` at 999ms would catch it

## Common Scenarios

### Async Delay / Throttle / Debounce

Use fake timers + boundary assertions (as shown above).

### Data Transformation

Assert on output shape/values, not on which internal helper was called.

```typescript
// BAD
const spy = vi.spyOn(utils, 'formatDate');
transform(input);
expect(spy).toHaveBeenCalled();

// GOOD
const result = transform(input);
expect(result.date).toBe('2026-01-01');
```

### Side Effects (API calls, DB writes)

Mocking the boundary (API/DB) is acceptable — that IS the observable behavior.

```typescript
// OK: The contract IS "sends an email via mailer"
expect(mockMailer.sendMail).toHaveBeenCalledWith(
  expect.objectContaining({ to: 'user@example.com' })
);
```

### Retry Logic

Test the number of attempts and the final outcome, not the internal flow.

```typescript
// GOOD: Contract = "retries N times, then fails with specific error"
mockMailer.sendMail.mockRejectedValue(new Error('fail'));
await expect(sendWithRetry(config, 3)).rejects.toThrow('failed after 3 attempts');
expect(mockMailer.sendMail).toHaveBeenCalledTimes(3);
```

## When to Apply

- Writing new test cases for any function or method
- Reviewing existing tests for flakiness or brittleness
- Refactoring tests after fixing flaky CI failures
- Code review of test pull requests
