---
name: essential-test-patterns
description: GROWI testing patterns with Vitest, React Testing Library, and vitest-mock-extended.
---

# GROWI Testing Patterns

GROWI uses **Vitest** for all testing (unit, integration, component). This skill covers universal testing patterns applicable across the monorepo.

## Test File Placement (Global Standard)

Place test files **in the same directory** as the source file:

```
src/components/Button/
├── Button.tsx
└── Button.spec.tsx       # Component test

src/utils/
├── helper.ts
└── helper.spec.ts        # Unit test

src/services/api/
├── pageService.ts
└── pageService.integ.ts  # Integration test
```

## Test Types & Environments

| File Pattern | Type | Environment | Use Case |
|--------------|------|-------------|----------|
| `*.spec.{ts,js}` | Unit Test | Node.js | Pure functions, utilities, services |
| `*.integ.ts` | Integration Test | Node.js + DB | API routes, database operations |
| `*.spec.{tsx,jsx}` | Component Test | happy-dom | React components |

Vitest automatically selects the environment based on file extension and configuration.

## Vitest Configuration

### Global APIs (No Imports Needed)

All GROWI packages configure Vitest globals in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "types": ["vitest/globals"]
  }
}
```

This enables auto-import of testing APIs:

```typescript
// No imports needed!
describe('MyComponent', () => {
  it('should render', () => {
    expect(true).toBe(true);
  });

  beforeEach(() => {
    // Setup
  });

  afterEach(() => {
    // Cleanup
  });
});
```

**Available globals**: `describe`, `it`, `test`, `expect`, `beforeEach`, `afterEach`, `beforeAll`, `afterAll`, `vi`

## Type-Safe Mocking with vitest-mock-extended

### Basic Usage

`vitest-mock-extended` provides **fully type-safe mocks** with TypeScript autocomplete:

```typescript
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';

// Create type-safe mock
const mockRouter: DeepMockProxy<NextRouter> = mockDeep<NextRouter>();

// TypeScript autocomplete works!
mockRouter.asPath = '/test-path';
mockRouter.query = { id: '123' };
mockRouter.push.mockResolvedValue(true);

// Use in tests
expect(mockRouter.push).toHaveBeenCalledWith('/new-path');
```

### Complex Types with Optional Properties

```typescript
interface ComplexProps {
  currentPageId?: string | null;
  currentPathname?: string | null;
  data?: Record<string, unknown>;
  onSubmit?: (value: string) => void;
}

const mockProps: DeepMockProxy<ComplexProps> = mockDeep<ComplexProps>();
mockProps.currentPageId = 'page-123';
mockProps.data = { key: 'value' };
mockProps.onSubmit?.mockImplementation((value) => {
  console.log(value);
});
```

### Why vitest-mock-extended?

- ✅ **Type safety**: Catches typos at compile time
- ✅ **Autocomplete**: IDE suggestions for all properties/methods
- ✅ **Deep mocking**: Automatically mocks nested objects
- ✅ **Vitest integration**: Works seamlessly with `vi.fn()`

## React Testing Library Patterns

### Basic Component Test

```typescript
import { render } from '@testing-library/react';
import { Button } from './Button';

describe('Button', () => {
  it('should render with text', () => {
    const { getByText } = render(<Button>Click me</Button>);
    expect(getByText('Click me')).toBeInTheDocument();
  });

  it('should call onClick when clicked', async () => {
    const onClick = vi.fn();
    const { getByRole } = render(<Button onClick={onClick}>Click</Button>);

    const button = getByRole('button');
    await userEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
```

### Testing with Jotai (Global Pattern)

When testing components that use Jotai atoms, wrap with `<Provider>`:

```typescript
import { render } from '@testing-library/react';
import { Provider } from 'jotai';

const renderWithJotai = (ui: React.ReactElement) => {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider>{children}</Provider>
  );
  return render(ui, { wrapper: Wrapper });
};

describe('ComponentWithJotai', () => {
  it('should render with atom state', () => {
    const { getByText } = renderWithJotai(<MyComponent />);
    expect(getByText('Hello')).toBeInTheDocument();
  });
});
```

### Isolated Jotai Scope (For Testing)

To isolate atom state between tests:

```typescript
import { createScope } from 'jotai-scope';

describe('ComponentWithIsolatedState', () => {
  it('test 1', () => {
    const scope = createScope();
    const { getByText } = renderWithJotai(<MyComponent />, scope);
    // ...
  });

  it('test 2', () => {
    const scope = createScope(); // Fresh scope
    const { getByText } = renderWithJotai(<MyComponent />, scope);
    // ...
  });
});
```

## Async Testing Patterns (Global Standard)

### Using `act()` and `waitFor()`

When testing async state updates:

```typescript
import { waitFor, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';

test('async hook', async () => {
  const { result } = renderHook(() => useMyAsyncHook());

  // Trigger async action
  await act(async () => {
    result.current.triggerAsyncAction();
  });

  // Wait for state update
  await waitFor(() => {
    expect(result.current.isLoading).toBe(false);
  });

  expect(result.current.data).toBeDefined();
});
```

### Testing Async Functions

```typescript
it('should fetch data successfully', async () => {
  const data = await fetchData();
  expect(data).toEqual({ id: '123', name: 'Test' });
});

it('should handle errors', async () => {
  await expect(fetchDataWithError()).rejects.toThrow('Error');
});
```

## Advanced Assertions

### Object Matching

```typescript
expect(mockFunction).toHaveBeenCalledWith(
  expect.objectContaining({
    pathname: '/expected-path',
    data: expect.any(Object),
    timestamp: expect.any(Number),
  })
);
```

### Array Matching

```typescript
expect(result).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ id: '123' }),
    expect.objectContaining({ id: '456' }),
  ])
);
```

### Partial Matching

```typescript
expect(user).toMatchObject({
  name: 'John',
  email: 'john@example.com',
  // Other properties are ignored
});
```

## Test Structure Best Practices

### AAA Pattern (Arrange-Act-Assert)

```typescript
describe('MyComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks(); // Clear mocks before each test
  });

  describe('rendering', () => {
    it('should render with default props', () => {
      // Arrange: Setup test data
      const props = { title: 'Test' };

      // Act: Render component
      const { getByText } = render(<MyComponent {...props} />);

      // Assert: Verify output
      expect(getByText('Test')).toBeInTheDocument();
    });
  });

  describe('user interactions', () => {
    it('should submit form on button click', async () => {
      // Arrange
      const onSubmit = vi.fn();
      const { getByRole, getByLabelText } = render(
        <MyForm onSubmit={onSubmit} />
      );

      // Act
      await userEvent.type(getByLabelText('Name'), 'John');
      await userEvent.click(getByRole('button', { name: 'Submit' }));

      // Assert
      expect(onSubmit).toHaveBeenCalledWith({ name: 'John' });
    });
  });
});
```

### Nested `describe` for Organization

```typescript
describe('PageService', () => {
  describe('createPage', () => {
    it('should create a page successfully', async () => {
      // ...
    });

    it('should throw error if path is invalid', async () => {
      // ...
    });
  });

  describe('updatePage', () => {
    it('should update page content', async () => {
      // ...
    });
  });
});
```

## Common Mocking Patterns

### Mocking SWR

```typescript
vi.mock('swr', () => ({
  default: vi.fn(() => ({
    data: mockData,
    error: null,
    isLoading: false,
    mutate: vi.fn(),
  })),
}));
```

### Mocking Modules

```typescript
// Mock entire module
vi.mock('~/services/PageService', () => ({
  PageService: {
    findById: vi.fn().mockResolvedValue({ id: '123', title: 'Test' }),
    create: vi.fn().mockResolvedValue({ id: '456', title: 'New' }),
  },
}));

// Use in test
import { PageService } from '~/services/PageService';

it('should call PageService.findById', async () => {
  await myFunction();
  expect(PageService.findById).toHaveBeenCalledWith('123');
});
```

### Mocking Specific Functions

```typescript
import { myFunction } from '~/utils/myUtils';

vi.mock('~/utils/myUtils', () => ({
  myFunction: vi.fn().mockReturnValue('mocked'),
  otherFunction: vi.fn(), // Mock other exports
}));
```

### Mocking CommonJS Modules with mock-require

**IMPORTANT**: When `vi.mock()` fails with ESModule/CommonJS compatibility issues, use `mock-require` instead:

```typescript
import mockRequire from 'mock-require';

describe('Service with CommonJS dependencies', () => {
  beforeEach(() => {
    // Mock CommonJS module before importing the code under test
    mockRequire('legacy-module', {
      someFunction: vi.fn().mockReturnValue('mocked'),
      someProperty: 'mocked-value',
    });
  });

  afterEach(() => {
    // Clean up mocks to avoid leakage between tests
    mockRequire.stopAll();
  });

  it('should use mocked module', async () => {
    // Import AFTER mocking (dynamic import if needed)
    const { MyService } = await import('~/services/MyService');

    const result = MyService.doSomething();
    expect(result).toBe('mocked');
  });
});
```

**When to use `mock-require`**:
- Legacy CommonJS modules that don't work with `vi.mock()`
- Mixed ESM/CJS environments causing module resolution issues
- Third-party libraries with complex module systems
- When `vi.mock()` fails with "Cannot redefine property" or "Module is not defined"

**Key points**:
- ✅ Mock **before** importing the code under test
- ✅ Use `mockRequire.stopAll()` in `afterEach()` to prevent test leakage
- ✅ Use dynamic imports (`await import()`) when needed
- ✅ Works with both CommonJS and ESModule targets

### Choosing the Right Mocking Strategy

```typescript
// ✅ Prefer vi.mock() for ESModules (simplest)
vi.mock('~/modern-module', () => ({
  myFunction: vi.fn(),
}));

// ✅ Use mock-require for CommonJS or mixed environments
import mockRequire from 'mock-require';
mockRequire('legacy-module', { myFunction: vi.fn() });

// ✅ Use vitest-mock-extended for type-safe object mocks
import { mockDeep } from 'vitest-mock-extended';
const mockService = mockDeep<MyService>();
```

**Decision tree**:
1. Can use `vi.mock()`? → Use it (simplest)
2. CommonJS or module error? → Use `mock-require`
3. Need type-safe object mock? → Use `vitest-mock-extended`

## Integration Tests (with Database)

Integration tests (*.integ.ts) can access in-memory databases:

```typescript
describe('PageService Integration', () => {
  beforeEach(async () => {
    // Setup: Seed test data
    await Page.create({ path: '/test', body: 'content' });
  });

  afterEach(async () => {
    // Cleanup: Clear database
    await Page.deleteMany({});
  });

  it('should create a page', async () => {
    const page = await PageService.create({
      path: '/new-page',
      body: 'content',
    });

    expect(page._id).toBeDefined();
    expect(page.path).toBe('/new-page');
  });
});
```

## Testing Checklist

Before committing tests, ensure:

- ✅ **Co-location**: Test files are next to source files
- ✅ **Descriptive names**: Test descriptions clearly state what is being tested
- ✅ **AAA pattern**: Tests follow Arrange-Act-Assert structure
- ✅ **Mocks cleared**: Use `beforeEach(() => vi.clearAllMocks())`
- ✅ **Async handled**: Use `async/await` and `waitFor()` for async operations
- ✅ **Type safety**: Use `vitest-mock-extended` for type-safe mocks
- ✅ **Isolated state**: Jotai tests use separate scopes if needed

## Running Tests

See the `testing` rule (`.claude/rules/testing.md`) for test execution commands.

## Summary: GROWI Testing Philosophy

1. **Co-locate tests**: Keep tests close to source code
2. **Type-safe mocks**: Use `vitest-mock-extended` for TypeScript support
3. **React Testing Library**: Test user behavior, not implementation details
4. **Async patterns**: Use `act()` and `waitFor()` for async state updates
5. **Jotai integration**: Wrap components with `<Provider>` for atom state
6. **Clear structure**: Use nested `describe` and AAA pattern
7. **Clean mocks**: Always clear mocks between tests

These patterns apply to **all GROWI packages** with React/TypeScript code.
