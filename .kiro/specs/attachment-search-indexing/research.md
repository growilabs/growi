# Research: attachment-search-indexing

_Generated: 2026-04-17_
_Derived from: `.kiro/specs/full-text-search-for-attachments/research.md` (umbrella)_

本 spec の設計判断に関わる調査項目のみを umbrella research.md から抽出し再構成する。上流 `markitdown-extractor` の形式別抽出実装調査、下流 `attachment-search-ui` の UI コンポーネント調査は本 spec の範囲外であり、各 spec の research.md に残す。

## 1. AttachmentService ハンドラの fire-and-forget 特性と失敗可視化

### 既存実装の観察

- [apps/app/src/server/service/attachment.ts](apps/app/src/server/service/attachment.ts) の `createAttachment()` / `removeAttachment()` は **バックグラウンド (非同期) でハンドラを呼び、例外を catch して握りつぶす** 挙動を持つ
- 先行事例: OpenAI Vector Store 連携 ([apps/app/src/features/openai/server/services/openai.ts](apps/app/src/features/openai/server/services/openai.ts)) が同パターンで既に同居している
- `addAttachHandler` / `addDetachHandler` の shape:
  ```typescript
  type AttachHandler = (pageId: string | null, attachment: IAttachmentDocument, file: Express.Multer.File) => Promise<void>;
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

## 参照

- Reference research (gap analysis + design phase discovery): [../full-text-search-for-attachments/research.md](../full-text-search-for-attachments/research.md)
- Design review fixes log: [../full-text-search-for-attachments/design-review-fixes.md](../full-text-search-for-attachments/design-review-fixes.md)
- Brief: [./brief.md](./brief.md)
