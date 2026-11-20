# Brief: attachment-search-indexing

> 3-way split の第 2 spec。詳細背景・既存コード調査は [../attachment-search/research.md](../attachment-search/research.md) を参照。

## Problem

`attachment-search-text-extractor` spec で抽出サービスが動作しても、GROWI の既存検索基盤 (Elasticsearch) に抽出結果が流し込まれなければ検索できない。また、添付アップロード・削除に検索インデックスを追従させる仕組み、親ページの権限変更や削除を検索結果に反映する仕組み、管理者向けの一括再インデックス・個別再抽出・失敗可視化の API が必要。

## Current State

- Elasticsearch 連携は [apps/app/src/server/service/search-delegator/elasticsearch.ts](apps/app/src/server/service/search-delegator/elasticsearch.ts) に存在。インデックス対象は Page の `path` / `body` / `comments` のみ ([aggregate-to-index.ts](apps/app/src/server/service/search-delegator/aggregate-to-index.ts))
- `AttachmentService` は `addAttachHandler` / `detachHandler` の拡張ポイントを持つが **fire-and-forget で例外を握りつぶす**。OpenAI Vector Store 連携が同パターンで同居済み
- ページ権限変更は `pageEvent.emit('updateMany'|'syncDescendantsUpdate', ...)` で発火、SearchService が `registerUpdateEvent()` で購読している
- 既存 `rebuildIndex()` は tmp index → alias swap パターン、Socket.io で進捗通知 (`AddPageProgress`, `FinishAddPage`)
- 添付 (Prisma の `prisma.attachments`) はメタデータのみ保持、テキスト本文は持たない
- 添付 API: POST は apiv3 `/attachment`、DELETE は legacy `/_api/attachments.remove`

## Desired Outcome

- 添付専用 Elasticsearch インデックス (ES 8/9 対応 mapping。名前は page index 名から導く) が存在し、1 添付 = N 文書 (ページ/スライド/シート単位) で運用される。権限情報は持たない
- 添付アップロード時に自動で抽出サービスを呼び出し、結果を ES にインデックスする (機能無効時は一切呼び出さない)
- 添付削除は ES に反映される。親ページの削除と権限変更は、添付の文書を書き換えず、検索時に親ページの権限を確かめることで結果に反映される
- 既存添付を一括でインデックス化する admin 操作が提供される (rebuildIndex 拡張)
- 個別添付を再抽出する apiv3 エンドポイントが提供される
- 抽出失敗が MongoDB に記録され admin が参照できる
- 検索が Page index と添付 index の両方を使い、閲覧者に見せてよい添付ヒットだけを、親ページ単位に集約した応答型で返す
- Admin 画面用に設定 API / 失敗ログ API が提供される
- `packages/attachment-text-extractor-client` が orval で自動生成され apps/app から型安全に呼べる

## Approach

既存の `ElasticsearchDelegator` / `SearchService` / `AttachmentService` / `ConfigManager` を**拡張**し、apps/app 内に新規 feature module `features/search-attachments/server/` を配置する。

- **Feature module**: `apps/app/src/features/search-attachments/` 配下に server side 全コードを集約。既存モジュールは最小限の差分のみ
- **ES delegator 拡張**: 独立 delegator を作らず、既存 `ElasticsearchDelegator` の ES client を使う拡張 (`AttachmentSearchDelegatorExtension`) が、添付 index の作成・付け替え・書き込み・削除を受け持つ
- **Indexer 窓口**: `AttachmentSearchIndexer` が attach / detach / reextract の入口。一括再インデックスは `AttachmentReindexBatch` が受け持つ
- **検索時の権限判定 (Option D)**: 添付 ES 文書に権限情報を持たせない。検索時に、親ページを page_index (viewer filter と検索演算子) と MongoDB で確かめ、ページ検索が本文の抜粋を見せるページの添付ヒットだけを返す。権限変更のたびに添付の文書を書き換える必要が無い
- **Client package**: `packages/attachment-text-extractor-client/` を新規追加。orval が `apps/attachment-text-extractor` の OpenAPI spec (commit 済みの `openapi.json`) を入力に TS クライアントを自動生成 (pdf-converter-client と同パターン)
- **Config keys**: `app:attachmentFullTextSearch:extractorUri` / `extractorToken` / `timeoutMs` / `maxFileSizeBytes` の 4 つを [config-definition.ts](apps/app/src/server/service/config-manager/config-definition.ts) に追加。有効・無効は「検索サービスが設定済み AND URI とトークンが設定済み」の算出値で、`enabled` のキーは無い
- **検索クエリ**: ページ検索 (`GET /_api/search`) は機能導入前のまま動く。その結果のページの添付ヒットは、別の API (`GET /_api/v3/search/attachments`) が、ページを判定してから、そのページの添付だけを検索して返す (pageId ごとに上位 5 件)。`facet=attachments` は添付 index を検索してから親ページを判定する。ページと添付の点数を混ぜた順位は作らない
- **時間の上限**: `facet=attachments` は 800ms を超えたら空の結果と `primaryResultIncomplete: true` を返す。`GET /_api/v3/search/attachments` は 500ms を超えたらエラー (500) を返す
- **rebuildIndex 互換**: チェックボックス追加のみで既存挙動を保つ (OFF 時は Page/Comment のみ処理)

## Scope

### In

#### 新規ファイル (feature module)
- `apps/app/src/features/search-attachments/server/` 配下:
  - `services/attachment-text-extractor.ts` (attachment-text-extractor-client wrapper、failure 正規化)
  - `services/attachment-search-indexer.ts` (attach/detach/reextract 単一窓口)
  - `services/attachment-search-delegator-extension.ts` (ESDelegator 拡張)
  - `services/attachment-reindex-batch.ts` (bulk 再インデックス + Socket.io progress)
  - `services/extraction-failure-log-service.ts` (Prisma モデル `extractionfailurelogs` への記録と取得。モデルは `apps/app/prisma/schema.prisma`、index は migrate-mongo の migration で作成)
  - `services/attachment-search-result-aggregator.ts` / `search-accessible-pages.ts` (検索結果の集約と親ページの権限判定)
  - `mappings/attachments-mappings-es{8,9}.ts`
  - `queries/build-attachment-search-query.ts` / `build-attachments-by-page-ids-query.ts` (添付 index の検索 body の builder)
  - `routes/apiv3/attachment-reextract.ts` (`POST /_api/v3/attachments/:id/reextract`)
  - `routes/apiv3/attachment-search-admin.ts` (`GET /failures`, `GET|PUT /config`)
  - `routes/apiv3/search-attachments.ts` (`GET /_api/v3/search/attachments`)
  - `middlewares/require-search-attachments-enabled.ts`
  - `index.ts` (initAttachmentFullTextSearch(crowi) — Crowi 初期化から呼ぶ)
- `apps/app/src/features/search-attachments/interfaces/attachment-search.ts` (DTOs: `IAttachmentHit`, `IAttachmentEsDoc`, `ExtractionFailure` 等)

#### 新規パッケージ
- `packages/attachment-text-extractor-client/` (orval.config.js / openapi.json / 生成物 / package.json)

#### 既存ファイル修正
- [apps/app/src/server/crowi/index.ts](apps/app/src/server/crowi/index.ts): `initAttachmentFullTextSearch(this)` を searchService/attachmentService 初期化後に追加
- [apps/app/src/server/service/search.ts](apps/app/src/server/service/search.ts): facet 付きの検索の入口と集約ロジック。本文の抜粋の表示規則を `search/can-show-snippet.ts` に切り出し、添付検索と共有 (権限変更リスナは足さない)
- [apps/app/src/server/routes/search.ts](apps/app/src/server/routes/search.ts): `GET /_api/search` に optional な `facet` (`attachments`) を追加
- [apps/app/src/server/service/config-manager/config-definition.ts](apps/app/src/server/service/config-manager/config-definition.ts): 新規 Config キー 4 件
- [apps/app/src/interfaces/search.ts](apps/app/src/interfaces/search.ts): `IPageSearchMeta.attachmentHits[]` optional 追加 (検索結果の各項目では `meta.attachmentHits`)
- [apps/app/src/interfaces/activity.ts](apps/app/src/interfaces/activity.ts): 監査ログの action 2 つ (設定の更新、個別再抽出)
- [apps/app/prisma/schema.prisma](apps/app/prisma/schema.prisma) と `apps/app/src/migrations/`: 抽出失敗ログのモデルと index
- [apps/app/src/server/routes/apiv3/search.js](apps/app/src/server/routes/apiv3/search.js): `PUT /search/indices` に `includeAttachments` フラグ受理。添付を含む作り直しは裏で実行して即応答し、完了・失敗は Socket.io で通知

### Out
- 抽出サービス本体 (`apps/attachment-text-extractor`) の実装 — `attachment-search-text-extractor` spec (前段 spec)
- 検索結果 UI / 添付モーダル UI / 管理画面 UI — `attachment-search-ui` spec (後段 spec)
- OpenAPI export script の実装 — `attachment-search-text-extractor` spec
- 添付ファイル自体の保管方式変更 (FileUploader 抽象は据え置き)
- 既存 Page 検索クエリ・ランキング・権限モデル本体の改変
- 永続ジョブキュー化 (fire-and-forget パターンを継続)
- チェックポイント再開型の bulk 再インデックス (best-effort 冪等で運用)

## Boundary Candidates

1. **TS クライアントパッケージ** (`packages/attachment-text-extractor-client/`) — OpenAPI 消費 → orval 生成、server 専用依存として apps/app に渡される
2. **抽出クライアント wrapper** (`attachment-text-extractor.ts`) — 到達不可/エラー正規化層
3. **Indexer 層** (`attachment-search-indexer.ts` + reindex-batch) — ES への書き込み責務
4. **ES 契約層** (`delegator-extension` + `mappings/*` + `queries/*`) — Elasticsearch との接続責務
5. **永続化層** (Prisma モデル `extractionfailurelogs` + `services/extraction-failure-log-service.ts`)
6. **API 層** (`routes/apiv3/*`) — HTTP エンドポイント
7. **SearchService extension** — ページと添付の検索の集約、親ページの権限判定、fallback
8. **Config + Crowi wiring** — 有効化ゲートと初期化

## Out of Boundary

- 添付専用の delegator を作ること (既存 delegator 拡張で対応)
- 独立した job queue 基盤 (既存 fire-and-forget パターンを維持)
- 独立した admin ページ (既存 ElasticsearchManagement に attach する、画面自体は `attachment-search-ui` spec)
- `IPageWithSearchMeta` の破壊的変更 (optional フィールド追加のみ)

## Upstream / Downstream

### Upstream (依存先)
- `attachment-search-text-extractor` spec: OpenAPI spec と Docker image
- 既存 `ElasticsearchDelegator` / `SearchService` / `AttachmentService` / `FileUploader` / `ConfigManager` / `pageEvent`
- 既存 Socket.io progress チャネル (`AddPageProgress` 等) — 同パターンで `AddAttachmentProgress` を追加
- 既存 `apps/pdf-converter` + `packages/pdf-converter-client` (orval パターンの参考)

### Downstream (影響先)
- `attachment-search-ui` spec: 本 spec の API 応答型 (各項目の `meta.attachmentHits[]`) と apiv3 エンドポイント契約を消費
- GROWI.cloud 運用 (新 ES インデックス、新 Config キー、admin API)
- 既存 Page 検索の応答型 (後方互換を保つ optional 拡張のみ)

## Existing Spec Touchpoints

- **Extends**:
  - (暗黙) 既存検索 / 添付サブシステム。spec 化されていないが apps/app 内の SearchService / AttachmentService / ElasticsearchDelegator を拡張
- **Adjacent**:
  - `attachment-search-text-extractor` (上流 API 提供元)
  - `attachment-search-ui` (下流 UI 消費者)
  - `suggest-path` (既存 spec、検索体験で隣接するが責務は重ならない)

## Constraints

- **ライセンス**: MIT / Apache-2.0 / BSD 系のみ (orval は MIT)
- **対応 OS**: apps/app は Windows/macOS/Linux 全対応を維持 (attachment-text-extractor-client は純 TS で cross-platform)
- **ES バージョン**: 既存のサポート範囲 (8/9) に従う (各 mapping 変種を `attachments-mappings-esN.ts` に分離)
- **非互換ゼロ**: 機能無効時は既存検索 API のレイテンシ・結果順序・応答形式を機能導入前と同一にする (R14.1)
- **マルチテナント**: 共有 ES クラスタの ingest ノード上では抽出処理を実行しない (apps/app 側で完結)。抽出サービスの同時実行上限で他テナント影響を抑える
- **ハンドラの fire-and-forget 特性**: 例外は pino ログと FailureLog 永続化で確実に捕捉する (UI に通知する経路は別 spec の admin UI が担当)
- **API 後方互換**: `meta.attachmentHits` は optional に限定、既存クライアントが破壊的変更を受けないこと
- **OpenAPI drift 検知**: CI で `apps/attachment-text-extractor` が route 定義から生成する OpenAPI spec と `packages/attachment-text-extractor-client/openapi.json` の差分を検知し、古いクライアントでのビルドを防ぐ
- **rebuildIndex 中断時の方針**: best-effort 冪等バッチ (alias swap 未実行で旧 index 維持、admin の再実行で最初からやり直し)。抽出サービスや保存先の障害を疑う失敗が続いた場合も、同じく旧 index を残して止める。チェックポイント再開は初期実装では採用しない
