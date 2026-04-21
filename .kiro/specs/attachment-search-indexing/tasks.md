# Implementation Plan

> 本 spec が所有する境界: `apps/app/src/features/search-attachments/server/**`、`apps/app/src/server/service/search-delegator/**` (添付拡張のみ)、`packages/markitdown-client/**`、`app:attachmentFullTextSearch:*` Config キー群、`apps/app/src/pages/basic-layout-page/get-server-side-props/search-configurations.ts` と `apps/app/src/pages/basic-layout-page/types.ts` (SSR prop 拡張のみ、hydrate / atom / UI コンポーネントは下流 `attachment-search-ui` spec の責務)。

## 1. Foundation: packages/markitdown-client と orval パイプライン

- [ ] 1.1 `packages/markitdown-client` パッケージ雛形を追加する
  - `package.json` / `tsconfig.json` / `src/index.ts` / `orval.config.js` / `openapi.json` (上流 `attachment-search-markitdown-extractor` spec の export をコミット) を作成する
  - `pdf-converter-client` と同じ export パターンで generated コード (`src/generated/`) を commit 対象とし、`src/index.ts` で re-export する
  - pnpm workspace / Turborepo pipeline に組み込み、`apps/app` から型安全に import できる状態を確認する (`pnpm -F @growi/markitdown-client build` が成功することを観察)
  - _Requirements: 2.1_
  - _Boundary: packages/markitdown-client_

- [ ] 1.2 orval による TS クライアント自動生成と drift 検知 CI を整備する
  - `openapi.json` を入力に `src/generated/` を再生成する `pnpm gen` スクリプトを追加する
  - CI に `pnpm -F @growi/markitdown-client gen && git diff --exit-code packages/markitdown-client/src/` を追加し、orval 出力 drift を検知する
  - CI に `git diff --exit-code packages/markitdown-client/openapi.json` を追加し、上流 Python CI との 2 段 drift 検知を有効化する (上流 export 忘れ時に本 spec 側の CI が赤くなることを観察)
  - _Requirements: 2.1_
  - _Boundary: packages/markitdown-client, CI_
  - _Depends: 1.1_

## 2. Foundation: Config / ES mapping / feature module scaffolding

- [ ] 2.1 (P) `app:attachmentFullTextSearch:*` Config キー 4 件を config-definition に追加する
  - `extractorUri` / `extractorToken` / `timeoutMs` / `maxFileSizeBytes` の 4 キーを定義する
  - `extractorToken` は既存 `app:openaiApiKey` と同パターンで encrypted storage を指定し、`extractorUri` は `GROWI_MARKITDOWN_EXTRACTOR_URI`、`extractorToken` は `GROWI_MARKITDOWN_SERVICE_TOKEN` を初期値に採り得るようにする
  - ConfigManager 経由で get/set できることを単体テストで確認する (encrypted field は plaintext で persist されないことも assert)
  - _Requirements: 5.1, 5.2_
  - _Boundary: ConfigManager / config-definition_

- [ ] 2.2 (P) ES 添付 index mapping を ES 7/8/9 変種ごとに作成する
  - `attachments-mappings-es7.ts` / `es8.ts` / `es9.ts` を追加し、`attachmentId` / `pageId` / `pageNumber` / `label` / `fileName` / `originalName` (text+keyword) / `fileFormat` / `fileSize` / `content` (kuromoji + ngram) / `attachmentType` / `created_at` / `updated_at` を定義する
  - **権限フィールド (`grant` / `granted_users` / `granted_groups` / `creator`) を含めない** ことを mapping snapshot test で固定する (Option D の構造的担保)
  - ES バージョン別 delegator が version-aware に正しい mapping を選択できること
  - _Requirements: 2.2, 2.5, 9.2_
  - _Boundary: ESDelegator extension / mappings_

- [ ] 2.3 (P) feature module の DTO / interface ファイルを用意する
  - `apps/app/src/features/search-attachments/interfaces/attachment-search.ts` に `IAttachmentHit` / `ISnippetSegment` / `IAttachmentEsDoc` / `ExtractionOutcome` / `ExtractedPage` / `ExtractionFailureEntry` / `IPrimarySearchResult` / `ISecondarySearchResult` / `AttachmentSearchConfig` / `AttachmentSearchConfigUpdate` を定義する
  - `ExtractionOutcome` は `success` / `unsupported` / `tooLarge` / `timeout` / `serviceBusy` / `serviceUnreachable` / `failed` の判別共用体を export する
  - 型定義のみで runtime コードを含まず、型レベルでの利用が他タスクから可能になる
  - _Requirements: 1.4, 2.5, 8.3, 9.3, 9.4_
  - _Boundary: features/search-attachments/interfaces_

- [ ] 2.4 (P) `IPageWithSearchMeta.attachmentHits?: IAttachmentHit[]` optional を既存応答型に追加する
  - `apps/app/src/interfaces/search.ts` に optional フィールドを追加し、既存 shape を破壊しない
  - 型エクスポート後に既存 Page 検索コードを build し、既存 caller のコンパイルが通ることを observe する
  - _Requirements: 9.3, 9.4_
  - _Boundary: interfaces/search_

- [ ] 2.5 feature module の entry point を雛形として置く
  - `apps/app/src/features/search-attachments/server/index.ts` に `initAttachmentFullTextSearch(crowi)` の空関数を export する (後続タスクで実装を肉付け)
  - `features/search-attachments/server/{services,models,mappings,queries,routes/apiv3,middlewares}` ディレクトリ構成を作成する
  - 他タスクから import できる scaffolding が揃い、後続のサービス追加が既存コードに手を入れずに可能になる
  - _Requirements: 2.1_
  - _Boundary: features/search-attachments/server_
  - _Depends: 2.1, 2.2, 2.3_

## 3. Core: 抽出クライアントラッパ (`AttachmentTextExtractorService`)

- [ ] 3.1 extractor URI allowlist バリデータを実装する
  - URI 文字列 parse で `http` / `https` 以外のスキームを reject、クラウドメタデータ IP literal (`169.254.169.254` / `fd00:ec2::254` / `100.100.100.200` / `192.0.0.192`) を reject する pure function を実装する
  - k8s 内部 DNS (`.cluster.local` / `.svc`) / loopback / RFC1918 は受理する
  - `file://` / `ftp://` / `data:` / metadata IP を含む URI が reject され、正当な k8s / docker-compose URI が受理される単体テストが通る
  - _Requirements: 5.2_
  - _Boundary: features/search-attachments/server/services (helper)_

- [ ] 3.2 (P) `AttachmentTextExtractorService` 本体を実装する
  - FileUploader からバイト取得し `markitdown-client` に multipart 送信、503 `service_busy` で exponential backoff + jitter 1 回 retry、2 回目 503 で `serviceBusy` 正規化
  - 毎回 `configManager.getConfig('app:attachmentFullTextSearch:extractorToken')` を取得して `Authorization: Bearer` を付与、未設定時は `serviceUnreachable` 正規化
  - 上流 401 は `serviceUnreachable` 正規化 + pino ERROR + FailureLog 対象
  - 呼び出し直前に extractor URI の DNS 解決結果が metadata IP literal のいずれかなら送信せず `serviceUnreachable` 正規化
  - ネットワーク層 throw を catch-all し全経路で `ExtractionOutcome` を返す (throw しない) ことを単体テストで固定
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1_
  - _Boundary: features/search-attachments/server/services_
  - _Depends: 1.2, 2.1, 2.3, 3.1_

## 4. Core: ES delegator 拡張と query builder 群

- [ ] 4.1 (P) `attachment-search-delegator-extension` に index ライフサイクル / bulk 操作を実装する
  - `createAttachmentIndex(indexName)` (default `attachments`、rebuild 時 `attachments-tmp`) / `syncAttachmentIndexed(..., targetIndexes)` / `syncAttachmentRemoved(..., targetIndexes)` / `addAllAttachments(targetIndex, progress)` を追加する
  - doc ID を `${attachmentId}_${pageNumber ?? 0}` で決定し、`targetIndexes` 複数指定時は 1 回の `_bulk` で書き切る (2 回別 API コールにしない)
  - 既存 `ElasticsearchDelegator` と composition で合成し、既存 Page 系メソッドは不変であることを確認する
  - _Requirements: 2.2, 2.5, 3.1, 6.1, 9.2_
  - _Boundary: ESDelegator extension_
  - _Depends: 2.2_

- [ ] 4.2 (P) `attachments` alias 衝突検出を起動時に組み込む
  - `initializeSearchIndex` 相当の処理で `attachments` alias が本 spec 所有以外の実 index を指している場合に WARN ログを出し initialize を続行しない
  - 既存 OSS デプロイで衝突がある場合にログが出て human intervention を促すことを test で確認
  - _Requirements: 2.5, 9.2_
  - _Boundary: ESDelegator extension_
  - _Depends: 4.1_

- [ ] 4.3 (P) 検索クエリ builder 群を pure function として追加する
  - `queries/build-attachment-search-query.ts`: attachments_index content match body (権限フィルタを一切含めない) を組み立てる
  - `queries/build-attachments-by-page-ids-query.ts`: `terms: { pageId: primaryIds }` + content match body を組み立て、`pageIds.length > ページサイズ` で assert throw
  - `mgetPagesForPermissionBody(pageIds)`: `_source_includes: ['_id','grant','grantedUsers','grantedGroups','creator','path','title','updatedAt']` のみで mget body を返す
  - 3 builder それぞれの snapshot / unit test が通る
  - _Requirements: 4.1, 4.3, 4.4_
  - _Boundary: features/search-attachments/server/queries_

- [ ] 4.4 (P) ES highlighter 出力 → `ISnippetSegment[]` parser を実装する
  - `queries/build-snippet-segments.ts` を pure function として追加し、`<em>...</em>` で囲まれた部分のみ `highlighted: true` に、それ以外を平文 segment に分割する
  - `<script>` / `<img onerror>` / 不正な `<em>` 入れ子を含む入力で crash せず、非 `<em>` タグは text セグメント内にそのまま保持され React text node で自動 escape される想定を test で固定
  - _Requirements: 9.3_
  - _Boundary: features/search-attachments/server/queries_

## 5. Core: FailureLog 永続化

- [ ] 5.1 `ExtractionFailureLog` Mongoose model を追加する
  - `attachmentId` / `pageId` / `fileName` / `fileFormat` / `fileSize` / `reasonCode` (enum: `unsupportedFormat` / `fileTooLarge` / `extractionTimeout` / `serviceBusy` / `serviceUnreachable` / `extractionFailed`) / `message` / `occurredAt` / `retentionGroupHash` を schema 化する
  - `occurredAt` 90 日 TTL index を設定し、TTL が機能することを integ test で確認 (期限切れ doc が MongoDB から自動削除される)
  - _Requirements: 8.3_
  - _Boundary: features/search-attachments/server/models_

- [ ] 5.2 `ExtractionFailureLogService` を実装する
  - `record` / `listRecent({ limit, since })` / `totalRecent(since)` を提供する
  - `record` は `retentionGroupHash` により重複を抑制する (同 attachmentId + reasonCode が時間窓内で収斂)
  - failure を pino 構造化ログと二重経路で記録し、admin API から取得可能な状態になることを unit test で確認
  - _Requirements: 3.4, 8.1, 8.3, 8.4_
  - _Boundary: features/search-attachments/server/services_
  - _Depends: 5.1_

## 6. Core: Indexer と Rebuild Batch

- [ ] 6.1 `AttachmentSearchIndexer` を実装する (dual-write 対応込み)
  - `isFeatureEnabled()` 算出 (`searchService.isConfigured && extractorUri != null && extractorUri !== '' && extractorToken != null && extractorToken !== ''`) で早期 return
  - 成功時は `attachments` (live alias) に bulk upsert、**権限フィールドは一切書き込まない** (Option D 構造的担保)
  - 失敗時 (`unsupported` / `tooLarge` / `timeout` / `serviceBusy` / `serviceUnreachable` / `failed`) は metadata-only 1 文書 upsert + `ExtractionFailureLogService.record`
  - `reindexBatch.isRebuilding()` が true の間は live alias と `reindexBatch.getTmpIndexName()` 両方を `targetIndexes` として渡し dual-write する
  - tmp 側 write 失敗は live 側の成功を阻害せず pino warn のみに留めることを unit test で verify
  - `onDetach(attachmentId)` で該当 attachmentId の全 ES doc を削除する (dual-write 分岐も同様に適用)
  - `reindex(attachmentId)` は `{ ok, outcome }` を同期 return する (apiv3 reextract から呼ばれる窓口)
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.4, 7.1_
  - _Boundary: features/search-attachments/server/services_
  - _Depends: 3.2, 4.1, 5.2_

- [ ] 6.2 `AttachmentOrphanSweeper.sweep(targetIndex)` を実装する
  - 指定 index 上の unique pageId 集合を取得し、Page collection に存在しない pageId を持つ doc を tmp index から削除する
  - 失敗しても throw せず `{ removed, failed }` を返し、呼び出し側 rebuild 本体の成功を阻害しない
  - 独立トリガ (cron / pageEvent) を**持たない** ことを test で固定 (rebuildIndex 内からのみ呼ばれる)
  - _Requirements: 3.2, 4.4_
  - _Boundary: features/search-attachments/server/services_
  - _Depends: 4.1_

- [ ] 6.3 `AttachmentReindexBatch` を実装する
  - `addAllAttachments(targetIndex, progress)`: MongoDB の全 attachment を cursor で走査し、FileUploader からバイト取得 → extractor 経由 → `syncAttachmentIndexed` で tmp index に bulk upsert、個別失敗は `ExtractionFailureLogService.record` してスキップ継続
  - `begin(tmpIndexName)` / `end()` / `isRebuilding()` / `getTmpIndexName()` の in-memory lifecycle state を提供し、`begin()` 重複で 409 conflict を throw する
  - Socket.io `AddAttachmentProgress` / `FinishAddAttachment` / `RebuildingFailed` を既存 progress チャネルで発行する
  - bulk 完了後 alias swap **前** に `AttachmentOrphanSweeper.sweep` を呼ぶ
  - `attachments-tmp` は開始時に drop → create で冪等化 (累積しない)
  - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - _Boundary: features/search-attachments/server/services_
  - _Depends: 3.2, 4.1, 5.2, 6.2_

## 7. Core: 検索結果 Aggregator

- [ ] 7.1 `AttachmentSearchResultAggregator.searchPrimary` を実装する
  - facet=`pages` は既存 Page 検索経路のみを呼び attachments_index を一切叩かない (完全互換)
  - facet=`all` かつ `from==0` で `_msearch` により page_index (viewer filter 付き) と attachments_index (content only) を並列取得し、解釈 A (primary 20 件と pageId 一致する添付のみを埋め込み、不一致は破棄) を適用する
  - facet=`all` かつ `from>0` では attachments_index を叩かない
  - facet=`attachments` では attachments_index を優先検索 (over-fetch `size * k`、k=1.5) し、unique pageIds を `mget` permission filter にかけ drop 発生時 `primaryResultIncomplete: true` をメタに返す
  - primary レイテンシ閾値超過時 (例: 800ms) の safety net: facet=`all` は facet=`pages` 相当に degrade、facet=`attachments` は空 items + `primaryResultIncomplete: true` を返す
  - 返却 `IPrimarySearchResult` の `items[].attachmentHits[]` / `meta.primaryResultIncomplete` / `meta.nextCursor` が上記仕様どおりに埋まる
  - _Requirements: 3.3, 4.1, 4.2, 4.3, 4.4, 9.1, 9.3_
  - _Boundary: SearchService extension (AttachmentSearchResultAggregator)_
  - _Depends: 4.3, 4.4_

- [ ] 7.2 `AttachmentSearchResultAggregator.resolveSecondary` を実装する
  - `primaryIds.length > ページサイズ` で 400 相当のエラーを返す
  - facet=`all` で `terms: { pageId: primaryIds }` + content match を発行し、permission 再チェックはしない (primary で通過済)
  - primary → secondary の時間差対策として軽量 mget で pageId の存在と viewer permission を再検証し、消失 / 権限失効ページを enrichment 対象から除外する
  - secondary レイテンシ閾値超過時 (例: 500ms) に enrichment を skip し空の `ISecondarySearchResult` を返す
  - facet=`attachments` は primary で mget 済みのため通常 no-op として返す
  - _Requirements: 3.3, 4.1, 4.2, 4.3, 4.4, 9.1, 9.3_
  - _Boundary: SearchService extension (AttachmentSearchResultAggregator)_
  - _Depends: 4.3, 7.1_

- [ ] 7.3 permission mget の fail-close 分岐を実装・固定する
  - partial failure (一部 `found:false` / 一部 `errors` 配列) の挙動として、**成功分のみを許可、残りは一律除外**する fail-close 実装を `searchPrimary` / `resolveSecondary` 両方に適用する
  - 一部成功で全件許可する fail-open 分岐が存在しないことを unit test で明示的に固定 (3 ケース: 全 200 / 一部 404 / errors 配列)
  - _Requirements: 4.1, 4.2, 4.4_
  - _Boundary: SearchService extension (AttachmentSearchResultAggregator)_
  - _Depends: 7.1, 7.2_

## 8. Core: apiv3 エンドポイント群と `requiresReindex` 算出

- [ ] 8.1 (P) `require-search-attachments-enabled` middleware を実装する
  - 算出値 `isAttachmentFullTextSearchEnabled` が false のとき 503 `feature_disabled` を返し、true のときのみ next を呼ぶ
  - 各 apiv3 route から共通利用されることを確認する (機能無効時 / URI 空文字 / token 未設定の各経路で 503 が返る)
  - _Requirements: 2.3, 5.4, 7.3_
  - _Boundary: features/search-attachments/server/middlewares_
  - _Depends: 2.1_

- [ ] 8.2 `POST /_api/v3/attachments/:id/reextract` を実装する
  - `accessTokenParser([SCOPE.WRITE.FEATURES.ATTACHMENT])` + `loginRequiredStrictly` + `require-search-attachments-enabled` を適用する
  - **handler 内で毎回 Page current grant を参照** して admin OR page editor を判定 (session / middleware cache を使わない)、不可なら 403 forbidden
  - `AttachmentSearchIndexer.reindex(attachmentId)` を同期呼び出し、`{ outcome: ExtractionOutcome }` を返す
  - 機能無効時は middleware が 503、存在しない attachmentId で 404 になることを observe
  - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - _Boundary: features/search-attachments/server/routes/apiv3_
  - _Depends: 6.1, 8.1_

- [ ] 8.3 (P) `GET /_api/v3/search/attachments` (secondary enrichment) を実装する
  - `?q=&pageIds=id1,id2,...` を受理し `AttachmentSearchResultAggregator.resolveSecondary` に委譲する
  - `pageIds` 必須、要素数がページサイズ (default 20) を超過すると 400、空で 400
  - 機能無効時は 503 `feature_disabled`
  - _Requirements: 4.1, 9.1, 9.3_
  - _Boundary: features/search-attachments/server/routes/apiv3_
  - _Depends: 7.2, 8.1_

- [ ] 8.4 (P) admin config エンドポイントと `requiresReindex` 算出サービスを実装する
  - `GET /_api/v3/admin/attachment-search/config`: `extractorUri` / `hasExtractorToken` (存在判定のみ、値は返さない) / `timeoutMs` / `maxFileSizeBytes` / `isAttachmentFullTextSearchEnabled` / `requiresReindex` を返す
  - `PUT /_api/v3/admin/attachment-search/config`: `extractorUri` (null / 空文字で soft-disable、allowlist 検証 400) / `extractorToken` (write-only、null で削除、encrypted storage 経由で save) / `timeoutMs` / `maxFileSizeBytes` を受理
  - `requiresReindex` は `Attachment.countDocuments()` > ES `attachments` cardinality 集計の算出、**Config collection に persist しない**、30 秒 TTL in-memory cache + `PUT config` 成功時 invalidate
  - `extractorToken` の値が GET 応答に絶対含まれないことを unit test で固定 (encrypted field の値漏出防止)
  - _Requirements: 5.1, 5.2, 5.3_
  - _Boundary: features/search-attachments/server/routes/apiv3, Config service_
  - _Depends: 2.1, 3.1, 4.1_

- [ ] 8.5 (P) `GET /_api/v3/admin/attachment-search/failures` を実装する
  - `?limit=N&since=iso` を受理し `ExtractionFailureLogService.listRecent` + `totalRecent` に委譲する
  - admin middleware で gate し、非 admin は 403 forbidden
  - _Requirements: 8.4_
  - _Boundary: features/search-attachments/server/routes/apiv3_
  - _Depends: 5.2_

- [ ] 8.6 `PUT /_api/v3/search/indices` の `includeAttachments` フラグ受理を追加する
  - 既存 route に `includeAttachments?: boolean` を受理するよう最小差分で拡張する
  - `includeAttachments=true` かつ 機能有効時に `AttachmentReindexBatch.begin()` → Page 再インデックス (既存) → `addAllAttachments(tmp)` → orphan sweep → alias swap → `Batch.end()` を **try/finally で** 実行する経路を組み立てる
  - `includeAttachments=false` のときは従来どおり Page/Comment のみ処理し `attachments` alias は据え置き、機能無効時は 503
  - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - _Boundary: apiv3 search route / ReindexBatch integration_
  - _Depends: 6.3, 8.1_

## 9. Integration: Crowi 配線 / SSR prop / AttachmentService handler

- [ ] 9.1 `initAttachmentFullTextSearch(crowi)` を Crowi 初期化から呼び出す
  - `apps/app/src/server/crowi/index.ts` に searchService / attachmentService 初期化完了後の配線点を追加する
  - feature module 内で `attachmentService.addAttachHandler(indexer.onAttach)` / `addDetachHandler(indexer.onDetach)` / Aggregator の SearchService への注入を行う
  - 機能無効時 (URI 未設定) は一切の拡張ロジックが走らず、既存挙動と完全互換であることを integ test で確認
  - _Requirements: 2.1, 2.3, 3.1, 9.1_
  - _Boundary: apps/app crowi init, features/search-attachments/server entry_
  - _Depends: 6.1, 7.1_

- [ ] 9.2 SearchService の multi-index 経路として Aggregator を組み込む
  - `apps/app/src/server/service/search.ts` の search entry に `facet` / `resolve` パラメタを受け、Aggregator.searchPrimary を呼ぶ分岐を追加する
  - facet=`pages` では既存 Page 検索経路のみを維持 (attachments 関連コードを通らない non-refactoring を observe)
  - **`registerUpdateEvent()` への添付向け pageEvent リスナ追加は行わない** ことをコメントで明記 (Option D)
  - _Requirements: 3.3, 4.1, 4.2, 9.1_
  - _Boundary: SearchService_
  - _Depends: 7.1, 7.2_

- [ ] 9.3 (P) `SearchConfigurationProps.searchConfig` SSR prop を拡張する
  - `apps/app/src/pages/basic-layout-page/types.ts` に `isAttachmentFullTextSearchEnabled?: boolean` を optional として追加する (hydrate 層で `?? false` に正規化する責務は下流 UI spec)
  - `apps/app/src/pages/basic-layout-page/get-server-side-props/search-configurations.ts` の `getServerSideSearchConfigurationProps` で `searchService.isConfigured && extractorUri != null && extractorUri !== '' && extractorToken != null && extractorToken !== ''` を算出して props に含める
  - SSR props に `extractorToken` の値を含めない (boolean 算出の入力にのみ用いる) ことを unit test で固定
  - _Requirements: 5.1, 5.4_
  - _Boundary: basic-layout-page SSR props_
  - _Depends: 2.1_

## 10. Validation: Integration / Performance tests

- [ ] 10.1 添付アップロード / 削除の E2E 経路を integ test で固定する
  - 添付アップロード → attach handler → `attachments` index に bulk upsert された文書数が抽出 pages 数と一致すること
  - ES 文書に `grant` / `granted_users` / `granted_groups` / `creator` が一切含まれないこと (Option D の E2E 固定)
  - 添付削除 → detach handler → 該当 attachmentId の全文書が削除されること
  - 機能無効時 (URI 空文字) → attach handler が extractor を一切呼ばず既存挙動と完全一致すること
  - _Requirements: 2.1, 2.2, 2.5, 3.1, 9.1_
  - _Boundary: integration_

- [ ] 10.2 query-time permission lookup (facet=all secondary / facet=attachments primary) を integ test で固定する
  - 親ページ権限変更直後に ES を触らずに次回検索で添付ヒット可視性が更新されること
  - 親ページ削除後 rebuildIndex 前でも添付ヒットが primary の mget permission filter により除外されること
  - rebuildIndex 実行後に `AttachmentOrphanSweeper` が親 Page 不在の doc を実削除していること
  - `GET /search/attachments?q=...&pageIds=...` (secondary endpoint) が `pageIds.length` 超過で 400、消失/権限失効ページを軽量 mget で除外すること
  - _Requirements: 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 9.1, 9.3_
  - _Boundary: integration_

- [ ] 10.3 rebuild window 中の dual-write integ test を追加する
  - rebuild 実行中に別 runner から `AttachmentService.attach()` / `detach()` を発火させ、live alias と `attachments-tmp` の両方に doc が存在することを assert
  - alias swap 後に live alias から当該添付が検索 hit すること
  - tmp index を中途 delete して bulk がエラーになる stub で、live 側 write が成功し続け real-time event 戻り値が正常であること
  - `Batch.begin()` 後に `rebuildIndex()` が例外 throw しても finally で `Batch.end()` が呼ばれ `isRebuilding=false` に戻ること (lifecycle leak 耐性)
  - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - _Boundary: integration_

- [ ] 10.4 (P) extractor / auth / allowlist の fail-close 経路を integ test で固定する
  - 上流 401 `unauthorized` が `serviceUnreachable` に正規化され、FailureLog 記録 + pino ERROR が出ること
  - extractorToken 未設定時に抽出呼び出しが一切走らず `isAttachmentFullTextSearchEnabled=false` になること
  - extractorUri host が metadata IP literal に解決されるケースで request 送信前に `serviceUnreachable` となること
  - admin PUT で `file://` / metadata IP を指定した URI が 400 `invalid_extractor_uri` になること
  - _Requirements: 1.1, 1.3, 1.4, 5.2_
  - _Boundary: integration_

- [ ] 10.5 (P) `requiresReindex` 算出・キャッシュを integ test で固定する
  - 機能有効化直後 (既存添付 N 件、ES 0 件) で `true`、rebuild 完了直後 (ES N 件) で `false` になること
  - `PUT config` 成功時に 30 秒 TTL cache が invalidate され次回 GET で再計算されること
  - 機能無効 / mongoCount===0 の早期 return 経路で ES aggregation を叩かないこと
  - _Requirements: 5.3_
  - _Boundary: integration_

- [ ] 10.6 (P) reextract handler の current grant 再チェックを integ test で固定する
  - session は editor 権限、Page current grant では viewer 以下 (demote 済み) の状態で `POST /attachments/:id/reextract` が 403 forbidden を返すこと
  - session / Page current grant ともに editor の状態で 200 + `ExtractionOutcome` 返却
  - _Requirements: 7.1, 7.2_
  - _Boundary: integration_

- [ ] 10.7 (P) `attachments` alias 衝突検出を integ test で固定する
  - 起動前に本 spec 所有外の実 index を指す `attachments` alias を仕込み、起動時に WARN ログ + initialize 中断が観測されること
  - _Requirements: 9.2_
  - _Boundary: integration_

- [ ] 10.8 primary / secondary 検索性能とスナップ safety net を perf test で確認する
  - primary p95 が機能有効時に既存 Page 検索比 +30% 以内 (facet=`all` 1 ページ目 msearch 並列、2 ページ目以降 Page 単体と同等)
  - secondary p95 が 500ms 以内 (非同期なので初期描画に影響しない)
  - primary 閾値超過時 facet=`all` が facet=`pages` 相当に degrade、facet=`attachments` が `primaryResultIncomplete: true` を返す safety net
  - secondary 閾値超過時 enrichment skip で primary のみ返ること
  - _Requirements: 9.1, 9.2_
  - _Boundary: performance_
