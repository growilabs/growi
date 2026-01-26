# Project Structure

@.claude/skills/monorepo-overview/SKILL.md

## cc-sdd Specific Notes

### Specification Storage
- All specifications are stored in `.kiro/specs/{feature-name}/`
- Each spec contains: `spec.json`, `requirements.md`, `design.md`, `tasks.md`

### Feature Placement
When implementing new features via `/kiro:spec-impl`:
- Create feature modules in `src/features/{feature-name}/`
- Follow the server-client separation pattern documented in the skill above
