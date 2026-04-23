# Gap Analysis: attachment-search

_Generated: 2026-04-17_

## Analysis Scope

要件 R1〜R14 を既存コードベースと照合し、拡張ポイント・新規作成対象・研究項目を整理する。

## 1. Current State Investigation

### 1.1 検索サブシステム (R3, R5–R8, R10, R14)

#### 既存資産
- [apps/app/src/server/service/search.ts](apps/app/src/server/service/search.ts) — `SearchService` 本体。ES/named-query 委譲、イベント登録 (`registerUpdateEvent()`)、検索パイプライン
- [apps/app/src/server/service/search-delegator/elasticsearch.ts](apps/app/src/server/service/search-delegator/elasticsearch.ts) — `ElasticsearchDelegator`。ES 7/8/9 の互換レイヤ、bulkWrite ベースの同期、`filterPagesByViewer()` による権限フィルタリング、`rebuildIndex()` (tmp index → alias swap)
- [mappings-es9.ts](apps/app/src/server/service/search-delegator/mappings/mappings-es9.ts) — Page ドキュメントの mapping 定義。`path` / `body` / `comments` / `grant` / `granted_users` / `granted_groups` / `created_at` 等
- [aggregate-to-index.ts](apps/app/src/server/service/search-delegator/aggregate-to-index.ts) — MongoDB aggregation パイプラインで Page + Revision + Comment + Bookmark + Tag を join して ES に供給
- API: `PUT /api/v3/search/indices` (operation=rebuild/normalize)、`GET /api/v3/search/indices`
- Socket.io イベント: `AddPageProgress`, `FinishAddPage`, `RebuildingFailed` (rebuild 進捗通知)

#### 主要メソッドシグネチャ
- `syncPageUpdated(page, user)` → `updateOrInsertPageById()`
- `syncPageDeleted(page, user)` → `deletePages()`
- `syncCommentChanged(comment)` → `updateOrInsertPageById(comment.page)`
- `addAllPages()` — ストリーミング再インデックス、progress 通知
- `prepareBodyForCreate(doc)` — ページを ES ドキュメントに変換 (新規作成系列)

#### 権限モデル
ES 側は `grant` (enum) / `granted_users` (keyword array) / `granted_groups` (keyword array) をフィールドに持ち、クエリ実行時に `filterPagesByViewer()` が bool query の should clause に変換して可視性を制御している。

### 1.2 添付サブシステム (R3, R4, R11)

#### 既存資産
- [apps/app/src/server/models/attachment.ts](apps/app/src/server/models/attachment.ts) — Schema: `page`, `creator`, `fileName` (unique/hashed), `fileFormat` (MIME), `fileSize`, `originalName`, `attachmentType`
- [apps/app/src/server/service/attachment.ts](apps/app/src/server/service/attachment.ts) — `AttachmentService`。以下が重要な**既存の拡張ポイント**:
  ```typescript
  type AttachHandler = (pageId: string | null, attachment: IAttachmentDocument, file: Express.Multer.File) => Promise<void>;
  type DetachHandler = (attachmentId: string) => Promise<void>;
  addAttachHandler(h: AttachHandler): void;
  addDetachHandler(h: DetachHandler): void;
  ```
- ハンドラ実行特性: `createAttachment()` / `removeAttachment()` が**バックグラウンド (非同期・fire-and-forget)** でハンドラを実行し、例外は catch して握りつぶす。OpenAI Vector Store 連携が既に同パターンで使われている ([features/openai/server/services/openai.ts](apps/app/src/features/openai/server/services/openai.ts))
- [apps/app/src/server/service/file-uploader/](apps/app/src/server/service/file-uploader/) — `AbstractFileUploader` 抽象と各実装 (S3/GCS/Azure/Local/None)

#### 制約
- ハンドラが握りつぶす仕様のため、抽出失敗の可視化 (R12) は別途ログ記録を抽出側で行う必要あり
- 親ページの権限変更時に添付ハンドラは発火しない → **新規イベント購読ポイントが必要**

### 1.3 検索結果 UI (R5, R6, R7)

#### 既存資産
- [apps/app/src/features/search/client/components/SearchPage/SearchPage.tsx](apps/app/src/features/search/client/components/SearchPage/SearchPage.tsx) — 検索ページ全体
- [SearchResultList.tsx](apps/app/src/features/search/client/components/SearchPage/SearchResultList.tsx) — 左ペイン (ページリスト)
- [SearchResultContent.tsx](apps/app/src/features/search/client/components/SearchPage/SearchResultContent.tsx) — 右ペイン (選択ページのプレビュー)
- [apps/app/src/interfaces/search.ts](apps/app/src/interfaces/search.ts) — 応答型: `ISearchResult<T>` / `IFormattedSearchResult` / `IPageWithSearchMeta` (`elasticSearchResult.snippet`, highlight)

#### 拡張ポイント
- `IPageWithSearchMeta` に `attachmentHits?: { attachmentId, fileName, fileFormat, label, snippet, pageNumber }[]` を追加 (非破壊拡張)
- `SearchResultList` で Page カード内に添付サブエントリを展開/折りたたみ表示
- `SearchResultContent` で添付ヒット存在時にプレビュー最上部に `AttachmentHitCard` を追加
- ファセット UI (全体 / ページ / 添付) は新規タブコンポーネント

### 1.4 管理画面 (R9, R10, R12)

#### 既存資産
- [ElasticsearchManagement.tsx](apps/app/src/client/components/Admin/ElasticsearchManagement/ElasticsearchManagement.tsx) — ES 管理画面。Reconnect / Normalize / Rebuild ボタン、Socket.io で進捗表示
- ConfigManager (`config-manager.ts`) で設定永続化 (DB `Config` model)

#### 拡張ポイント
- Rebuild ボタン近傍に「添付も対象にする」チェックボックス追加 (R10)
- 新規 admin セクション: 有効化トグル / 抽出サービス URL / 最大サイズ / タイムアウト / 同時実行上限 (R9)
- 抽出失敗ログパネル (R12)
- 新規 Config キー: `search:attachments:enabled`, `search:attachments:extractorUrl`, `search:attachments:maxFileSize`, `search:attachments:timeoutMs`, `search:attachments:maxConcurrency`

### 1.5 マイクロサービスパターン参考 ([apps/pdf-converter](apps/pdf-converter/))

- フレームワーク: Ts.ED + Express + Swagger (Node.js)
- [Dockerfile](apps/pdf-converter/docker/Dockerfile) — Node.js Alpine、health check endpoint
- [packages/pdf-converter-client/](packages/pdf-converter-client/) — axios ベース自動生成クライアント
- [orval.config.js](packages/pdf-converter-client/orval.config.js) — OpenAPI spec → TS client 自動生成 (orval)
- apps/app から axios クライアント経由で呼び出し

#### 本機能への転用
- **言語差異**: pdf-converter は Node.js、markitdown-extractor は **Python** 予定。Ts.ED は使わず **FastAPI + Uvicorn** とする
- **OpenAPI 自動生成は転用可**: FastAPI の OpenAPI スキーマを orval で取り込み `packages/markitdown-client` を生成
- **HTTP 契約**: pdf-converter は JSON 応答、本機能は入力が multipart/form-data (ファイルバイト)、出力は JSON (`{ pages: [{ pageNumber, content, label }] }`)
- **FUSE は採用しない**: 短命リクエストのため pdf-converter とはデプロイ形態が異なる

### 1.6 Crowi 初期化 (R3, R4, R9)

- [apps/app/src/server/crowi/index.ts](apps/app/src/server/crowi/index.ts) — Crowi クラスが `searchService`, `attachmentService`, `events` (page, bookmark, tag) を保持
- 初期化順: `searchService` → `attachmentService`
- **拡張点**: Crowi コンストラクタで `attachmentService.addAttachHandler()` / `addDetachHandler()` を登録、page event を購読して権限変更ハンドラを登録

## 2. Requirements Feasibility Analysis

### Requirement → Asset Map (gap tag)

| Req | 既存資産 | 新規作成 | Gap タグ |
|---|---|---|---|
| R1 抽出 API | — | `services/markitdown-extractor` / `packages/markitdown-client` | Missing |
| R2 リソース保護 | — | 抽出サービス側で FastAPI middleware / semaphore | Missing |
| R3 自動インデックス化 | `addAttachHandler` | ES attachment index / attach→抽出→index ハンドラ | Extension + Missing |
| R4 削除・権限追従 | `addDetachHandler`, Page 削除イベント | **権限変更イベント購読**、attachment 削除ハンドラ | Extension + Missing |
| R5 左ペイン集約 | `SearchResultList`, `IPageWithSearchMeta` | attachmentHits 表示ロジック / サブエントリ UI | Extension |
| R6 右ペイン添付カード | `SearchResultContent` | `AttachmentHitCard` コンポーネント | Missing |
| R7 ファセット | — | ファセットタブ UI + クエリ side filter | Missing |
| R8 権限制御 | `filterPagesByViewer` | 添付インデックス側の同等フィルタ | Extension |
| R9 機能トグル | ConfigManager / `ElasticsearchManagement` | 新規 Config キー / admin セクション | Extension + Missing |
| R10 一括再インデックス | `addAllPages`, `rebuildIndex`, Socket.io progress | `addAllAttachments()` + チェックボックス UI | Extension |
| R11 個別再抽出 | 添付一覧モーダル | 「再抽出」ボタン + API `POST /attachments/:id/reextract` | Extension + Missing |
| R12 失敗可視化 | — | 失敗ログ model / 集計 API / admin パネル | Missing |
| R13 デプロイ | pdf-converter Dockerfile/compose パターン | markitdown-extractor Dockerfile + compose 追記 + k8s manifest | Extension (pattern) + Missing |
| R14 互換性・隔離 | 機能無効時のフェールセーフ | 機能フラグによる条件分岐 | Constraint |

### Complexity 信号
- **アルゴリズム的ロジック**: 抽出結果を pages[] に分割し 1 添付 = N 文書としてインデックス化する構造 (PDF/PPTX/XLSX)
- **外部統合**: Python FastAPI サービスとの HTTP 統合、OpenAPI → TS client 生成パイプライン
- **ワークフロー**: アップロード → 抽出 → インデックス / 削除 → インデックス削除 / 権限変更 → 権限更新
- **CRUD**: admin 設定・失敗ログ
- **非機能**: マルチテナント隔離 (共有 ES に負荷を寄せない)、機能無効時の完全互換、DoS 対策

## 3. Implementation Approach Options

### Option A: 既存 Page インデックスに添付テキストを統合 (shape β 寄り)

添付テキストを親ページの ES 文書の `attachment_body` フィールドに追記、または Page と同じインデックスに添付専用ドキュメントを混在させる。

- **対象ファイル**:
  - [elasticsearch.ts](apps/app/src/server/service/search-delegator/elasticsearch.ts) — `prepareBodyForCreate` 拡張 / mapping 拡張
  - [aggregate-to-index.ts](apps/app/src/server/service/search-delegator/aggregate-to-index.ts) — attachment join
  - [SearchResultContent.tsx](apps/app/src/features/search/client/components/SearchPage/SearchResultContent.tsx) — ヒット種別分岐最小
- **Trade-offs**:
  - ✅ クエリ実装が簡潔 (単一インデックス)、コード変更範囲が狭い
  - ❌ **要件 R1 の位置情報 (1添付 = N 文書) と噛み合わない** (Page 単位に畳み込む必要が出て label 情報が劣化)
  - ❌ 添付専用の再インデックス (R10, R11) が難しく、Page 再インデックスに巻き込まれる
  - ❌ ファセット (R7 添付だけ表示) の実装が重くなる
- **適合度**: **低**。位置情報保持と個別再抽出の要件を満たしにくい

### Option B: 完全分離した添付専用インデックス + 独立した検索パス

添付用の別 ES インデックス、専用の delegator サービス、独立したクエリパス、独立した UI ツリー。

- **対象ファイル**:
  - 新規 delegator / 新規 search query パイプライン / 新規 UI コンポーネントツリー
- **Trade-offs**:
  - ✅ 完全な責務分離、添付だけの運用が容易
  - ❌ 既存 SearchService / SearchResultContent との統合コストが高い
  - ❌ Page 集約表示 (R5 左ペイン) で Page クエリと Attachment クエリを結合する必要があり、複雑化
  - ❌ UI が既存 SearchPage と断絶しやすい
- **適合度**: 中。分離志向だが、Page 集約表示・プレビュー統合の要件とコスト効率が悪い

### Option C: Hybrid — 添付専用 ES インデックス + 既存検索/UI の拡張 (推奨)

- ES に `attachments` 専用インデックスを作成 (1 添付 = N 文書、位置情報付き)
- 既存 `ElasticsearchDelegator` に添付向けの `syncAttachment*` メソッドを追加 (既存 Page 系と並列)
- 検索時は Page index と Attachment index を multi-search で並列取得し、apps/app サーバ側で `pageId` をキーに集約 → `IPageWithSearchMeta.attachmentHits[]` を構築
- UI は既存 `SearchResultList` / `SearchResultContent` を拡張 (破壊的変更なし、新フィールドは optional)
- `AttachmentService.addAttachHandler/addDetachHandler` を Crowi 初期化時に登録
- 親ページ権限変更イベントを新規に購読する hook を SearchService に追加
- 管理画面の `ElasticsearchManagement` を拡張しつつ、添付専用 admin セクションを新規追加

#### 組み合わせ戦略
- **拡張**: SearchService / ElasticsearchDelegator / SearchResultList / SearchResultContent / ElasticsearchManagement / Crowi 初期化 / AttachmentService (ハンドラ登録のみ)
- **新規**: services/markitdown-extractor / packages/markitdown-client / `attachments` ES index と mapping / AttachmentHitCard コンポーネント / ファセットタブ / 添付専用 admin セクション / 失敗ログ model
- **リスク緩和**:
  - 機能フラグ (R9 の有効化トグル) による段階ロールアウト
  - 既存 Page index / 既存検索クエリは無変更に近い → 機能無効時の互換性を自然に担保 (R14)
  - markitdown PR #1263 未マージリスクは抽出サービス内部実装のフォールバック (pdfminer.six 直接呼び出し) で吸収

**Trade-offs**:
- ✅ 要件 R1 (1添付=N文書、位置情報) を素直に満たす
- ✅ 要件 R14 (既存互換性) を自然に満たす (Page index 無変更)
- ✅ 再インデックス・個別再抽出・権限継承・ファセットいずれも実装が見通しやすい
- ✅ 既存 UI の破壊的変更ゼロ、応答型は optional フィールド追加のみ
- ❌ マルチインデックス検索のクエリ実装が Option A より複雑
- ❌ 権限情報を添付ドキュメントに**スナップショット**で保持する必要がある (親ページ変更時の同期ハンドラが必要)

## 4. Recommendation

### 推奨: Option C (Hybrid)

**根拠**:
- R1 の位置情報保持 (pages[]) と R10/R11 の再インデックス粒度、R7 のファセット、R14 の互換性を同時に満たす最適解
- 既存の SearchDelegator / SearchService / AttachmentService / Admin UI の各拡張ポイントが整備されており、単発の追加で済む
- pdf-converter のマイクロサービスパターンが新規 extractor にそのまま適用でき、OpenAPI → orval での client 自動生成パイプラインが流用可能

### Effort / Risk

| ワークパッケージ | Effort | Risk | 根拠 |
|---|---|---|---|
| services/markitdown-extractor (新規、FastAPI) | M | Medium | FastAPI 標準構成だが Python 言語追加で CI/配布系に新規導入が必要 |
| packages/markitdown-client (orval 生成) | S | Low | pdf-converter-client の orval 設定を模倣できる |
| ES attachments index + mapping + delegator 拡張 | M | Medium | 既存 delegator パターンを踏襲、ES 7/8/9 三版対応の mapping 追加 |
| AttachmentService ハンドラ登録 + 抽出→index 連携 | M | Medium | 既存 hook は fire-and-forget、失敗可視化の配線を追加 |
| 権限変更時の追従 (R4.3) | S | Medium | 現状 Page 権限変更時のハンドラ連携が弱い → 対応箇所特定が要調査 |
| 検索クエリ multi-index 集約 + IPageWithSearchMeta 拡張 | M | Medium | 既存検索 API を保ったまま応答拡張、性能要注意 |
| SearchResultList 添付サブエントリ | S | Low | 既存コンポーネントへの追加表示 |
| AttachmentHitCard + SearchResultContent 統合 | M | Low | 新規コンポーネントだがプロップ渡しのみ |
| ファセットタブ (全体/ページ/添付) | M | Low | 既存 facet 機構なし、新規追加 |
| admin: rebuild チェックボックス + 添付セクション + 失敗ログ UI | M | Low | ElasticsearchManagement 拡張 |
| 添付ファイル一覧モーダル 再抽出ボタン + API | S | Low | 既存 UI 拡張 + 新 endpoint |
| 一括再インデックス `addAllAttachments` | M | Medium | `addAllPages` を参考に実装、Socket.io progress を拡張 |
| 失敗ログ model + 集計 | S | Low | 単純 CRUD |
| 抽出サービスのセキュリティハードニング | S | Low | k8s manifests のポリシー設定 |
| docker-compose / k8s manifest 追加 | S | Low | pdf-converter のパターン踏襲 |
| 機能フラグ (有効化トグル) | S | Low | ConfigManager 既存 |
| テスト (各レイヤ) | M | Medium | 既存テスト構造に乗せる、FastAPI 側は pytest |

**総合**: Effort **L** (1–2 週間) 〜 **XL** (2+ 週間)、Risk **Medium**。言語横断、複数レイヤ変更、OpenAPI パイプライン整備による。

### 主要設計判断 (design phase 移行時に確定すべき項目)

1. **ES index 設計**: `attachments` index の正確なフィールド一覧 (`attachmentId` / `pageId` / `pageNumber` / `label` / `content` / `fileName` / `fileFormat` / `fileSize` / `grant` / `granted_users` / `granted_groups` / `created_at` / `updated_at`)、ES 7/8/9 それぞれの mapping 変種
2. **権限スナップショットの同期方式**: 親ページ権限変更を検知するイベント点 (既存 hook の位置特定 / 新規 hook 追加 / ページ save フック)
3. **multi-index 検索クエリの集約**: apps/app 側での集約 vs ES mget / multi-search、性能比較
4. **抽出 API 契約の確定**: `POST /extract` (multipart) vs ストリーミング、リクエスト schema、エラーコード体系
5. **OpenAPI → orval パイプライン**: FastAPI の OpenAPI json をどのタイミングで吸い上げるか (ビルド時 / 手動コマンド)、Turbo の依存グラフへの登録方法
6. **再インデックス進捗通知**: 既存 Socket.io の `AddPageProgress` を流用するか、別イベントを追加するか
7. **個別再抽出 API のルーティング**: `/api/v3/attachments/:id/reextract` / 権限 (admin / page editor)

### Research Needed (design phase でさらなる調査)

- **markitdown PR #1263 マージ状況の継続確認** — 現状 OPEN (2026-03-28 更新、1 件の APPROVAL review)。未マージでの本機能リリース時は抽出サービス内部で `pdfminer.six` を直接呼ぶフォールバック (数十行規模) が必要
- **ES 7/8/9 の mapping 実機検証** — 日本語 analyzer (kuromoji) / 英語 analyzer の添付テキストに対する挙動、body との整合
- **Python FastAPI OpenAPI → orval** の統合手順の実例 (GROWI monorepo での類似事例は pdf-converter のみ、あれは Ts.ED が Swagger を直接出す構成)
- **添付ファイル一覧モーダルのコンポーネント特定** — `PageAttachment` / `AttachmentList` 系のクライアントコンポーネントの正確な場所と拡張スロット
- **親ページ権限変更のイベントフック** — 既存実装のどの箇所に hook 点があるか、または新規追加が必要か
- **日本語 snippet/highlight の添付テキスト** — ES highlight 機能を添付専用 index に適用した際の UX (短いスニペット抽出、マルチバイト境界)
- **抽出サービスの CI ジョブ追加** — Python lint / test / image ビルド / dependency 更新の運用フロー (既存 monorepo は Node 系)

---

## Conclusion

Option C (Hybrid) を推奨。既存の `AttachmentService` / `ElasticsearchDelegator` / `SearchService` / `ElasticsearchManagement` / `SearchResultList` / `SearchResultContent` の拡張ポイントと、新規 `services/markitdown-extractor` / `packages/markitdown-client` / 添付専用 ES インデックス / 新規 UI コンポーネント群を組み合わせる。pdf-converter のマイクロサービス + orval パターンを転用しつつ、言語は Python (FastAPI) に切り替え、デプロイは共有サービス + HPA とする。

design phase では上記「主要設計判断」および「Research Needed」を入力として、Boundary Commitments を確定する。

---

# Design Phase Discovery (Addendum)

_Generated: 2026-04-17 (during `/kiro-spec-design`)_

## Additional Investigations

### A. 添付ファイル一覧モーダル (R11 実装ポイント特定)

- 親: [apps/app/src/client/components/PageAccessoriesModal/PageAttachment.tsx](apps/app/src/client/components/PageAccessoriesModal/PageAttachment.tsx) — SWR + Jotai のパターン
- リスト: [apps/app/src/client/components/PageAttachment/PageAttachmentList.tsx](apps/app/src/client/components/PageAttachment/PageAttachmentList.tsx) — `@growi/ui` の `Attachment` コンポーネントに prop で操作を渡す
- 削除モーダル: [apps/app/src/client/components/PageAttachment/DeleteAttachmentModal.tsx](apps/app/src/client/components/PageAttachment/DeleteAttachmentModal.tsx) — Jotai atom (`useDeleteAttachmentModalStatus` / `useDeleteAttachmentModalActions`)
- データフェッチ: `useSWRxAttachments()` → `/attachment/list`
- **拡張方針**: `PageAttachmentList` 経由で `Attachment` に `onReextractClicked` prop を追加し、個別行で「再抽出」ボタンをレンダリング。操作状態は SWR mutate で楽観更新

### B. ページ権限変更イベントの既存フロー (R4.3 実装ポイント)

- `PageService.updateGrant()` は [apps/app/src/server/service/page/index.ts#L5109](apps/app/src/server/service/page/index.ts#L5109) で `updatePage(null, null, options: { grant, userRelatedGrantUserGroupIds })` に委譲
- 権限変更を含むページ更新フローは `pageEvent.emit('syncDescendantsUpdate', targetPage, user)` と `pageEvent.emit('updateMany', pages, user)` を発火 ([page-service index.ts#L1250-L1331](apps/app/src/server/service/page/index.ts#L1250-L1331))
- 既存 SearchService は `registerUpdateEvent()` で `pageEvent` を購読している
- **拡張方針**: 同 `registerUpdateEvent()` 内、または同等の初期化点で `updateMany` / `syncDescendantsUpdate` を購読する添付同期リスナを追加。受信時は対象ページ配下の添付 ES 文書の権限情報フィールドのみ partial update する

### C. Config key 命名規則 (R9 追加キー)

- 既存は `{namespace}:{camelKey}` または `{namespace}:{sub}:{key}` のコロン区切り (例: `app:elasticsearchUri`, `app:elasticsearchRequestTimeout`, `attachments:contentDisposition:inlineMimeTypes`)
- [config-definition.ts](apps/app/src/server/service/config-manager/config-definition.ts) に型定義を追加する既存パターンに準拠
- **新規キー**:
  - `app:attachmentFullTextSearch:enabled` (bool)
  - `app:attachmentFullTextSearch:extractorUrl` (string)
  - `app:attachmentFullTextSearch:maxFileSizeBytes` (number)
  - `app:attachmentFullTextSearch:timeoutMs` (number)
  - `app:attachmentFullTextSearch:maxConcurrency` (number, extractor 側の同時実行推奨値を admin が参照)

### D. 添付ファイル API の既存構造

- POST: `/_api/v3/attachment` (apiv3) — multipart upload、`accessTokenParser([SCOPE.WRITE.FEATURES.ATTACHMENT])` → `loginRequiredStrictly`
- GET: `/_api/v3/attachment/list` (apiv3) — ページアクセス権チェック付き
- DELETE: `/_api/attachments.remove` (legacy) — `{ attachment_id }` body
- **新規**: `POST /_api/v3/attachments/:id/reextract` (apiv3) — `accessTokenParser([SCOPE.WRITE.FEATURES.ATTACHMENT])` + `loginRequiredStrictly` + page access check + (admin or page editor) ガード
- **新規 admin**: `GET /_api/v3/admin/attachment-search/failures`, `GET/PUT /_api/v3/admin/attachment-search/config`

### E. FastAPI → orval パイプライン (R13 CI 設計)

- FastAPI は `/openapi.json` を自動生成 ([FastAPI SDK generation docs](https://fastapi.tiangolo.com/advanced/generate-clients/))
- pdf-converter と同じく orval が OpenAPI spec (yaml/json) を入力として axios ベースクライアントを生成可能
- **採用パイプライン**:
  1. FastAPI 側に `scripts/export-openapi.py` を置き、`/openapi.json` を `packages/markitdown-client/openapi.json` に書き出し
  2. `packages/markitdown-client` の turbo task で orval を実行し TS クライアントを生成
  3. CI の pre-commit / pipeline で両ステップを実行し、差分を commit に反映 (Vinta / PropelAuth / full-stack-fastapi-template パターン)
- 差分検出なしで CI を通す簡易版: クライアントコードをリポジトリにコミット (監査と可読性優先)、別途 `check-openapi-drift` を turbo task 化

### F. markitdown PR #1263 継続確認結果

- 状態: OPEN (2026-03-28 最終更新、1 件 APPROVAL review)
- マージ見込みは不明。**本機能リリース時点で未マージなら抽出サービス内部で `pdfminer.six` を直接呼ぶページ分割フォールバック (推定 30〜50 行) を同梱する方針**
- PPTX のスライド番号 HTML コメントは現行 stable に既に含まれる (フォールバック不要)

## Design Synthesis Outcomes

### Generalization
- **「attach / detach / reextract / bulk reindex」は同一パイプライン**: 添付を入力として抽出 → ES 文書群を upsert という流れで共通。`AttachmentSearchIndexer` が単一の `indexAttachment(attachmentId)` / `removeAttachmentFromIndex(attachmentId)` を提供し、アップロード時・一括再インデックス時・個別再抽出ボタンがすべて同じ関数を呼ぶ
- **権限スナップショットの更新**は「添付 ES 文書の partial update」として汎化でき、親ページ更新 / 権限変更 / 移動のすべてに使える

### Build vs. Adopt
- **採用**: microsoft/markitdown (Python) / FastAPI / orval / pdfminer.six (フォールバック) / 既存 `ElasticsearchDelegator` / 既存 `AttachmentService` ハンドラ / 既存 Socket.io progress / 既存 ConfigManager
- **構築**: `AttachmentSearchIndexer`、添付 ES mapping、UI コンポーネント (`AttachmentHitCard`, `AttachmentSubEntry`, `SearchResultFacetTabs`, `ReextractButton`, `AttachmentSearchSettings`, `AttachmentExtractionFailures`)、抽出サービス本体

### Simplification
- **独立 delegator は作らない**: 既存 `ElasticsearchDelegator` に添付向けメソッドを追加する (ES 7/8/9 の互換処理を再利用)
- **独立 job queue は作らない**: 既存 Socket.io progress + fire-and-forget ハンドラパターンを再利用
- **独立 admin ページは作らない**: 既存 `ElasticsearchManagement` に添付セクションと rebuild チェックボックスを追加
- **検索 API を破壊的変更しない**: `IPageWithSearchMeta` に optional `attachmentHits[]` を追加するだけで新機能を表現

## Key Risks & Mitigations

1. **markitdown PR #1263 未マージでの出荷**: extractor 内部で pdfminer.six ページ分割フォールバックを同梱
2. **権限変更イベントの網羅性**: `updateMany` / `syncDescendantsUpdate` に加えて漏れイベント (例: ページ削除時の descendant cascade) がないか、実装時に `pageEvent` 全リスナの整合性を確認
3. **検索 multi-index 性能**: msearch で 2 インデックス並列クエリ、結果を app 側で pageId 集約。クエリタイムアウトと結果件数制限を設計時に明示
4. **日本語 highlight**: 既存 kuromoji analyzer を添付 index にも適用 (mapping 同構成)
5. **設計時点で未確定**: FastAPI OpenAPI spec のリポジトリへのコミット運用 (drift 検知)

---

# 抽出アーキテクチャ選択の根拠

_Source: brief.md (original single-spec phase, 2026-04-17)_

## 採用アーキテクチャ概要

**Python 版 microsoft/markitdown を共有 HTTP マイクロサービス (`markitdown-extractor`) として分離し、apps/app (Node.js) から HTTP 経由で呼び出してテキスト抽出、結果を Elasticsearch にインデックスする。**

### 採用根拠

- markitdown は Microsoft 公式メンテ、MIT ライセンス、PDF/Office を extras で絞ると**外部バイナリ不要・image ~200MB** の軽量構成
- apps/pdf-converter で確立された「マイクロサービス + OpenAPI → 自動生成 client」パターンを踏襲可能
- pdf-converter と異なり **FUSE によるファイルシステム共有は不要**。入力=添付バイナリ、出力=短いテキストという短命リクエストのため、HTTP multipart/form-data で完結
- **共有サービス方式 (k8s Deployment + HPA) を採用**。サイドカー方式に比べクラスタ全体のベースライン消費を大幅削減 (例: 100 テナント × idle ~120MB のサイドカー = 12GB → 共有 2 replica × ~500MB ≈ 1GB)、バースト時のみスケール
- apps/app 側に抽出処理を載せないことで、テナント間のリソース境界維持・クラッシュ耐性・言語別ランタイムの分離を実現

## 検討した代替案と不採用理由

| 案 | 概要 | 不採用理由 |
|---|---|---|
| **ES ingest-attachment (Apache Tika)** | ES の built-in pipeline として ingest-attachment plugin を使い、ドキュメント投入時に Tika でテキスト抽出 | GROWI.cloud のマルチテナント共有 ES クラスタに Tika の CPU/memory 負荷が集中し、他テナントの検索・インデックス更新に波及するリスク。plugin 追加の運用負担も発生 |
| **apps/app 内で Node ライブラリ直接抽出 (unpdf + officeparser 等)** | Node.js プロセス内で抽出ライブラリを呼び出し、Python マイクロサービスを持たない構成 | apps/app に重い処理を抱える構造的リスク (イベントループ占有、OOM 時の巻き込み)。Office 系の抽出品質は markitdown に劣る。将来的な差し替え余地としては残す |
| **markitdown TS ポート (markitdown-ts / markitdown-js / markitdown-node)** | TypeScript/JavaScript 移植版を使い Node.js 内で完結させる構成 | いずれも個人メンテ。markitdown-ts は PPTX 未対応。本質的に Node ライブラリの薄いラッパーで独自価値が小さい。markitdown-js/node は停滞・未成熟。プロダクション利用に不適 |
