# Research: attachment-search-indexing

_Generated: 2026-04-17_
_Derived from: `.kiro/specs/attachment-search/research.md` (umbrella)_

本 spec の設計判断に関わる調査項目のみを umbrella research.md から抽出し再構成する。上流 `attachment-search-text-extractor` の形式別抽出実装調査、下流 `attachment-search-ui` の UI コンポーネント調査は本 spec の範囲外であり、各 spec の research.md に残す。

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

> **この節の結論は採用されていない。** 権限を添付文書に持たない方式 (Option D) に移ったので、権限変更のイベントを購読する `AttachmentGrantSync` は作っていない (7 節の注記を参照)。 以下は検討の記録として残す。

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

> 「独立 delegator を作らず、既存 delegator の ES client を使う拡張にする」という結論は今も有効。ただし、下に出てくるメソッド名 (`syncPageAttachmentsGrantUpdated` / `searchAttachmentsBody` など) と「Page と添付の alias を同時に付け替える」は当時の案で、現在の形ではない (現在の形は design.md、付け替えを別々にした理由は 8.6)。

### 比較観点

| 観点 | 既存 delegator 拡張 (composition) | 独立 attachment-delegator |
|---|---|---|
| ES 8/9 互換レイヤ | 既存コードを再利用 | 複製が必要 |
| alias swap ライフサイクル | Page と同時 atomic swap 可能 | 独立 swap だと Page と一貫性が取れない |
| 再インデックス時の連携 | `rebuildIndex()` に checkbox で合流可能 | 独立 API / 独立 UI 導線が必要 |
| テスト面 | 既存 integration test 構造に乗せられる | 新規テストハーネスが必要 |

### 設計判断への根拠

- 既存 `ElasticsearchDelegator` に `AttachmentIndexOperations` を composition で合成する方式を採用
- 既存 Page 系メソッドは不変を保ち、添付向けメソッド (`syncAttachmentIndexed` / `syncAttachmentRemoved` / `syncPageAttachmentsGrantUpdated` / `searchAttachmentsBody` / `addAllAttachments`) を追加するのみ
- `rebuildIndex()` に `includeAttachments` フラグを渡すだけで両 index を atomic alias swap できる利点が大きい

## 4. multi-index msearch の採用理由と代替案比較

> **この節の結論は採用されていない。** `_msearch` でページと添付を同時に検索する形は、いまは使っていない。facet=`all` の 1 ページ目は、ページ検索の後に、見えるページの添付だけを検索する (理由は 10.1)。 以下は検討の記録として残す。

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
- 抽出サービスも route 定義から OpenAPI document を生成するため spec 入力は同じ形で扱える

### 採用パイプライン

1. 上流 `apps/attachment-text-extractor/scripts/export-openapi.ts` が OpenAPI document を `packages/attachment-text-extractor-client/openapi.json` に書き出し (上流 spec 責務)
2. `packages/attachment-text-extractor-client` の turbo task で orval を実行し TS クライアント生成
3. CI で上流 spec と下流 committed artifact の差分を検出する `check-openapi-drift` task を追加
4. 差分検知時はビルド失敗、手動で orval 再生成して commit する運用

### 検討したが不採用の方式

- **ビルド時動的生成**: turbo の依存グラフにサービス側の export 実行が混入するリスク。commit artifact 方式で監査性と再現性を確保
- **drift 検知なし**: 上流変更が下流を silent break するリスクがあるため必須

## 7. 添付権限スナップショット vs lookup

> **この節の結論は採用されていない。** 設計はその後、権限を添付文書に持たず検索時に page_index から引く方式 (Option D) に移った。採用理由と現在の方式は design.md の Security Considerations と、umbrella の [design-review-fixes.md](../attachment-search/design-review-fixes.md) を参照。以下は検討の記録として残す。

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
- 一括走査: Mongoose の stream cursor の代わりに `findMany` の id 順ページング (`where: { id: { gt: 直前の id } }` + `take`。基準にした行が走査中に消えても影響されない) を使う。1 件の行が壊れていても全体が止まらないよう、ページングは id だけを読み、各行は 1 件ずつ `findUnique` で読む

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
  - 二重起動のときは `startRebuild()` が例外を投げずに `false` を返す。route はそれを見て 409 にするだけで、例外クラスを route と batch で共有しなくて済む
- 実 index の名前 (2026-11): alias `{page}-attachments-alias` の裏に実 index `{page}-attachments-1` / `{page}-attachments-2` を置き、作り直しのたびに alias が指していない方を埋めて付け替える。`{page}` は page index 名 (Elasticsearch URI のパス)
  - 以前の設計は「固定名 `attachments-tmp` に作って alias `attachments` を付け替える」だった。付け替えた後は `attachments-tmp` が本番になるので、次の作り直しが最初に行う「`attachments-tmp` を drop」で本番を消してしまう。また alias と同じ名前の実 index は作れないので、alias `attachments` の裏の最初の実 index に置ける名前も無かった
  - Page 側の `rebuildIndex()` (tmp に複製 → alias を tmp へ → 本体を消して作り直す → alias を戻す) をそのまま真似ない理由: 途中で止まると、起動時の normalize が tmp (旧データの複製) を消し、作りかけの本体に alias を戻す。Req 6.4 (中断しても旧 index を保つ) を満たせない。添付の作り直しは抽出を伴い何時間もかかりうるので、途中で止まる可能性を無視できない
  - 同じ理由で、余った実 index は起動時に消さず、次の作り直しの先頭で消す。消すのは常に「alias が指していない方」だけにする
  - 名前を page index 名から導くのは、1 つの Elasticsearch を複数の GROWI (GROWI.cloud のテナントなど) で共有するため。Page の index は URI のパスで名前を分けており、添付だけ固定名だと、あるテナントの作り直しが別のテナントの添付 index を消してしまう
  - alias 名を `attachments` にしなかったのは、Page (`<index>-alias`) の命名に揃えるためと、以前の実装で Elasticsearch が自動作成した実 index `attachments` が開発環境に残っていても名前がぶつからないようにするため
  - 固定名だったころは「`attachments` alias が他の index を指していたら起動を止める」衝突検出を置いていた。名前を page index 名から導くようにしたので要らなくなり、削除した
  - alias を通す書き込みに `require_alias: true` を付けるのは、alias が無いときの書き込みで Elasticsearch が alias と同じ名前の実 index を自動作成し、以後 alias を張れなくなるのを防ぐため。そのおかげで index の作成を「機能が有効なとき」(起動時と、管理画面で有効にしたとき) に限れる。作成前の書き込みは失敗としてログに残るだけで、次の作り直しで取り込まれる
- 作り直し中の削除 (2026-11): 走査がある添付を読んで抽出している間にその添付が削除されると、削除は両 index に効くが、走査はその後で抽出結果を作り直し先へ書くので、削除済みの添付が戻る (orphan sweep は親ページしか見ない)。そこで batch は作り直し中に `onDetach` された id を覚え、走査と sweep の後、alias swap の直前に作り直し先から消す。delete-by-query は refresh 前の文書を見ないので、削除はどれも (本番 alias への削除も) 先に対象 index を refresh してから行い、消せなかった文書が返ってきたら失敗として扱う
- 抽出中の削除 (ふだんのアップロードと再抽出): `onAttach` / 再抽出でも、抽出中に添付が削除されると、削除は何も見つけず、その後に抽出結果が書かれて残る。こちらは「書いた後に MongoDB にまだ添付があるか確かめ、無ければ消す」で塞ぐ。添付の削除は MongoDB の行を消してから detach handler を呼ぶので、書き込みが detach の削除より後に届いた場合は、書いた後の確認が必ず行の消滅を見る。書き込みが先に届いた場合は detach の削除 (refresh 付き) が消す。「書く前に確かめる」形は、確かめてから書くまでの間に削除が来ると同じ穴が残るので採らない。作り直しの走査は件数が多く 1 件ごとの確認を足すより、記録した id を swap 直前に 1 回で消す方が軽いので、上の方式のままにする
- 名前がぶつかる組み合わせ: page index `foo` の添付 alias は `foo-attachments-alias` で、page index `foo-attachments` の page alias も `foo-attachments-alias` になる。同じ Elasticsearch でこの 2 つの名前を同時に使う構成は想定せず、コードでは防いでいない
- 残っている制約 (2026-11 時点、いずれも作り直しを止めるほどではないと判断):
  - 実行中フラグはプロセスごとのメモリにある。アプリを複数インスタンスで動かすと、別インスタンスへの 2 回目の要求は 409 にならず作り直しが二重に走る。作り直し中に別インスタンスが受けた添付の書き込みは旧 index にだけ入り、alias を付け替えた時点で検索に出なくなる (次の作り直しで戻る)。別インスタンスで起きた削除も、作り直し中の削除の記録 (下記) に載らない。監査ログの作り直しも同じ前提 (1 インスタンスで実行する)
  - 添付を含む作り直しの実行中に、添付を含まない (`includeAttachments=false`) 作り直しを要求すると、ページの作り直しが 2 本同時に走る。ページの作り直しにはもともと二重起動の判定が無い (本 spec より前からの挙動)
  - 作り直しが失敗して作り直し先の index を消した直後に、それより前に始まっていた書き込みが届くと、Elasticsearch がその名前の index を既定の mapping で自動作成することがある。作り直し先の名前は書き込み先から外してから消すので、届くのは消す前に始まった書き込みだけ。残った index は次の作り直しの先頭で作り直される
  - 作り直し中に削除された id は 1 回の `terms` クエリで消すので、その数は Elasticsearch の `index.max_terms_count` (既定 65,536) を超えられない。超えると削除が失敗し、作り直しは alias を付け替えずに失敗として終わる

### 8.7 検索の速さの測定 (2026-11-16)

- 測り方: `apps/app/src/features/search-attachments/server/services/attachment-search-performance.integ.ts` を `ATTACHMENT_SEARCH_PERF=1 env -u MONGO_URI pnpm vitest run attachment-search-performance.integ` で手で走らせる。CI では飛ばす。共有の CI 機では他のジョブの負荷で p95 の比が大きく揺れ、「+30% 以内」を合否に使えないため
- 条件: 開発用の devcontainer (16 CPU)、Elasticsearch 9.3.3 (1 ノード)、MongoDB はテスト用の MongoMemoryServer。公開ページ 2,000 件 (3 件に 1 件が検索語を含む) と、ページあたり 3 件・計 6,000 件の添付文書 (3 件に 1 件が検索語を含む)。ゲストとして `<検索語> report` を検索。各経路を 20 回空回ししてから、経路を交互に 200 回ずつ測った
- 結果 (ms、3 回の測定):

| 経路 | 1 回目 p50 / p95 | 2 回目 p50 / p95 | 3 回目 p50 / p95 |
|---|---|---|---|
| ページ検索 (`/_api/search` と同じ処理) | 14.6 / 37.1 | 12.6 / 17.9 | 13.8 / 41.9 |
| facet=`all` 1 ページ目 | 26.9 / 60.7 | 22.9 / 32.5 | 25.4 / 60.0 |
| facet=`all` 2 ページ目 | 13.9 / 33.4 | 10.4 / 18.6 | 13.0 / 41.2 |
| facet=`attachments` | 32.0 / 66.1 | 28.5 / 35.8 | 31.8 / 69.9 |
| secondary (20 ページ分) | 24.0 / 56.2 | 21.3 / 29.2 | 23.7 / 50.2 |

- 分かったこと:
  - facet=`all` の 2 ページ目以降はページ検索と同じ速さ (添付 index を使わないため)
  - secondary の p95 は 500ms を大きく下回る
  - facet=`all` の 1 ページ目は、ページ検索より p95 で 43〜82%、p50 で約 80% (約 10〜12ms) 遅く、目標の +30% 以内に収まらない。ページ検索と添付の検索は並行して走るが、その後に添付ヒットの親ページの権限確認 (page_index への検索 1 回と MongoDB の読み込み 1 回) が順に続いていた

#### 1 ページ目の権限確認をページ検索の結果で済ませた後 (2026-11-16)

- 変更: facet=`all` の 1 ページ目では、添付ヒットを残すのはページ検索の結果に入っているページだけなので、そのページについては viewer filter・演算子・`security:disableUserPages` をページ検索がすでに当てている。本文の断片を見せるかどうかもページ検索は MongoDB のページ文書だけで決めており、その文書は結果の各項目に入っている。そこで権限確認を、結果の各項目に同じ規則 (`canShowSnippetOfPage`、`SearchService.canShowSnippet` もこれを呼ぶ) を当てる処理に置き換え、page_index と MongoDB への問い合わせをやめた。page_index 側の権限項目で同じ規則を当てる確認も無くなるが、これは page_index が古いときに MongoDB 側が見せると判断したページを余計に落とすだけで、仕様の規則 (ページ検索が本文の断片を見せるページだけ) には要らない。権限の比較の結合テスト (`attachment-search-permission.integ.ts`) は変更なしで通る
- 測り方・条件は上と同じ。同じ機械・同じ日に、変更前と変更後を 3 回ずつ続けて測った (他のテストは同時に走らせていない)
- 変更前 (ms、p50 / p95):

| 経路 | 1 回目 | 2 回目 | 3 回目 |
|---|---|---|---|
| ページ検索 | 15.9 / 40.2 | 13.4 / 22.7 | 13.2 / 24.4 |
| facet=`all` 1 ページ目 | 27.1 / 60.3 | 22.8 / 40.9 | 22.1 / 36.8 |
| facet=`all` 2 ページ目 | 13.5 / 39.2 | 11.3 / 22.0 | 11.0 / 20.7 |
| facet=`attachments` | 31.8 / 73.0 | 28.9 / 49.1 | 29.6 / 52.6 |
| secondary (20 ページ分) | 27.0 / 70.7 | 24.0 / 40.7 | 25.5 / 41.9 |

- 変更後 (ms、p50 / p95):

| 経路 | 1 回目 | 2 回目 | 3 回目 |
|---|---|---|---|
| ページ検索 | 11.9 / 17.5 | 11.5 / 17.6 | 12.0 / 18.1 |
| facet=`all` 1 ページ目 | 17.2 / 26.3 | 16.7 / 26.1 | 17.2 / 27.7 |
| facet=`all` 2 ページ目 | 10.1 / 17.8 | 10.2 / 16.4 | 10.2 / 17.8 |
| facet=`attachments` | 28.7 / 38.3 | 29.3 / 37.4 | 28.8 / 38.7 |
| secondary (20 ページ分) | 23.6 / 32.5 | 24.7 / 32.5 | 24.3 / 34.2 |

- 分かったこと:
  - facet=`all` 1 ページ目のページ検索に対する比は、p95 で 1.50 / 1.80 / 1.51 倍 → 1.50 / 1.48 / 1.53 倍、p50 で 1.70 / 1.70 / 1.67 倍 → 1.45 / 1.45 / 1.43 倍。p50 の差は約 10ms から約 5ms に縮んだ
  - それでも目標の +30% 以内には 3 回とも収まらない。権限確認の往復が無くなったので、1 ページ目の時間はページ検索と添付の検索の遅いほうで決まる。添付の検索 (6,000 件に対する本文の一致と強調表示) とページ検索のどちらがどれだけかかっているかは測っていない。目標を見直すか、添付の検索を速くするかは未決

#### 見えるページの添付だけを検索する形にした後 (2026-11-17)

- 変更: facet=`all` の 1 ページ目を、「ページ検索と添付 index 全体の検索を同時に走らせる」形から、「ページ検索 → 本文の抜粋を見せるページを選ぶ → そのページの添付だけを検索する」形に変えた (理由は 10.1)。さらに、添付の検索を pageId ごとにまとめて 1 ページあたり上位 5 件を返す形にした (10.2)。2 つの検索が順に走るので、時間は足し算になる
- ページ検索に対する facet=`all` 1 ページ目の p95 の比の移り変わり (どれも手元での測定):

| 時点 | ページ検索 p95 | facet=`all` 1 ページ目 p95 | 比 |
|---|---|---|---|
| 権限確認をページ検索の結果で済ませた後 (上の「変更後」) | 17.5〜18.1ms | 26.1〜27.7ms | 約 1.5 倍 |
| その後の測定 | (記録なし) | (記録なし) | 約 1.87 倍 |
| ページごとに上位 5 件にまとめた後 (最新) | 17.9ms | 42.2ms | 約 2.36 倍 |

- 1.87 倍の行は、比だけが伝えられていて、どの変更の直後の測定か、そのときの p95 の値がいくつだったかの記録が残っていない
- 最新の値でも目標の +30% 以内には収まらない。速さより「見えない添付が結果に影響しないこと」を優先した結果である。目標を見直すか、形を変えるかは、umbrella の [roadmap.md](../attachment-search/roadmap.md) の 3-(d) / (e) で決める (tasks.md 10.8 は未完了のまま)

## 9. 抽出サービスへ送る内容 (2026-11)


- 観察: 生成クライアントの `file` に `Buffer` を渡していた。Node の `FormData` は `Blob` でない値を文字列の項目に変えるので、ファイルの部品が 1 度も送られず、抽出サービスはすべての添付に 422 を返していた。以前の生成クライアントが `file` を `string` と書いていたため、型の検査では見つからなかった。テストは axios を差し替えていたので、実際に送られる形を見ていなかった
- 判断:
  - ファイルの部品として送り、本物の生成クライアントを、要求を記録するサーバに向けるテストで形を固定する
  - 部品のファイル名は `file.<拡張子>` にする。抽出サービスがファイル名から読むのは拡張子だけなので、利用者が付けた名前 (長さも文字も自由) を外へ出す理由が無い。見出しの長さの上限や、引用符・改行の扱いの問題も、まとめて避けられる
  - 保存してある MIME type は、拡張子が使えないときだけ `mimeType` で送る。抽出サービスは知っている `mimeType` を拡張子より優先し、保存してある MIME type はブラウザの申告なので拡張子と食い違うことがある
  - 部品の `Content-Type` には MIME type を入れない。抽出サービスは読まず、長い値は部品の見出しの上限に当たって 422 になる
- 分かっている制限:
  - 抽出サービスが知らない拡張子のテキストのファイル (`.conf`、`.tf` など) は `unsupported` になる。中身を見て抽出する拡張は [../attachment-search/roadmap.md](../attachment-search/roadmap.md) に載せた
- 大きさの上限 (2026-11-12):
  - `app:attachmentFullTextSearch:maxFileSizeBytes` を、ファイルを読む前の検査に使うことにした。それまでは設定と管理 API にあるだけで、どこからも読まれず、添付は大きさに関係なく全体をメモリに読み込んでから送っていた (管理 API では 500MB まで設定できる)
  - アップロードの上限 (`app:maxFileSize`、既定は無制限) とは連動させない。目的が違う (アップロードできる大きさと、抽出の重さ) うえ、既定が無制限なので、抽出の上限の代わりにならない
  - 抽出サービスの上限を apps/app に知らせる仕組みは作らない (約束事を増やさない)。apps/app の設定を抽出サービスの上限より大きくした場合、その間の大きさの添付は抽出サービスが 413 で断り、`fileTooLarge` として記録される
  - 413 が apps/app に届くことを実測した: 抽出サービスを `MAX_FILE_SIZE_MB=1` で起動し、生成クライアントで 2・30・70・100MiB を 15 回ずつ送って、すべて 413 `file_too_large` を受け取った (接続の切断による失敗は 0 回)。抽出サービスは不要な本文を最大 64MiB まで読み捨ててから接続を閉じるが、この範囲では応答が先に届いている。測ったのは同じ機械の中の通信だけで、間に proxy などがある構成では確かめていない

## 10. 2026-11-16 / 17 に決めたこと

実装のレビューで見つかった問題への対応として決めたこと。現在の形は design.md に書いてあり、ここには理由と、採らなかった案を残す。

### 10.1 見えない添付の推測を防ぐため、見えるページの添付だけを検索する

- 問題: facet=`all` の 1 ページ目は、添付 index 全体を検索して上位の決まった件数を取り、その後でページ検索の結果と突き合わせていた。添付 index は権限情報を持たないので、上位の枠には閲覧者に見えない添付のヒットも入る。見えない添付に検索語が多く含まれるほど、見える添付のヒットが枠から押し出されて応答から消える。利用者は、検索語を変えながら「自分に見える添付のヒットが消えるかどうか」を見ることで、見えない添付の中身を推測できた
- 判断: ページ検索を先に行い、その結果のうち本文の抜粋を見せるページを選んで、そのページの添付だけを検索する。検索の対象に見えない添付が入らないので、応答の中身にも、検索の回数にも、見えない添付は影響しない
- 費用: ページ検索と添付の検索を同時に走らせられなくなり、2 つの時間が足される (8.7 の表)。添付だけが一致するページ (ページ本文には一致しない) は facet=`all` には出ない。これは変更前から同じで、facet=`attachments` で探せる
- 採らなかった案: 添付 index 全体の検索の件数を増やして押し出しを起きにくくする案は、件数をいくら増やしても、見えないヒットがそれを超えれば同じことが起きるので採らなかった
- facet=`attachments` は添付 index 全体を検索するが、結果を「見えるヒットだけを並べた列」の上で決め、件数も不足の印も返さない (design.md の Security Considerations の「残存リスク」に、応答時間からの推測が残ることを書いてある)

### 10.2 添付ヒットを親ページごとに上位 5 件にまとめる

- 問題: 1 つの添付は、ページ・スライド・シートの数だけ文書になる。長い PDF 1 つが検索語を何十ページにも含むと、その添付の文書だけで検索の枠が埋まり、同じ検索結果のほかのページの添付ヒットが 1 件も返らなかった
- 判断: 見えるページに絞った添付の検索では、Elasticsearch の `collapse` で pageId ごとにまとめ、`inner_hits` で 1 ページあたり上位 5 件を返す。どのページも自分の枠を持つ
- 5 件にした理由: 画面は、最も関連の高い 1 件を開いて見せ、残りを折りたたむ想定である。数件あれば足り、件数を増やすほど応答が大きくなる

### 10.3 作り直しを止める失敗数 (`20 + 5%`) と、終わりの判定

- 問題: 抽出サービスが落ちたまま一括再インデックスを走らせると、全添付が失敗し、metadata-only の文書だけの index ができる。作り直しは成功として終わり、alias がその index に付け替わって、それまで検索できていた添付の本文がすべて消えた
- 判断: 「ファイルそのものの問題ではなく障害を疑う結果」を作り直し全体で数え、`20 + ceil(対象の添付数 × 5%)` に達したら止める。alias は動かさない
  - 数える結果: 抽出サービスに届かない、抽出サービスが混雑している、保存してあるファイルを読めない (読み込みのタイムアウトを含む)、その添付の処理が例外で終わった (ES への書き込みの失敗など)
  - 20 件の固定分: 正常な作り直しでも、大きなファイルのタイムアウトや接続の切断は、たまに起きる。小さな環境が数件の失敗で止まらないようにする
  - 5% の比例分: 大きな環境ほど、正常でも失敗の数は増える。一方、障害は始まった時点から全件を失敗させるので、数 % 走った時点で上限に達し、空の文書だけの index に alias が付け替わる前に止まる
- 終わりの判定: 対象が少ないと (たとえば 10 件)、全件が失敗しても 20 件に届かない。そこで、最後まで走った後に「1 件以上を処理し、そのすべてが障害を疑う結果だった」場合も失敗にする
- 途中の案:
  - 「抽出サービスに届かない結果が 1 件でも出たら止める」: 1 回の切断で、何時間もかかる作り直しが止まる
  - 「障害を疑う結果が 10 件続いたら止める」: 間にファイルごとの失敗 (対応していない形式など) が挟まると数え直しになり、障害の最中でも止まらないことがある。全体で数える形に変えた
- **保存先の「ファイルが無い」を、障害と区別しない理由**: MongoDB に行があるのに保存先にファイルが無い添付は、そのファイルだけの問題に見える。途中で、保存先のアダプタに「無い」と分かったときだけ専用の例外を投げさせて、ファイルごとの失敗として扱う形を試した。しかし S3 と GCS は、bucket そのものが無い (設定の誤り) 場合にも「見つからない」を返し、ローカル保存では volume が mount されていない場合にも `ENOENT` になる。保存先の設定が違っているだけの環境で全件が「ファイルが無い」になり、止まらずに空の index に付け替わってしまう。また、この変更は全員が使う添付の削除の動きも変えていた。そこで保存先のアダプタは元に戻し、読めなかった結果はすべて障害を疑う結果として数える
- 分かっている制限: 保存先のファイルが本当に失われている添付が `20 + 5%` を超える環境では、それらの添付を片づける (添付を消す、ファイルを戻す) まで、作り直しを最後まで走らせられない。umbrella の roadmap.md に載せた

### 10.4 再抽出は、書いてから古い文書を消す

- 問題 1: 再抽出が失敗したときに metadata-only の文書を書くと、文書 ID が `${attachmentId}_0` なので、1 文書だけの形式 (テキストなど) の本文の文書と同じ ID になり、検索できていた本文を空で上書きした
- 判断 1: 再抽出の失敗では、登録済みの文書に触れない。失敗は ExtractionFailureLog に残すだけにする。アップロードと一括再インデックスでは、今までどおり metadata-only の文書を書く (その添付の文書がまだ無いか、作り直し先の空の index に書くので、上書きの問題が無い)
- 問題 2: 再抽出が成功したとき、新しい結果のページ数が前より少ないと、前の結果の余った文書が残った。metadata-only の文書 (`pageNumber` が null) も、ページ番号を持つ形式では別の ID なので残った
- 判断 2: 成功したら、その添付の文書のうち、いま書いたもの以外を消す。順番は「書いてから消す」にする。先に消すと、その後の書き込みが失敗したときに、検索できていた文書が無くなる。書いてから消す形なら、書き込みが失敗した場合は消す処理に進まないので、前の文書が残る

### 10.5 抽出の同時実行は、プロセス全体で 3 件まで

- 問題: アップロードの索引づけには同時実行の上限が無く、再抽出の route だけが独自の上限 (3 件。超えたら 503 `reextract_busy`) を持っていた。添付をまとめてアップロードすると、その数だけファイルを同時にメモリに読み込み、抽出サービスに同時に送っていた
- 判断: 抽出サービスを呼ぶところに上限を 1 つだけ置き、アップロード・再抽出・一括再インデックスで共有する。超えた呼び出しは拒否せず、順番を待つ。再抽出の route の独自の上限と `reextract_busy` は無くした
- 3 件にした理由: 抽出サービスの `MAX_CONCURRENCY` の既定が 3 である。それより多く送っても `service_busy` が返ってくるだけで、待っている間もファイルをメモリに持ち続けることになる
- 枠を待つ時間は、再抽出の制限時間に含める (待たされ続けた要求が、いつまでも応答を返さないことが無いように)

### 10.6 ファイルの読み込みの時間制限と、待つ人のいなくなった再抽出の停止

- 問題 1: 保存先からの読み込みに時間制限が無かった。保存先が応答しないと、その抽出が枠を 1 つ持ったまま終わらず、3 件たまると、以後の抽出がすべて止まる
- 判断 1: 読み込みを `timeoutMs` (抽出サービスの呼び出しと同じ設定) で打ち切り、stream を閉じる。結果は `failed` (`file_read_failed`) にする。抽出サービスは無事なので `serviceUnreachable` にはしない
- 問題 2: 再抽出が制限時間を超えると、呼び出し元には 503 を返すが、裏の処理はそのまま続いていた。順番待ちの抽出は、誰も結果を待っていないのに、後から枠を取ってファイルを読み、抽出サービスを呼んでいた
- 判断 2: 制限時間を超えたら中断の合図 (`AbortSignal`) を出し、順番待ち・読み込み・抽出サービスへの要求・混雑時の再試行を止める。中断された後の失敗は、ファイルについての事実ではないので、ExtractionFailureLog に残さない
- あわせて、再抽出を最後まで進められなかった場合 (実行の時点で添付が消えていた、ES への書き込みが失敗した、など) の応答を、200 から 500 `reextract_failed` に変えた。200 のままだと、画面が成功として扱い、監査ログにも成功として残るためである

### 10.7 抽出失敗ログは Prisma のモデルにし、index は migration で作る

- 8.3 の判断のとおりに実装した: Mongoose の schema は持たず、`schema.prisma` のモデルと migration (`20261117120000-add-indexes-to-extractionfailurelogs.js`) にした。機能を使わない環境には、migration が空のコレクションに index を作るだけで、行は増えない
- index は `occurredAt_1` (90 日の TTL) と `retentionGroupHash_1` の 2 つ。`attachmentId` の index は、それで絞り込む問い合わせがどこにも無いので作らない
- `v` (`__v`) をモデルに持たせている。このリポジトリの Prisma のモデルの決まり (`.claude/rules/model.md`) に合わせたもの
- TTL のテストは、index の `expireAfterSeconds` が 90 日であることを確かめる。期限切れの文書が実際に消えることは確かめない (MongoDB が期限切れを消す処理は約 60 秒おきに動くので、テストで待つと遅く、不安定になる。消すこと自体は MongoDB の機能である)

### 10.8 トークンは平文で保存する

- 以前の設計と tasks は「`extractorToken` を暗号化して保存する (`app:openaiApiKey` と同じ仕組み)」と書いていたが、実装は、他の設定の秘密と同じく平文で保存していた。「暗号化して保存される」と名乗るテストもあったので、取り除いた
- 判断: 設計の記述を実態に合わせる。トークンは、他の設定の秘密と同じく Config collection に平文で保存する。守っているのは「API から値を読めない」(write-only) ことで、これを、設定を保存してから GET する route のテストで固定する
- このトークンだけを暗号化する仕組みは足していない (他の設定の秘密と扱いを揃えた)。DB を読める人にはトークンが見える

### 10.9 監査ログの action を 2 つ足す

- `ADMIN_ATTACHMENT_SEARCH_SETTINGS_UPDATE` (設定の更新): 抽出サービスの URI を変えると、以後の添付の中身がその宛先に送られる。誰がいつ変えたかを後から追えるようにする。ほかの管理者の設定変更と同じ Large のグループに置く。記録に持たせるのは action だけで、設定値もトークンも含めない
- `ATTACHMENT_REEXTRACT` (個別再抽出): 一般の利用者が、抽出サービスを動かす操作をできる。添付の追加・削除と同じ Medium のグループに置き、対象の添付と親ページの snapshot を付ける
- どちらも、要求を受けた時点で `UNSETTLED` の記録を作り、成功したときだけ action を確定する (リポジトリの監査ログの決まり)。拒否や失敗は `UNSETTLED` のまま残る。再抽出が最後まで進められなかった場合を 500 にしたのは、成功として確定させないためでもある (10.6)

### 10.10 分かっている制限: orphan sweep が確かめるのは 10,000 ページまで

- orphan sweep は、作り直し先の index にある pageId を terms aggregation (`size: 10000`) で集める。添付を持つページが 10,000 を超えると、超えた分の pageId は MongoDB と照合されず、親ページの無い添付の文書が index に残る
- 残っても、検索結果には出ない (検索時に親ページの権限を確かめるため)。影響は index の大きさと、`requiresReindex` の件数の比較だけである
- 直すタスクは tasks.md 6.4 (composite aggregation などで全 pageId を順に取り出す)

### 10.11 既知のずれ: 機能が無効でも、不正な `facet` に 400 を返す

- `GET /_api/search` は、`facet` / `resolve` の値の検査を、機能の有効・無効を見る前に行っている。機能が無効でも、`facet=foo` のような値には `{ ok: false, code: 400 }` が返る。機能導入前は、`facet` は未知のクエリとして無視され、ページ検索の結果が返っていた
- Req 9.1 (無効時は導入前と同一) から外れている。`facet` を付けない既存の利用者には影響が無く、影響を受けるのは「機能が無効の環境に、不正な `facet` を付けて送る」場合だけなので、要件は変えず、直すタスクを tasks.md 9.4 に置いた

### 10.12 ページ検索の本文の抜粋の規則を直し、添付検索と共有する

- 添付ヒットを見せる条件を「ページ検索がそのページの本文の抜粋を見せること」に揃えるにあたり、ページ検索の側の判定 (`SearchService.canShowSnippet`) を調べたところ、次の問題があった
  - 指定ユーザー限定 (`GRANT_SPECIFIED`) のページを扱う分岐が無く、誰にでも抜粋を見せていた
  - 自分のみ (`GRANT_OWNER`) は、権限を持つ利用者の一覧の先頭の 1 人としか比べていなかった
  - グループ限定は、利用者のグループの id (文字列) と、ページ側の `{ item, type }` の形の要素をそのまま比べていた (コードを読んだ限りでは一致せず、グループに属する利用者にも抜粋が出ない。実際の動きは測っていない)
  - 未知の公開範囲の値は、誰にでも見せる側に倒れていた
- 判断: 規則を pure function (`can-show-snippet.ts` の `canShowSnippetForGrant`) に切り出して直し、ページ検索と添付検索の両方がそれを使う。規則は、ページの閲覧の可否を決める `generateGrantCondition` (models/page.ts) と同じ相手に見せる形にした (リンク共有限定のページは、検索では誰にも見せない)
- この修正は、添付全文検索の有効・無効に関係なく、全員のページ検索に効く。リリースノートでの扱いは umbrella の roadmap.md の 1 に書いてある

## 参照


- Reference research (gap analysis + design phase discovery): [../attachment-search/research.md](../attachment-search/research.md)
- Design review fixes log: [../attachment-search/design-review-fixes.md](../attachment-search/design-review-fixes.md)
- Brief: [./brief.md](./brief.md)
