# Research: attachment-search-ui

_Generated: 2026-04-17 (3-way split から派生)_

umbrella spec `full-text-search-for-attachments` の research.md / design.md から、本 spec (UI 層) の設計判断に直接関わる調査のみを抽出・再整理する。サーバ側や抽出サービス側の調査は対象外とする。

## 1. 既存 UI 拡張ポイントの特定経緯

### 1.1 検索結果 UI (Requirement 1, 2, 3)

調査対象コンポーネント:

- [apps/app/src/features/search/client/components/SearchPage/SearchPage.tsx](apps/app/src/features/search/client/components/SearchPage/SearchPage.tsx) — 検索ページ全体
- [apps/app/src/features/search/client/components/SearchPage/SearchResultList.tsx](apps/app/src/features/search/client/components/SearchPage/SearchResultList.tsx) — 左ペイン (ページリスト)
- [apps/app/src/features/search/client/components/SearchPage/SearchResultContent.tsx](apps/app/src/features/search/client/components/SearchPage/SearchResultContent.tsx) — 右ペイン (選択ページプレビュー)
- [apps/app/src/interfaces/search.ts](apps/app/src/interfaces/search.ts) — 応答型 `ISearchResult<T>` / `IFormattedSearchResult` / `IPageWithSearchMeta`

### 既存構造

- `SearchResultList` は `IPageWithSearchMeta[]` を受け取り、各 Page をカードとして render する。ヒット情報は `elasticSearchResult.snippet` などに格納される
- `SearchResultContent` は「選択中の Page」を表示。選択状態は親 `SearchPage` が state で保持
- `IPageWithSearchMeta` は既に extensible な形で、新規フィールドを optional として追加しやすい

### 本 spec の拡張方針

- `IPageWithSearchMeta.attachmentHits?: IAttachmentHit[]` を上流 spec が追加する前提で、UI 側は **optional フィールド処理**を追加するだけで破壊なし
- `SearchResultList` の Page カード render 箇所に `AttachmentSubEntry` を conditional render
- `SearchResultContent` のプレビュー最上部に `AttachmentHitCard` を conditional render
- `SearchPage` のヘッダ近傍に `SearchResultFacetTabs` を新設し、`activeFacet` を検索 API のクエリパラメータに注入

ファセットタブは**既存 facet 機構が存在しない**ため新規実装する。

## 2. 添付ファイル一覧モーダルの拡張ポイント (Requirement 4)

umbrella research.md の Design Phase Discovery セクション A より抽出:

- 親: [apps/app/src/client/components/PageAccessoriesModal/PageAttachment.tsx](apps/app/src/client/components/PageAccessoriesModal/PageAttachment.tsx) — SWR + Jotai のパターン
- リスト: [apps/app/src/client/components/PageAttachment/PageAttachmentList.tsx](apps/app/src/client/components/PageAttachment/PageAttachmentList.tsx) — `@growi/ui` の `Attachment` コンポーネントに行 prop (`onAttachmentDeleteClicked` など) を渡す
- 削除モーダル: [apps/app/src/client/components/PageAttachment/DeleteAttachmentModal.tsx](apps/app/src/client/components/PageAttachment/DeleteAttachmentModal.tsx) — Jotai atom (`useDeleteAttachmentModalStatus` / `useDeleteAttachmentModalActions`)
- データフェッチ: `useSWRxAttachments()` → `/attachment/list`

### 本 spec の拡張方針

- `PageAttachmentList` 経由で `Attachment` に **新規 prop (例: `reextractButtonSlot` または `onReextractClicked`)** を渡し、個別行で「再抽出」ボタンをレンダリング
- 操作状態は SWR の `mutate` で楽観更新 (成功時に対応する attachment list key を invalidate)
- 既存の `onAttachmentDeleteClicked` と**同パターン**で実装し、行アクション全体の見た目・挙動を揃える
- 機能無効時は `ReextractButton` 自体が `null` を返すため、`PageAttachmentList` 側の差分は prop 追加のみ

### 制約

- `@growi/ui` の `Attachment` コンポーネントの行アクション props がどこまで拡張可能かは実装時に確認する (本 spec は prop 追加で成立すると想定)
- 行アクション追加以外のモーダル全体の構造変更は **Out of scope** (brief.md の Out of Boundary)

## 3. 管理画面の拡張方針 (Requirement 5, 6, 7)

umbrella research.md の 1.4 より抽出:

- [apps/app/src/client/components/Admin/ElasticsearchManagement/ElasticsearchManagement.tsx](apps/app/src/client/components/Admin/ElasticsearchManagement/ElasticsearchManagement.tsx) — ES 管理画面
- 機能: Reconnect / Normalize / Rebuild ボタン、Socket.io で進捗表示 (`AddPageProgress` / `FinishAddPage` / `RebuildingFailed`)
- ConfigManager で設定永続化 (DB `Config` model)

### 専用 admin ページを作らない判断の根拠

3 つの代替案を検討した:

1. **新規 admin ページを作る**: 情報の独立性は高いが、管理者動線が増え「ES 再インデックス画面と別に添付設定画面を開く」二重操作が発生。rebuildIndex と「添付も対象にする」の相関が見えづらい
2. **既存 `ElasticsearchManagement` にセクション追加**: 関連機能が一画面に集約され、rebuild チェックボックスとの相関が自然。既存 Socket.io 進捗 UI にもそのまま相乗り可能
3. **Config 画面 (General Settings 等) に統合**: 設定トグルは馴染むが、rebuildIndex と失敗ログは検索インフラ関連なのでミスマッチ

**採用: 案 2**。`ElasticsearchManagement` への拡張であれば、rebuild チェックボックス、設定セクション、失敗ログパネルが一画面で揃い、Socket.io 進捗受信の listener も同一コンポーネント内で完結する。

### 拡張ポイント

- Rebuild ボタン近傍に `RebuildWithAttachmentsCheckbox` (デフォルト ON、機能無効時は非表示)
- 新規セクション `AttachmentSearchSettings` (有効化トグル / URL / サイズ / タイムアウト / 同時実行) + 有効化ガイダンス
- 新規セクション `AttachmentExtractionFailures` (失敗ログテーブル、機能無効時は非表示)
- Socket.io listener に `AddAttachmentProgress` / `FinishAddAttachment` を追加

### Config キー (上流 spec 定義を消費)

umbrella research.md の Design Phase Discovery C より:

- `app:attachmentFullTextSearch:enabled` (bool)
- `app:attachmentFullTextSearch:extractorUrl` (string)
- `app:attachmentFullTextSearch:maxFileSizeBytes` (number)
- `app:attachmentFullTextSearch:timeoutMs` (number)
- `app:attachmentFullTextSearch:maxConcurrency` (number)

これらは上流 spec が定義・永続化し、本 spec は `use-attachment-search-config` hook 経由で**読み書きするだけ**。

## 4. ファセットタブの設計判断

### 既存 facet 機構の有無

調査結果: GROWI 既存の検索 UI に **facet UI は存在しない**。新規タブコンポーネントとして追加する必要がある。

### 3 択 vs より細かい分類

umbrella 要件 R7 は「全体 / ページ / 添付ファイル」の 3 択を指定。より細かいファセット (PDF だけ / xlsx だけ / ページ番号範囲 等) は **Out of scope** (brief.md の Out)。

### state 管理の選択肢

1. **URL クエリパラメータ**: ブックマーク可能だが SSR との整合・遷移時の state 保持ロジックが増える
2. **React local state**: シンプルだが `SearchPage` から子コンポーネントへの prop drilling が発生
3. **Jotai atom**: 既存パターンに合致、`SearchResultFacetTabs` と `SearchPage` の両方から参照可能

**採用: Jotai atom** (`activeFacetAtom`, default `'all'`)。将来 URL 同期が必要になったら atom のミドルウェアで対応可能。

## 5. 添付ヒットカード UI パターン (他 wiki 検索との比較)

GROWI 既存の検索結果には「Page カードの中にサブ情報を展開して表示」するパターンがある (本文 snippet の highlight 等)。添付ヒットの表示方針は以下の 2 案を検討した:

1. **Page カードとは別の行として添付ヒットを表示**: Confluence の添付検索結果に近い。ただし Page 中心のナビゲーションが崩れ、「どのページに属するか」の視認性が落ちる
2. **Page カード内にサブエントリ (折りたたみ) として表示 + 右ペイン最上部にヒットカード**: Notion の検索結果サブエントリに近い。Page 中心のナビゲーションを維持でき、マッチ箇所への遷移が 2 段 (ページ選択 → 添付本体) になるが各段階で情報が豊富

**採用: 案 2** (umbrella 要件 R5, R6 の指定と一致)。Page 中心のナビゲーションを維持しつつ、右ペインに強調表示を配置することで「本文ヒットの補助情報」としての添付ヒットを自然に表現できる。

### 複数ヒット時の UI

- 左ペインサブエントリ: 最上位 (関連度トップ) 1 件を展開、残りは折りたたみアコーディオン
- 右ペインヒットカード: 最上位 1 件をカードとして展開、残りは折りたたみでカード切替

umbrella 要件 R5.4 / R6.4 に準拠。

## 6. SSR 到達性と Turbopack 互換性

umbrella design.md の UI Components 節より抽出:

- 添付系 UI は全て既存 SearchPage と同経路 (SSR 経由) のため、Turbopack 外部化の対象になる可能性あり
- `orval` 生成クライアント (`packages/markitdown-client`) は **server 専用依存**。UI からは apiv3 経由でのみ触る
- 重量級依存 (特に admin failures のテーブルライブラリ等) は `dynamic({ ssr: false })` で分離

### 本 spec の適用方針

- `packages/markitdown-client` は UI から一切 import しない (静的解析で検知できるよう、feature module 内にガードを設置)
- 新規コンポーネントは純粋な React + SWR + Jotai で構成し、Node 固有 API を避ける
- 失敗ログテーブルが大きいライブラリを使う場合は動的 import を採用

## 7. 上流契約への依存関係

上流 `attachment-search-indexing` spec が確定すべき項目 (本 spec の Revalidation Trigger):

| 上流契約 | 本 spec の消費箇所 |
|----------|------------------|
| `IPageWithSearchMeta.attachmentHits[]` の形状 | `AttachmentSubEntry`, `AttachmentHitCard` |
| `POST /_api/v3/attachments/:id/reextract` の req/res | `use-attachment-reextract` |
| `GET|PUT /_api/v3/admin/attachment-search/config` | `use-attachment-search-config` |
| `GET /_api/v3/admin/attachment-search/failures` | `use-attachment-extraction-failures` |
| `PUT /_api/v3/search/indices` の `includeAttachments` 受理 | `RebuildWithAttachmentsCheckbox` + `ElasticsearchManagement` |
| Config キー `app:attachmentFullTextSearch:*` | admin 設定フォーム |
| Socket.io `AddAttachmentProgress` / `FinishAddAttachment` payload | `ElasticsearchManagement` listener |
| 機能有効フラグを非 admin から参照する経路 (Open Question 1) | `use-search-attachments-enabled` |

これらのいずれかが上流で変更された場合、本 spec のコンポーネント・hook の回帰テストが必要になる。

## 8. Open Questions (上流と調整が必要)

1. 非 admin ユーザが機能有効/無効を参照する経路 (admin config API は 403 になるため、公開フラグまたは検索応答メタに `featureEnabled` を含める選択が必要)
2. Socket.io `AddAttachmentProgress` の payload 形状 (既存 `AddPageProgress` と同形か否か)
3. `@growi/ui` の `Attachment` コンポーネントの行アクション props 拡張可能性 (prop 追加で済むか、内部改修が必要か)
4. ファイル形式アイコンの辞書 (MIME → アイコン) が既存 util で足りるか新規追加が必要か

## Conclusion

本 spec は**既存 UI の最小差分拡張 + 新規 feature module client 配下への集約**で成立する。サーバ側実装は一切持たず、上流 `attachment-search-indexing` spec が提供する API・応答型・Socket.io イベントを消費するだけ。拡張ポイントはすべて既存コンポーネントに存在し、optional prop / conditional render の追加で破壊的変更なし。ファセットタブのみ新規追加 (既存 facet 機構なし)。機能無効時は全追加 UI が `null` を返すことで、既存画面の挙動は導入前と完全一致する。
