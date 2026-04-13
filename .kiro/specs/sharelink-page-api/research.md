# Research & Design Decisions: sharelink-page-api

---

## Summary

- **Feature**: `sharelink-page-api`
- **Discovery Scope**: Extension（既存 page API ルートへの拡張）
- **Key Findings**:
  1. `findPageAndMetaDataByViewer` は `isSharedPage: true` オプションを既にサポートしており、変更不要で再利用可能
  2. `certifySharedPage` ミドルウェアには 2 つの既知の設計課題がある：`disableLinkSharing` 未チェック、および無効/期限切れリンクのサイレントパス（エラーを返さず次のミドルウェアへ）
  3. 現行の `GET /page` ルートは share link アクセスで `ShareLink.findOne` を 2 回実行する（`certifySharedPage` + ハンドラ）。専用エンドポイントで 1 回に集約できる

---

## Research Log

### `certifySharedPage` ミドルウェアの動作分析

- **Context**: 専用エンドポイントで `certifySharedPage` をそのまま再利用できるか検証
- **Sources Consulted**: `apps/app/src/server/middlewares/certify-shared-page.js`
- **Findings**:
  - `pageId` または `shareLinkId` が null の場合、検証をスキップして `next()` を呼ぶ
  - ShareLink が見つからないか期限切れの場合も `next()` を呼ぶ（`req.isSharedPage` を設定しない）
  - `security:disableLinkSharing` 設定を一切チェックしない
  - 設計上「フラグ設定専用ミドルウェア」であり、`loginRequired` と組み合わせて初めて機能する
- **Implications**: 専用エンドポイントでは `certifySharedPage` を使わず、明示的なバリデーション関数を新規作成する

### `disableLinkSharing` 設定の適用範囲調査

- **Context**: `disableLinkSharing=true` 時に既存の share link 経由でページ取得 API が保護されているか確認
- **Sources Consulted**: `share-links.js` の `linkSharingRequired` ミドルウェア、`certify-shared-page.js`、`page/index.ts`
- **Findings**:
  - `disableLinkSharing` は ShareLink の**作成・一覧取得**ルートのみで確認されている（`share-links.js` の `linkSharingRequired`）
  - `GET /page?shareLinkId=xxx` 経由でのページ**取得**は、`disableLinkSharing=true` でも保護されていない（既存バグ）
  - SSR の share ページ (`page-data-props.ts`) もこの設定をチェックしていない
- **Implications**: 新専用エンドポイントでこの設定チェックを追加することで、要件 2.5 を満たしつつ既存バグを修正する

### クライアント側 API 呼び出しパターン調査

- **Context**: クライアントが `GET /page` に `shareLinkId` を渡す仕組みを確認
- **Sources Consulted**: `apps/app/src/states/page/use-fetch-current-page.ts`
- **Findings**:
  - `buildApiParams` 関数内で `shareLinkId` が存在する場合に `params.shareLinkId = shareLinkId` と `params.pageId = currentPageId` を設定
  - 最終的に `apiv3Get('/page', params)` として呼び出し
  - コメントに「required by certifySharedPage middleware」と明記されており、ミドルウェア依存を意識した設計
- **Implications**: 新エンドポイントへの移行時に `apiv3Get` の第 1 引数を条件分岐させるだけでよい（パラメータ構造は変わらない）

### 既存ハンドラーファクトリーパターン確認

- **Context**: 新ハンドラーファイルが従うべきパターンを確認
- **Sources Consulted**: `get-page-info.ts`、`page/index.ts`
- **Findings**:
  - `getPageInfoHandlerFactory(crowi): RequestHandler[]` の形式でファクトリーを export
  - `page/index.ts` で `router.get('/info', getPageInfoHandlerFactory(crowi))` として登録（Express はミドルウェア配列を直接受け付ける）
  - `certifySharedPage` と `loginRequired` の両方を使用している（新エンドポイントでは両方不要）
- **Implications**: 新ファイル `get-page-by-share-link.ts` は同一のファクトリーパターンで実装し、`GET /page/shared` として登録する

---

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: `GET /page/shared` | `page/` ディレクトリ内に新ハンドラーファイルを追加 | 既存パターンと一致・TypeScript ネイティブ・クライアント変更が最小 | クライアント URL 変更が必要 | **採用** |
| B: `GET /share-links/:id/page` | `share-links.js` ルーターに追加 | RESTful なリソース URL 設計 | `share-links.js` が CommonJS/JS・クライアント変更が大きい | 非採用 |
| C: `GET /share-links/page` | クエリパラメータ方式で `share-links.js` に追加 | パラメータ構造が変わらない | JS ファイルへの追加・名前空間が直感的でない | 非採用 |

---

## Design Decisions

### Decision: エンドポイント URL の選択

- **Context**: share link 専用エンドポイントの URL パスをどこに配置するか
- **Alternatives Considered**:
  1. `GET /page/shared` — `page/` ディレクトリ内の新ハンドラー
  2. `GET /share-links/:id/page` — RESTful リソース設計
  3. `GET /share-links/page` — クエリパラメータ方式
- **Selected Approach**: `GET /page/shared` を採用
- **Rationale**: `get-page-info.ts` と完全に同じハンドラーファクトリーパターンを踏襲でき、TypeScript ネイティブ。クライアント側の変更は API パスの条件分岐のみで最小限。`page/` ディレクトリ内でルーター登録まで完結する。
- **Trade-offs**: URL がリソース中心でない点は妥協点だが、GROWI の既存 `/page/info` パターンと一貫性がある
- **Follow-up**: 実装時に OpenAPI ドキュメントも更新する

### Decision: ShareLink バリデーションの実装方式

- **Context**: share link の DB バリデーション（存在確認・期限確認・relatedPage 照合）をどこに置くか
- **Alternatives Considered**:
  1. `certifySharedPage` ミドルウェアを改修して再利用
  2. ハンドラー内にインライン実装
  3. 新規サービス関数として抽出（`server/service/share-link/validate-share-link.ts`）
- **Selected Approach**: 新規サービス関数 `validateShareLink` を `server/service/share-link/validate-share-link.ts` に作成
- **Rationale**: `certifySharedPage` は「フラグ設定ミドルウェア」として設計されており、単体でエラーレスポンスを返す責務を持たない。`server/service/page/find-page-and-meta-data-by-viewer.ts` と同じ service 層パターンに従い、純粋な非同期バリデーション関数として実装することで、他ルートからも再利用可能になる（例: `get-page-info.ts` の将来的なリファクタリング）
- **Trade-offs**: 新規ディレクトリ `server/service/share-link/` の作成が必要
- **Follow-up**: `certifySharedPage` は `get-page-info.ts` でまだ使用されているため、このスペック内では削除せず残す

### Decision: `respondWithSinglePage` の抽出

- **Context**: ページデータをレスポンスに変換するロジックの重複を避ける方法
- **Alternatives Considered**:
  1. 新ハンドラーにインラインで複製
  2. `page/index.ts` 内のクロージャを共有ユーティリティとして抽出
- **Selected Approach**: `page/respond-with-single-page.ts` として抽出・export
- **Rationale**: 要件 5.3 を直接満たす。既存の `page/index.ts` ハンドラーと新ハンドラーの両方が同じロジックを参照できる
- **Trade-offs**: `res` オブジェクト（`ApiV3Response` 型）と設定値を引数として受け取る設計が必要
- **Follow-up**: `initLatestRevisionField` の呼び出し引数（`revisionId`）の扱いを実装時に確認

### Decision: `disableLinkSharing` チェックの位置

- **Context**: グローバル設定の確認をどのレイヤーで行うか
- **Alternatives Considered**:
  1. `validateShareLink` サービス関数内に含める
  2. 新ハンドラーの先頭で確認（リクエストレイヤー）
- **Selected Approach**: ハンドラーの先頭で確認
- **Rationale**: `validateShareLink` は DB レベルの検証（link の存在・有効性）に責務を限定する。グローバル設定の確認はリクエスト処理の最初のゲートとして、ハンドラーが明示的に担当する
- **Trade-offs**: なし（シンプルかつ透明性が高い）

### Decision: 既存 `GET /page` ハンドラーのクリーンアップ方針

- **Context**: 新エンドポイント追加後、旧ルートの share link ブランチをどうするか
- **Selected Approach**: 同一スコープ内でクリーンアップを実施
  - `certifySharedPage` を `GET /page` ミドルウェアチェーンから除去
  - `isSharedPage` 条件分岐をハンドラーから除去
  - `shareLinkId` パラメータバリデーターを除去
  - クライアントを新エンドポイントに移行してから除去
- **Rationale**: ゾンビコードを残さない。クライアント側の移行と backend のクリーンアップを同一 PR にまとめることで不整合期間をゼロにする
- **Trade-offs**: `get-page-info.ts` はまだ `certifySharedPage` を使用しているため、`certifySharedPage` ファイル自体は削除しない

---

## Risks & Mitigations

- **クライアント移行の原子性**: クライアント (`use-fetch-current-page.ts`) と backend のデプロイが分離すると、移行期間中に新エンドポイントが存在しないタイミングが生じる可能性がある — 同一 PR で backend と client を同時変更することで回避
- **`get-page-info.ts` への影響**: `certifySharedPage` は引き続き `get-page-info.ts` で使用される — このスペックのスコープ外として明示し、別タスク化を検討
- **`disableLinkSharing` の既存動作変更**: 新エンドポイントで `disableLinkSharing` を正しくチェックすることは、現行の未チェック状態からの動作変更になる — セキュリティ改善として位置づけ、リリースノートに明記する
