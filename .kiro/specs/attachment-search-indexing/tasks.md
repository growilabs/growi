# Implementation Plan

> 本 spec が所有する境界: `apps/app/src/features/search-attachments/server/**`、`apps/app/src/server/service/search-delegator/**` (添付拡張のみ)、`packages/attachment-text-extractor-client/**`、`app:attachmentFullTextSearch:*` Config キー群、`apps/app/src/pages/basic-layout-page/get-server-side-props/search-configurations.ts` と `apps/app/src/pages/basic-layout-page/types.ts` (SSR prop 拡張のみ、hydrate / atom / UI コンポーネントは下流 `attachment-search-ui` spec の責務)。

## 1. Foundation: packages/attachment-text-extractor-client と orval パイプライン

- [x] 1.1 `packages/attachment-text-extractor-client` パッケージ雛形を追加する
  - `package.json` / `tsconfig.json` / `src/index.ts` / `orval.config.js` / `openapi.json` (上流 `attachment-search-text-extractor` spec の export をコミット) を作成する
  - `pdf-converter-client` と同じ export パターンで generated コード (`src/generated/`) を commit 対象とし、`src/index.ts` で re-export する
  - pnpm workspace / Turborepo pipeline に組み込み、`apps/app` から型安全に import できる状態を確認する (`pnpm -F @growi/attachment-text-extractor-client build` が成功することを観察)
  - _Requirements: 2.1_
  - _Boundary: packages/attachment-text-extractor-client_

- [x] 1.2 orval による TS クライアント自動生成と drift 検知 CI を整備する
  - `openapi.json` を入力に `src/generated/` を再生成する `pnpm gen` スクリプトを追加する
  - CI に `pnpm -F @growi/attachment-text-extractor-client gen && git diff --exit-code packages/attachment-text-extractor-client/src/` を追加し、orval 出力 drift を検知する
  - CI に `git diff --exit-code packages/attachment-text-extractor-client/openapi.json` を追加し、上流のテスト (`export-openapi.integ.ts`) との 2 段 drift 検知を有効化する (上流 export 忘れ時に本 spec 側の CI が赤くなることを観察)
  - _Requirements: 2.1_
  - _Boundary: packages/attachment-text-extractor-client, CI_
  - _Depends: 1.1_

## 2. Foundation: Config / ES mapping / feature module scaffolding

- [x] 2.1 (P) `app:attachmentFullTextSearch:*` Config キー 4 件を config-definition に追加する
  - `extractorUri` / `extractorToken` / `timeoutMs` / `maxFileSizeBytes` の 4 キーを定義する
  - `extractorToken` には `isSecret: true` を付ける (環境変数の一覧表示で値を隠す。DB には他の設定の秘密と同じく平文で保存される)。`extractorUri` は `GROWI_ATTACHMENT_EXTRACTOR_URI`、`extractorToken` は `GROWI_ATTACHMENT_EXTRACTOR_SERVICE_TOKEN` を初期値に採り得るようにする
  - ConfigManager 経由で get/set できる。トークンの値が API の応答に出ないことは 8.4 のテストで固定する
  - _Requirements: 5.1, 5.2_
  - _Boundary: ConfigManager / config-definition_

- [x] 2.2 (P) ES 添付 index mapping を ES 8/9 変種ごとに作成する
  - `attachments-mappings-es8.ts` / `es9.ts` を追加し、`attachmentId` / `pageId` / `pageNumber` / `label` / `fileName` / `originalName` (text+keyword) / `fileFormat` / `fileSize` / `content` (kuromoji + ngram) / `attachmentType` / `created_at` / `updated_at` を定義する
  - **権限フィールド (`grant` / `granted_users` / `granted_groups` / `creator`) を含めない** ことを mapping snapshot test で固定する (Option D の構造的担保)
  - ES バージョン別 delegator が version-aware に正しい mapping を選択できること
  - _Requirements: 2.2, 2.5, 9.2_
  - _Boundary: ESDelegator extension / mappings_

- [x] 2.3 (P) feature module の DTO / interface ファイルを用意する
  - `apps/app/src/features/search-attachments/interfaces/attachment-search.ts` に `IAttachmentHit` / `ISnippetSegment` / `IAttachmentEsDoc` / `ExtractionOutcome` / `ExtractedPage` / `ExtractionFailureEntry` / `ReextractResponse` / `AttachmentSearchConfig` / `AttachmentSearchConfigUpdate` を定義する (検索結果の型 `IPrimarySearchResult` / `IResolvedSecondaryResult` は aggregator のファイルに置く)
  - `ExtractionOutcome` は `success` / `unsupported` / `tooLarge` / `timeout` / `serviceBusy` / `serviceUnreachable` / `encrypted` / `resourceLimit` / `failed` の判別共用体を export する
  - 型定義が中心で、runtime の値は「保存してあるファイルを読めなかった」ことを表す理由コード `FILE_READ_FAILED` だけを持つ
  - _Requirements: 1.4, 2.5, 8.3, 9.3, 9.4_
  - _Boundary: features/search-attachments/interfaces_

- [x] 2.4 (P) `IPageSearchMeta.attachmentHits?: IAttachmentHit[]` optional を既存応答型に追加する (検索結果の各項目では `meta.attachmentHits`)
  - `apps/app/src/interfaces/search.ts` に optional フィールドを追加し、既存 shape を破壊しない
  - 型エクスポート後に既存 Page 検索コードを build し、既存 caller のコンパイルが通ることを observe する
  - _Requirements: 9.3, 9.4_
  - _Boundary: interfaces/search_

- [x] 2.5 feature module の entry point を雛形として置く
  - `apps/app/src/features/search-attachments/server/index.ts` に `initAttachmentFullTextSearch(crowi)` の空関数を export する (後続タスクで実装を肉付け)
  - `features/search-attachments/server/{services,mappings,queries,routes/apiv1,routes/apiv3,middlewares}` ディレクトリ構成を作成する
  - 他タスクから import できる scaffolding が揃い、後続のサービス追加が既存コードに手を入れずに可能になる
  - _Requirements: 2.1_
  - _Boundary: features/search-attachments/server_
  - _Depends: 2.1, 2.2, 2.3_

## 3. Core: 抽出クライアントラッパ (`AttachmentTextExtractorService`)

- [x] 3.1 extractor URI allowlist バリデータを実装する
  - URI 文字列 parse で `http` / `https` 以外のスキームを reject、クラウドのメタデータの宛先 (リンクローカル `169.254.0.0/16` / `fd00:ec2::254` / `100.100.100.200` / `192.0.0.192` と host 名 `metadata.google.internal`。IPv4 射影 IPv6 や 10 進・16 進表記など、同じ宛先の別の書き方を含む) を reject する pure function を実装する
  - k8s 内部 DNS (`.cluster.local` / `.svc`) / loopback / RFC1918 は受理する
  - `file://` / `ftp://` / `data:` / metadata IP を含む URI が reject され、正当な k8s / docker-compose URI が受理される単体テストが通る
  - _Requirements: 5.2_
  - _Boundary: features/search-attachments/server/services (helper)_

- [x] 3.2 (P) `AttachmentTextExtractorService` 本体を実装する
  - FileUploader からバイト取得し `attachment-text-extractor-client` に multipart 送信、503 `service_busy` で exponential backoff + jitter 1 回 retry、2 回目 503 で `serviceBusy` 正規化
  - ファイルの読み込みは `timeoutMs` で打ち切り、読めなければ `failed` (`file_read_failed`) を返す
  - 同時に抽出するのはプロセス全体で 3 件まで (アップロード・個別再抽出・一括再インデックスで共有)。それを超える呼び出しは順番を待つ
  - 呼び出し元が待つのをやめたこと (`signal`) を受け取ったら、順番待ち・読み込み・要求・再試行を止める
  - 毎回 `configManager.getConfig('app:attachmentFullTextSearch:extractorToken')` を取得して `Authorization: Bearer` を付与、未設定時は `serviceUnreachable` 正規化
  - 上流 401 は `serviceUnreachable` 正規化 + pino ERROR + FailureLog 対象
  - 呼び出し直前に extractor URI の host (IPv6 の `[` `]` を外したもの) を名前解決し、結果がメタデータの宛先なら送信せず `serviceUnreachable` 正規化。リダイレクトには従わない
  - ネットワーク層 throw を catch-all し全経路で `ExtractionOutcome` を返す (throw しない) ことを単体テストで固定
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1_
  - _Boundary: features/search-attachments/server/services_
  - _Depends: 1.2, 2.1, 2.3, 3.1_

- [x] 3.3 抽出サービスの応答の大きさの上限と、呼び出し全体の制限時間を設ける
  - axios の `maxContentLength` で応答の大きさを制限し、`AbortSignal.timeout` で 1 回の呼び出し全体を打ち切る (呼び出し元の `signal` と合わせる)
  - 上限と制限時間を超えた応答が、例外にならずに決まった `ExtractionOutcome` になることを、本物の生成クライアントを代わりのサーバに向けるテストで固定する
  - _Requirements: 1.1, 1.3, 1.4_
  - _Boundary: features/search-attachments/server/services_

- [ ] 3.4 抽出の成功・失敗の件数と所要時間を、監視システムが収集できる形で公開する (Req 8.2。未実装)
  - いまあるのは pino の構造化ログと ExtractionFailureLog だけで、件数と所要時間を数値として取り出す口が無い
  - 既存の OpenTelemetry の仕組みに載せるか、別の公開の形にするかを決めてから実装する
  - _Requirements: 8.2_
  - _Boundary: features/search-attachments/server/services_

## 4. Core: ES delegator 拡張と query builder 群

- [x] 4.1 (P) `attachment-search-delegator-extension` に index ライフサイクル / bulk 操作を実装する
  - `ensureAttachmentIndex()` / `createRebuildIndex()` / `swapAttachmentAlias(index)` / `dropRebuildIndex(index)` (alias の裏の 2 つの実 index を交互に使う) と `syncAttachmentIndexed(..., targetIndex)` / `syncAttachmentRemoved(..., targetIndexes)` を追加する (`syncAttachmentIndexed` が受け取る index は 1 つで、indexer が対象の index ごとに呼ぶ)
  - doc ID を `${attachmentId}_${pageNumber ?? 0}` で決定し、`syncAttachmentIndexed` は 1 つの index に 1 回の `_bulk` で書き切る (ページごとに別 API コールにしない)
  - 既存 `ElasticsearchDelegator` と composition で合成し、既存 Page 系メソッドは不変であることを確認する
  - _Requirements: 2.2, 2.5, 3.1, 6.1, 9.2_
  - _Boundary: ESDelegator extension_
  - _Depends: 2.2_

- [x] 4.2 (P) 添付 index の名前と作成のタイミングを、他のアプリや既存の index とぶつからないようにする
  - 名前は page index 名 (Elasticsearch URI のパス) から `<page index>-attachments-alias` / `-attachments-1` / `-attachments-2` と導き、1 つの Elasticsearch を共有する GROWI 同士でぶつからないようにする (`attachmentIndexNames()` が唯一の出どころ)
  - alias を通す書き込みには `require_alias: true` を付け、alias が無いときに Elasticsearch が同名の実 index を自動作成しないようにする。失敗は他の ES 失敗と同じく例外として呼び出し側でログに残す
  - index は機能が有効なときだけ作る (起動時と、管理画面の設定保存で有効になったとき)。機能を使わない環境には作らない
  - _Requirements: 2.5, 9.2_
  - _Boundary: ESDelegator extension_
  - _Depends: 4.1_

- [x] 4.3 (P) 検索クエリ builder 群を pure function として追加する
  - `queries/build-attachment-search-query.ts` (`buildAttachmentSearchQuery`): 添付 index 全体を本文語で検索する body (権限フィルタを一切含めない) を組み立てる。facet=`attachments` が使う
  - `queries/build-attachments-by-page-ids-query.ts` (`buildAttachmentsByPageIdsQuery`): `terms: { pageId }` + 本文語の body を組み立てる。`collapse` で pageId ごとにまとめ、`inner_hits` で 1 ページあたり上位 5 件を返す。`pageIds.length > 20` で throw する。`GET /_api/v3/search/attachments` (検索結果のページへの添付ヒット) が使う
  - どちらも `_source` から `content` を除き、件数を数えない (`track_total_hits: false`)。本文語の句と強調表示の指定は `queries/attachment-keyword-query.ts` に共通化する
  - 2 つの builder それぞれの snapshot / unit test が通る
  - _Requirements: 4.1, 4.3, 4.4_
  - _Boundary: features/search-attachments/server/queries_

- [x] 4.4 (P) ES highlighter 出力 → `ISnippetSegment[]` parser を実装する
  - `queries/build-snippet-segments.ts` を pure function として追加し、`<em>...</em>` で囲まれた部分のみ `highlighted: true` に、それ以外を平文 segment に分割する
  - `<script>` / `<img onerror>` / 不正な `<em>` 入れ子を含む入力で crash せず、非 `<em>` タグは text セグメント内にそのまま保持され React text node で自動 escape される想定を test で固定
  - _Requirements: 9.3_
  - _Boundary: features/search-attachments/server/queries_

## 5. Core: FailureLog 永続化

- [x] 5.1 抽出失敗ログのコレクション `extractionfailurelogs` を Prisma モデルとして追加する
  - `apps/app/prisma/schema.prisma` に `attachmentId` / `pageId` / `fileName` / `fileFormat` / `fileSize` / `reasonCode` (`unsupportedFormat` / `fileTooLarge` / `extractionTimeout` / `serviceBusy` / `serviceUnreachable` / `fileEncrypted` / `resourceLimitExceeded` / `extractionFailed`) / `message` / `occurredAt` / `retentionGroupHash` と `v` (`__v`) を定義する。Mongoose の schema と `models/` ディレクトリは持たない
  - index は migration `20261117120000-add-indexes-to-extractionfailurelogs.js` で作る: `occurredAt_1` (90 日の TTL) と `retentionGroupHash_1`
  - migration の integ test で、作られる index の名前・キー・`expireAfterSeconds` (90 日) と、2 回実行しても変わらないこと、`down` で消えることを確かめる (期限切れの文書が実際に消えることまでは確かめない)
  - G2G 転送の対象外コレクション (`non-transferable-collections.ts`) に加える
  - _Requirements: 8.3_
  - _Boundary: apps/app/prisma/schema.prisma, apps/app/src/migrations_

- [x] 5.2 `ExtractionFailureLogService` を実装する
  - `record` / `listRecent({ limit, since })` / `totalRecent(since)` を提供する
  - `record` は `retentionGroupHash` (attachmentId + reasonCode) により重複を抑制する (同じ組が 1 時間以内にあれば、新しい行を足さずに `occurredAt` だけを更新する)
  - failure を pino 構造化ログと二重経路で記録し、admin API から取得可能な状態になることを unit test で確認
  - _Requirements: 3.4, 8.1, 8.3, 8.4_
  - _Boundary: features/search-attachments/server/services_
  - _Depends: 5.1_

## 6. Core: Indexer と Rebuild Batch

- [x] 6.1 `AttachmentSearchIndexer` を実装する (dual-write 対応込み)
  - `isFeatureEnabled()` (算出値 `isAttachmentFullTextSearchEnabled`: 検索サービスが設定済み AND `extractorUri` と `extractorToken` が空白以外で設定済み) で早期 return。ページに属さない添付 (`pageId` が無い) も対象にしない
  - 成功時は live alias に bulk upsert、**権限フィールドは一切書き込まない** (Option D 構造的担保)
  - アップロードでの失敗時 (`unsupported` / `tooLarge` / `timeout` / `serviceBusy` / `serviceUnreachable` / `encrypted` / `resourceLimit` / `failed`) は、先に `ExtractionFailureLogService.record` を呼び、その後で metadata-only 1 文書を upsert する (ES への書き込みが失敗しても、抽出の結果は記録に残る)
  - 個別再抽出 (`reindex`) での成功時は、新しい文書を書いてから、その添付の他の文書を消す (`removeStaleAttachmentDocs`)。失敗時は登録済みの文書に触れず、`ExtractionFailureLogService.record` だけを呼ぶ
  - 書いた後に MongoDB にまだ添付があるかを確かめ、無ければ書いた文書を消す (抽出中に削除された添付の文書が残らないように)
  - `reindexBatch.isRebuilding()` が true の間は live alias と `reindexBatch.getTmpIndexName()` 両方を `targetIndexes` として渡し dual-write する
  - tmp 側 write 失敗は live 側の成功を阻害せず pino warn のみに留めることを unit test で verify
  - `onDetach(attachmentId)` で該当 attachmentId の全 ES doc を削除する (dual-write 分岐も同様に適用。機能が無効でも削除する)
  - `reindex(attachmentId, { signal })` は `{ ok, outcome }` を return する (apiv3 reextract から呼ばれる窓口)。添付が無い・ページに属さない・機能が無効・想定外の例外のときは `ok: false`
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.4, 7.1_
  - _Boundary: features/search-attachments/server/services_
  - _Depends: 3.2, 4.1, 5.2_

- [x] 6.2 `AttachmentOrphanSweeper.sweep(targetIndex)` を実装する
  - 指定 index 上の unique pageId 集合を取得し、Page collection に存在しない pageId を持つ doc を tmp index から削除する (pageId の取得は 6.4 で分割した取り出しに変えた)
  - 失敗しても throw せず `{ removed, failed }` を返し、呼び出し側 rebuild 本体の成功を阻害しない
  - 独立トリガ (cron / pageEvent) を**持たない** ことを test で固定 (rebuildIndex 内からのみ呼ばれる)
  - _Requirements: 3.2, 4.4_
  - _Boundary: features/search-attachments/server/services_
  - _Depends: 4.1_

- [x] 6.3 `AttachmentReindexBatch` を実装する
  - `addAllAttachments(targetIndex)`: MongoDB の、ページに属する全 attachment を id 順に走査し、FileUploader からバイト取得 → extractor 経由 → `syncAttachmentIndexed` で作り直し先の index に bulk upsert、個別失敗は `ExtractionFailureLogService.record` してスキップ継続。最後に `AttachmentOrphanSweeper.sweep` を呼ぶ (alias swap **前**)
  - 障害を疑う結果 (`serviceUnreachable` / `serviceBusy` / `failed` の `file_read_failed` / その添付の処理が例外で終わった) を作り直し全体で数え (`rebuild-failure-budget.ts`)、`20 + ceil(対象数 × 5%)` に達したら例外で止める。最後まで走っても、処理した結果がすべて障害を疑うものだったら例外で終える
  - `startRebuild(rebuildPageIndex)` / `isRebuilding()` / `getTmpIndexName()` の in-memory lifecycle state を提供する。実行中フラグの上げ下ろしは batch 内部で行い、実行中の再呼び出しは `false` を返す
  - Socket.io `AddAttachmentProgress` (`{ totalCount, count }`) / `FinishAddAttachment` (`{ totalCount, count }`) / `AttachmentRebuildingFailed` (`{ error: string }`) を既存 progress チャネルで発行する
  - 作り直し先は alias が指していない方の実 index で、開始時に drop → create する (実 index は 2 つから増えない)
  - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - _Boundary: features/search-attachments/server/services_
  - _Depends: 3.2, 4.1, 5.2, 6.2_

- [x] 6.4 親ページが 10,000 を超える添付 index でも orphan sweep が全ページを確かめるようにする
  - composite aggregation で pageId を最後まで順に取り出し、MongoDB との照合と削除を分割して行う
  - sweep の削除を、`attachment-search-delegator-extension.ts` の共通の削除に揃える
  - _Requirements: 3.2_
  - _Boundary: features/search-attachments/server/services_

## 7. Core: 検索結果 Aggregator

> 7.1 の facet=`all`、7.2 の「失敗したら空を返す」と facet 引数、9.2 の `resolve` は、12 でやめる (research.md 12)。

- [x] 7.1 `AttachmentSearchResultAggregator.searchPrimary` を実装する
  - facet=`pages` は既存 Page 検索経路のみを呼び attachments_index を一切叩かない (完全互換)
  - facet=`all` かつ `from==0` では、先にページ検索を行い、その結果のうちページ検索が本文の抜粋を見せるページ (`snippetVisiblePageIds`: 結果の各項目が持つ MongoDB のページ文書に `canShowSnippetOfPage` を当てる) を選び、そのページの添付だけを検索して `meta.attachmentHits` に付ける。添付 index 全体は検索しない。添付の検索は pageId 20 件ごとに分け、1 ページあたり上位 5 件を返す
  - facet=`all` かつ `from>0` では attachments_index を叩かない
  - facet=`attachments` では attachments_index を優先検索し、unique pageIds を `searchAccessiblePages` (page_index の viewer filter + 検索演算子 + `canShowSnippetForGrant` + MongoDB での権限確認) にかけ、見てよいページの添付ヒットだけを点数順に並べる。窓は `ceil((from+size)×1.5)` 件から始め、足りなければ倍に広げて最大 200 件・最大 9 回まで。`meta.total` は常に null、`primaryResultIncomplete` は検索または権限確認が失敗したときだけ true
  - 800ms の safety net: facet=`all` の 1 ページ目は、要求の開始から数えて 800ms 以内に添付ヒットがそろわなければ、ページ検索の結果だけを返す。facet=`attachments` は空 items + `primaryResultIncomplete: true` を返す
  - 返却 `IPrimarySearchResult` の `items[].meta.attachmentHits[]` / `meta.total` / `meta.primaryResultIncomplete` が上記仕様どおりに埋まる
  - _Requirements: 3.3, 4.1, 4.2, 4.3, 4.4, 9.1, 9.3_
  - _Boundary: SearchService extension (AttachmentSearchResultAggregator)_
  - _Depends: 4.3, 4.4_

- [x] 7.2 `AttachmentSearchResultAggregator.resolveSecondary` を実装する
  - `primaryIds.length > ページサイズ` で 400 相当のエラーを返す
  - `primaryIds` はクライアントが送る値なので、毎回 `searchAccessiblePages` で viewer・検索演算子・本文の抜粋の規則を確かめ、通ったページの添付だけを検索する (消えたページ、権限を失ったページは対象から外れる)
  - secondary の処理が 500ms を超えたら enrichment を skip し、空の `IResolvedSecondaryResult` を返す
  - facet=`attachments` は primary で権限判定を済ませているので、何もせず空を返す
  - _Requirements: 3.3, 4.1, 4.2, 4.3, 4.4, 9.1, 9.3_
  - _Boundary: SearchService extension (AttachmentSearchResultAggregator)_
  - _Depends: 4.3, 7.1_

- [x] 7.3 permission 判定の fail-close 分岐を実装・固定する
  - 権限判定 (`searchAccessiblePages`) が失敗・タイムアウト・一部の shard の失敗になった場合は、**添付ヒットを全て除外**する (facet=`attachments` は空 + `primaryResultIncomplete`、facet=`all` はページを残して添付ヒットだけ除外、secondary は空)。ログではタイムアウトとそれ以外のエラーを区別する
  - 判定は ES の viewer filter とページ検索の本文抜粋の判定 (`canShowSnippetForGrant`) を単一の判定元にし、失敗を許可として扱う分岐が存在しないことを unit test で固定する。閲覧者が無い場合はゲストとして扱い、判定を飛ばさない
  - _Requirements: 4.1, 4.2, 4.4, 4.7_
  - _Boundary: SearchService extension (AttachmentSearchResultAggregator)_
  - _Depends: 7.1, 7.2_

## 8. Core: apiv3 エンドポイント群と `requiresReindex` 算出

- [x] 8.1 (P) `require-search-attachments-enabled` middleware を実装する
  - 算出値 `isAttachmentFullTextSearchEnabled` が false のとき 503 `feature_disabled` を返し、true のときのみ next を呼ぶ
  - 各 apiv3 route から共通利用されることを確認する (機能無効時 / URI 空文字 / token 未設定の各経路で 503 が返る)
  - _Requirements: 2.3, 5.4, 7.3_
  - _Boundary: features/search-attachments/server/middlewares_
  - _Depends: 2.1_

- [x] 8.2 `POST /_api/v3/attachments/:id/reextract` を実装する
  - middleware の順は `accessTokenParser([SCOPE.WRITE.FEATURES.ATTACHMENT])` → `loginRequiredStrictly` → `excludeReadOnlyUser` → `requireSearchAttachmentsEnabled` → `addActivity` → id の検証
  - **handler 内で毎回 Page の現在の権限を参照** して admin OR ページを閲覧できる利用者かを判定する (session / middleware cache を使わない)。不可の場合と、添付が無い・ページに属さない・親ページが無い場合は、区別のつかない 404 `notfound_or_forbidden`
  - `AttachmentSearchIndexer.reindex(attachmentId, { signal })` を呼び、`{ outcome: { kind } }` を返す。同じ添付への同時の要求は 1 回の抽出にまとめる (`reextract-gate.ts`)
  - 最後まで進められなかったとき (`ok: false`) は 500 `reextract_failed`、制限時間 (`timeoutMs × 2 + 30 秒`) を超えたら 503 `reextract_timeout` を返して処理を止める
  - 200 を返すときに監査ログの記録を `ATTACHMENT_REEXTRACT` (Medium のグループ) に確定する。それ以外は `UNSETTLED` のまま
  - 機能無効時は middleware が 503 `feature_disabled`。回数制限は 1 分あたり 5 回 (添付ごと)
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_
  - _Boundary: features/search-attachments/server/routes/apiv3_
  - _Depends: 6.1, 8.1_

- [x] 8.3 (P) `GET /_api/v3/search/attachments` (secondary enrichment) を実装する
  - `?q=&pageIds=id1,id2,...` を受理し `AttachmentSearchResultAggregator.resolveSecondary` に委譲する
  - `pageIds` 必須、要素数がページサイズ (default 20) を超過すると 400、空で 400
  - 機能無効時は 503 `feature_disabled`
  - _Requirements: 4.1, 9.1, 9.3_
  - _Boundary: features/search-attachments/server/routes/apiv3_
  - _Depends: 7.2, 8.1_

- [x] 8.4 (P) admin config エンドポイントと `requiresReindex` 算出サービスを実装する
  - `GET /_api/v3/admin/attachment-search/config`: `{ config: { extractorUri, hasExtractorToken, timeoutMs, maxFileSizeBytes, isAttachmentFullTextSearchEnabled, requiresReindex } }` を返す (`hasExtractorToken` は存在判定のみで、値は返さない)
  - `PUT /_api/v3/admin/attachment-search/config`: `extractorUri` (null / 空文字で soft-disable、allowlist 検証 400 `invalid_extractor_uri`) / `extractorToken` (write-only。前後の空白を除いて保存し、null・空文字・空白だけで削除。DB には平文で保存される) / `timeoutMs` (1,000〜600,000) / `maxFileSizeBytes` (1〜500MiB) を受理し、空の本文 `{}` を返す。保存後に機能が有効なら添付 index を作る (4.2)
  - `PUT` は `adminRequired` の後に `addActivity` を通し、成功時に監査ログの記録を `ADMIN_ATTACHMENT_SEARCH_SETTINGS_UPDATE` (Large のグループ) に確定する。記録にトークンの値を含めない。拒否・失敗は `UNSETTLED` のまま
  - `requiresReindex` は「ページに属する添付の数 (`prisma.attachments.count`)」> 「添付 index の `attachmentId` の cardinality」の算出、**Config collection に persist しない**、30 秒 TTL in-memory cache + `PUT config` 成功時 invalidate
  - `extractorToken` の値が GET 応答に含まれないことを、route を通すテスト (設定値にトークンを入れ、GET を呼んで応答に含まれないことを確かめる) で固定する
  - _Requirements: 5.1, 5.2, 5.3, 5.6_
  - _Boundary: features/search-attachments/server/routes/apiv3, Config service_
  - _Depends: 2.1, 3.1, 4.1_

- [x] 8.5 (P) `GET /_api/v3/admin/attachment-search/failures` を実装する
  - `?limit=N&since=iso` (`limit` は 1〜200、既定 50) を受理し `ExtractionFailureLogService.listRecent` + `totalRecent` に委譲して `{ items, total }` を返す
  - admin middleware で gate し、非 admin は 403 forbidden
  - _Requirements: 8.4_
  - _Boundary: features/search-attachments/server/routes/apiv3_
  - _Depends: 5.2_

- [x] 8.6 `PUT /_api/v3/search/indices` の `includeAttachments` フラグ受理を追加する
  - 既存 route に `includeAttachments?: boolean` を受理するよう最小差分で拡張する
  - `includeAttachments=true` かつ 機能有効時は `AttachmentReindexBatch.startRebuild(() => searchService.rebuildIndex(true))` を呼んで完了を待たずに 200 を返す。実行中なら 409 `rebuild_in_progress`
  - batch は裏で Page 再インデックス (既存) → alias が指していない方の実 index を作成 → 全添付を書き込み → orphan sweep → 作り直し中に削除された添付を新しい index から消す → alias swap を行い、失敗時 (障害を疑う結果が上限に達した場合を含む。6.3) は `AttachmentRebuildingFailed` を送り、作りかけの index を消して実行中フラグを下ろす (try/catch/finally は batch の内部)
  - alias `{page}-attachments-alias` と最初の実 index は、機能が有効なときだけ作る (起動時と、管理画面の設定保存で有効になったとき。4.2 参照)
  - `includeAttachments=false` のときは従来どおり Page/Comment のみ処理し添付の alias と実 index は据え置き、機能無効時は 503
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
  - _Boundary: apiv3 search route / ReindexBatch integration_
  - _Depends: 6.3, 8.1_

## 9. Integration: Crowi 配線 / SSR prop / AttachmentService handler

- [x] 9.1 `initAttachmentFullTextSearch(crowi)` を Crowi 初期化から呼び出す
  - `apps/app/src/server/crowi/index.ts` に searchService / attachmentService 初期化完了後の配線点を追加する
  - feature module 内で `attachmentService.addAttachHandler(indexer.onAttach)` / `addDetachHandler(indexer.onDetach)` / Aggregator の SearchService への注入を行う
  - 検索サービスが設定済みなら常に配線し、有効かどうかは各処理が呼ばれるたびに確かめる (管理画面で有効にしたときに再起動が要らない)。無効の間は抽出サービスを呼ばず文書も作らず、既存挙動と完全互換であることを integ test で確認
  - _Requirements: 2.1, 2.3, 3.1, 9.1_
  - _Boundary: apps/app crowi init, features/search-attachments/server entry_
  - _Depends: 6.1, 7.1_

- [x] 9.2 SearchService の multi-index 経路として Aggregator を組み込む
  - `apps/app/src/server/service/search.ts` の search entry に `facet` / `resolve` パラメタを受け、Aggregator.searchPrimary を呼ぶ分岐を追加する
  - facet=`pages` では既存 Page 検索経路のみを維持 (attachments 関連コードを通らない non-refactoring を observe)
  - **`registerUpdateEvent()` への添付向け pageEvent リスナ追加は行わない** ことをコメントで明記 (Option D)
  - _Requirements: 3.3, 4.1, 4.2, 9.1_
  - _Boundary: SearchService_
  - _Depends: 7.1, 7.2_

- [x] 9.3 (P) `SearchConfigurationProps.searchConfig` SSR prop を拡張する
  - `apps/app/src/pages/basic-layout-page/types.ts` に `isAttachmentFullTextSearchEnabled?: boolean` を optional として追加する (hydrate 層で `?? false` に正規化する責務は下流 UI spec)
  - `apps/app/src/pages/basic-layout-page/get-server-side-props/search-configurations.ts` の `getServerSideSearchConfigurationProps` で算出値 `isAttachmentFullTextSearchEnabled(searchService.isConfigured)` を props に含める
  - SSR props に `extractorToken` の値を含めない (boolean 算出の入力にのみ用いる) ことを unit test で固定
  - _Requirements: 5.1, 5.4_
  - _Boundary: basic-layout-page SSR props_
  - _Depends: 2.1_

- [x] 9.4 機能が無効のときの `GET /_api/search` を、機能導入前と完全に同じにする
  - `facet` の値の検査は、機能が有効なときだけ行う (research.md 10.11)
  - 機能が無効のときは `facet` / `resolve` を読まず、従来のページ検索をそのまま行う
  - _Requirements: 9.1_
  - _Boundary: apps/app/src/server/routes/search.ts_

## 10. Validation: Integration / Performance tests

- [x] 10.1 添付アップロード / 削除の E2E 経路を integ test で固定する (`attachment-indexing-lifecycle.integ.ts`: 本物の `AttachmentService` と `initAttachmentFullTextSearch`、本物の抽出クライアントを手元の代わりの抽出サービスにつなぎ、本物の ES に書く)
  - 添付アップロード → attach handler → alias に書かれた文書数が抽出 pages 数と一致すること
  - ES 文書に `grant` / `granted_users` / `granted_groups` / `creator` が一切含まれないこと (文書の項目が決まった 12 項目だけであることで確かめる)
  - 添付削除 → detach handler → 該当 attachmentId の全文書が削除されること。機能を無効にした後の削除でも消えること
  - 機能無効時 (URI 空文字) → 抽出サービスへの要求が 1 件も無く、文書も作られず、添付の保存は通常どおりであること。ページの無い添付も抽出・登録されないこと
  - _Requirements: 2.1, 2.2, 2.5, 3.1, 9.1_
  - _Boundary: integration_

- [x] 10.2 query-time permission lookup (検索結果のページへの添付ヒット / facet=attachments) を integ test で固定する (`attachment-search-permission.integ.ts`: 本物の ES と MongoDB で、7 種類の閲覧者 × 公開範囲 × 一覧ポリシー 4 通り × 2 経路を、ページ検索そのものを正解として比較)
  - 親ページ権限変更直後に ES を触らずに次回検索で添付ヒット可視性が更新されること (MongoDB の権限確認で、page_index の同期が遅れていても即座に反映される)
  - 親ページ削除後 rebuildIndex 前でも添付ヒットが primary の権限判定により除外されること
  - `AttachmentOrphanSweeper` が親 Page 不在の doc を削除することは、ES を mock した単体テスト (`attachment-orphan-sweeper.spec.ts`) で確かめている。本物の ES を使うテストは無い
  - `GET /search/attachments?q=...&pageIds=...` (secondary endpoint) が `pageIds.length` 超過で 400、消失/権限失効ページを権限判定で除外すること
  - _Requirements: 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 9.1, 9.3_
  - _Boundary: integration_

- [x] 10.3 rebuild window 中の dual-write integ test を追加する (`attachment-indexing-lifecycle.integ.ts` の「during a rebuild」。走査は代わりの抽出サービスが特定の添付への応答を止めることで途中に留める)
  - rebuild 実行中に `AttachmentService.createAttachment()` / `removeAttachment()` を発火させ、アップロードは旧 index と作り直し先の両方に入り、削除は両方から消えること。実行中の 2 回目の `startRebuild()` は何も始めず `false` を返すこと
  - alias swap 後に alias が作り直し先を指し、alias への検索で作り直し中にアップロードした添付がヒットすること。作り直し中に削除した添付は残らないこと
  - 走査がある添付を抽出している間にその添付が削除されても、swap 後の index に残らないこと
  - 作り直し先に書き込み禁止 (`index.blocks.write`) を設定して書き込みを失敗させても、アップロードは通常どおり終わり、旧 index (live) 側には書かれていること (作り直し先を消すだけでは、書き込みが同じ名前の index を自動で作るので失敗にならない)
  - `startRebuild()` に渡したページの作り直しが例外で止まっても `isRebuilding()` が false に戻り、alias が旧 index を指したままで、`AttachmentRebuildingFailed` が送られ、次の作り直しを始められること
  - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - _Boundary: integration_

- [x] 10.4 (P) extractor / auth / allowlist の fail-close 経路を integ test で固定する (`attachment-extractor-fail-close.integ.ts`)
  - 上流 401 `unauthorized` が `serviceUnreachable` に正規化され、`GET /failures` に記録が出て、ERROR のログが出ること。ログに token の値が含まれないこと
  - extractorToken 未設定時に抽出サービスへの要求が 1 件も無く、`GET /config` の `isAttachmentFullTextSearchEnabled` が false になること
  - extractorUri の host の名前解決が metadata IP を返すとき、要求を送らずに `serviceUnreachable` になること (名前解決だけを差し替え、URI は手元の代わりの抽出サービスを指す。差し替えない場合は要求が届くことも確かめる)
  - admin PUT で `file://` / `ftp://` / `data:` / metadata IP (表記ちがいを含む) を指定した URI が 400 `invalid_extractor_uri` になり、RFC1918 と k8s 内部 DNS の URI は受理されること
  - _Requirements: 1.1, 1.3, 1.4, 5.2_
  - _Boundary: integration_

- [x] 10.5 (P) `requiresReindex` 算出・キャッシュを integ test で固定する (`attachment-search-admin.exclusive.integ.ts`: 添付の総数を数えるので、コレクションを空にできる exclusive の DB で走らせる。機能の有効化と設定の変更は PUT /config で行う)
  - 機能有効化直後 (既存添付 N 件、ES 0 件) で `true`、作り直しの完了後に再計算すると (ES N 件) `false` になること
  - 作り直しの完了直後は 30 秒のキャッシュが前の値 (`true`) を返し、`PUT config` が成功すると次回 GET で再計算されること
  - 機能無効、または添付が 0 件のときは、alias が無くても `false` になること (ES に問い合わせると alias が無いので `true` になるため、問い合わせていないことが分かる)。添付があって alias が無いときは `true` になること
  - _Requirements: 5.3_
  - _Boundary: integration_

- [x] 10.6 (P) reextract handler の current grant 再チェックを integ test で固定する (`attachment-reextract.integ.ts` の「who may call it」)
  - 一度は 200 を返した利用者でも、親ページの権限をその人が閲覧できないものに変えた直後の `POST /attachments/:id/reextract` は 404 `notfound_or_forbidden` になること (Req 7.2。権限が無いことと添付が無いことを区別しない)
  - 現在の権限で閲覧できる利用者と admin には 200 + 結果の種別 (`kind`) だけを返すこと
  - _Requirements: 7.1, 7.2_
  - _Boundary: integration_

- [x] 10.7 (P) 添付 index の名前の分離と `require_alias` を integ test で固定する (`attachment-index-names.integ.ts`)
  - page index 名の違う 2 つの設定 (一方の名前がもう一方の先頭部分になる組み合わせ) で作成・作り直し・後始末を行い、互いの alias と実 index と文書に触れないこと
  - alias が無い状態で添付を書き込むと失敗し (例外にならず `require_alias` の失敗としてログに残り)、alias と同じ名前の実 index が作られず、後から alias を作れること。alias が無い状態の削除は何も作らずに終わること
  - _Requirements: 9.2_
  - _Boundary: integration_

- [x] 10.8 検索の速さを perf test で確認する (`attachment-search-performance.integ.ts`: 手で走らせる測定。`ATTACHMENT_SEARCH_PERF=1` のときだけ動き、CI では飛ばす。測定値は research.md 8.7 / 12)
  - 測定はアプリを起動して HTTP で送る。経路の順番は 1 回ごとに入れ替える (research.md 8.7 の最後の測定)
  - 測る経路を、機能有効時の `facet` なしの `GET /_api/search`、`GET /_api/v3/search/attachments` (20 ページ分)、`facet=attachments` の 3 つにする。facet=`all` の経路は外す
  - 機能有効時の `facet` なしの `GET /_api/search` の p95 が、機能無効時のページ検索と同等であること (添付 index を使わないので同じ処理になる) — 2026-11-20 のアプリ経由の測定で、比は p95 で 0.96〜1.08 倍
  - `GET /_api/v3/search/attachments` の p95 が 500ms 以内であること (ページ検索の結果の表示を待たせない) — 2026-11-20 のアプリ経由の測定で 36.5〜42.3ms
  - 時間の上限を超えたとき、`facet=attachments` が `primaryResultIncomplete: true` を返し、`GET /_api/v3/search/attachments` がエラーを返すこと (`attachment-search-result-aggregator.spec.ts` で固定する)
  - _Requirements: 9.1, 9.2, 9.5_
  - _Boundary: performance_
  - _Depends: 12.1, 12.2_

## 11. 抽出サービスへの送信の修正

- [x] 11.1 添付ファイルを、本物のファイルの部品として抽出サービスに送る
  - 送る内容を `extract-request-body.ts` で組み立てる (design.md の AttachmentTextExtractorService の「送る内容」)
  - 本物の生成クライアントを、受け取った要求を記録するだけのサーバに向けて、ファイルの部品・ファイル名・`mimeType` の項目が決まりどおりに届くことを確かめる
  - `file_encrypted` と `resource_limit_exceeded` を、それぞれの結果 (`encrypted`、`resourceLimit`) と失敗の理由コード (`fileEncrypted`、`resourceLimitExceeded`) に対応させる
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 8.3_

- [x] 11.2 `maxFileSizeBytes` を超える添付を、読まずに `tooLarge` にする
  - ファイルを読む前に、保存してある大きさと設定を比べる。超えたら、読まず、送らない。上限ちょうどは送る
  - 抽出サービスが 413 `file_too_large` を返したとき、本物の生成クライアントを通して `tooLarge` になることをテストで固定する
  - _Requirements: 8.3_

## 12. ページと添付をまとめた検索 (`facet=all`) と `resolve` をやめる

- [x] 12.1 `GET /_api/search` から `facet=all` と `resolve` を取り除く
  - 機能が有効なとき、`facet` は `pages` と `attachments` だけを受け付け、それ以外 (`all` を含む) は `{ ok: false, code: 400 }` にする。`resolve` は読まない。機能が無効のときは、これまでどおり `facet` を読まない
  - `AttachmentSearchResultAggregator.searchPrimary` を `facet=attachments` の検索だけにする。facet=`all` の処理 (`searchPrimaryAll`、`snippetVisiblePageIds`、2 ページ目以降の分岐) と、`SearchService.searchByFacet` の `resolve` / `attachSecondaryHits` を消す
  - `SearchFacet` / `IFacetedSearchResultMeta` / `IPrimarySearchResult` を design.md の形にする。`GET /_api/search` の OpenAPI の説明から `all` と `resolve` を消す
  - 消した処理のテストを消し、機能が有効でも `facet` なし・`facet=pages` の `GET /_api/search` が添付 index に触れず、機能が無効のときと同じ応答を返すことを結合テストで固定する。権限の比較の結合テスト (`attachment-search-permission.integ.ts`) は、検索結果のページへの添付ヒットと `facet=attachments` の 2 経路にする
  - `attachment-search-routes.integ.ts` は、ゲスト・アクセストークン・トークンの範囲・機能が無効のときの確認を facet=`all` で行っている。これらは消さずに `facet=attachments` に移す
  - _Requirements: 9.1, 9.3, 9.5_
  - _Boundary: apps/app/src/server/routes/search.ts (と `search.spec.ts`), SearchService (と `search.spec.ts`), AttachmentSearchResultAggregator, `features/search-attachments/server/routes/apiv1/facet-search-contract.ts` (と `.spec.ts`), interfaces/search.ts, `attachment-search-routes.integ.ts`, `attachment-search-permission.integ.ts`_

- [x] 12.2 `GET /_api/v3/search/attachments` の失敗を、空の結果で隠さずエラーで返す
  - `resolveSecondary` は、権限確認か添付の検索が失敗するか 500ms を超えたら例外を投げる。ルートは 500 を返す
  - `resolveSecondary` の `facet` 引数と、応答の `facet` を消す (応答は `{ enrichments }`)
  - 機能が無効のときなど aggregator が無いとき、`SearchService.resolveAttachmentSecondary` が空の結果を返す分岐も、例外にする。`routes/apiv3/search-attachments.ts` の先頭の説明に 500 を足す
  - _Requirements: 4.1, 9.5, 9.6_
  - _Boundary: AttachmentSearchResultAggregator, SearchService, features/search-attachments/server/routes/apiv3 (`search-attachments.ts` と `.spec.ts`)_
  - _Depends: 12.1_

## 13. 下流の画面 (`attachment-search-ui`) のための追加

- [x] 13.1 添付だけを対象にした検索の項目に、ページ検索と同じページ文書を入れる
  - `GET /_api/search` の `facet=attachments` の処理で、aggregator が返したページ ID を `findPageListByIds` で読み、各項目の `data` に入れる。`lastUpdateUser` の `serializeUserSecurely` と `seenUserCount` は、ページ検索の `formatSearchResult` と同じにする (同じ処理を共有する)
  - MongoDB に無いページの項目は落とす。`meta.hitsCount` は落とす前の項目数のままにする
  - ページが MongoDB から消えていても `hitsCount` が減らないこと、`data` に `path`・`revision`・`lastUpdateUser` が入ることを、route のテストで固定する。権限で見えないページが入らないことは、既存の権限の結合テストで確かめる
  - ページのパス・本文・コメントも検索語に一致する項目には、ページ検索と同じ抜粋 (`meta.elasticSearchResult`) を入れる。返すページの id に絞り、ページ検索と同じ組み立てで page_index を 1 回検索する。抜粋の作り方 (`canShowSnippet`、`filterXss`) は `formatSearchResult` と共有する。失敗と 500ms 超過では抜粋を付けずに返し、ログに残す
  - 本文も一致したページにだけ抜粋が付くこと、一致しないページと抜粋の検索が失敗したときは抜粋なしで項目が返ることを、テストで固定する
  - OpenAPI の `facet=attachments` の応答の説明を直す
  - _Requirements: 9.7_
  - _Boundary: apps/app/src/server/routes/search.ts (と `search.spec.ts`), SearchService (`formatSearchResult` の共有部分と、項目の組み立て), ElasticsearchDelegator (ページ検索のクエリの組み立てを `search()` と共有する、id に絞ったページ検索 `searchWithinPages`), `features/search-attachments/server/routes/apiv1/facet-search-contract.ts`_

- [x] 13.2 設定の取得 API で、環境変数で固定されているかを返す
  - `GET /_api/v3/admin/attachment-search/config` の `config` に `useOnlyEnvVars` (`env:useOnlyEnvVars:app:attachmentFullTextSearch` の値) を足す。`AttachmentSearchConfig` の型と、route のファイル先頭の一覧の説明を直す (この feature の route には OpenAPI の記述が無い)
  - 固定されているときと、されていないときの両方で値が返ることを、route のテストで固定する
  - _Requirements: 5.7_
  - _Boundary: features/search-attachments/server/routes/apiv3/attachment-search-admin.ts (と `.spec.ts`), features/search-attachments/interfaces/attachment-search.ts_

- [x] 13.3 添付だけを対象にした検索で、抜粋を入れる項目にブックマーク数も入れる
  - `searchWithinPages` が返す hit の `_source.bookmark_count` を、抜粋を入れる項目の `meta.bookmarkCount` に入れる (ページ検索の `formatSearchResult` と同じく、無ければ 0)。抜粋の無い項目には入れない
  - 抜粋の付いた項目にブックマーク数が入ること、抜粋の無い項目には入らないことをテストで固定する。本物の Elasticsearch の結合テスト (`attachment-search-routes.integ.ts`) でも、抜粋の付いた項目の `meta.bookmarkCount` が数であることを確かめる
  - _Requirements: 9.8_
  - _Boundary: SearchService (`formatFacetSearchItems`)_
  - _Depends: 13.1_
