# Gap Analysis: sharelink-page-api

## 1. 現状調査 (Current State Investigation)

### 調査対象ファイル

| ファイル | 役割 |
|---|---|
| `apps/app/src/server/routes/apiv3/page/index.ts` | 既存の `GET /page` ルートハンドラ |
| `apps/app/src/server/middlewares/certify-shared-page.js` | share link 検証ミドルウェア |
| `apps/app/src/server/service/page/find-page-and-meta-data-by-viewer.ts` | ページデータ取得サービス関数 |
| `apps/app/src/server/models/share-link.ts` | ShareLink Mongoose モデル |
| `apps/app/src/server/routes/apiv3/share-links.js` | ShareLink CRUD ルート |
| `apps/app/src/pages/share/[[...path]]/page-data-props.ts` | SSR 用 share link ページ取得 |
| `apps/app/src/states/page/use-fetch-current-page.ts` | クライアント側 page API 呼び出しフック |

### 既存ミドルウェアチェーン（`GET /page` ルート）

```
accessTokenParser → certifySharedPage → loginRequired → validator.getPage → handler
```

handler 内の分岐:
1. `isSharedPage=true` の場合 → `ShareLink.findOne` (2回目) + `findPageAndMetaDataByViewer({ isSharedPage: true })`
2. `findAll` の場合 → `Page.findByPathAndViewer`
3. デフォルト → `findPageAndMetaDataByViewer`

### クライアント側の呼び出しパターン（`use-fetch-current-page.ts`）

```typescript
// share link 表示時に生成されるパラメータ
{ pageId: currentPageId, shareLinkId: shareLinkId }
// → apiv3Get('/page', { pageId, shareLinkId }) で呼び出し
```

---

## 2. 要件フィージビリティ分析 (Requirements Feasibility Analysis)

### 要件 → 資産マップ

| 要件 | 既存資産 | ギャップ種別 | 詳細 |
|---|---|---|---|
| Req 1: 専用エンドポイント | なし | **Missing** | 新規ルートハンドラが必要 |
| Req 2: シェアリンク検証 | `certifySharedPage.js`（部分的） | **Gap** | `disableLinkSharing` 未チェック・DB 二重クエリ問題 |
| Req 3: ページデータ返却 | `findPageAndMetaDataByViewer` | **Gap** | `respondWithSinglePage` ヘルパーがインライン定義のため未抽出 |
| Req 4: 認証不要 | `loginRequired(isGuestAllowed: true)` で代替中 | **Constraint** | 既存ルートの設計では `certifySharedPage` + `loginRequired` に依存 |
| Req 5: コード重複回避 | `findPageAndMetaDataByViewer` は再利用可能 | **Gap** | バリデーション・レスポンスシリアライズが抽出されていない |

### 発見された既知の問題（既存実装のバグ/設計課題）

#### 問題 1: DB 二重クエリ

`certifySharedPage` ミドルウェアで 1 回 `ShareLink.findOne` → ハンドラでさらに `ShareLink.findOne` を実行。専用エンドポイントでは 1 回に集約できる。

```javascript
// certifySharedPage.js: 1回目
ShareLink.findOne({ _id: shareLinkId, relatedPage: pageId })

// page/index.ts handler: 2回目
ShareLink.findOne({ _id: shareLinkId })
```

#### 問題 2: `disableLinkSharing` がページ取得 API で未チェック

- `share-links.js` の CRUD ルート（作成・一覧）では `linkSharingRequired` ミドルウェアで `disableLinkSharing` をチェックしている
- `certifySharedPage` ミドルウェアは `disableLinkSharing` を**チェックしない**
- `GET /page` ハンドラも `disableLinkSharing` を**チェックしない**
- → `disableLinkSharing=true` 設定でも、既存の share link 経由でページデータを取得可能な状態

専用エンドポイントでは、この設定を適切にチェックすることで要件 2-5 を満たす。

#### 問題 3: `certifySharedPage` のサイレント・パス

期限切れ / 無効なリンクの場合、`certifySharedPage` はエラーを返さず `next()` を呼ぶ。その後 `loginRequired` が未認証リクエストをブロックする設計。専用エンドポイントでは、無効リンクを明示的なエラーレスポンス（403/404）で返すべき。

### 再利用可能な既存資産

**完全に再利用可能（変更不要）:**
- `findPageAndMetaDataByViewer` — `isSharedPage: true` オプション対応済み
- `ShareLink` モデル + `isExpired()` メソッド
- `page.populateDataToShowRevision()` メソッド
- `configManager.getConfig('security:disableLinkSharing')`
- `configManager.getConfig('security:disableUserPages')`
- `apiV3FormValidator` ミドルウェア
- `ErrorV3` エラークラス + `res.apiv3Err()` / `res.apiv3()` レスポンスヘルパー

**抽出・リファクタリングが必要:**
- `respondWithSinglePage` — `page/index.ts` ハンドラ内インライン定義 → 共有ユーティリティに抽出
- share link 検証ロジック — `certifySharedPage.js` の DB クエリ部分 → 純粋関数として抽出

**不要（専用エンドポイントには使用しない）:**
- `accessTokenParser` — 認証不要のため
- `loginRequired` — 認証不要のため
- `certifySharedPage` ミドルウェア本体 — 専用エンドポイントでは使用しない（ただし既存ルートの互換性維持のため削除はしない）

---

## 3. 実装アプローチ選択肢 (Implementation Approach Options)

### Option A: `GET /page/shared` として page ルートに追加

**新規ファイル**: `apps/app/src/server/routes/apiv3/page/get-page-by-share-link.ts`

ハンドラーファクトリーパターン（`get-page-info.ts` と同様）:

```
GET /_api/v3/page/shared?shareLinkId=xxx&pageId=yyy
```

ミドルウェアチェーン（シンプル化）:
```
validateShareLinkParams → handler
```

- `page/index.ts` に `router.get('/shared', getPageByShareLinkHandlerFactory(crowi))` を追加
- `respondWithSinglePage` を `page/respond-with-single-page.ts` として抽出
- share link バリデーション純粋関数を抽出

**Trade-offs:**
- ✅ `get-page-info.ts` と同一パターン（コードレビューが容易）
- ✅ TypeScript ネイティブ
- ✅ `page/` ディレクトリ内で完結
- ✅ 既存ルートへの影響最小
- ❌ クライアント側 URL 変更が必要（`/page` → `/page/shared`）

### Option B: `GET /share-links/:shareLinkId/page` として share-links ルートに追加

```
GET /_api/v3/share-links/:shareLinkId/page?pageId=yyy
```

- `share-links.js` に新ルートを追加
- RESTful 設計として最もセマンティック

**Trade-offs:**
- ✅ RESTful な URL 構造（share link がリソースの起点）
- ✅ share link 関連ロジックが share-links ルートに集約される
- ❌ `share-links.js` は CommonJS/JavaScript → TypeScript 化またはJS で書く必要
- ❌ クライアント側 URL 変更が必要かつ変更量が大きい

### Option C: Hybrid（推奨）

**Phase 1**: Option A と同様に `GET /page/shared` を新規作成（TypeScript）
- 新ファイル: `page/get-page-by-share-link.ts`
- `respondWithSinglePage` ユーティリティ抽出: `page/respond-with-single-page.ts`
- share link バリデーション純粋関数抽出（`certifySharedPage` から）

**Phase 2**: クライアント側を新エンドポイントに移行
- `use-fetch-current-page.ts` の API 呼び出しを `/page/shared` に変更

**Phase 3**: 既存ルートの share link ブランチ除去（オプション）
- `page/index.ts` から `isSharedPage` 分岐を削除
- `certifySharedPage` ミドルウェアの使用箇所を精査して不要になれば削除

**Trade-offs:**
- ✅ 段階的に安全に移行できる
- ✅ TypeScript ネイティブ
- ✅ 確立されたパターンに従う
- ✅ 既存ルートの動作を壊さない
- ❌ Phase 1 完了後に古い実装が一時的に並存する

---

## 4. 実装複雑度・リスク評価

| 項目 | 評価 | 根拠 |
|---|---|---|
| **努力量** | **S（1〜3 日）** | 全サービス関数は既存。パターン確立済み（`get-page-info.ts` と同様）。主な作業は新ハンドラファイル + 2 つのユーティリティ抽出 + クライアント側変更 |
| **リスク** | **Low** | 新しいアーキテクチャパターンなし・新規依存なし・対象スコープが明確 |

---

## 5. 設計フェーズへの推薦事項

### 推奨アプローチ
**Option C（Hybrid）** を推薦。`get-page-info.ts` と同一のハンドラファクトリーパターンで `get-page-by-share-link.ts` を実装する。

### 設計フェーズで確定すべき事項

1. **エンドポイント URL の確定**: `GET /page/shared` か `GET /share-links/:id/page` か
2. **クライアント側変更のスコープ**: `use-fetch-current-page.ts` の変更内容と後方互換性方針
3. **`respondWithSinglePage` 抽出の設計**: 型シグネチャと依存関係
4. **`disableLinkSharing` チェックの位置**: ミドルウェアとして抽出するか、ハンドラ内に配置するか
5. **既存 `GET /page` ルートの share link ブランチの扱い**: Phase 3 で削除するか並存させるか

### Research Needed
- `certifySharedPage` が他のルート（`get-page-info.ts` など）でも使われているため、削除・変更の影響範囲を確認（→ 設計フェーズで調査）
