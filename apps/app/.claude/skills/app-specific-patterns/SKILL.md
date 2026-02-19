---
name: app-specific-patterns
description: GROWI main application (apps/app) specific patterns for Next.js, Jotai, SWR, and testing. Auto-invoked when working in apps/app.
user-invocable: false
---

# App Specific Patterns (apps/app)

For general testing patterns, see the global `.claude/skills/learned/essential-test-patterns` and `.claude/skills/learned/essential-test-design` skills.

## Next.js Pages Router

### File Naming

Pages must use `.page.tsx` suffix:

```
pages/
├── _app.page.tsx           # App wrapper
├── [[...path]]/index.page.tsx  # Catch-all wiki pages
└── admin/index.page.tsx    # Admin pages
```

### getLayout Pattern

```typescript
// pages/admin/index.page.tsx
import type { NextPageWithLayout } from '~/interfaces/next-page';

const AdminPage: NextPageWithLayout = () => <AdminDashboard />;

AdminPage.getLayout = (page) => <AdminLayout>{page}</AdminLayout>;

export default AdminPage;
```

## Jotai State Management

### Directory Structure

```
src/states/
├── ui/
│   ├── sidebar/              # Multi-file feature
│   ├── device.ts             # Single-file feature
│   └── modal/                # 1 modal = 1 file
│       ├── page-create.ts
│       └── page-delete.ts
├── page/                     # Page data state
├── server-configurations/
└── context.ts

features/{name}/client/states/  # Feature-scoped atoms
```

### Placement Rules

| Category | Location |
|----------|----------|
| UI state | `states/ui/` |
| Modal state | `states/ui/modal/` (1 file per modal) |
| Page data | `states/page/` |
| Feature-specific | `features/{name}/client/states/` |

### Derived Atoms

```typescript
import { atom } from 'jotai';

export const currentPageAtom = atom<Page | null>(null);

// Derived (read-only)
export const currentPagePathAtom = atom((get) => {
  return get(currentPageAtom)?.path ?? null;
});
```

## SWR Data Fetching

### Directory

```
src/stores-universal/
├── pages.ts       # Page hooks
├── users.ts       # User hooks
└── admin/settings.ts
```

### Patterns

```typescript
import useSWR from 'swr';
import useSWRImmutable from 'swr/immutable';

// Auto-revalidation
export const usePageList = () => useSWR<Page[]>('/api/v3/pages', fetcher);

// No auto-revalidation (static data)
export const usePageById = (id: string | null) =>
  useSWRImmutable<Page>(id ? `/api/v3/pages/${id}` : null, fetcher);
```

## Testing (apps/app Specific)

### Mocking Next.js Router

```typescript
import { mockDeep } from 'vitest-mock-extended';
import type { NextRouter } from 'next/router';

const createMockRouter = (overrides = {}) => {
  const mock = mockDeep<NextRouter>();
  mock.pathname = '/test';
  mock.push.mockResolvedValue(true);
  return Object.assign(mock, overrides);
};

vi.mock('next/router', () => ({
  useRouter: () => createMockRouter(),
}));
```

### Testing with Jotai

```typescript
import { Provider } from 'jotai';
import { useHydrateAtoms } from 'jotai/utils';

const HydrateAtoms = ({ initialValues, children }) => {
  useHydrateAtoms(initialValues);
  return children;
};

const renderWithJotai = (ui, initialValues = []) => render(
  <Provider>
    <HydrateAtoms initialValues={initialValues}>{ui}</HydrateAtoms>
  </Provider>
);

// Usage
renderWithJotai(<PageHeader />, [[currentPageAtom, mockPage]]);
```

### Testing SWR

```typescript
import { SWRConfig } from 'swr';

const wrapper = ({ children }) => (
  <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>
    {children}
  </SWRConfig>
);

const { result } = renderHook(() => usePageById('123'), { wrapper });
```

## Path Aliases

Always use `~/` for imports:

```typescript
import { PageService } from '~/server/services/PageService';
import { currentPageAtom } from '~/states/page/page-atoms';
```

## Summary

1. **Next.js**: `.page.tsx` suffix, `getLayout` for layouts
2. **Jotai**: `states/` global, `features/*/client/states/` feature-scoped
3. **SWR**: `stores-universal/`, null key for conditional fetch
4. **Testing**: Mock router, hydrate Jotai, wrap SWR config
5. **Imports**: Always `~/` path alias
