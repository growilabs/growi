# Vitest + TypeScript Testing Guide

## 核心技術要素

### tsconfig.json最適設定
```json
{
  "compilerOptions": {
    "types": ["vitest/globals"]  // グローバルAPI: describe, it, expect等をインポート不要化
  }
}
```

### vitest-mock-extended: 型安全モッキング
```typescript
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';

// 完全型安全なNext.js Routerモック
const mockRouter: DeepMockProxy<NextRouter> = mockDeep<NextRouter>();
mockRouter.asPath = '/test-path';  // TypeScript補完・型チェック有効

// 複雑なUnion型も完全サポート
interface ComplexProps {
  currentPageId?: string | null;
  currentPathname?: string | null;
}
const mockProps: DeepMockProxy<ComplexProps> = mockDeep<ComplexProps>();
```

### React Testing Library + Jotai統合
```typescript
const renderWithProvider = (ui: React.ReactElement, scope?: Scope) => {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider scope={scope}>{children}</Provider>
  );
  return render(ui, { wrapper: Wrapper });
};
```

## 実践パターン

### 非同期テスト
```typescript
import { waitFor, act } from '@testing-library/react';

await act(async () => {
  result.current.triggerAsyncAction();
});

await waitFor(() => {
  expect(result.current.isLoading).toBe(false);
});
```

### 詳細アサーション
```typescript
expect(mockFunction).toHaveBeenCalledWith(
  expect.objectContaining({
    pathname: '/expected-path',
    data: expect.any(Object)
  })
);
```

## 実行コマンド

### 基本テスト実行
```bash
# Vitest単体
pnpm run test:vitest

# Vitest単体（coverageあり）
pnpm run test:vitest:coverage

# 特定ファイルのみ実行（coverageあり）
pnpm run test:vitest src/path/to/test.spec.tsx
```
