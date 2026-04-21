# Requirements Document

## Project Description (Input)

### 背景と問題

上流 spec `attachment-search-indexing` によって、添付ファイルのテキストが Elasticsearch にインデックスされ、検索 API の応答型 `IPageWithSearchMeta` に optional `attachmentHits[]` が付与されるようになる。しかしサーバ側応答だけでは、エンドユーザと管理者に添付ヒットの存在が可視化されず、機能としては未完結である。本 spec は apps/app クライアント側の UI 統合を担い、(1) 検索結果画面 (左ペイン集約 / 右ペイン添付ヒットカード / ファセット)、(2) 添付ファイル一覧モーダルの個別再抽出ボタン、(3) 管理画面 (設定 / 一括再インデックスチェックボックス / 抽出失敗可視化) の 3 領域を新規コンポーネントと既存コンポーネントの最小差分拡張で提供する。

### スコープ

- **In**: 既存 SearchPage / PageAttachmentList / ElasticsearchManagement への拡張。新規コンポーネント群 (`AttachmentHitCard` / `AttachmentSubEntry` / `SearchResultFacetTabs` / `ReextractButton` / `AttachmentSearchSettings` / `AttachmentExtractionFailures` / `RebuildWithAttachmentsCheckbox`) と SWR hooks を feature module 配下に集約。機能無効時の UI 完全隠蔽。
- **Out**: apiv3 エンドポイント実装、ES 連携、Config 永続化 (上流 `attachment-search-indexing` 責務)。抽出サービス本体 (`attachment-search-markitdown-extractor` 責務)。添付ビューア本体の変更、PDF インラインプレビュー、形式別詳細ファセット、抽出テキストの全文プレビュー表示、選択的再インデックス UI。

詳細は [brief.md](./brief.md) を参照。

## Introduction

本 spec は GROWI の添付ファイル全文検索機能のクライアント側 UI 層を担う。上流 `attachment-search-indexing` spec が提供する検索 API 応答 (`IPageWithSearchMeta.attachmentHits[]`) と admin 系 apiv3 エンドポイントを消費し、エンドユーザ検索体験と管理者運用体験を完結させる。

UI 拡張は 3 領域に分かれる。第 1 に検索結果画面で、左ペイン Page カード内の「添付サブエントリ」と右ペインプレビュー最上部の「添付ヒットカード」、および「全体 / ページ / 添付ファイル」の 3 択ファセットタブを提供する。第 2 に添付ファイル一覧モーダルで、各添付行に「再抽出」ボタンを追加し、成功/失敗を toast でフィードバックする。第 3 に管理画面 (`ElasticsearchManagement`) で、抽出サービスの接続先 URI と limits を編集するフォーム、rebuildIndex の「添付も対象にする」チェックボックス、抽出失敗可視化パネルを追加する。なお、機能の有効/無効を表す独立したトグルは**提供しない**。機能の有効化判定は上流 spec で「ES 有効 AND `extractorUri` 設定済み」の算出値として導出され、UI には SSR prop (`searchConfig.isAttachmentFullTextSearchEnabled: boolean`) として供給される。soft-disable (緊急停止) は管理者が URI を空文字にクリアして保存することで実現する。

本 spec は上流 (`attachment-search-indexing`) が定めた型と API 契約に UI を**追従させる**責務に限定する。したがって上流の API 応答形状・Config キー名・進捗通知イベント名の変更は本 spec の Revalidation Trigger となる。

## Boundary Context

- **In scope (feature responsibility)**:
  - 検索結果画面 (`SearchPage` / `SearchResultList` / `SearchResultContent`) への添付ヒット表示統合
  - 検索結果ファセットタブ UI と state 管理
  - 添付ファイル一覧モーダル (`PageAttachmentList`) への個別「再抽出」ボタン追加と結果フィードバック UI
  - 管理画面 (`ElasticsearchManagement`) への設定セクション・ガイダンス表示・rebuildIndex チェックボックス・失敗ログパネル追加
  - 機能有効/無効に応じた UI 全体の表示制御 (機能ゲート hook)
  - UI 側 SWR hooks (`use-attachment-reextract` / `use-attachment-search-config` / `use-attachment-extraction-failures` / `use-search-attachments-enabled`)
  - UI 側で消費する DTO 型と props shape の確定
  - 機能無効時に既存検索・添付モーダル・admin 画面の表示を完全に維持すること
- **Out of scope (explicitly not owned)**:
  - apiv3 エンドポイントの実装 (`POST /attachments/:id/reextract` / `GET|PUT /admin/attachment-search/config` / `GET /admin/attachment-search/failures` / `PUT /search/indices` の `includeAttachments` 受理) は上流 `attachment-search-indexing` spec
  - Config キーの定義と MongoDB 永続化は上流 `attachment-search-indexing` spec
  - `IPageWithSearchMeta.attachmentHits[]` の型定義とサーバ側での構築は上流 `attachment-search-indexing` spec
  - ES 連携 / ES インデックス mapping / AttachmentService ハンドラ登録 / pageEvent 権限追従は上流 `attachment-search-indexing` spec
  - 抽出サービス本体 (`attachment-search-markitdown-extractor` spec)
  - 添付ビューア本体の改修 (既存ビューアへ遷移するだけ)
  - PDF インラインプレビュー、形式別詳細ファセット、抽出テキスト全文プレビュー、選択的再インデックス UI
- **Adjacent expectations (this feature relies on these)**:
  - 上流 `attachment-search-indexing` spec が `IPageWithSearchMeta` に optional `attachmentHits[]` を追加し、後方互換を保って検索 API 応答を返す
  - 上流 spec が `POST /_api/v3/attachments/:id/reextract`、admin 系 apiv3 (`config` / `failures`)、`PUT /_api/v3/search/indices` の `includeAttachments` フラグを提供する
  - 上流 spec が Config キー `app:attachmentFullTextSearch:*` (`extractorUri` / `timeoutMs` / `maxFileSizeBytes` の 3 キーのみ。旧 `enabled` / `maxConcurrency` は削除済み) の読み書き API を提供する
  - 上流 spec が SSR prop `searchConfig.isAttachmentFullTextSearchEnabled: boolean` を「ES 有効 AND `extractorUri` 設定済み」の算出値として供給する (shape は `boolean` で不変)
  - 上流 spec が Socket.io `AddAttachmentProgress` / `FinishAddAttachment` イベントを発行する
  - 既存 SearchPage / SearchResultList / SearchResultContent / PageAttachmentList / ElasticsearchManagement が拡張可能な構造を維持している
  - 既存 Jotai + SWR パターン、既存 i18n パイプライン、Turbopack + Next.js Pages Router 構成、`@growi/ui` の `Attachment` 行アクション props 拡張点

## Requirements

### Requirement 1: 検索結果リスト (左ペイン) の Page 集約と添付サブエントリ
<!-- derived from umbrella R5.1〜R5.5 -->

**Objective:** As a GROWI 利用者, I want 検索結果で添付ヒットが属する親ページの下に集約表示されること, so that ページ中心のナビゲーションを維持したまま添付マッチを把握できる

#### Acceptance Criteria

1. When 検索クエリが実行される, the 検索結果リスト shall 結果を親ページ単位に集約し、各ページを 1 枚の Page カードとして左ペインに表示する <!-- derived from umbrella R5.1 -->
2. When Page 本文ヒットに加えて 1 件以上の添付ヒットが当該ページに存在する, the 検索結果リスト shall Page カード内に「この添付にもマッチ」サブエントリを表示し、添付ファイル名、ファイル形式アイコン、`label`、マッチスニペットを含める <!-- derived from umbrella R5.2 -->
3. When 添付サブエントリがクリックされる, the 検索結果リスト shall 対象ページを選択状態にし、右ペインに当該添付ヒットを反映したプレビューを表示する <!-- derived from umbrella R5.3 -->
4. Where 同一ページに添付ヒットが 2 件以上存在する, the 検索結果リスト shall 関連度最上位の 1 件を展開表示し、残りを折りたたみで切替可能にする <!-- derived from umbrella R5.4 -->
5. Where 本文がヒットせず添付のみがヒットしたページが応答に含まれる, the 検索結果リスト shall 当該ページを Page カードとして結果に含め、添付サブエントリを展開表示する <!-- derived from umbrella R5.5 -->

### Requirement 2: 検索結果プレビュー (右ペイン) の添付ヒットカード
<!-- derived from umbrella R6.1〜R6.5 -->

**Objective:** As a GROWI 利用者, I want ページ選択時にどの添付でマッチしたかをプレビュー最上部で即座に確認したい, so that マッチ箇所に素早く到達できる

#### Acceptance Criteria

1. When 左ペインで添付ヒットを持つページが選択される, the 検索結果プレビュー shall 右ペインプレビュー最上部に「添付ヒットカード」を表示する <!-- derived from umbrella R6.1 -->
2. The 添付ヒットカード shall 添付ファイル名、ファイル形式アイコン、ファイルサイズ、`label`、マッチスニペット、および添付本体を開くためのリンクまたはボタンを含む <!-- derived from umbrella R6.2 -->
3. When 添付ヒットカードの添付本体リンクがクリックされる, the 検索結果プレビュー shall 既存の添付ビューアで当該添付本体を開く <!-- derived from umbrella R6.3 -->
4. Where 選択ページに添付ヒットが 2 件以上存在する, the 検索結果プレビュー shall 関連度最上位 1 件をカードとして展開表示し、残りを折りたたみで切替可能にする <!-- derived from umbrella R6.4 -->
5. Where 選択ページに添付ヒットが存在しない, the 検索結果プレビュー shall 添付ヒットカードを表示しない <!-- derived from umbrella R6.5 -->

### Requirement 3: 検索結果のファセットフィルタ
<!-- derived from umbrella R7.1〜R7.5 -->

**Objective:** As a GROWI 利用者, I want 検索結果を「ページだけ」「添付だけ」に切り替えられること, so that 目的に応じた絞り込み軸で結果を精査できる

#### Acceptance Criteria

1. The 検索結果画面 shall 「全体」「ページ」「添付ファイル」の 3 つを切り替えるファセットタブを表示する <!-- derived from umbrella R7.1 -->
2. The 検索結果画面 shall 「全体」をデフォルトのファセットとして選択状態にする <!-- derived from umbrella R7.2 -->
3. When 「ページ」ファセットが選択される, the 検索結果画面 shall 本文がヒット根拠である結果のみを表示する <!-- derived from umbrella R7.3 -->
4. When 「添付ファイル」ファセットが選択される, the 検索結果画面 shall 添付ヒットのみを親ページ情報と `label` 付きで表示する <!-- derived from umbrella R7.4 -->
5. Where 機能が無効化されている (URI 未設定または空である場合を含む、SSR prop `isAttachmentFullTextSearchEnabled` が false の状態), the 検索結果画面 shall 「添付ファイル」ファセットタブを非表示または無効化する <!-- derived from umbrella R7.5 -->

### Requirement 4: 添付ファイル一覧モーダルの個別再抽出 UI
<!-- derived from umbrella R11.1, R11.3, R11.4, R11.5 -->

**Objective:** As a GROWI 管理者 (または権限を持つユーザ), I want 添付ファイル一覧から特定の添付だけを再抽出操作できること, so that 全体再インデックスを回さずに個別修正が行える

#### Acceptance Criteria

1. Where 機能が有効化されている (URI が設定済みで SSR prop `isAttachmentFullTextSearchEnabled` が true の状態), the 添付ファイル一覧モーダル shall 各添付行に「再抽出」ボタンを表示する <!-- derived from umbrella R11.1 -->
2. When 再抽出処理が完了する, the 添付ファイル一覧モーダル shall 成功または失敗の結果を toast 等のフィードバックでユーザに表示する <!-- derived from umbrella R11.3 -->
3. If 再抽出処理が失敗する, the 添付ファイル一覧モーダル shall エラー概要を表示し、管理者が原因を推測できる最低限の情報 (失敗種別または理由) を含める <!-- derived from umbrella R11.4 -->
4. Where 機能が無効化されている (URI 未設定または空である場合を含む、SSR prop `isAttachmentFullTextSearchEnabled` が false の状態), the 添付ファイル一覧モーダル shall 「再抽出」ボタンを表示しない <!-- derived from umbrella R11.5 -->

### Requirement 5: 管理画面の設定 UI と URI 設定時ガイダンス
<!-- derived from umbrella R9.3 + 設定 UI 表示部分 -->

**Objective:** As a GROWI 管理者, I want 添付ファイル全文検索機能の接続先 URI と limits を 1 つの画面で操作でき、新たに URI を設定した際に必要な後続操作が分かる形で提示されること, so that 設定ミスや運用ミスを防げる

#### Acceptance Criteria

1. The 管理画面 shall `ElasticsearchManagement` 画面内に「添付ファイル全文検索」セクションを表示し、抽出サービス URI (`extractorUri`)、抽出タイムアウト (`timeoutMs`)、最大ファイルサイズ (`maxFileSizeBytes`) の 3 つの設定項目を管理者が閲覧・編集・保存できる入力フォームとして提供する。独立した有効/無効トグルは**提供しない** (機能の有効化は URI が非空で保存されていることで成立し、soft-disable は URI を空文字にクリアすることで実現する)
2. When 管理者が `extractorUri` を未設定 (空文字) から設定済み (非空) に変更して保存する, the 管理画面 shall 既存添付を検索対象に取り込むには別途一括再インデックスを実行する必要がある旨を明示するガイダンスを保存成功後に表示する <!-- derived from umbrella R9.3 -->
3. If 設定値 (`extractorUri` の URI 形式、または数値項目) が形式要件を満たさない, the 管理画面 shall 該当フィールドにバリデーションエラーを表示し、保存操作を抑止する
4. Where 管理者でないユーザが当該画面にアクセスしようとした場合, the 管理画面 shall 既存 admin 画面と同じ権限制御に従いアクセスを遮断する

### Requirement 6: 管理画面の一括再インデックス UI
<!-- derived from umbrella R10.1, R10.3, R10.5 -->

**Objective:** As a GROWI 管理者, I want 既存 rebuildIndex 機能から添付も同時にインデックス化できること、かつ進捗が見えること, so that 機能有効化後の取り込みをセルフサービスで完了できる

#### Acceptance Criteria

1. The 管理画面の既存 rebuildIndex UI shall 「添付も対象にする」チェックボックスを追加し、機能が有効な場合はデフォルト ON の状態で表示する <!-- derived from umbrella R10.1 -->
2. While 一括再インデックスが実行中, the 管理画面 shall Socket.io イベントに基づき処理済み件数と総件数を管理者が視認可能な形で表示する <!-- derived from umbrella R10.3 -->
3. Where 機能が無効化されている (URI 未設定または空である場合を含む、SSR prop `isAttachmentFullTextSearchEnabled` が false の状態), the 管理画面 shall 「添付も対象にする」チェックボックスを非表示または無効化する <!-- derived from umbrella R10.5 -->

### Requirement 7: 管理画面の抽出失敗可視化 UI
<!-- derived from umbrella R12.2, R12.3 -->

**Objective:** As a GROWI 管理者, I want 抽出失敗の発生状況を管理画面から参照できること, so that 問題発生時に原因追跡の手がかりを得られる

#### Acceptance Criteria

1. The 管理画面 shall 直近の抽出失敗件数と、直近の失敗サンプル (数件) の概要 (添付識別子、ファイル形式、ファイルサイズ、失敗理由コード、発生時刻を含む) を一覧形式で表示する <!-- derived from umbrella R12.2 -->
2. Where 機能が無効化されている (URI 未設定または空である場合を含む、SSR prop `isAttachmentFullTextSearchEnabled` が false の状態), the 管理画面 shall 抽出失敗情報セクションを非表示にする <!-- derived from umbrella R12.3 -->
3. If 失敗一覧 API の取得が失敗する, the 管理画面 shall エラー状態をユーザに通知し、既存 admin 画面の他機能の表示を阻害しない
