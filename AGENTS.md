# AGENTS.md

GROWI is a team collaboration wiki platform built with Next.js, Express, and MongoDB. This guide helps AI coding agents navigate the monorepo and work effectively with GROWI's architecture.

## Language

If we detect at the beginning of a conversation that the user's primary language is not English, we will always respond in that language. However, we may retain technical terms in English if necessary.

When generating source code, all comments and explanations within the code will be written in English.

## Project Overview

GROWI is a team collaboration software using markdown - a wiki platform with hierarchical page organization. It's built with Next.js, Express, MongoDB, and includes features like real-time collaborative editing, authentication integrations, and plugin support.

## Development Tools
- **Package Manager**: pnpm with workspace support
- **Build System**: Turborepo for monorepo orchestration
- **Code Quality**: 
  - Biome for linting and formatting
  - Stylelint for SCSS/CSS

## Development Commands

### Core Development
- `turbo run bootstrap` - Install dependencies for all workspace packages
- `turbo run dev` - Start development server (automatically runs migrations and pre-builds styles)

### Production Commands
- `pnpm run app:build` - Build GROWI app client and server for production
- `pnpm run app:server` - Launch GROWI app server in production mode
- `pnpm start` - Build and start the application (runs both build and server commands)

### Database Migrations
- `pnpm run migrate` - Run MongoDB migrations (production)
- `turbo run dev:migrate @apps/app` - Run migrations in development (or wait for automatic execution with dev)
- `cd apps/app && pnpm run dev:migrate:status` - Check migration status
- `cd apps/app && pnpm run dev:migrate:down` - Rollback last migration

### Testing and Quality
- `turbo run test @apps/app` - Run Jest and Vitest test suites with coverage
- `turbo run lint @apps/app` - Run all linters (TypeScript, Biome, Stylelint, OpenAPI)
- `cd apps/app && pnpm run lint:typecheck` - TypeScript type checking only
- `cd apps/app && pnpm run test:vitest` - Run Vitest unit tests
- `cd apps/app && pnpm run test:jest` - Run Jest integration tests

### Development Utilities  
- `cd apps/app && pnpm run repl` - Start Node.js REPL with application context loaded
- `turbo run pre:styles @apps/app` - Pre-build styles with Vite

## Architecture Overview

### Monorepo Structure
- `/apps/app/` - Main GROWI application (Next.js frontend + Express backend)
- `/apps/pdf-converter/` - PDF conversion microservice
- `/apps/slackbot-proxy/` - Slack integration proxy service
- `/packages/` - Shared libraries and components

## File Organization Patterns

### Components
- Use TypeScript (.tsx) for React components
- Co-locate styles as `.module.scss` files
- Export components through `index.ts` files where appropriate
- Group related components in feature-based directories

### Tests
- Unit Test: `*.spec.ts`
- Integration Test: `*.integ.ts`
- Component Test: `*.spec.tsx`


---

When working with this codebase, always run the appropriate linting and testing commands before committing changes. The application uses strict TypeScript checking and comprehensive test coverage requirements.