# Jest → Vitest 完全移行計画

## 現状分析

### Jest (test/integration/)
- **対象テストファイル**: 18 個
  - `test/integration/models/*.test.{js,ts}` (4 個)
  - `test/integration/service/*.test.{js,ts}` (9 個)
  - `test/integration/crowi/*.test.js` (1 個)
  - `test/integration/middlewares/*.test.js` (1 個)
  - `test/integration/migrations/*.test.ts` (1 個)
  - `test/integration/service/search/*.test.js` (1 個)
- **設定ファイル**:
  - `jest.config.js`
  - `test/integration/tsconfig.json`
  - `test/integration/global-setup.js`
  - `test/integration/global-teardown.js`
  - `test/integration/setup.js`
  - `test/integration/setup-crowi.ts`

### Vitest (vitest.workspace.mts)
- 3 ワークスペース構成
  - `app-unit`: `*.spec.{ts,js}` (node 環境)
  - `app-integration`: `*.integ.ts` (node + MongoMemoryServer)
  - `app-components`: `*.spec.{tsx,jsx}` (happy-dom)

### 主な差異

| 項目 | Jest | Vitest |
|------|------|--------|
| MongoDB | 実環境接続 | MongoMemoryServer |
| タイムアウト | `jest.setTimeout(30000)` | `test.setTimeout()` / `testTimeout` |
| 日時モック | `jest-date-mock` | `vi.useFakeTimers()` |
| モジュール | CommonJS | ESM |
| トランスパイル | `@swc-node/jest` | Vite ネイティブ |

## 移行戦略

### 基本方針

1. **Co-location**: テストファイルは実装モジュールと同じディレクトリに配置
2. **TypeScript 化**: 移行と同時に `.js` → `.ts` 化を実施
   - 型エラーは一旦 `as` 型アサーションで解消可
   - `as any` の撲滅は後続フェーズで対応
3. **インクリメンタル移行**: ファイルごとに「移行 → テスト → クリーンアップ」を完遂してから次へ

### Phase 1: 準備と環境整備

#### 1.1 依存関係の整理
- [ ] `jest-date-mock` → `vi.useFakeTimers()` への移行検討
- [ ] `jest-localstorage-mock` → Vitest 互換に置き換え
- [ ] 不要になる Jest 関連パッケージのリストアップ

#### 1.2 Vitest 設定の拡張
- [ ] `vitest.workspace.mts` に新しい integration workspace を追加
  - 名前: `app-integration-legacy` または既存 `app-integration` の拡張
  - MongoDB 接続方式の統一検討 (MongoMemoryServer 推奨)
- [ ] グローバルセットアップの移植 (`globalSetup` オプション)
- [ ] `test-with-vite/setup/crowi.ts` 作成 (setup-crowi.ts の Vitest 対応版)

### Phase 2: テストファイルのインクリメンタル移行

各ファイルに対して以下のサイクルを繰り返す:

```
┌─────────────────────────────────────────────────────┐
│  1. 移行: Jest → Vitest (TypeScript化含む)          │
│  2. テスト: vitest run で当該ファイルの動作確認      │
│  3. クリーンアップ: 元の .test.js ファイル削除       │
│  4. 次のファイルへ                                  │
└─────────────────────────────────────────────────────┘
```

#### 2.1 移行対象と配置先 (Co-location)

| 元ファイル | 移行先 |
|-----------|--------|
| `test/integration/crowi/crowi.test.js` | `src/server/crowi/crowi.integ.ts` |
| `test/integration/models/user.test.js` | `src/server/models/user.integ.ts` |
| `test/integration/models/page.test.js` | `src/server/models/page.integ.ts` |
| `test/integration/models/page-redirect.test.js` | `src/server/models/page-redirect.integ.ts` |
| `test/integration/models/update-post.test.js` | `src/server/models/update-post.integ.ts` |
| `test/integration/models/v5.page.test.js` | `src/server/models/v5.page.integ.ts` |
| `test/integration/service/page.test.js` | `src/server/service/page/page.integ.ts` |
| `test/integration/service/page-grant.test.ts` | `src/server/service/page/page-grant.integ.ts` |
| `test/integration/service/user-groups.test.ts` | `src/server/service/user-group/user-groups.integ.ts` |
| `test/integration/service/v5.migration.test.js` | `src/server/service/page/v5.migration.integ.ts` |
| `test/integration/service/v5.public-page.test.ts` | `src/server/service/page/v5.public-page.integ.ts` |
| `test/integration/service/v5.non-public-page.test.ts` | `src/server/service/page/v5.non-public-page.integ.ts` |
| `test/integration/service/v5.page.test.ts` | `src/server/service/page/v5.page.integ.ts` |
| `test/integration/service/external-user-group-sync.test.ts` | `src/features/external-user-group/server/service/external-user-group-sync.integ.ts` |
| `test/integration/service/ldap-user-group-sync.test.ts` | `src/features/external-user-group/server/service/ldap-user-group-sync.integ.ts` |
| `test/integration/service/search/search-service.test.js` | `src/server/service/search/search-service.integ.ts` |
| `test/integration/middlewares/login-required.test.js` | `src/server/middlewares/login-required.integ.ts` |
| `test/integration/migrations/20210913153942-migrate-slack-app-integration-schema.test.ts` | `config/migrations/20210913153942-migrate-slack-app-integration-schema.integ.ts` |

#### 2.2 各ファイルの移行手順 (1ファイルごとに実施)

**Step 1: 移行**
1. 新しい配置先に `.integ.ts` ファイルを作成
2. TypeScript 化:
   - `require()` → ESM `import`
   - 型アノテーション追加 (必要に応じて `as` アサーション使用可)
3. Jest API → Vitest API 置き換え:
   ```ts
   // Before (Jest)
   import { advanceTo } from 'jest-date-mock';
   jest.setTimeout(30000);
   
   // After (Vitest)
   import { vi, beforeEach, afterEach } from 'vitest';
   vi.setConfig({ testTimeout: 30000 });
   beforeEach(() => {
     vi.useFakeTimers();
     vi.setSystemTime(new Date('2024-01-01'));
   });
   afterEach(() => {
     vi.useRealTimers();
   });
   ```

**Step 2: テスト**
```bash
pnpm run test:vitest src/server/models/page.integ.ts
```

**Step 3: クリーンアップ**
- 元の `test/integration/.../*.test.{js,ts}` ファイルを削除
- Jest 設定の `testMatch` から除外 (最終ファイルまで保留可)

#### 2.3 移行順序 (依存関係順)

1. **基盤テスト** (他に依存されるもの)
   - [ ] `crowi.test.js` → `src/server/crowi/crowi.integ.ts`
   - [ ] `user.test.js` → `src/server/models/user.integ.ts`

2. **モデルテスト**
   - [ ] `page.test.js` → `src/server/models/page.integ.ts`
   - [ ] `page-redirect.test.js` → `src/server/models/page-redirect.integ.ts`
   - [ ] `update-post.test.js` → `src/server/models/update-post.integ.ts`
   - [ ] `v5.page.test.js` → `src/server/models/v5.page.integ.ts`

3. **サービステスト**
   - [ ] `page.test.js` → `src/server/service/page/page.integ.ts`
   - [ ] `page-grant.test.ts` → `src/server/service/page/page-grant.integ.ts`
   - [ ] `user-groups.test.ts` → `src/server/service/user-group/user-groups.integ.ts`
   - [ ] `v5.migration.test.js` → `src/server/service/page/v5.migration.integ.ts`
   - [ ] `v5.public-page.test.ts` → `src/server/service/page/v5.public-page.integ.ts`
   - [ ] `v5.non-public-page.test.ts` → `src/server/service/page/v5.non-public-page.integ.ts`
   - [ ] `v5.page.test.ts` → `src/server/service/page/v5.page.integ.ts`
   - [ ] `external-user-group-sync.test.ts` → features 配下
   - [ ] `ldap-user-group-sync.test.ts` → features 配下
   - [ ] `search-service.test.js` → `src/server/service/search/search-service.integ.ts`

4. **ミドルウェア/マイグレーション**
   - [ ] `login-required.test.js` → `src/server/middlewares/login-required.integ.ts`
   - [ ] `20210913153942-migrate-slack-app-integration-schema.test.ts` → config/migrations 配下

### Phase 3: 最終クリーンアップ (全ファイル移行完了後)

#### 3.1 削除対象ファイル
- [ ] `jest.config.js`
- [ ] `test/integration/global-setup.js`
- [ ] `test/integration/global-teardown.js`
- [ ] `test/integration/setup.js`
- [ ] `test/integration/tsconfig.json`
- [ ] `test/integration/setup-crowi.ts`
- [ ] `test/integration/` ディレクトリ全体

#### 3.2 削除対象パッケージ (package.json)
```
devDependencies から削除:
- @swc-node/jest
- @swc/jest
- @types/jest
- jest
- jest-date-mock
- jest-localstorage-mock
```

#### 3.3 package.json スクリプトの更新
```json
{
  "scripts": {
    "test": "vitest run --coverage",
    "test:unit": "vitest run --project app-unit",
    "test:integration": "vitest run --project app-integration",
    "test:components": "vitest run --project app-components"
  }
}
```
- `test:jest` スクリプト削除
- `jest:run` スクリプト削除

#### 3.4 CI/CD の更新
- Jest 関連のワークフローステップを削除
- Vitest の統一コマンドに置き換え

### Phase 4: 型アサーション撲滅 (後続タスク)

Phase 2 で使用した型アサーション (`as SomeType`, `as any`) を段階的に解消:
- [ ] `as any` の特定と適切な型への置き換え
- [ ] 不要な型アサーションの削除
- [ ] 型定義の改善

## 技術的注意点

### MongoDB 接続方式
**推奨**: MongoMemoryServer に統一
- テストの独立性が高まる
- CI 環境で外部 DB 不要
- 並列実行が容易

既存の `test-with-vite/setup/mongoms.ts` を拡張して使用

### 日時モックの変換例
```ts
// Jest (jest-date-mock)
import { advanceTo, clear } from 'jest-date-mock';
advanceTo(new Date('2024-01-01'));
clear();

// Vitest
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2024-01-01'));
});
afterEach(() => {
  vi.useRealTimers();
});
```

### setup-crowi.ts の Vitest 対応
`test/integration/setup-crowi.ts` を `test-with-vite/setup/` に移動し、
Vitest の `setupFiles` で読み込む構成に変更

## 作業チェックリスト

### 準備フェーズ
- [ ] 現在の Jest テストが全てパスすることを確認
- [ ] `vitest.workspace.mts` のバックアップ
- [ ] ブランチ作成: `feat/migrate-jest-to-vitest`

### 移行フェーズ
- [ ] `test-with-vite/setup/crowi.ts` 作成
- [ ] `test-with-vite/setup/global-setup.ts` 作成 (必要に応じて)
- [ ] 各テストファイルを `.integ.ts` に変換
- [ ] インポート文の ESM 化
- [ ] Jest API → Vitest API の置き換え

### 検証フェーズ
- [ ] 全テストが Vitest で実行可能
- [ ] カバレッジレポートが正常生成される
- [ ] CI パイプラインが正常動作

### クリーンアップフェーズ
- [ ] Jest 関連ファイル削除
- [ ] Jest 関連パッケージ削除
- [ ] ドキュメント更新 (AGENTS.md, README 等)

## 見積もり工数
- Phase 1: 準備 (1-2 日)
- Phase 2: インクリメンタル移行 (各ファイル 0.5-2 時間 × 18 ファイル = 2-5 日)
- Phase 3: 最終クリーンアップ (0.5 日)
- Phase 4: 型アサーション撲滅 (後続タスク、別途見積もり)

**合計: 約 4-8 日** (Phase 4 除く)

## リスクと対策

| リスク | 影響 | 対策 |
|--------|------|------|
| MongoMemoryServer との互換性 | テスト失敗 | 段階的移行、問題発生時は実 DB フォールバック |
| ESM 移行による import エラー | ビルド失敗 | 動的 import やエイリアス設定で対応 |
| CI 時間増加 | デプロイ遅延 | 並列実行、キャッシュ最適化 |

---

*作成日: 2026-01-15*
*最終更新: 2026-01-16*
*ステータス: 移行作業中 (Phase 2 後半)*

## 移行進捗

### 完了 ✅
- [x] Phase 1: Vitest 設定拡張 (`vitest.workspace.mts` に `testTimeout`, `resolve.alias`, `server.deps.inline` 追加)
- [x] `test-with-vite/setup/crowi.ts` 作成
- [x] `http-error-handler.js` → `http-error-handler.ts` 変換
- [x] `update-post.test.js` → `src/server/models/update-post.spec.ts` (純粋なユニットテスト)
- [x] `20210913153942-migrate-slack-app-integration-schema.test.ts` → `src/migrations/20210913153942-migrate-slack-app-integration-schema.integ.ts`
- [x] `user.test.js` → `src/server/models/user/user.integ.ts` ⚠️要品質チェック
- [x] `page.test.js` (models) → `src/server/models/page.integ.ts` ⚠️要品質チェック
- [x] `page-redirect.test.js` → `src/server/models/page-redirect.integ.ts` ⚠️要品質チェック
- [x] `external-user-group-sync.test.ts` → `src/features/external-user-group/server/service/external-user-group-sync.integ.ts` ⚠️要品質チェック
- [x] `login-required.test.js` → `src/server/middlewares/login-required.spec.ts` (ユニットテストに変更)
- [x] `crowi.test.js` → 削除 (e27f1a3443 で不要と判断)

### 残り Jest ファイル (9個)
- [ ] `test/integration/models/v5.page.test.js` → `src/server/models/v5.page.integ.ts`
- [ ] `test/integration/service/page.test.js` → `src/server/service/page/page.integ.ts`
- [ ] `test/integration/service/page-grant.test.ts` → `src/server/service/page/page-grant.integ.ts`
- [ ] `test/integration/service/user-groups.test.ts` → `src/server/service/user-group/user-groups.integ.ts`
- [ ] `test/integration/service/v5.migration.test.js` → `src/server/service/page/v5.migration.integ.ts`
- [ ] `test/integration/service/v5.public-page.test.ts` → `src/server/service/page/v5.public-page.integ.ts`
- [ ] `test/integration/service/v5.non-public-page.test.ts` → `src/server/service/page/v5.non-public-page.integ.ts`
- [ ] `test/integration/service/v5.page.test.ts` → `src/server/service/page/v5.page.integ.ts`
- [ ] `test/integration/service/ldap-user-group-sync.test.ts` → `src/features/external-user-group/server/service/ldap-user-group-sync.integ.ts`
- [ ] `test/integration/service/search/search-service.test.js` → `src/server/service/search/search-service.integ.ts`

### Phase 3: 最終クリーンアップ (未着手)
- [ ] Jest 設定ファイル削除
- [ ] Jest 関連パッケージ削除
- [ ] package.json スクリプト更新

### 技術的知見
1. `.js` ファイルで ESM `import` を使用しているものは `require()` でロードできない → TypeScript 化が必要
2. 動的 `import()` を使用すれば ESM ファイルをロード可能
3. `configManager.loadConfigs()` の事前呼び出しが必要なテストあり
4. Crowi インスタンスに依存するテストは、多くの `.js` → `.ts` 変換が前提

---

## ⚠️ 重要: 移行時の品質保証チェックリスト

**移行後の各テストファイルは、以下の観点で必ずレビューすること。**

テストフレームワークの移行は「テストが動く」だけでは不十分。
**テストの本質的な価値（実装のデグレを検出する能力）が維持されているかを検証する必要がある。**

### 必須チェック項目

#### 1. テストケースの網羅性
- [ ] **Jest 版のテストケース数と Vitest 版のテストケース数を比較**
- [ ] 削除されたテストケースがある場合、その理由を明確化
- [ ] `describe.skip` / `test.skip` が使われている場合、復活の計画を立てる

#### 2. モックの妥当性
- [ ] **モック対象が必要最小限か確認**
  - テスト対象のコアロジックがモックされていないか
  - ヘルパーメソッドまで独自に再実装していないか
- [ ] **モック実装が本番実装と一致するか確認**
  - `vi.mock()` 内でロジックを書いている場合、本番コードと同一か検証
  - 可能であれば `vi.importActual()` で実際の実装を使う

#### 3. Assertion の有効性
- [ ] **期待値が入力から独立して定義されているか**
  - テスト内で都合の良い変数を用意し、それを検証しているだけになっていないか
- [ ] **実際の副作用（DB 操作など）を検証しているか**
  - モックの戻り値だけでなく、実際の状態変化を確認

#### 4. 依存コンポーネントのカバレッジ
- [ ] **統合テストで検証されるべき連携が維持されているか**
  - 例: ページ grant 変更、ユーザーページ作成など
- [ ] モック化により検証から外れた機能は、別のテストでカバーされているか確認

### 過去のレビューで発見された問題例

| ファイル | 問題 | 詳細 |
|---------|------|------|
| `ldap-user-group-sync.integ.ts` | ヘルパーメソッドの再実装 | `getArrayValFromSearchResultEntry`, `getStringValFromSearchResultEntry` をモック内で独自実装。本番実装の変更を検出できない |
| `page-grant.integ.ts` | テストケースの大幅削減 | Jest 版 1190 行 → Vitest 版 648 行。`calcApplicableGrantData` の多数のケースが削除 |
| `search.integ.ts` | 主要メソッドのスキップ | `searchKeyword()` テストが `describe.skip` になっている |
| `user-group.integ.ts` | 統合検証の欠落 | ページ grant 変更が `pageService` モックにより実際には検証されていない |
| `external-user-group-sync.integ.ts` | ユーザーページ作成テスト削除 | Jest 版にあった `/user/*` ページ存在確認が Vitest 版で削除 |

### レビュー手順

```bash
# 1. 差分確認
git diff HEAD -- <jest-file> <vitest-file>

# 2. 行数比較
wc -l <jest-file> <vitest-file>

# 3. テストケース数の比較
grep -c "test\|it(" <jest-file>
grep -c "test\|it(" <vitest-file>

# 4. skip されているテストの確認
grep -n "skip\|todo" <vitest-file>
```

### 問題発見時の対応

1. **テストケース削減**: 削除理由を確認し、必要なら復活
2. **過剰なモック**: `vi.importActual()` を使って実装を復元
3. **スキップされたテスト**: 根本原因を調査し、有効化の方法を検討
4. **統合検証の欠落**: 別途統合テストを追加するか、モックを解除

---

## 品質チェック結果 (2026-01-16 実施)

### 1. user.integ.ts ✅ OK (再評価)

| 項目 | Jest | Vitest | 差分 |
|------|------|--------|------|
| テスト数 | 9 | 7 | -2 |
| skip | 0 | 0 | - |

**削除されたテスト:**
- `User.getUsernameByPath` の `found` / `not found` テスト

**結論:** ✅ 修正不要
- `getUsernameByPath` は `@growi/core` の `page-path-utils` にある関数
- 既に `packages/core/src/utils/page-path-utils/index.spec.ts` でテスト済み
- User モデルの静的メソッドとしては現在存在しない
- Jest 版のテストは冗長だった

### 2. page.integ.ts ✅ 修正完了

| 項目 | Jest | Vitest (修正後) | 差分 |
|------|------|-----------------|------|
| テスト数 | 29 | 31 | +2 |
| skip | 0 | 0 | 0 |

**実施した修正:**
- `MockPageEvent` クラスを追加し、最小限の crowi モックを作成
- `Page = pageFactory(crowiMock)` で crowi を渡すように変更
- `.findListWithDescendants` と `.findManageableListWithDescendants` の skip を解除
- 全31テストがパス

### 3. page-redirect.integ.ts ✅ OK

| 項目 | Jest | Vitest | 差分 |
|------|------|--------|------|
| テスト数 | 4 | 4 | 0 |
| skip | 0 | 0 | - |

### 4. external-user-group-sync.integ.ts ⚠️ 制限あり

| 項目 | Jest | Vitest | 差分 |
|------|------|--------|------|
| テスト数 | 3 | 3 | 0 |
| skip | 0 | 0 | - |

**削除された検証:**
- `/user/*` ページ作成の検証 (`userPages.length === 4` のアサーション)

**現状:**
- ユーザーページ作成は `UserEvent.onActivated` が担当
- これには `pageService.create` が必要で、完全な Crowi インスタンスが必要
- TODO コメントを追加して制限を文書化

**対応方針:** real Crowi instance の Vitest セットアップを作成して対応

### 今後のアクション

1. [x] `user.integ.ts`: 修正不要 (別の場所でテスト済み)
2. [x] `page.integ.ts`: skip テスト有効化完了
3. [ ] `external-user-group-sync.integ.ts`: real Crowi セットアップで対応予定

---

## Real Crowi Instance セットアップ (Vitest 版)

### 背景

Jest 版では `test/integration/setup-crowi.ts` を使用して完全な Crowi インスタンスを初期化していた。
一部のテスト (特に `UserEvent.onActivated` によるユーザーページ作成) にはこれが必要。

### 実装状況 ✅ 完了 (2026-01-16)

#### 1. ESM 変換作業

Crowi クラスとその依存関係の多くが `require()` を使用していたため、Vitest (ESM) で動作させるには変換が必要だった。

**変換済みファイル:**

| ファイル | 変更内容 |
|---------|---------|
| `src/server/events/page.js` | `module.exports` → `export default` |
| `src/server/events/activity.ts` | `module.exports` → `export default` |
| `src/server/events/admin.js` | `module.exports` → `export default` |
| `src/server/events/bookmark.js` | `module.exports` → `export default` |
| `src/server/events/tag.js` | `module.exports` → `export default` |
| `src/server/middlewares/login-required.js` | `module.exports` → `export default` |
| `src/server/middlewares/admin-required.js` | `module.exports` → `export default` |
| `src/server/service/activity.ts` | `module.exports` → `export default` |
| `src/server/service/comment.ts` | `module.exports` → `export default` |
| `src/server/service/system-events/sync-page-status.ts` | `module.exports` → `export default` |
| `src/server/crowi/index.ts` | `require()` → ESM import に変更 |
| `src/server/service/socket-io/socket-io.ts` | `require()` → ESM import に変更 |

#### 2. 作成したファイル

| ファイル | 説明 |
|---------|------|
| `test-with-vite/setup/crowi.ts` | Jest の `setup-crowi.ts` に相当。singleton パターンで Crowi インスタンスを提供 |
| `src/server/crowi/crowi-setup.integ.ts` | Crowi セットアップのテスト (6テスト pass, 1 skip) |

#### 3. vitest.workspace.mts の設定

```typescript
// integration test project に追加
resolve: {
  conditions: ['require', 'node', 'default'],
},
server: {
  deps: {
    inline: [
      '@growi/remark-attachment-refs',
      '@growi/remark-drawio',
      '@growi/remark-lsx',
      /src\/server\/events/,
    ],
  },
},
```

#### 4. 既知の制限

- **mongoose discriminator 問題**: 新しい Crowi インスタンスを作成すると、mongoose のモデルが重複登録されてエラーになる。テストでは singleton インスタンスを使用すること。
- **Crowi 内に残る require()**: `setupSession()`, `setUpApp()` 内にまだ多数の `require()` が残っている。これらは動的ロードのため Vitest でも許容される場合が多い。

#### 5. 次のステップ

- [ ] `external-user-group-sync.integ.ts` を real Crowi instance で書き換え、ユーザーページ検証を復活
- [ ] 残り9個の Jest テストファイルを移行

---

## 追加移行作業 (2026-01-19 実施)

### 移行完了したファイル

| Jest ファイル | Vitest ファイル | 状態 |
|--------------|-----------------|------|
| `test/integration/service/page-grant.test.ts` | `src/server/service/page/page-grant.integ.ts` | ✅ 完了 |
| `test/integration/service/user-groups.test.ts` | `src/server/service/user-group.integ.ts` | ✅ 完了 |
| `test/integration/service/v5.page.test.ts` | `src/server/service/page/v5.page.integ.ts` | ✅ 完了 |

### テスト結果サマリー

```
Test Files  101 passed | 2 skipped (103)
Tests  1126 passed | 22 skipped (1148)
```

### スキップされているテスト (要修正)

#### 1. `file-upload-setting.integ.ts` (10テスト全体スキップ)
- **原因**: `vi.mock` が CommonJS の `module.exports` と互換性がない
- **症状**: ミドルウェアモックが適用されず、302 リダイレクトが発生
- **修正方法**:
  1. `file-upload-setting.ts` を ESM エクスポートに変換
  2. または別のモック戦略を使用

#### 2. `v5.public-page.integ.ts` (10テストスキップ)
- **原因**: テスト間のデータ干渉（共有 MongoDB インスタンス）
- **スキップ対象**:
  - Rename テスト (5個)
  - Duplicate テスト (3個)
  - Delete テスト (2個)
- **修正方法**: テスト間のデータ分離改善

#### 3. `20210913153942-migrate-slack-app-integration-schema.integ.ts` (1テストスキップ)
- **原因**: マイグレーションファイルが ESM/CJS 混合構文を使用
- **症状**: "Cannot use import statement outside a module" エラー
- **修正方法**: マイグレーションファイルを純粋な ESM または CJS に変換

### 修正した問題

#### `v5.non-public-page.integ.ts`
- **問題**: `dummyUser1` が undefined で `Cannot read properties of undefined (reading '_id')` エラー
- **解決**: ユーザー作成後に変数への代入を追加
```typescript
dummyUser1 = await User.findOne({ username: 'v5DummyUser1' });
dummyUser2 = await User.findOne({ username: 'v5DummyUser2' });
npDummyUser1 = await User.findOne({ username: 'npUser1' });
npDummyUser2 = await User.findOne({ username: 'npUser2' });
npDummyUser3 = await User.findOne({ username: 'npUser3' });
```
