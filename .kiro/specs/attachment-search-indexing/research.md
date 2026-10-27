# Research: attachment-search-indexing

_Generated: 2026-04-17_
_Derived from: `.kiro/specs/attachment-search/research.md` (umbrella)_

本 spec の設計判断に関わる調査項目のみを umbrella research.md から抽出し再構成する。上流 `attachment-search-markitdown-extractor` の形式別抽出実装調査、下流 `attachment-search-ui` の UI コンポーネント調査は本 spec の範囲外であり、各 spec の research.md に残す。

## 1. AttachmentService ハンドラの fire-and-forget 特性と失敗可視化

### 既存実装の観察

- [apps/app/src/server/service/attachment.ts](apps/app/src/server/service/attachment.ts) の `createAttachment()` / `removeAttachment()` は **バックグラウンド (非同期) でハンドラを呼び、例外を catch して握りつぶす** 挙動を持つ
- 先行事例: OpenAI Vector Store 連携 ([apps/app/src/features/openai/server/services/openai.ts](apps/app/src/features/openai/server/services/openai.ts)) が同パターンで既に同居している
- `addAttachHandler` / `addDetachHandler` の shape:
  ```typescript
  type AttachHandler = (pageId: string | null, attachment: AttachmentWithComputed, file: Express.Multer.File) => Promise<void>;
  type DetachHandler = (attachmentId: string) => Promise<void>;
  ```

### 設計判断への根拠

- **fire-and-forget を継承**: 既存 OpenAI 連携と同パターンであり、添付アップロード API のレイテンシに一切影響を与えない
- **失敗が握りつぶされる制約**: 抽出失敗時に pino ログだけでは消費者 (admin) が追跡できないため、**ExtractionFailureLog (MongoDB) に永続化する二重経路**を必須化
- `AttachmentSearchIndexer` 内部で確実に `FailureLogService.record()` と `logger.error()` を呼ぶ設計 (上位は throw しても無視される)

### 代替案と不採用理由

- **同期ハンドラへの変更**: AttachmentService の根本改修は本 spec の境界外。かつアップロード API レイテンシに直結するため却下
- **永続ジョブキューの導入**: 既存アーキテクチャに不在、本機能のためだけに導入する正当性が薄い。将来 enhancement の余地として記録のみ

## 2. ページ権限変更イベントの購読点特定

### 調査経緯

umbrella gap analysis 時点では「親ページ権限変更のイベントフック」が要研究項目だった。`/kiro-spec-design` phase の追加調査で以下が確定:

- `PageService.updateGrant()` ([apps/app/src/server/service/page/index.ts#L5109](apps/app/src/server/service/page/index.ts#L5109)) → `updatePage(null, null, options: { grant, userRelatedGrantUserGroupIds })` に委譲
- 権限変更を含む更新フローは以下のイベントを発火 ([page-service index.ts#L1250-L1331](apps/app/src/server/service/page/index.ts#L1250-L1331)):
  - `pageEvent.emit('syncDescendantsUpdate', targetPage, user)`
  - `pageEvent.emit('updateMany', pages, user)`
- 既存 `SearchService.registerUpdateEvent()` が `pageEvent` を購読しており、同経路で添付向けリスナを追加可能

### 設計判断への根拠

- `AttachmentGrantSync` を `registerUpdateEvent()` 内または同等の初期化点で購読登録
- 受信時に対象ページ配下の添付 ES 文書の `grant` / `granted_users` / `granted_groups` を **partial update** する (文書全体の reindex は不要)
- ES `update_by_query` が冪等なため、同一イベントの重複受信は安全

### 残留リスク

- `updateMany` / `syncDescendantsUpdate` 以外に権限変更を伴う経路 (例: ページ削除時 descendant cascade、ページ移動) が存在しないかは実装時に `pageEvent` の全発火点を走査して検証が必要

## 3. ES delegator 拡張 vs 独立 delegator の判断

### 比較観点

| 観点 | 既存 delegator 拡張 (composition) | 独立 attachment-delegator |
|---|---|---|
| ES 7/8/9 互換レイヤ | 既存コードを再利用 | 複製が必要 |
| alias swap ライフサイクル | Page と同時 atomic swap 可能 | 独立 swap だと Page と一貫性が取れない |
| 再インデックス時の連携 | `rebuildIndex()` に checkbox で合流可能 | 独立 API / 独立 UI 導線が必要 |
| テスト面 | 既存 integration test 構造に乗せられる | 新規テストハーネスが必要 |

### 設計判断への根拠

- 既存 `ElasticsearchDelegator` に `AttachmentIndexOperations` を composition で合成する方式を採用
- 既存 Page 系メソッドは不変を保ち、添付向けメソッド (`syncAttachmentIndexed` / `syncAttachmentRemoved` / `syncPageAttachmentsGrantUpdated` / `searchAttachmentsBody` / `addAllAttachments`) を追加するのみ
- `rebuildIndex()` に `includeAttachments` フラグを渡すだけで両 index を atomic alias swap できる利点が大きい

## 4. multi-index msearch の採用理由と代替案比較

### 比較観点

| 案 | 長所 | 短所 | 判定 |
|---|---|---|---|
| **A: `_msearch` で並列クエリ** | app 側 RTT 1 回、既存 ES クライアントで実装簡潔 | 結果集約を app 側で行う | **採用** |
| B: ES parent-child / join | クエリ 1 発で集約可能 | ES の join は cluster-wide に性能ペナルティ、GROWI.cloud 共有 ES に相性最悪 | 不採用 |
| C: 単一 index に Page と Attachment を混在 | クエリ最単純 | 位置情報 (1 添付 = N 文書) と Page mapping の両立が困難、再インデックス粒度が崩れる | 不採用 |
| D: app 側で 2 回連続クエリ | 実装最単純 | RTT 2 倍、p95 劣化 | 不採用 |

### 設計判断への根拠

- **採用 A (msearch)**: GROWI.cloud の共有 ES クラスタでも negotiated performance impact を予測しやすい
- N+1 を避けるため、添付のみヒットのページメタは `mget` or msearch 追加スロットで batch 取得する制約を設計で明示
- 閾値超過時の safety net (attachments ヒットを捨てる) も app 側で完結

## 5. `IPageWithSearchMeta` への optional フィールド追加方式

### 前提

- 既存検索 API は `IFormattedSearchResult<IPageWithSearchMeta>` を返す
- 下流 `attachment-search-ui` spec が `attachmentHits[]` を消費するが、**既存クライアント (old UI / 外部 API 消費者)** は `attachmentHits` の有無を知らない

### 検討した案

| 案 | 長所 | 短所 | 判定 |
|---|---|---|---|
| **optional フィールド追加** | 既存クライアント無影響、機能無効時は undefined で pre-feature と同値 | クライアント側で optional チェックが必要 | **採用** |
| 新規レスポンス型 (`IPageWithAttachmentSearchMeta`) | 型で機能の有無を区別可能 | apiv3 応答のエンドポイント分岐が必要、UI/SWR 両側で重複 | 不採用 |
| `attachmentHits: IAttachmentHit[]` 必須 (空配列 default) | 分岐ロジック不要 | 既存クライアントが未知フィールドを受け取る (一応後方互換だが Req 9 AC 9.4 と整合しない) | 不採用 |

### 設計判断への根拠

- Req 9 AC 9.3 (後方互換) / AC 9.4 (optional) の双方を満たすには optional 一択
- 下流 UI spec は `attachmentHits != null && attachmentHits.length > 0` のパターンで分岐することを契約化

## 6. OpenAPI → orval パイプライン設計

### 既存パターン参考

- `apps/pdf-converter` + `packages/pdf-converter-client` が Ts.ED (Node.js) + orval + axios で同パターンを構成
- FastAPI も `/openapi.json` を自動生成するため spec 入力は同じ形で扱える ([FastAPI SDK generation docs](https://fastapi.tiangolo.com/advanced/generate-clients/))

### 採用パイプライン

1. 上流 `services/markitdown-extractor/scripts/export-openapi.py` が `/openapi.json` を `packages/markitdown-client/openapi.json` に書き出し (上流 spec 責務)
2. `packages/markitdown-client` の turbo task で orval を実行し TS クライアント生成
3. CI で上流 spec と下流 committed artifact の差分を検出する `check-openapi-drift` task を追加
4. 差分検知時はビルド失敗、手動で orval 再生成して commit する運用

### 検討したが不採用の方式

- **ビルド時動的生成**: turbo の依存グラフに Python ビルドが混入するリスク。commit artifact 方式で監査性と再現性を確保
- **drift 検知なし**: 上流変更が下流を silent break するリスクがあるため必須

## 7. 添付権限スナップショット vs lookup

### 比較観点

| 案 | 長所 | 短所 |
|---|---|---|
| **スナップショット** (添付 ES doc に grant コピー) | 検索クエリ 1 発で viewer filter 完結、既存 `filterPagesByViewer` と同じ bool shape | 親ページ権限変更時に update_by_query が必要 |
| lookup (検索結果に親ページを join して後段で filter) | 更新処理不要 | 検索パフォーマンス劣化、権限漏れのレース条件 |

### 設計判断への根拠

- **スナップショット採用**: viewer filter を ES 側で完結させるほうが p95 レイテンシを守れる (Req 9 AC 9.2)
- 権限変更の near-real-time 反映は `AttachmentGrantSync` が `pageEvent` 購読で担保
- `update_by_query` は冪等で、失敗時はログ記録して次回検索時の潜在的漏れを admin が検知できる

### 残留リスク

- 権限変更直後の検索では ES refresh interval (デフォルト 1s) 分だけ旧権限が見える可能性がある → GROWI 既存 Page index と同水準の near-real-time 制約として受容

## 8. master の変化に合わせた設計の見直し (2026-10)

2026-05 に止まっていたブランチへ master を取り込んだところ、設計の前提になっていた既存コードがいくつか変わっていた。以下はその確認結果と判断。

### 8.1 Elasticsearch 7 対応の終了

- 観察: master は ES8/ES9 だけをサポートするようになった (`refactor(search): drop Elasticsearch 7 support`)。ES7 の client delegator、mapping、`isES7ClientDelegator` が削除されている
- 判断: 添付 index も ES8/ES9 だけを対象にする。`attachments-mappings-es7.ts` と、ES7 の応答形 (`result.body`) や bulk 引数 (`body`) を扱う分岐を持たない

### 8.2 Attachment モデルの Prisma 移行

- 観察: Attachment は `prisma.attachments` (Prisma 拡張) で読み書きされるようになり、Mongoose の `Attachment` / `IAttachmentDocument` は export されない。`AttachHandler` の引数は `AttachmentWithComputed`。id は 24 桁の 16 進文字列で、ObjectId を文字列化した値と同じ形
- 判断: indexer / reindex batch / 抽出サービス / 管理 API は `prisma.attachments` を使う。ES 文書 ID (`${attachmentId}_${pageNumber ?? 0}`) と `attachmentId` keyword の値は以前と同じ文字列になるため、既存の添付 index を作り直す必要はない
- 一括走査: Mongoose の stream cursor の代わりに `findMany` の id 順ページング (`take` + `cursor`) を使う

### 8.3 抽出失敗ログを Prisma-only のモデルにする

- 観察: `.claude/rules/model.md` は「移行が終わるまで collection と index の作成は Mongoose が受け持つ」としている。一方、master で新しく作られた監査ログ同期のコレクション (`auditlog_es_sync_status` / `changestream_resume_tokens`) は Mongoose schema を持たない Prisma-only のモデルで、必要な index は migrate-mongo の migration (`20260619120000-add-unique-key-index-to-auditlog-es-sync-collections.js`) で作っている
- 判断: `extractionfailurelogs` も新規コレクションなので、監査ログ同期と同じく Prisma-only にし、TTL index と通常 index は migration で作る。model.md の規則は「既存の Mongoose モデルを移行している間」の取り決めであり、新しいコレクションに Mongoose schema を足すと、後で消す対象を自分から増やすことになる
- G2G 転送: 監査ログ同期のコレクションと同じく、環境固有の運用記録なので `non-transferable-collections.ts` に加える

### 8.4 検索演算子 (search-filters) への対応

- 観察: master に `author:` / `editor:` / `group:` と各否定形が入った (`search-filters` spec)。`prefix:` / `tag:` を含むこれらの演算子は、`parseSearchQuery()` が `QueryTerms` に分解し、`appendCriteriaForQueryString()` / `appendCriteriaForGroupFilter()` が page_index のクエリに積む。以前の設計は演算子を一切考慮しておらず、(a) `facet=attachments` では演算子が効かず、(b) 演算子のトークンがそのまま添付本文の検索語になっていた
- 判断 (ユーザー判断 2026-10-27): 添付ヒットにも **親ページの条件として** 演算子を効かせる。`QueryTerms` を本文語 4 キーとそれ以外に分け、本文語だけを添付本文に当て、それ以外は親ページ側の page_index 検索で既存の部品を使って当てる
- 付随する変更: `facet=attachments` の権限判定を、page_index の mget + app 側での権限判定から、`ids` + viewer filter + 絞り込み条件を持つ page_index の search 1 回に置き換える。mget は filter を持てないため演算子を当てられない。また app 側で権限を判定し直すと「既存と同じ権限モデルを ES 側で適用する」(Req 4.3) から外れる。search に置き換えると、権限と絞り込みの両方を既存ロジックのまま ES 側で適用できる
- 不採用案: 演算子を添付では無視する案。実装は簡単だが、`author:jim` を付けても他人のページの添付が出るため、ユーザーから見て検索結果が矛盾する

### 8.5 同期方式: 通知関数 (attach/detach handler) を維持する

- 観察: 監査ログ同期 (`features/auditlog-es-sync`) は MongoDB の change stream と、どこまで受け取ったかの記録 (resume token)、同期漏れフラグ、起動時の作り直し設定を持つ
- 判断 (ユーザー判断 2026-10-27): 添付は通知関数による同期を続ける。理由:
  - 添付の作成・削除は `AttachmentService` の 1 か所でしか起きないため、通知関数で漏れが出ない。監査ログは書き込み元が多数あり、change stream で 1 か所に集める必要があった
  - 添付の同期は「外部の抽出サービスを呼ぶ重い処理」であり、change stream で受け取っても結局は待ち行列が必要になる。失敗は ExtractionFailureLog に残し、個別の再抽出と一括の作り直しで回収する現行の作りで足りる
  - ページ削除に伴う一括削除 (`removeAllAttachments()`) は detach handler を呼ばないが、これは orphan sweeper と検索時の権限判定で既に扱っている
- 再検討の条件: 添付の作成・削除が `AttachmentService` 以外から行われるようになった場合 (Revalidation Triggers に記載)

### 8.6 作り直し API: ページと一緒に、ただし応答は待たせない

- 観察: 以前の設計と実装は `PUT /search/indices` に `includeAttachments` を付け、Page と添付の作り直しが終わるまで HTTP 応答を返さなかった。添付の作り直しは添付ごとに抽出サービスを呼ぶため、添付が多いと HTTP がタイムアウトする。監査ログは専用 API (`/search/auditlog-indices`) で作り直しを非同期に進め、完了を Socket.io で通知している
- 判断 (ユーザー判断 2026-10-27): 添付はページに属するので、ページの作り直しと同じ要求 (`PUT /search/indices` + `includeAttachments`) のまま扱う。ただし作り直しは裏で進め、即応答する。完了・失敗は `FinishAddAttachment` / `AttachmentRebuildingFailed` で通知する (失敗イベント名は監査ログの `AuditlogRebuildingFailed` に揃えた)
- 付随する変更:
  - 実行中フラグの上げ下ろしを API route から `AttachmentReindexBatch.startRebuild()` の内部へ移した。応答後に処理が続く形では、route の try/finally で後始末する以前の設計が成り立たないため
  - Page 側の作り直しは関数として受け取り、batch から `SearchService` への依存を作らない
  - alias swap は Page と添付で別々に行う。以前の設計は両 index の同時 swap を描いていたが、Page 側は既存の `rebuildIndex()` の中で swap が完結しており、同時にするには既存コードを分解する必要がある。2 つの swap の間も、添付ヒットの権限は検索時に page_index から引くため漏洩は起きない

## 参照

- Reference research (gap analysis + design phase discovery): [../attachment-search/research.md](../attachment-search/research.md)
- Design review fixes log: [../attachment-search/design-review-fixes.md](../attachment-search/design-review-fixes.md)
- Brief: [./brief.md](./brief.md)
