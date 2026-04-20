# Brief: attachment-search-indexing

> 3-way split の第 2 spec。詳細背景・既存コード調査は [../full-text-search-for-attachments/research.md](../full-text-search-for-attachments/research.md) を参照。

## Problem

`markitdown-extractor` spec で抽出サービスが動作しても、GROWI の既存検索基盤 (Elasticsearch) に抽出結果が流し込まれなければ検索できない。また、添付アップロード・削除・親ページ権限変更などのイベントに検索インデックスを追従させる仕組み、管理者向けの一括再インデックス・個別再抽出・失敗可視化の API が必要。

## Current State

- Elasticsearch 連携は [apps/app/src/server/service/search-delegator/elasticsearch.ts](apps/app/src/server/service/search-delegator/elasticsearch.ts) に存在。インデックス対象は Page の `path` / `body` / `comments` のみ ([aggregate-to-index.ts](apps/app/src/server/service/search-delegator/aggregate-to-index.ts))
- `AttachmentService` は `addAttachHandler` / `detachHandler` の拡張ポイントを持つが **fire-and-forget で例外を握りつぶす**。OpenAI Vector Store 連携が同パターンで同居済み
- ページ権限変更は `pageEvent.emit('updateMany'|'syncDescendantsUpdate', ...)` で発火、SearchService が `registerUpdateEvent()` で購読している
- 既存 `rebuildIndex()` は tmp index → alias swap パターン、Socket.io で進捗通知 (`AddPageProgress`, `FinishAddPage`)
- 添付モデル ([attachment.ts](apps/app/src/server/models/attachment.ts)) はメタデータのみ保持、テキスト本文は持たない
- 添付 API: POST は apiv3 `/attachment`、DELETE は legacy `/_api/attachments.remove`

## Desired Outcome

- 添付専用 Elasticsearch インデックス `attachments` (ES 7/8/9 対応 mapping) が存在し、1 添付 = N 文書 (ページ/スライド/シート単位) で運用される
- 添付アップロード時に自動で抽出サービスを呼び出し、結果を ES にインデックスする (機能無効時は一切呼び出さない)
- 添付削除・親ページ削除・親ページ権限変更が ES に反映される
- 既存添付を一括でインデックス化する admin 操作が提供される (rebuildIndex 拡張)
- 個別添付を再抽出する apiv3 エンドポイントが提供される
- 抽出失敗が MongoDB に記録され admin が参照できる
- 検索クエリが Page index と Attachment index を multi-index で評価し、結果を親ページ単位に集約した応答型を返す
- Admin 画面用に設定 API / 失敗ログ API が提供される
- `packages/markitdown-client` が orval で自動生成され apps/app から型安全に呼べる

## Approach

既存の `ElasticsearchDelegator` / `SearchService` / `AttachmentService` / `ConfigManager` を**拡張**し、apps/app 内に新規 feature module `features/search-attachments/server/` を配置する。

- **Feature module**: `apps/app/src/features/search-attachments/` 配下に server side 全コードを集約。既存モジュールは最小限の差分のみ
- **ES delegator 拡張**: 独立 delegator を作らず、既存 `ElasticsearchDelegator` に `syncAttachment*` メソッドと `addAllAttachments()` を composition で追加
- **Indexer 単一窓口**: `AttachmentSearchIndexer.indexAttachment(attachmentId)` が attach/detach/reextract/bulk すべてのエントリポイント (Synthesis で汎化済み)
- **権限スナップショット**: 添付 ES 文書に `grant` / `granted_users` / `granted_groups` をコピーして保持。親ページ変更時に `update_by_query` で partial update
- **Client package**: `packages/markitdown-client/` を新規追加。orval が `services/markitdown-extractor/` の OpenAPI spec を入力に TS クライアントを自動生成 (pdf-converter-client と同パターン)
- **Config keys**: `app:attachmentFullTextSearch:enabled` / `extractorUrl` / `maxFileSizeBytes` / `timeoutMs` / `maxConcurrency` を [config-definition.ts](apps/app/src/server/service/config-manager/config-definition.ts) に追加
- **検索クエリ**: ES `_msearch` で page_index と attachments_index を並列クエリ、app 側で `pageId` 集約。viewer フィルタは既存 `filterPagesByViewer` と同じ権限モデル
- **性能 fallback**: 添付 msearch が設定閾値を超過したら添付ヒットを除外し Page 結果のみ返す safety net
- **rebuildIndex 互換**: チェックボックス追加のみで既存挙動を保つ (OFF 時は Page/Comment のみ処理)

## Scope

### In

#### 新規ファイル (feature module)
- `apps/app/src/features/search-attachments/server/` 配下:
  - `services/attachment-text-extractor.ts` (markitdown-client wrapper、failure 正規化)
  - `services/attachment-search-indexer.ts` (attach/detach/reextract 単一窓口)
  - `services/attachment-search-delegator-extension.ts` (ESDelegator 拡張)
  - `services/attachment-reindex-batch.ts` (bulk 再インデックス + Socket.io progress)
  - `services/attachment-grant-sync.ts` (pageEvent listener)
  - `services/extraction-failure-log-service.ts`
  - `models/extraction-failure-log.ts` (Mongoose schema + TTL index)
  - `mappings/attachments-mappings-es{7,8,9}.ts`
  - `queries/build-attachment-search-query.ts` (msearch body builder)
  - `routes/apiv3/attachment-reextract.ts` (`POST /_api/v3/attachments/:id/reextract`)
  - `routes/apiv3/attachment-search-admin.ts` (`GET /failures`, `GET|PUT /config`)
  - `middlewares/require-search-attachments-enabled.ts`
  - `index.ts` (initAttachmentFullTextSearch(crowi) — Crowi 初期化から呼ぶ)
- `apps/app/src/features/search-attachments/interfaces/attachment-search.ts` (DTOs: `IAttachmentHit`, `IAttachmentEsDoc`, `ExtractionFailure` 等)

#### 新規パッケージ
- `packages/markitdown-client/` (orval.config.js / openapi.json / 生成物 / package.json)

#### 既存ファイル修正
- [apps/app/src/server/crowi/index.ts](apps/app/src/server/crowi/index.ts): `initAttachmentFullTextSearch(this)` を searchService/attachmentService 初期化後に追加
- [apps/app/src/server/service/search.ts](apps/app/src/server/service/search.ts): `registerUpdateEvent()` に権限変更リスナ + multi-index 検索集約ロジック
- [apps/app/src/server/service/search-delegator/elasticsearch.ts](apps/app/src/server/service/search-delegator/elasticsearch.ts): 拡張モジュールとの合成
- [apps/app/src/server/service/config-manager/config-definition.ts](apps/app/src/server/service/config-manager/config-definition.ts): 新規 Config キー 5 件
- [apps/app/src/interfaces/search.ts](apps/app/src/interfaces/search.ts): `IPageWithSearchMeta.attachmentHits[]` optional 追加
- [apps/app/src/server/routes/apiv3/search.js](apps/app/src/server/routes/apiv3/search.js): `PUT /search/indices` に `includeAttachments` フラグ受理

### Out
- Python 抽出サービス本体の実装 — `markitdown-extractor` spec (前段 spec)
- 検索結果 UI / 添付モーダル UI / 管理画面 UI — `attachment-search-ui` spec (後段 spec)
- OpenAPI export script の実装 — `markitdown-extractor` spec
- 添付ファイル自体の保管方式変更 (FileUploader 抽象は据え置き)
- 既存 Page 検索クエリ・ランキング・権限モデル本体の改変
- 永続ジョブキュー化 (fire-and-forget パターンを継続)
- チェックポイント再開型の bulk 再インデックス (best-effort 冪等で運用)

## Boundary Candidates

1. **TS クライアントパッケージ** (`packages/markitdown-client/`) — OpenAPI 消費 → orval 生成、server 専用依存として apps/app に渡される
2. **抽出クライアント wrapper** (`attachment-text-extractor.ts`) — 到達不可/エラー正規化層
3. **Indexer 層** (`attachment-search-indexer.ts` + grant-sync + reindex-batch) — ES への書き込み責務
4. **ES 契約層** (`delegator-extension` + `mappings/*` + `queries/build-attachment-search-query.ts`) — Elasticsearch との接続責務
5. **永続化層** (`models/extraction-failure-log.ts` + `services/extraction-failure-log-service.ts`)
6. **API 層** (`routes/apiv3/*`) — HTTP エンドポイント
7. **SearchService extension** — 検索クエリの multi-index 集約と fallback
8. **Config + Crowi wiring** — 有効化ゲートと初期化

## Out of Boundary

- 添付専用の delegator を作ること (既存 delegator 拡張で対応)
- 独立した job queue 基盤 (既存 fire-and-forget パターンを維持)
- 独立した admin ページ (既存 ElasticsearchManagement に attach する、画面自体は `attachment-search-ui` spec)
- `IPageWithSearchMeta` の破壊的変更 (optional フィールド追加のみ)

## Upstream / Downstream

### Upstream (依存先)
- `markitdown-extractor` spec: OpenAPI spec と Docker image
- 既存 `ElasticsearchDelegator` / `SearchService` / `AttachmentService` / `FileUploader` / `ConfigManager` / `pageEvent`
- 既存 Socket.io progress チャネル (`AddPageProgress` 等) — 同パターンで `AddAttachmentProgress` を追加
- 既存 `apps/pdf-converter` + `packages/pdf-converter-client` (orval パターンの参考)

### Downstream (影響先)
- `attachment-search-ui` spec: 本 spec の API 応答型 (`IPageWithSearchMeta.attachmentHits[]`) と apiv3 エンドポイント契約を消費
- GROWI.cloud 運用 (新 ES インデックス、新 Config キー、admin API)
- 既存 Page 検索の応答型 (後方互換を保つ optional 拡張のみ)

## Existing Spec Touchpoints

- **Extends**:
  - (暗黙) 既存検索 / 添付サブシステム。spec 化されていないが apps/app 内の SearchService / AttachmentService / ElasticsearchDelegator を拡張
- **Adjacent**:
  - `markitdown-extractor` (上流 API 提供元)
  - `attachment-search-ui` (下流 UI 消費者)
  - `suggest-path` (既存 spec、検索体験で隣接するが責務は重ならない)

## Constraints

- **ライセンス**: MIT / Apache-2.0 / BSD 系のみ (orval は MIT)
- **対応 OS**: apps/app は Windows/macOS/Linux 全対応を維持 (markitdown-client は純 TS で cross-platform)
- **ES バージョン**: 既存 7/8/9 を維持 (各 mapping 変種を `attachments-mappings-esN.ts` に分離)
- **非互換ゼロ**: 機能無効時は既存検索 API のレイテンシ・結果順序・応答形式を機能導入前と同一にする (R14.1)
- **マルチテナント**: 共有 ES クラスタの ingest ノード上では抽出処理を実行しない (apps/app 側で完結)。抽出サービスの同時実行上限で他テナント影響を抑える
- **ハンドラの fire-and-forget 特性**: 例外は pino ログと FailureLog 永続化で確実に捕捉する (UI に通知する経路は別 spec の admin UI が担当)
- **API 後方互換**: `IPageWithSearchMeta.attachmentHits` は optional に限定、既存クライアントが破壊的変更を受けないこと
- **OpenAPI drift 検知**: CI で `services/markitdown-extractor/` の OpenAPI spec と `packages/markitdown-client/openapi.json` の差分を検知し、古いクライアントでのビルドを防ぐ
- **rebuildIndex 中断時の方針**: best-effort 冪等バッチ (alias swap 未実行で旧 index 維持、admin の再実行で最初からやり直し)。チェックポイント再開は初期実装では採用しない
