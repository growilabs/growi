# Technology Stack

@.claude/skills/tech-stack/SKILL.md

## cc-sdd Specific Notes

### Specification Language
All spec files (requirements.md, design.md, tasks.md) should be written in English unless explicitly configured otherwise in spec.json.

### Build Verification
Before marking tasks complete in `/kiro:spec-impl`, ensure:
```bash
turbo run lint --filter @growi/app
turbo run test --filter @growi/app
```