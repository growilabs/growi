# Test-Driven Development

The RED → GREEN → REFACTOR enforcement workflow lives in the `kiro-impl` skill
(`.claude/skills/kiro-impl/SKILL.md`), which gates every task on a captured
failing-test (`RED_PHASE_OUTPUT`) before implementation.

For how to *write* the tests well, see `.claude/skills/essential-test-design/SKILL.md`
(test the contract, not the mechanism) and `.claude/skills/essential-test-patterns/SKILL.md`
(Vitest / RTL / type-safe mocking). The `testing` rule (`.claude/rules/testing.md`)
is always loaded and points to both.

## cc-sdd Specific Notes

How the cc-sdd workflow is orchestrated across models when `/kiro-impl` runs
(orchestrate-first on a strong main-loop model, implementer model by task
difficulty, final adversarial review on Opus) lives in its own steering file:
`.kiro/steering/kiro-impl-orchestration.md`.

Other instructions specific to the cc-sdd workflow, if narrowly about TDD, can be
added to this section.
