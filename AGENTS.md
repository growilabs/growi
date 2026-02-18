# AGENTS.md

GROWI is a team collaboration wiki platform built with Next.js, Express, and MongoDB. This guide provides essential instructions for AI coding agents working with the GROWI codebase.

## Language Policy

**Response Language**: If the user writes in a non-English language at any point in the conversation, always respond in that language from that point onward. This rule takes **absolute priority** over any other language instructions, including skill/command prompts or context documents written in English.

**Code Comments**: When generating source code, all comments and explanations within the code must be written in English, regardless of the conversation language.

## Project Overview

GROWI is a team collaboration wiki platform using Markdown, featuring hierarchical page organization, real-time collaborative editing, authentication integrations, and plugin support. Built as a monorepo with Next.js, Express, and MongoDB.

## Knowledge Base

### Claude Code Skills (Auto-Invoked)

Technical information is available in **Claude Code Skills** (`.claude/skills/`), which are automatically invoked during development.

**Global Skills** (always loaded):

| Skill | Description |
|-------|-------------|
| **monorepo-overview** | Monorepo structure, workspace organization, Changeset versioning |
| **tech-stack** | Technology stack, pnpm/Turborepo, TypeScript, Biome |

**Rules** (always applied):

| Rule | Description |
|------|-------------|
| **coding-style** | Coding conventions, naming, exports, immutability, comments |
| **security** | Security checklist, secret management, OWASP vulnerability prevention |
| **performance** | Model selection, context management, build troubleshooting |

**Agents** (specialized):

| Agent | Description |
|-------|-------------|
| **build-error-resolver** | TypeScript/build error resolution with minimal diffs |
| **security-reviewer** | Security vulnerability detection, OWASP Top 10 |

**Commands** (user-invocable):

| Command | Description |
|---------|-------------|
| **/tdd** | Test-driven development workflow |
| **/learn** | Extract reusable patterns from sessions |

**apps/app Skills** (loaded when working in apps/app):

| Skill | Description |
|-------|-------------|
| **app-architecture** | Next.js Pages Router, Express, feature-based structure |
| **app-commands** | apps/app specific commands (migrations, OpenAPI, etc.) |
| **app-specific-patterns** | Jotai/SWR patterns, router mocking, API routes |

### Package-Specific CLAUDE.md

Each application has its own CLAUDE.md with detailed instructions:

- `apps/app/CLAUDE.md` - Main GROWI application
- `apps/pdf-converter/CLAUDE.md` - PDF conversion microservice
- `apps/slackbot-proxy/CLAUDE.md` - Slack integration proxy

### Serena Memories

Additional detailed specifications are stored in **Serena memories** and can be referenced when needed for specific features or subsystems.

## Quick Reference

### Essential Commands (Global)

```bash
# Development
turbo run dev                    # Start all dev servers

# Quality Checks (use Turborepo for caching)
turbo run lint --filter @growi/app
turbo run test --filter @growi/app

# Production
pnpm run app:build              # Build main app
pnpm start                      # Build and start
```

### Key Directories

```
growi/
├── apps/
│   ├── app/                # Main GROWI application (Next.js + Express)
│   ├── pdf-converter/      # PDF conversion microservice
│   └── slackbot-proxy/     # Slack integration proxy
├── packages/               # Shared libraries (@growi/core, @growi/ui, etc.)
└── .claude/
    ├── skills/             # Claude Code skills (auto-loaded)
    ├── rules/              # Coding standards (always applied)
    ├── agents/             # Specialized agents
    └── commands/           # User-invocable commands (/tdd, /learn)
```

## Development Guidelines

1. **Feature-Based Architecture**: Create new features in `features/{feature-name}/`
2. **Server-Client Separation**: Keep server and client code separate
3. **State Management**: Jotai for UI state, SWR for data fetching
4. **Named Exports**: Prefer named exports (except Next.js pages)
5. **Test Co-location**: Place test files next to source files
6. **Type Safety**: Use strict TypeScript throughout
7. **Changeset**: Use `npx changeset` for version management

## Before Committing

Always execute these checks:

```bash
# From workspace root (recommended)
turbo run lint:typecheck --filter @growi/app
turbo run lint:biome --filter @growi/app
turbo run test --filter @growi/app
turbo run build --filter @growi/app
```

Or from apps/app directory:

```bash
pnpm run lint:typecheck
pnpm run lint:biome
pnpm run test
pnpm run build
```

---

For detailed information, refer to:
- **Rules**: `.claude/rules/` (coding standards)
- **Skills**: `.claude/skills/` (technical knowledge)
- **Package docs**: `apps/*/CLAUDE.md` (package-specific)
