# Test-Driven Development

@.claude/commands/tdd.md
@.claude/skills/testing-patterns-with-vitest/SKILL.md

## cc-sdd Integration

### TDD in spec-impl Workflow
When executing `/kiro:spec-impl`, the TDD cycle is mandatory:

1. **Each task → TDD cycle**: RED → GREEN → REFACTOR
2. **Tests trace to requirements**: Test names should reference EARS requirement IDs
3. **Coverage gates completion**: Task is not complete until coverage targets met

### Validation Before Task Completion
```bash
# Verify tests pass
turbo run test --filter {package}

# Check coverage (80% minimum)
cd {package_dir} && pnpm vitest run --coverage src/utils/page-path-validator.spec.ts
```
