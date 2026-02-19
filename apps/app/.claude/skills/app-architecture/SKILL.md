---
name: app-architecture
description: GROWI main application (apps/app) architecture, directory structure, and design patterns. Auto-invoked when working in apps/app.
user-invocable: false
---

# App Architecture (apps/app)

The main GROWI application is a **full-stack Next.js application** with Express.js backend and MongoDB database.

For technology stack details, see the global `tech-stack` skill.

## Directory Structure

```
apps/app/src/
├── pages/                 # Next.js Pages Router (*.page.tsx)
├── features/             # Feature modules (recommended for new code)
│   └── {feature-name}/
│       ├── index.ts      # Public exports
│       ├── interfaces/   # TypeScript types
│       ├── server/       # models/, routes/, services/
│       └── client/       # components/, states/, hooks/
├── server/               # Express server (legacy)
│   ├── models/           # Mongoose models
│   ├── routes/apiv3/     # RESTful API v3
│   └── services/         # Business logic
├── components/           # React components (legacy)
├── states/               # Jotai atoms
└── stores-universal/     # SWR hooks
```

## Feature-Based Architecture

Organize code by **business feature** rather than by technical layer:

```
❌ Layer-based (old):          ✅ Feature-based (new):
├── models/User.ts             ├── features/user/
├── routes/user.ts             │   ├── server/models/User.ts
├── components/UserList.tsx    │   ├── server/routes/user.ts
                               │   └── client/components/UserList.tsx
```

### Creating a New Feature

1. Create `features/{feature-name}/`
2. Define interfaces in `interfaces/`
3. Implement server logic in `server/` (models, routes, services)
4. Implement client logic in `client/` (components, hooks, states)
5. Export public API through `index.ts`

## Entry Points

- **Server**: `server/app.ts` - Express + Next.js initialization
- **Client**: `pages/_app.page.tsx` - Jotai + SWR providers
- **Wiki Pages**: `pages/[[...path]]/index.page.tsx` - Catch-all route (SSR)

## API Design (RESTful API v3)

Routes in `server/routes/apiv3/` with OpenAPI specs:

```typescript
/**
 * @openapi
 * /api/v3/pages/{id}:
 *   get:
 *     summary: Get page by ID
 */
router.get('/pages/:id', async (req, res) => {
  const page = await PageService.findById(req.params.id);
  res.json(page);
});
```

## State Management

- **Jotai**: UI state (modals, forms) in `states/`
- **SWR**: Server data (pages, users) in `stores-universal/`

For detailed patterns, see `app-specific-patterns` skill.

## Design Principles

1. **Feature Isolation**: New features self-contained in `features/`
2. **Server-Client Separation**: Prevent server code bundled into client
3. **API-First**: Define OpenAPI specs before implementation
4. **Type-Driven**: Define interfaces before implementation
5. **Progressive Migration**: Gradually move legacy code to `features/`

## Legacy Migration

Legacy directories (`components/`, `server/models/`, `client/`) should be gradually migrated to `features/`:

- New features → `features/`
- Bug fixes → Can stay in legacy
- Refactoring → Move to `features/`

## Summary

1. **New features**: `features/{feature-name}/` structure
2. **Server-client separation**: Keep separate
3. **API-first**: OpenAPI specs for API v3
4. **State**: Jotai (UI) + SWR (server data)
5. **Progressive migration**: No rush for stable legacy code
