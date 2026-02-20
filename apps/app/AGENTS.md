# GROWI Main Application (apps/app)

The main GROWI wiki application - a full-stack Next.js application with Express.js backend and MongoDB database.

## Technology Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 14 (Pages Router), React 18 |
| **Backend** | Express.js with custom server |
| **Database** | MongoDB with Mongoose ^6.13.6 |
| **State** | Jotai (UI state) + SWR (server state) |
| **API** | RESTful API v3 with OpenAPI specs |
| **Testing** | Vitest, React Testing Library |

## Quick Reference

### Essential Commands

```bash
# Development
pnpm run dev                    # Start dev server (or turbo run dev from root)
pnpm run dev:migrate            # Run database migrations

# Quality Checks
pnpm run lint:typecheck         # TypeScript type check
pnpm run lint:biome             # Biome linter
pnpm run test                   # Run tests

# Build
pnpm run build                  # Build for production

# Run Specific Tests
pnpm vitest run yjs.integ       # Use partial file name
pnpm vitest run helper.spec     # Vitest auto-finds matching files
```

### Key Directories

```
src/
├── pages/                 # Next.js Pages Router (*.page.tsx)
├── features/             # Feature modules (recommended for new code)
│   └── {feature-name}/
│       ├── server/       # Server-side (models, routes, services)
│       └── client/       # Client-side (components, hooks, states)
├── server/               # Express server (legacy structure)
│   ├── models/           # Mongoose models
│   ├── routes/apiv3/     # API v3 routes
│   └── services/         # Business logic
├── components/           # React components (legacy)
├── states/               # Jotai atoms
└── stores-universal/     # SWR hooks
```

## Development Guidelines

### 1. Feature-Based Architecture (New Code)

Create new features in `features/{feature-name}/`:

```
features/my-feature/
├── index.ts              # Public exports
├── interfaces/           # TypeScript types
├── server/
│   ├── models/           # Mongoose models
│   ├── routes/           # Express routes
│   └── services/         # Business logic
└── client/
    ├── components/       # React components
    ├── hooks/            # Custom hooks
    └── states/           # Jotai atoms
```

### 2. State Management

- **Jotai**: UI state (modals, forms, selections)
- **SWR**: Server data (pages, users, API responses)

```typescript
// Jotai for UI state
import { atom } from 'jotai';
export const isModalOpenAtom = atom(false);

// SWR for server data
import useSWR from 'swr';
export const usePageById = (id: string) => useSWR(`/api/v3/pages/${id}`);
```

### 3. Next.js Pages

Use `.page.tsx` suffix and `getLayout` pattern:

```typescript
// pages/admin/index.page.tsx
import type { NextPageWithLayout } from '~/interfaces/next-page';

const AdminPage: NextPageWithLayout = () => <AdminDashboard />;
AdminPage.getLayout = (page) => <AdminLayout>{page}</AdminLayout>;
export default AdminPage;
```

### 4. API Routes (Express)

Add routes to `server/routes/apiv3/` with OpenAPI docs:

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

### 5. Path Aliases

Use `~/` for absolute imports:

```typescript
import { PageService } from '~/server/services/PageService';
import { Button } from '~/components/Button';
```

## Before Committing

```bash
pnpm run lint:typecheck   # 1. Type check
pnpm run lint:biome       # 2. Lint
pnpm run test             # 3. Run tests
pnpm run build            # 4. Verify build (optional)
```

## Key Features

| Feature | Directory | Description |
|---------|-----------|-------------|
| Page Tree | `features/page-tree/` | Hierarchical page navigation |
| OpenAI | `features/openai/` | AI assistant integration |
| Search | `features/search/` | Elasticsearch full-text search |
| Plugins | `features/growi-plugin/` | Plugin system |
| OpenTelemetry | `features/opentelemetry/` | Monitoring/telemetry |

## Skills (Auto-Loaded)

When working in this directory, these skills are automatically loaded:

- **app-architecture** - Directory structure, feature-based patterns
- **app-commands** - apps/app specific commands (migrations, OpenAPI, etc.)
- **app-specific-patterns** - Jotai/SWR/Next.js patterns, testing

Plus all global skills (monorepo-overview, tech-stack).

---

For detailed patterns and examples, refer to the Skills in `.claude/skills/`.
