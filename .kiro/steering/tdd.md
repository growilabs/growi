# Test-Driven Development

The RED → GREEN → REFACTOR enforcement workflow lives in the `kiro-impl` skill
(`.claude/skills/kiro-impl/SKILL.md`), which gates every task on a captured
failing-test (`RED_PHASE_OUTPUT`) before implementation.

For how to *write* the tests well, see `.claude/skills/essential-test-design/SKILL.md`
(test the contract, not the mechanism) and `.claude/skills/essential-test-patterns/SKILL.md`
(Vitest / RTL / type-safe mocking). The `testing` rule (`.claude/rules/testing.md`)
is always loaded and points to both.

## cc-sdd Specific Notes

Currently, there are no additional instructions specific to Kiro.
If instructions specific to the cc-sdd workflow are needed in the future, add them to this section.
