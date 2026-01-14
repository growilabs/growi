# GROWI Main Application Development Guide

## Overview

This guide provides comprehensive documentation for AI coding agents working on the GROWI main application (`/apps/app/`). GROWI is a team collaboration wiki platform built with Next.js, Express, and MongoDB.

## Project Structure

### Main Application (`/apps/app/src/`)

#### Directory Structure Philosophy

**Feature-based Structure (Recommended for new features)**
- `features/{feature-name}/` - Self-contained feature modules
  - `interfaces/` - Universal TypeScript type definitions
  - `server/` - Server-side logic (models, routes, services)
  - `client/` - Client-side logic (components, stores, services)
  - `utils/` - Shared utilities for this feature
  
**Important Directories Structure**
- `client/` - Client-side React components and utilities
- `server/` - Express.js backend
- `components/` - Universal React components
- `pages/` - Next.js Pages Router
- `states/` - Jotai state management
- `stores/` - SWR-based state stores
- `stores-universal/` - Universal SWR-based state stores
- `styles/` - SCSS stylesheets with modular architecture
- `migrations/` - MongoDB database migration scripts
- `interfaces/` - Universal TypeScript type definitions
- `models/` - Universal Data model definitions

### Key Technical Details

**Frontend Stack**
- **Framework**: Next.js (Pages Router) with React
- **Language**: TypeScript (strict mode enabled)
- **Styling**: SCSS with CSS Modules by Bootstrap 5
- **State Management**:
  - **Jotai** (Primary, Recommended): Atomic state management for UI and application state
  - **SWR**: Data fetching, caching, and revalidation
  - **Unstated**: Legacy (being phased out, replaced by Jotai)
- **Testing**: 
  - Vitest for unit tests (`*.spec.ts`, `*.spec.tsx`)
  - Jest for integration tests (`*.integ.ts`)
  - React Testing Library for component testing
  - Playwright for E2E testing
- **i18n**: next-i18next for internationalization

**Backend Stack**
- **Runtime**: Node.js
- **Framework**: Express.js with TypeScript
- **Database**: MongoDB with Mongoose ODM
- **Migration System**: migrate-mongo
- **Authentication**: Passport.js with multiple strategies (local, LDAP, OAuth, SAML)
- **Real-time**: Socket.io for collaborative editing and notifications
- **Search**: Elasticsearch integration (optional)
- **Observability**: OpenTelemetry integration

**Common Commands**
```bash
# Type checking only
cd apps/app && pnpm run lint:typecheck

# Run specific test file
turbo run test:vitest @apps/app -- src/path/to/test.spec.tsx

# Check migration status
cd apps/app && pnpm run dev:migrate:status

# Start REPL with app context
cd apps/app && pnpm run repl
```

### Important Technical Specifications

**Entry Points**
- **Server**: `server/app.ts` - Handles OpenTelemetry initialization and Crowi server startup
- **Client**: `pages/_app.page.tsx` - Root Next.js application component
  - `pages/[[...path]]/` - Dynamic catch-all page routes

---

*This guide was compiled from project memory files to assist AI coding agents in understanding the GROWI application architecture and development practices.*
