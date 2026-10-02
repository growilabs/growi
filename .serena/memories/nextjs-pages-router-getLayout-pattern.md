# Next.js Pages Router における getLayout パターン完全ガイド

## getLayout パターンの基本概念と仕組み

getLayout パターンは、Next.js Pages Router における**ページごとのレイアウト定義を可能にする強力なアーキテクチャパターン**です。このパターンを使用することで、各ページが独自のレイアウト階層を静的な `getLayout` 関数を通じて定義できます。

### 技術的な仕組み

getLayout パターンは React のコンポーネントツリー構成を活用して動作します：

```typescript
// pages/dashboard.tsx
import DashboardLayout from '../components/DashboardLayout'

const Dashboard = () => <div>ダッシュボードコンテンツ</div>

Dashboard.getLayout = function getLayout(page) {
  return <DashboardLayout>{page}</DashboardLayout>
}

export default Dashboard

// pages/_app.tsx
export default function MyApp({ Component, pageProps }) {
  const getLayout = Component.getLayout ?? ((page) => page)
  return getLayout(<Component {...pageProps} />)
}
```

**動作原理：**
1. Next.js がページを初期化する際、`getLayout` プロパティをチェック
2. `getLayout` 関数がページコンポーネントを受け取り、完全なレイアウトツリーを返す
3. React の差分アルゴリズムがコンポーネントツリーの同じ位置を維持し、効率的な差分更新を実現

## パフォーマンス向上の具体的なメリット

### レンダリング回数の削減

getLayout パターンの最大の利点は、**ページ遷移時のレイアウトコンポーネントの再マウント防止**です。React の差分アルゴリズムは、コンポーネントツリーの同じ位置に同じタイプのコンポーネントが存在する場合、そのインスタンスを再利用します。

**実測データ（Zenn.dev の事例）：**
```
実装前：
├ /_app      97.7 kB （全ページで Recoil を含む）
├ /articles  98 kB
├ /profile   98 kB

実装後：
├ /_app      75 kB （22.7 kB 削減）
├ /articles  75.3 kB （最適化されたバンドル）
├ /profile   98.3 kB （必要な依存関係のみ）
```

### メモリ効率の改善

**主要な最適化ポイント：**
- **状態の永続化**: 入力値、スクロール位置、コンポーネント状態がナビゲーション間で保持
- **イベントリスナーの永続性**: イベントハンドラーの再アタッチ回避
- **DOM 参照の安定性**: サードパーティ統合用の DOM ノード参照の維持

## 実装のベストプラクティス

### TypeScript での型安全な実装

```typescript
// types/layout.ts
import type { NextPage } from 'next'
import type { AppProps } from 'next/app'
import type { ReactElement, ReactNode } from 'react'

export type NextPageWithLayout<P = {}, IP = P> = NextPage<P, IP> & {
  getLayout?: (page: ReactElement) => ReactNode
}

export type AppPropsWithLayout = AppProps & {
  Component: NextPageWithLayout
}

// pages/_app.tsx
import type { AppPropsWithLayout } from '../types/layout'

export default function MyApp({ Component, pageProps }: AppPropsWithLayout) {
  const getLayout = Component.getLayout ?? ((page) => page)
  return getLayout(<Component {...pageProps} />)
}
```

### ネストレイアウトの実装

```typescript
// utils/nestLayout.ts
export function nestLayout(
  parentLayout: (page: ReactElement) => ReactNode,
  childLayout: (page: ReactElement) => ReactNode
) {
  return (page: ReactElement) => parentLayout(childLayout(page))
}

// pages/dashboard/profile.tsx
import { nestLayout } from '../../utils/nestLayout'
import { getLayout as getBaseLayout } from '../../components/BaseLayout'
import { getLayout as getDashboardLayout } from '../../components/DashboardLayout'

const ProfilePage: NextPageWithLayout = () => {
  return <div>プロフィールコンテンツ</div>
}

ProfilePage.getLayout = nestLayout(getBaseLayout, getDashboardLayout)
```

### 状態管理の最適化

```typescript
// レイアウトごとのコンテキスト分割
const AuthLayout = ({ children }) => (
  <AuthProvider>
    <UserProvider>
      {children}
    </UserProvider>
  </AuthProvider>
)

const PublicLayout = ({ children }) => (
  <ThemeProvider>
    {children}
  </ThemeProvider>
)

// 各ページで適切なレイアウトを選択
Page.getLayout = (page) => <AuthLayout>{page}</AuthLayout>
```

## バッドプラクティスと実装時の落とし穴

### 避けるべきアンチパターン

**❌ レイアウトの再作成**
```typescript
// 悪い例：レイアウトの永続性が失われる
const BadPage = () => {
  return (
    <Layout>
      <div>ページコンテンツ</div>
    </Layout>
  )
}

// ✅ 良い例：getLayout パターンを使用
const GoodPage = () => <div>ページコンテンツ</div>
GoodPage.getLayout = (page) => <Layout>{page}</Layout>
```

**❌ _app.tsx での条件付きレンダリング**
```typescript
// 悪い例：レイアウトの再マウントを引き起こす
function MyApp({ Component, pageProps, router }) {
  if (router.pathname.startsWith('/dashboard')) {
    return <DashboardLayout><Component {...pageProps} /></DashboardLayout>
  }
  return <Component {...pageProps} />
}
```

### メモリリークの防止

```typescript
// ✅ 適切なクリーンアップ
const Layout = ({ children }) => {
  useEffect(() => {
    const handleResize = () => { /* 処理 */ }
    
    window.addEventListener('resize', handleResize)
    
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  return <div>{children}</div>
}
```

## 他のレイアウト管理手法との比較

### Pages Router 内での比較

| 手法 | 複雑度 | パフォーマンス | 柔軟性 | 学習曲線 |
|------|--------|----------------|--------|----------|
| getLayout | 中 | 高 | 高 | 中 |
| HOCs | 高 | 中 | 高 | 高 |
| _app.js ルーティング | 低 | 高 | 低 | 低 |
| Context ベース | 高 | 中 | 高 | 高 |
| ラッパーコンポーネント | 低 | 低 | 低 | 低 |

### Next.js 13+ App Router との比較

**App Router の利点：**
- ビルトインのレイアウトネスティング
- ファイルシステムベースの直感的な構造
- 自動的な状態永続化
- `loading.js` と `error.js` による組み込みの状態管理

**getLayout パターンの利点：**
- 明示的なレイアウト制御
- 成熟した安定したパターン
- シンプルなメンタルモデル
- 優れた TTFB パフォーマンス

**パフォーマンス比較：**
- **TTFB**: Pages Router が App Router より最大 2 倍高速
- **開発サーバー**: Pages Router がより安定
- **バンドルサイズ**: getLayout により選択的な読み込みが可能

## SEO と SSR/SSG への影響

### Core Web Vitals への影響

**測定された改善効果：**
- **LCP (Largest Contentful Paint)**: レイアウトの永続化により改善
- **INP (Interaction to Next Paint)**: JavaScript 実行時間の削減
- **CLS (Cumulative Layout Shift)**: レイアウトシフトの除去

**Netflix の事例：**
- Time-to-Interactive が **50% 削減**
- JavaScript バンドルサイズが **200KB 削減**
- デスクトップユーザーの 97% が高速な First Input Delay を体験

### SSR/SSG との統合

```typescript
// SSR との完全な互換性
export async function getServerSideProps() {
  const data = await fetchData()
  return { props: { data } }
}

function Page({ data }) {
  return <div>{data.content}</div>
}

Page.getLayout = (page) => <Layout>{page}</Layout>
```

## 実際のプロジェクトでの活用例

### 企業での実装事例

**Netflix:**
- ログアウト済みホームページで Time-to-Interactive を 50% 削減
- 戦略的なプリフェッチで後続ページロードを 30% 改善

**Hulu:**
- Next.js による統一されたフロントエンドアーキテクチャ
- CSS-in-JS の自動コード分割を実装

**Sonos:**
- ビルド時間を **75% 短縮**
- パフォーマンススコアを **10% 改善**

## パフォーマンス測定と最適化

### 測定ツールの設定

```javascript
// next.config.js - Bundle Analyzer の設定
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

module.exports = withBundleAnalyzer(nextConfig);

// 使用方法
// ANALYZE=true npm run build
```

### React DevTools Profiler の活用

```javascript
import { Profiler } from 'react';

function onRenderCallback(id, phase, actualDuration, baseDuration) {
  console.log({ id, phase, actualDuration, baseDuration });
}

<Profiler id="LayoutProfile" onRender={onRenderCallback}>
  <MyLayout>{children}</MyLayout>
</Profiler>
```

### 最適化テクニック

**メモ化の実装：**
```typescript
import { memo, useMemo, useCallback } from 'react'

const Layout = memo(({ children, menuItems }) => {
  const processedMenu = useMemo(() => 
    menuItems.filter(item => item.visible).sort(), 
    [menuItems]
  );
  
  const handleNavigation = useCallback((path) => {
    router.push(path);
  }, [router]);
  
  return (
    <div>
      <Navigation items={processedMenu} onNavigate={handleNavigation} />
      {children}
    </div>
  );
});
```

**動的インポートによるコード分割：**
```typescript
import dynamic from 'next/dynamic';

const DynamicSidebar = dynamic(() => import('../components/Sidebar'), {
  loading: () => <SidebarSkeleton />,
  ssr: false
});

const Layout = ({ children }) => (
  <div>
    <Header />
    <DynamicSidebar />
    <main>{children}</main>
  </div>
);
```

### パフォーマンスバジェットの実装

```javascript
export const PERFORMANCE_BUDGETS = {
  layoutRenderTime: 16, // 60fps のための 16ms
  memoryUsage: 50 * 1024 * 1024, // 50MB
  bundleSize: 200 * 1024, // 200KB
  firstContentfulPaint: 2000, // 2秒
};

const measureLayoutPerformance = (layoutName, renderFn) => {
  const start = performance.now();
  const result = renderFn();
  const duration = performance.now() - start;
  
  if (duration > PERFORMANCE_BUDGETS.layoutRenderTime) {
    console.warn(`Layout ${layoutName} がレンダーバジェットを超過: ${duration}ms`);
  }
  
  return result;
};
```

## 実装チェックリスト

### 初期設定
- [ ] TypeScript の型定義を設定
- [ ] `_app.tsx` に getLayout パターンを実装
- [ ] React DevTools をインストール
- [ ] Bundle Analyzer を設定

### 最適化の優先順位

**高影響・低労力：**
- [ ] レイアウトコンポーネントに React.memo を実装
- [ ] Bundle Analyzer で大きな依存関係を特定
- [ ] Context Provider をレイアウトごとに分割

**中影響・中労力：**
- [ ] 非クリティカルなレイアウトコンポーネントに動的インポートを実装
- [ ] Suspense 境界を追加してストリーミングを改善
- [ ] 自動パフォーマンス監視を設定

**高影響・高労力：**
- [ ] 状態管理アーキテクチャの再設計
- [ ] 包括的なプログレッシブエンハンスメントの実装
- [ ] 高度なパフォーマンスバジェットシステムの作成

## まとめ

getLayout パターンは、Next.js Pages Router において**強力なパフォーマンス最適化とアーキテクチャの柔軟性**を提供します。適切に実装すれば、以下の利点が得られます：

1. **パフォーマンスの向上**: 不要な再レンダリングの削減とバンドルサイズの最適化
2. **ユーザー体験の向上**: 状態の永続化とスムーズなページ遷移
3. **アーキテクチャの柔軟性**: ページごとのレイアウトカスタマイズとパフォーマンスの維持
4. **メモリ効率**: コンポーネントの再利用による最適なリソース使用

App Router が新しい代替手段を提供する一方で、getLayout パターンの理解は React のレンダリング最適化とコンポーネントライフサイクル管理への深い洞察を提供します。Pages Router アプリケーションでは、プロジェクトの開始時から getLayout を実装することで、アプリケーションのスケールに応じて最大限のパフォーマンス利点とアーキテクチャの柔軟性を維持できます。