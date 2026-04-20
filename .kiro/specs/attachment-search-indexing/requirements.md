# Requirements Document

## Project Description (Input)

### 背景と問題

GROWI の Elasticsearch 連携では Page の `path` / `body` / `comments` のみがインデックス対象で、ページに添付された PDF/Office/テキスト系ファイルの本文は検索できない。umbrella spec [`full-text-search-for-attachments`](../full-text-search-for-attachments/) の 3-way split により、本 spec (`attachment-search-indexing`) は **apps/app サーバ側の統合責務** を担当する。抽出処理本体は上流 spec [`markitdown-extractor`](../markitdown-extractor/) が、検索結果 UI / 管理画面 UI は下流 spec [`attachment-search-ui`](../attachment-search-ui/) が担当する。

### 現状

- Elasticsearch 連携は [apps/app/src/server/service/search-delegator/elasticsearch.ts](apps/app/src/server/service/search-delegator/elasticsearch.ts) に存在
- `AttachmentService` は `addAttachHandler` / `addDetachHandler` の拡張ポイントを持つが fire-and-forget で例外を握りつぶす
- ページ権限変更は `pageEvent.emit('updateMany'|'syncDescendantsUpdate', ...)` で発火、`SearchService` が `registerUpdateEvent()` で購読して page_index を同期
- 既存 `rebuildIndex()` は tmp index → alias swap パターン、Socket.io で進捗通知
- Attachment モデルはメタデータのみで、テキスト本文は保持しない

### あるべき姿 (本 spec のスコープ)

- 添付専用 Elasticsearch インデックス `attachments` (ES 7/8/9 対応 mapping) が存在。**権限情報 (grant / granted_users / granted_groups / creator) は保持しない**
- 添付アップロード時に自動で抽出サービスを呼び出し、結果を ES にインデックスする (1 添付 = N 文書)
- 添付削除は即時 ES に反映される。親ページ削除・権限変更は **query-time permission lookup** により検索時に整合が取れる (添付 ES 文書の更新は不要)
- 既存添付を一括でインデックス化する admin 操作を提供 (`rebuildIndex` 拡張)。親 Page が不在の添付 doc は orphan sweeper が cleanup する
- 個別添付を再抽出する apiv3 エンドポイントを提供
- 抽出失敗が MongoDB に永続化され admin が参照可能
- 検索クエリが Page index と Attachment index を multi-index で評価し、**添付のみヒットのページについては page_index を viewer filter 付きで lookup して権限判定**、親ページ単位に集約した応答型を返す
- 抽出サービス到達不可時も apps/app の添付保存と既存検索は継続動作
- 機能無効時は既存検索 API の挙動が機能導入前と完全一致 (非互換ゼロ)
- **核心メリット**: 権限情報を添付側に snapshot しない query-time permission lookup 方式 (Option D) の採用により、sync drift 起因の snippet 漏洩は**構造的に発生しない**

### 採用アプローチ

既存の `ElasticsearchDelegator` / `SearchService` / `AttachmentService` / `ConfigManager` を拡張し、apps/app 内に新規 feature module `features/search-attachments/server/` を配置する。抽出サービスへの HTTP 呼び出しは新規 `packages/markitdown-client` (orval 生成) を経由。独立 delegator は作らず、既存 ES delegator に composition で添付向けメソッドを追加する。**権限は添付 ES 文書に snapshot せず、検索時に page_index を viewer filter 付きで lookup する query-time permission lookup 方式 (Option D) を採用**。この設計により、添付側で権限同期リスナ (pageEvent 購読) を用意する必要がなく、sync drift 起因の snippet 漏洩が構造的に発生しない。

### スコープ

- **In**: 添付 ES インデックス mapping / ハンドラ登録 / 権限変更連動 / 一括再インデックス / 個別再抽出 API / 失敗ログ model / admin API (設定・失敗ログ) / multi-index 検索集約 / 応答型拡張 / Config キー追加 (`extractorUri` / `timeoutMs` / `maxFileSizeBytes` の 3 キー、`extractorUri` は admin Config として扱う) / `packages/markitdown-client` orval パイプライン
- **Out**:
  - Python 抽出サービス本体の実装・Dockerfile・k8s manifest (上流 `markitdown-extractor` spec の責務)
  - 検索結果 UI / 添付一覧モーダル UI / 管理画面 UI (下流 `attachment-search-ui` spec の責務)
  - 添付ファイル保管方式の変更 (`FileUploader` 抽象は据え置き)
  - 既存 Page 検索のクエリ・ランキング・権限モデル本体の改変
  - 永続ジョブキュー化 (fire-and-forget 継続)
  - チェックポイント再開型の bulk 再インデックス

### 制約

- ライセンス: MIT / Apache-2.0 / BSD 系のみ (orval は MIT)
- 対応 OS: apps/app は Windows/macOS/Linux 全対応を維持 (`packages/markitdown-client` は純 TS で cross-platform)
- ES バージョン: 既存 7/8/9 を維持 (mapping 変種を `attachments-mappings-esN.ts` に分離)
- 非互換ゼロ: 機能無効時は既存検索 API のレイテンシ・結果順序・応答形式を機能導入前と同一にする
- API 後方互換: `IPageWithSearchMeta.attachmentHits` は optional に限定
- OpenAPI drift 検知: CI で上流 `services/markitdown-extractor/` の OpenAPI spec と `packages/markitdown-client/openapi.json` の差分を検知
- ハンドラ fire-and-forget 特性: 例外は pino ログと FailureLog 永続化で確実に捕捉

詳細は [brief.md](./brief.md) を参照。

## Introduction

本 spec は GROWI の添付ファイル全文検索機能のうち、**apps/app サーバ側の統合層**を定義する。具体的には、上流の抽出マイクロサービス (`markitdown-extractor`) が提供する OpenAPI を orval で TypeScript クライアント化し、添付アップロード・削除・親ページ権限変更といった既存イベントにフックして Elasticsearch への書き込みを行う。さらに、一括再インデックス・個別再抽出・抽出失敗の永続化といった運用系 API を提供し、検索実行時には Page index と添付専用 index を multi-index でクエリして親ページ単位に集約した応答を返す。

本 spec は上流 `markitdown-extractor` spec の API 契約 (`POST /extract` のリクエスト/レスポンス schema、エラーコード体系) に依存し、下流 `attachment-search-ui` spec に対して apiv3 エンドポイント契約と `IPageWithSearchMeta.attachmentHits[]` 応答型を提供する。UI コンポーネント・admin 画面の描画・ユーザ向けガイダンス文言は本 spec の責務外であり、下流 spec に委譲する。

機能無効時には抽出サービスへの呼び出しを行わず、既存検索 API の挙動を機能導入前と完全一致させることが絶対要件となる。抽出サービス到達不可時にも apps/app の添付保存・既存 Page 検索は継続動作する。

## Boundary Context

- **In scope (本 spec の責務)**:
  - 抽出サービスクライアントラッパ (タイムアウト/エラー正規化/到達不可時フォールバック)
  - 添付専用 Elasticsearch インデックス (`attachments`) の mapping 定義と CRUD 操作 (**権限フィールドは保持しない**)
  - `AttachmentService.addAttachHandler` / `addDetachHandler` への indexer 登録
  - **Query-time permission lookup**: 検索時に page_index を viewer filter 付きで参照し、添付ヒットを app 側で filter する方式の実装 (添付 ES 文書への partial update は行わない)
  - 親 Page が不在の添付 doc を eventual に cleanup する orphan sweeper (rebuildIndex 統合、real-time cascade 削除は行わない)
  - 一括再インデックスのサーバ側バッチ処理と Socket.io 進捗イベント発行 (UI 描画は対象外)
  - 個別再抽出 apiv3 エンドポイント (`POST /_api/v3/attachments/:id/reextract`)
  - admin 用 apiv3 エンドポイント (`GET/PUT /_api/v3/admin/attachment-search/config`, `GET /failures`)
  - `PUT /_api/v3/search/indices` の `includeAttachments` フラグ受理
  - 抽出失敗の MongoDB 永続化 (`ExtractionFailureLog`) と集計
  - Config キー群 (`app:attachmentFullTextSearch:extractorUri` / `:timeoutMs` / `:maxFileSizeBytes` の 3 キー) の定義と ConfigManager 経由の永続化。`extractorUri` は admin Config として扱い、環境変数 `GROWI_MARKITDOWN_EXTRACTOR_URI` を初期値として採り得る (既存 `app:elasticsearchUri` と同等のパターン)。機能の「有効/無効」は独立した Config キーを持たず、`searchService.isConfigured && extractorUri != null && extractorUri !== ''` の**算出値**として扱う。`maxConcurrency` は抽出サービス側の env var 専用で Config キーとしては提供しない
  - multi-index msearch のクエリビルダ、viewer フィルタ、pageId 集約
  - 応答型 `IPageWithSearchMeta.attachmentHits[]` の optional 追加 (後方互換)
  - 機能無効化ゲートの全サーバ側入口への適用
  - 抽出成功/失敗/スキップの pino 構造化ログと監視メトリクス公開
  - `packages/markitdown-client` の orval 生成パイプラインと OpenAPI drift 検知

- **Out of scope (他 spec の責務)**:
  - **上流 (`markitdown-extractor` spec)**: Python FastAPI 抽出サービス本体、Dockerfile、docker-compose / k8s manifest、セキュリティハードニング、OpenAPI エクスポートスクリプト
  - **下流 (`attachment-search-ui` spec)**: 検索結果 UI (左ペイン集約・右ペイン添付ヒットカード・ファセットタブ)、添付ファイル一覧モーダルの「再抽出」ボタン、管理画面の設定フォーム・失敗ログパネル・rebuild チェックボックス・UI ガイダンス文言
  - 添付ファイル本体の保管方式変更 (`FileUploader` は据え置き)
  - 既存 Page 検索 (Page/Comment) のクエリ・ランキング・権限モデル本体の改変
  - Elasticsearch サポートバージョン範囲の変更
  - 永続ジョブキュー基盤の導入

- **Adjacent expectations (本 spec が前提とする隣接要素)**:
  - 上流 `markitdown-extractor` が `POST /extract` (multipart) を提供し、`pages[]` / エラーコード体系を返すこと
  - 上流 spec が `/openapi.json` を正しく出力し、`packages/markitdown-client/openapi.json` にコミットされ drift 検知 CI が機能すること
  - 既存 `AttachmentService` のハンドラ登録点、`pageEvent` の発火点、`FileUploader` の バイト取得 API が現行の契約を維持すること
  - 既存 `ElasticsearchDelegator` の `rebuildIndex()` tmp index → alias swap パターン、`filterPagesByViewer` 権限モデルを流用可能な形で維持すること
  - 既存 Socket.io progress チャネル (`AddPageProgress`, `FinishAddPage`, `RebuildingFailed`) と同経路で添付向け進捗イベントを発行できること
  - 下流 `attachment-search-ui` spec が本 spec の apiv3 エンドポイント契約と `IPageWithSearchMeta.attachmentHits[]` 応答型を消費し、UI を描画すること

## Requirements

### Requirement 1: 抽出サービス呼び出しの障害隔離とフェールオーバ <!-- derived from umbrella R2.4, R2.5, R13.4 -->

**Objective:** SRE として、抽出サービスの障害が apps/app 本体の添付アップロードや既存検索を停止させないよう、到達不可・タイムアウト・エラー応答を apps/app 側で吸収したい

#### Acceptance Criteria

1. If 抽出サービスへの呼び出しが失敗するかタイムアウトする, the apps/app shall 添付本体の保存処理を成功させ、当該添付を検索対象外として扱う <!-- derived from umbrella R2.4 -->
2. The apps/app shall 抽出成功・失敗・スキップ・再試行の各イベントを構造化ログに記録する <!-- derived from umbrella R2.5 -->
3. Where 抽出サービスが到達不可能または `extractorUri` が未設定 / 空である (算出値 `isAttachmentFullTextSearchEnabled` が false), the apps/app shall 添付アップロードと既存検索を従来どおり動作させる <!-- derived from umbrella R13.4 -->
4. If 抽出サービス到達不可の結果が返る, the apps/app shall ExtractionOutcome を `serviceUnreachable` に正規化し例外を throw しない

### Requirement 2: 添付アップロード時の自動インデックス化 <!-- derived from umbrella R3.1〜R3.5 -->

**Objective:** GROWI 利用者として、添付ファイルをアップロードしたら自動で検索対象になってほしい、検索のための追加操作を不要にするため

#### Acceptance Criteria

1. When `extractorUri` が設定済み (算出値 `isAttachmentFullTextSearchEnabled` が true) かつ対応形式の添付ファイルがページにアップロードされる, the apps/app shall 抽出サービスを呼び出してテキストを取得し、抽出結果を Elasticsearch にインデックスする <!-- derived from umbrella R3.1 -->
2. When 添付ファイルの抽出結果が複数の pages 要素を含む, the apps/app shall 各要素を個別の ES 文書としてインデックスする <!-- derived from umbrella R3.2 -->
3. Where `extractorUri` が未設定または空である (算出値 `isAttachmentFullTextSearchEnabled` が false), the apps/app shall 抽出サービスを呼び出さず、添付アップロードフロー全体の挙動を機能導入前と完全に一致させる <!-- derived from umbrella R3.3 -->
4. If 抽出呼び出しが失敗するか、対象がサポート対象外形式か、ファイルサイズ上限を超える, the apps/app shall 添付メタデータのみの ES 文書を作成しコンテンツを空として登録する <!-- derived from umbrella R3.4 -->
5. The ES 添付文書 shall 添付ファイル識別子、親ページ識別子 (`pageId`)、`pageNumber`、`label`、抽出コンテンツ、ファイル名、ファイル形式、ファイルサイズ、添付種別、作成/更新時刻を含む。**権限情報 (grant 種別・granted_users・granted_groups・creator) は添付文書に持たない** (query-time に `pageId` をキーとして page_index を参照して解決する) <!-- derived from umbrella R3.5 -->

### Requirement 3: 添付削除と orphan cleanup (親ページ変更は query-time で自動解決) <!-- derived from umbrella R4.1〜R4.4 -->

**Objective:** GROWI 管理者として、削除された添付や閲覧不可になった添付の検索ヒットが残らないようにしたい、情報漏洩と混乱を防ぐため。親ページ権限変更への追従は query-time permission filter により構造的に保証される (同期不要)

#### Acceptance Criteria

1. When 添付ファイルが削除される, the apps/app shall 該当添付に紐づく全 ES 文書を削除する <!-- derived from umbrella R4.1 -->
2. When 親ページが削除される, the apps/app shall orphan cleanup (rebuildIndex 実行時に親 Page 不在の添付 doc を eventual に削除) により整合性を保つ。real-time cascade は行わないが、**query-time permission filter により親 Page 削除後の snippet 漏洩は発生しない** (検索時に page_index に存在しない pageId はアクセス不可と判定され結果から除外される) <!-- derived from umbrella R4.2 -->
3. When 親ページの権限 (grant 種別 / granted users / granted groups) が変更される, the 検索 UI shall **query-time に親 Page の最新権限を page_index から参照して添付ヒットを filter する** (添付 ES 文書の更新は不要)。これは非機能的な保証であり、apps/app 側に添付用の権限同期リスナは存在しない <!-- derived from umbrella R4.3 -->
4. If 削除または orphan sweep 処理が失敗する, the apps/app shall 失敗を構造化ログに記録し、管理者が追跡可能にする。orphan sweep 失敗は `rebuildIndex` の成功を阻害せず、query-time permission filter が snippet 漏洩を防ぐ <!-- derived from umbrella R4.4 -->

### Requirement 4: 検索結果の権限制御 <!-- derived from umbrella R8.1〜R8.4 -->

**Objective:** GROWI 利用者として、自分が閲覧権限を持たないページの添付内容が検索結果に漏れないことを保証したい、既存の権限モデルとの整合のため

#### Acceptance Criteria

1. When 検索クエリが実行される, the apps/app shall **query-time に page_index を viewer filter 付きで参照** して実行ユーザが閲覧可能な親ページを特定し、その親ページに紐づく添付ヒットのみを返却する。添付文書に権限スナップショットを保持しないため、判定の源は常に page_index 側の最新権限となる <!-- derived from umbrella R8.1 -->
2. When 親ページの権限が変更された後に検索クエリが実行される, the apps/app shall 次回検索時の permission lookup が更新後の page_index を参照するため、追加の sync 処理なしに更新後の権限に基づいて添付ヒットの可視性を制御する <!-- derived from umbrella R8.2 -->
3. The 添付検索の権限判定 shall 既存 `filterPagesByViewer` と**同一の権限モデル (grant 種別・granted users・granted groups) を page_index 側で (ES 上で) 適用**する。添付側に独自の権限実装を持たない <!-- derived from umbrella R8.3 -->
4. If 親ページが既に削除されている添付が ES に残存する, the apps/app shall query-time permission lookup において当該 pageId が page_index に存在しない → アクセス不可と判定し、当該添付ヒットを検索結果から除外する (orphan sweeper による eventual cleanup が実行されるまでの間も漏洩は発生しない) <!-- derived from umbrella R8.4 -->

### Requirement 5: URI 設定による機能有効化と設定 API <!-- derived from umbrella R9.1〜R9.5 -->

**Objective:** GROWI 管理者として、抽出サービスの接続先 URI を admin API 経由で設定することで添付全文検索機能を有効化し、URI を空にすることで緊急停止 (soft-disable) できるようにしたい、独立した有効/無効トグルを設けず「URI が設定されているか」を単一の判定軸として運用したいため

#### Acceptance Criteria

1. The apps/app shall 抽出サービスの接続先 URI (`extractorUri`) を admin Config として保持し、「ES が有効 AND `extractorUri` が設定済み (null/空文字でない)」を機能有効の判定式 (算出値) として提供する <!-- derived from umbrella R9.1 -->
2. The apps/app shall 抽出サービスの接続先 URI (`extractorUri`)、最大ファイルサイズ (`maxFileSizeBytes`)、抽出タイムアウト (`timeoutMs`) の 3 つの Config キーを ConfigManager 経由で永続化し、admin API で取得・更新可能にする。同時実行上限 (`maxConcurrency`) は抽出サービス側の env var で管理し Config キーとしては提供しない <!-- derived from umbrella R9.2 -->
3. The apps/app shall 設定 API 応答 (`GET /_api/v3/admin/attachment-search/config`) に算出値 `requiresReindex: boolean` を含める。当該フラグは**Config collection に persist せず**、「`Attachment.countDocuments()` > ES `attachments` index の `attachmentId` cardinality 数」が成立するとき true とする (算出は 30 秒 TTL の in-memory キャッシュ、`PUT config` 成功時に即 invalidate)。これにより URI 未設定→設定済みに変わった直後や、rebuild 前の初期 migration 状態で admin に取り込み推奨シグナルを提示できる <!-- derived from umbrella R9.3 (サーバ部分) -->
4. Where `extractorUri` が未設定または空である (すなわち算出値 `isAttachmentFullTextSearchEnabled` が false), the apps/app shall 添付ヒットを検索結果に含めず、抽出サービスへの新規呼び出しを行わない <!-- derived from umbrella R9.4 -->
5. When `extractorUri` が未設定または空である期間中に新規添付がアップロードされる, the apps/app shall 添付の保存を継続し、`extractorUri` 再設定後の一括再インデックスで取り込めるようにする <!-- derived from umbrella R9.5 -->

### Requirement 6: 一括再インデックスのサーバ処理 <!-- derived from umbrella R10.2, R10.4 -->

**Objective:** GROWI 管理者として、機能有効化後に既存添付を検索対象として取り込みたい、過去添付にも機能を適用するため

#### Acceptance Criteria

1. When `PUT /_api/v3/search/indices` が `includeAttachments=true` で呼ばれ `extractorUri` が設定済み (算出値 `isAttachmentFullTextSearchEnabled` が true) である, the apps/app shall Page/Comment の再インデックスに加えて全添付の再抽出とインデックス化を実施する <!-- derived from umbrella R10.2 -->
2. If 一括再インデックス中に特定の添付で抽出が失敗する, the apps/app shall 当該添付をスキップして処理を継続し、失敗を構造化ログおよび ExtractionFailureLog に記録する <!-- derived from umbrella R10.4 -->
3. The apps/app shall 一括再インデックスの進捗を既存 Socket.io チャネルと同経路で公開する (`AddAttachmentProgress` / `FinishAddAttachment` 相当)
4. If 一括再インデックス実行中に apps/app が中断される, the apps/app shall tmp インデックスを alias swap せずに旧 index を維持する

### Requirement 7: 個別再抽出 API <!-- derived from umbrella R11.2 -->

**Objective:** GROWI 管理者またはページ編集権限者として、特定添付の抽出失敗や形式更新に対処したい、全体再インデックスを回さずに個別修正するため

#### Acceptance Criteria

1. When `POST /_api/v3/attachments/:id/reextract` が呼ばれる, the apps/app shall 当該添付を抽出サービスに再送し、成功した場合は ES 文書を更新する <!-- derived from umbrella R11.2 -->
2. If 呼び出し元が admin でもページ編集権限者でもない, the apps/app shall 403 Forbidden を返却する
3. Where `extractorUri` が未設定または空である (算出値 `isAttachmentFullTextSearchEnabled` が false), the apps/app shall 503 feature_disabled を返却する
4. The apps/app shall 再抽出結果の `ExtractionOutcome` を含むレスポンスを返却する

### Requirement 8: 抽出失敗の永続化と監視 <!-- derived from umbrella R12.1, R12.4 -->

**Objective:** GROWI 管理者として、抽出失敗が発生している添付を特定したい、問題の原因追跡と対策を行うため

#### Acceptance Criteria

1. When 抽出処理が失敗する, the apps/app shall 対象添付の識別子、ファイル形式、ファイルサイズ、失敗理由コードを構造化ログに記録する <!-- derived from umbrella R12.1 -->
2. The apps/app shall 抽出処理の成功/失敗件数およびレイテンシを監視システムが収集できる形で公開する <!-- derived from umbrella R12.4 -->
3. The apps/app shall 抽出失敗を `ExtractionFailureLog` コレクションに永続化し、TTL で自動失効させる
4. The apps/app shall 失敗ログを `GET /_api/v3/admin/attachment-search/failures` で取得可能にする

### Requirement 9: 既存機能との互換性 <!-- derived from umbrella R14.1, R14.4, R14.5 -->

**Objective:** GROWI.cloud 運用者として、新機能が既存テナントの検索品質や応答性を悪化させないことを保証したい、共有 ES クラスタへの波及を防ぐため

#### Acceptance Criteria

1. Where `extractorUri` が未設定または空である (算出値 `isAttachmentFullTextSearchEnabled` が false), the apps/app shall 既存検索 (ページ本文・コメント) のレイテンシ、結果順序、API 応答形式を機能導入前と同一にする <!-- derived from umbrella R14.1 -->
2. The 添付 ES インデックス構成 shall 既存 Page インデックスの検索クエリ応答時間を `extractorUri` 設定前と比べて意味ある程度に劣化させない <!-- derived from umbrella R14.4 -->
3. When `extractorUri` 設定前後で検索 API が呼ばれる, the apps/app shall 既存クライアントが破壊的変更なしに応答を解釈できるよう API の後方互換を保つ <!-- derived from umbrella R14.5 -->
4. The apps/app shall `IPageWithSearchMeta.attachmentHits` を optional フィールドとして追加し、既存の必須フィールド形状を変更しない
