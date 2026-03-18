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

For testing patterns (mocking, assertions, structure), see the `.claude/skills/learned/essential-test-patterns` skill.
