# Brief: attachment-search-ui

> 3-way split の第 3 spec。詳細背景・既存コード調査は [../full-text-search-for-attachments/research.md](../full-text-search-for-attachments/research.md) を参照。

## Problem

`attachment-search-indexing` spec により添付が ES にインデックスされ `IPageWithSearchMeta.attachmentHits[]` が API から返るようになっても、ユーザと管理者にその情報が**見える形**で提供されなければ機能として完結しない。検索結果画面の統合 (左ペイン集約 / 右ペイン添付ヒットカード / ファセット)、添付ファイル一覧モーダルの個別再抽出ボタン、管理画面 (有効化設定 / 一括再インデックス操作 / 失敗可視化) の 3 領域の UI が必要。

## Current State

- 検索結果 UI: [SearchResultList.tsx](apps/app/src/features/search/client/components/SearchPage/SearchResultList.tsx) (左ペイン) / [SearchResultContent.tsx](apps/app/src/features/search/client/components/SearchPage/SearchResultContent.tsx) (右ペイン) / [SearchPage.tsx](apps/app/src/features/search/client/components/SearchPage/SearchPage.tsx)
- 応答型: [apps/app/src/interfaces/search.ts](apps/app/src/interfaces/search.ts) の `IPageWithSearchMeta` に `attachmentHits?[]` が optional で追加される (前段 spec で)
- 添付ファイル一覧モーダル: [PageAttachment.tsx](apps/app/src/client/components/PageAccessoriesModal/PageAttachment.tsx) (SWR+Jotai) → [PageAttachmentList.tsx](apps/app/src/client/components/PageAttachment/PageAttachmentList.tsx) → `@growi/ui` の Attachment コンポーネントに行 prop を渡す構成
- Admin UI: [ElasticsearchManagement.tsx](apps/app/src/client/components/Admin/ElasticsearchManagement/ElasticsearchManagement.tsx) に Rebuild / Normalize / Reconnect ボタン + Socket.io 進捗
- 状態管理: 検索は SWR + Jotai、admin は SWR で Config 同期、モーダルは Jotai atom

## Desired Outcome

- **検索結果リスト (左ペイン)**: 各 Page カード内に「この添付にもマッチ」サブエントリが折りたたみ表示され、添付名 / ファイル形式アイコン / `label` (p.N や Slide N) / マッチスニペットを含む。本文ヒットなし + 添付のみヒットのページも Page カードとして表示される
- **検索結果プレビュー (右ペイン)**: 添付ヒット持ちページ選択時にプレビュー最上部に「添付ヒットカード」が表示され、添付本体リンクで既存添付ビューアへ遷移できる
- **ファセットタブ**: 「全体 / ページ / 添付ファイル」の 3 つが切り替え可能。デフォルト「全体」。機能無効時はタブ自体が非表示
- **添付ファイル一覧モーダル**: 各添付行に「再抽出」ボタンが表示 (機能有効時のみ)、クリックで apiv3 呼び出し → 結果 toast
- **Admin (設定セクション)**: 有効化トグル、抽出サービス URL、最大サイズ、タイムアウト、同時実行上限を設定可能。初回有効化時の一括再インデックスガイダンス
- **Admin (rebuildIndex)**: 既存 rebuild ボタンに「添付も対象にする」チェックボックス (デフォルト ON)、Socket.io の `AddAttachmentProgress` で進捗表示
- **Admin (失敗可視化)**: 直近抽出失敗件数と失敗サンプル (数件) の一覧パネル

## Approach

既存の検索 UI / 添付モーダル / admin 画面を**拡張**し、新規コンポーネントは `apps/app/src/features/search-attachments/client/` 配下に集約する。

- **Feature module 配置**: client 側も前段 spec と同じ feature module 配下に置き、サーバ/クライアントのファイル境界は既存規約 (SSR 到達性) に従う
- **既存 UI コンポーネントへの差分は最小**: SearchResultList / SearchResultContent / PageAttachmentList / ElasticsearchManagement は optional フィールド/prop の追加のみで破壊しない
- **共有 Props 型**: 添付ヒット表示コンポーネント (`AttachmentHitCard` / `AttachmentSubEntry`) は共通の `AttachmentHitViewProps` base 型を拡張
- **SWR hooks**: `use-attachment-reextract` (mutation)、`use-attachment-search-config` (admin config)、`use-attachment-extraction-failures` (admin failures) を `client/services/` に配置
- **機能ゲート**: Config `app:attachmentFullTextSearch:enabled` を参照する SWR hook で全ての追加 UI を条件レンダリング
- **サーバ専用依存の隔離**: `packages/markitdown-client` は server 専用依存。UI からは apps/app の apiv3 経由でのみ触る (SSR 到達性に影響しないように)
- **Turbopack 互換**: 重量級依存があれば `dynamic({ ssr: false })` で分離、既存パターンに従う

## Scope

### In

#### 新規ファイル (feature module client)
- `apps/app/src/features/search-attachments/client/components/`:
  - `SearchPage/AttachmentHitCard.tsx` (右ペイン最上部カード)
  - `SearchPage/AttachmentSubEntry.tsx` (左ペイン Page カード内サブエントリ、複数時は折りたたみ)
  - `SearchPage/SearchResultFacetTabs.tsx` (全体/ページ/添付 のタブ、Jotai atom で共有)
  - `PageAttachment/ReextractButton.tsx` (個別再抽出ボタン、feature-gated)
  - `Admin/AttachmentSearchSettings.tsx` (設定フォーム、有効化 + URL/上限/タイムアウト/同時実行、ガイダンス)
  - `Admin/AttachmentExtractionFailures.tsx` (失敗ログテーブル)
  - `Admin/RebuildWithAttachmentsCheckbox.tsx` (既存 rebuild ボタン近傍に配置)
- `apps/app/src/features/search-attachments/client/services/`:
  - `use-attachment-reextract.ts` (SWR mutation)
  - `use-attachment-search-config.ts` (admin config SWR + setter)
  - `use-attachment-extraction-failures.ts` (failures SWR)
  - `use-search-attachments-enabled.ts` (機能ゲート用 SWR hook)

#### 既存ファイル修正 (最小差分)
- [SearchResultList.tsx](apps/app/src/features/search/client/components/SearchPage/SearchResultList.tsx): Page カード内に `AttachmentSubEntry` をレンダリング
- [SearchResultContent.tsx](apps/app/src/features/search/client/components/SearchPage/SearchResultContent.tsx): 添付ヒット持ちページ時に `AttachmentHitCard` をプレビュー最上部にレンダリング
- [SearchPage.tsx](apps/app/src/features/search/client/components/SearchPage/SearchPage.tsx): `SearchResultFacetTabs` 設置、facet 状態を検索 API クエリパラメータに反映
- [PageAttachmentList.tsx](apps/app/src/client/components/PageAttachment/PageAttachmentList.tsx): `Attachment` コンポーネントに `ReextractButton` を追加 (既存 `onAttachmentDeleteClicked` と同パターン)
- [ElasticsearchManagement.tsx](apps/app/src/client/components/Admin/ElasticsearchManagement/ElasticsearchManagement.tsx): `RebuildWithAttachmentsCheckbox` 配置、PUT payload に `includeAttachments` フラグ注入、`AttachmentSearchSettings` / `AttachmentExtractionFailures` セクションへのリンクまたは同居表示、`AddAttachmentProgress` Socket.io listener 追加

### Out
- apiv3 エンドポイント実装 (`POST /attachments/:id/reextract` / `GET /failures` / `GET|PUT /config` / `PUT /search/indices` の includeAttachments) — `attachment-search-indexing` spec
- 応答型 `IPageWithSearchMeta.attachmentHits[]` の定義 — `attachment-search-indexing` spec
- Config キー定義と永続化 — `attachment-search-indexing` spec
- 抽出サービス本体 — `markitdown-extractor` spec
- 添付ビューア本体の変更 (既存ビューアへ遷移するだけ)
- PDF/Office のインラインプレビュー
- 形式別詳細ファセット (PDF だけ / xlsx だけ等)
- 抽出テキストの全文プレビュー表示 (スニペット範囲のみ表示)
- 選択的再インデックス UI (失敗だけ再試行等)
- 抽出失敗の詳細分析ダッシュボード (メトリクス可視化は Out)

## Boundary Candidates

1. **検索結果 UI コンポーネント群** (`SearchPage/AttachmentHitCard.tsx` + `AttachmentSubEntry.tsx` + `SearchResultFacetTabs.tsx`) — ヒット表示とファセット
2. **添付モーダル拡張** (`PageAttachment/ReextractButton.tsx` + `use-attachment-reextract`) — 個別再抽出アクション
3. **Admin 設定 UI** (`Admin/AttachmentSearchSettings.tsx` + `use-attachment-search-config`) — 機能設定
4. **Admin 失敗可視化 UI** (`Admin/AttachmentExtractionFailures.tsx` + `use-attachment-extraction-failures`) — 失敗ログ表示
5. **Admin rebuild 拡張** (`Admin/RebuildWithAttachmentsCheckbox.tsx`) — 既存 rebuild への orthogonal 追加
6. **機能ゲート hook** (`use-search-attachments-enabled.ts`) — UI 全体で feature toggle を共有

## Out of Boundary

- サーバ側 API やデータモデル (前段 spec の責務)
- 抽出サービス本体 (`markitdown-extractor` spec)
- 添付ファイル一覧モーダル自体の構造変更 (行アクション追加のみ)
- 検索結果ページのレイアウト変更 (既存レイアウトを維持して拡張のみ)
- i18n の新規キー追加以外 (既存の translation パイプラインに従う)
- 添付ビューア本体の機能追加

## Upstream / Downstream

### Upstream (依存先)
- `attachment-search-indexing` spec: apiv3 エンドポイント契約と `IPageWithSearchMeta.attachmentHits[]` 応答型
- 既存 SearchPage / SearchResultList / SearchResultContent / PageAttachmentList / ElasticsearchManagement
- 既存 Jotai + SWR パターン
- 既存 i18n ファイルと翻訳ワークフロー
- Turbopack 構成 (SSR 到達性ルール)

### Downstream (影響先)
- エンドユーザの検索体験と管理者の運用体験 (機能の最終成果)
- 既存検索ユーザ向けの応答型 (optional 拡張のため破壊なし)
- 後続の UI enhancement (例: PDF インラインプレビュー、詳細ファセット) の基盤

## Existing Spec Touchpoints

- **Extends**: なし (既存 spec でカバーされていない UI 領域)
- **Adjacent**:
  - `attachment-search-indexing` (上流の API/型 提供元)
  - `suggest-path` (検索 UI の近傍、ただし責務非重複)
  - umbrella `full-text-search-for-attachments` (設計資料)

## Constraints

- **対応ブラウザ/OS**: 既存 GROWI サポート範囲 (Windows/macOS/Linux の主要ブラウザ)
- **ライセンス**: MIT / Apache-2.0 / BSD 系のみ
- **i18n**: 新規文言は既存 i18n パイプラインに従い ja/en 両言語で提供
- **非互換ゼロ**: 機能無効時は SearchPage / PageAttachmentList / ElasticsearchManagement が機能導入前と完全に同じ表示・挙動にする (R14.1)
- **SSR 到達性**: 既存の Pages Router + Turbopack 構成を壊さないこと (重量級依存は必要に応じ `dynamic({ ssr: false })`)
- **SWR cache**: 再抽出成功時は該当添付のキーを mutate して検索結果と整合
- **admin 権限**: 設定・失敗ログ UI は既存 admin 権限チェック (既存 ElasticsearchManagement と同等)
- **依存 API の契約変更**: 上流 spec (`attachment-search-indexing`) が API 契約を変えたら本 spec の UI と hook の回帰テストが必要
