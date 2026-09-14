# Research & Design Decisions

## Summary
- **Feature**: `i18n-community-translation`
- **Discovery Scope**: Extension（既存の翻訳ファイル・既存の i18n CI ゲートに統合する外部サービス連携）
- **Key Findings**:
  - POEditor の1プロジェクトは「フラットな用語リスト1本」であり、複数ファイル・複数namespaceを1プロジェクト内で構造的に分離する機能は無い。brief.md で未確認としていた論点はこれで解消: **namespace（`admin`/`translation`/`commons`）ごとに別の POEditor プロジェクトを作る**のが同一キー衝突を避ける唯一の構成である
  - POEditor API v2 は `type=i18next` を upload/export 双方でサポートしており、入れ子 JSON をそのまま扱える（フラット化は不要）
  - upload エンドポイントには「20秒に1リクエスト」という明文化されたレート制限があり、複数プロジェクトへの逐次呼び出しはこの間隔を空ける必要がある
  - POEditor の GitHub 連携は存在せず、API 呼び出しを自作する前提（brief.md の判断と一致）
  - `master` の branch protection は classic Required Pull Request Reviews を有効化しておらず、Mergify アプリと merge queue に委ねている。「翻訳のみの変更は自動反映」を実現する具体的な仕組み（GitHub 標準の auto-merge か、Mergify のラベル条件によるキュー投入か）は、既存の Mergify 設定を変更せずに済むかどうかまでは未検証 — タスク化して実装時に確認する

## Research Log

### POEditor API v2 の契約
- **Context**: brief.md が「POEditor の1プロジェクトが namespace ファイル1個に対応するのか」を設計前の要確認事項として明記していたため調査
- **Sources Consulted**: https://poeditor.com/docs/api （projects/upload, projects/export, languages/list, languages/add, contributors/add の各節）
- **Findings**:
  - `projects/upload`: `id`（プロジェクトID） / `updating`（`terms` | `terms_translations` | `translations`） / `file` / `language` / `overwrite` / `sync_terms`（0|1、非一致キーの削除＋新規キーの追加） / `tags` を受け付ける。ファイル形式は `i18next` を含む多数をサポート
  - `projects/export`: `id` / `language`（必須） / `type`（`i18next` 含む） / `filters` / `tags` / `options` を受け付け、10分で失効するダウンロードURLを返す
  - レート制限: upload は「20秒に1リクエスト」と明記。export には明文化された制限の記載なし（念のため逐次実行する）
  - プロジェクト構造: 1プロジェクト＝1つのフラットな用語リスト。複数ファイル/namespaceの分離機能は無い。同一キー文字列が別namespaceで別訳を持つ場合（例: `commons.json` への複製キー）、1プロジェクトに混在させると衝突する
  - `contributors/add` はメール個別追加が前提で、公開 join page の有無は API ドキュメントに記載が無い（brief.md 記載の「public join page」は POEditor 製品側のプロジェクト設定機能であり、API 経由の自動化対象ではない）
  - GitHub 連携（App/Action）はドキュメント上に記載が無く、API 呼び出しの自作が前提
- **Implications**: namespace ごとに独立した POEditor プロジェクトを作る（`admin` / `translation` / `commons` の3プロジェクト）。`sync_terms=1` 付きの `terms_translations` アップロードを namespace ごとに直列実行し、呼び出し間隔を20秒以上空ける

### 既存 `master` の branch protection / マージ経路
- **Context**: 「翻訳のみの変更は自動反映」をどう実現するかを具体化するため確認
- **Sources Consulted**: `gh api repos/growilabs/growi/branches/master/protection`
- **Findings**: classic の Required Pull Request Reviews は無効。Mergify アプリが `contents:write` 等の権限を持ち、merge queue を運用している。リポジトリ全体がどのようなラベル/ルールで自動マージ可否を判定しているかは、本 discovery の範囲では追い切れていない
- **Implications**: 設計では「翻訳のみの変更は PR を作成し、GitHub の auto-merge もしくは Mergify のラベル条件経由で人の承認なしに完了させる」という到達点だけを設計として確定し、どちらの機構で実現するか・既存 Mergify 設定に例外条件を追加する必要があるかは実装タスク側で検証する前提とする（design.md の Implementation Notes に Risk として明記）

### 既存 i18n CI ゲート・ツール構成との整合
- **Context**: 同期ワークフローが作るコード資産をどこに置くか、既存パターンをどう踏襲するかの確認
- **Sources Consulted**: `apps/app/tools/i18n-audit/`（`run-audit.ts`, `baseline.ts` 等）、`apps/app/package.json` の `lint:i18n` スクリプト、`.github/workflows/*.yml`（`check-changesets.yml` 等のトリガー/secrets/concurrency の書き方）
- **Findings**:
  - `lint:i18n` は `apps/app/tools/i18n-audit/run-audit.ts` を実行し、`turbo run lint`（`run-p lint:**`）経由で通常の lint パイプラインに統合済み。同期で取り込む変更もこのコマンドを素通りできない
  - 既存ツールは「pure function（判定ロジック）」と「I/O を伴う薄いラッパー」を分離する構成（coding-style.md のパターンに準拠）。同期ツールも同じ構成を踏襲する
  - GitHub Actions の慣習: `paths:` フィルタでトリガー範囲を絞る、`concurrency: group: ${{ github.workflow }}-${{ github.ref }}` で多重実行を防ぐ、secrets は `${{ secrets.XXX }}` で注入
- **Implications**: 同期ツールは `apps/app/tools/i18n-sync/` に、既存の `i18n-audit/` と同じ「pure function + 薄いI/Oラッパー」構成で置く。ワークフローは既存の慣習（paths filter, concurrency group）に揃える

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| namespace 1個 = POEditor 1プロジェクト（採用） | `admin`/`translation`/`commons` それぞれに専用プロジェクト | 用語の衝突が起きない。既存の namespace 境界とそのまま対応し、CI ゲートの namespace 単位の検査と整合する | プロジェクトが3つに増え、プロビジョニング・API呼び出しが3倍になる | brief.md の未確認事項を解消する決定 |
| 1プロジェクトに全namespaceを混在させ `context` で区別 | POEditor の `context` フィールドで namespace を模す | プロジェクトが1つで済む | `context` は本来「同一キー文字列の意味分岐」用途であり、namespace 全体の分離用途ではない。`commons.json` への複製キー（i18n-key-audit で導入済み）は同一キー文字列で別ファイルという構成そのものなので、1プロジェクトに混在させると衝突するリスクが高い | 不採用 |

## Design Decisions

### Decision: namespace ごとに独立した POEditor プロジェクトを作る
- **Context**: brief.md の未確認事項（1プロジェクトが1namespaceファイルに対応するのか）
- **Alternatives Considered**:
  1. namespace ごとに専用プロジェクト（3プロジェクト）
  2. 1プロジェクトに全namespaceを混在させ `context` フィールドで区別
- **Selected Approach**: 1
- **Rationale**: POEditor のプロジェクトはフラットな用語リストであり、`commons.json` への複製キーのような「同一キー文字列・別ファイル」の実態と構造的に相性が悪い。namespace 単位でプロジェクトを分ければ、衝突が起きようがない
- **Trade-offs**: プロジェクト数・API呼び出し回数が増える。ただしレート制限（20秒に1回）を踏まえても、3プロジェクト分の逐次呼び出しは数十秒で収まる規模であり許容範囲
- **Follow-up**: プロジェクト作成時に3プロジェクトそれぞれで公開 join page を有効化することを手順化する（実装タスク側）

### Decision: 変更の種類（構造変更の有無）で自動反映と人レビューを分岐する
- **Context**: requirements.md 要件3（ユーザー確認済み: ハイブリッド方式を採用）
- **Selected Approach**: 取り込み前後で namespace×言語ファイルのキー集合を比較し、キー集合が完全一致すれば「訳文のみの変更」として CI ゲート通過を条件に自動反映、キー集合に差分があれば「構造変更」として人レビュー必須の変更提案にする
- **Rationale**: キー集合の一致/不一致は機械的に判定できる明確な基準であり、レビューが本当に必要な変更（想定外のキー追加・削除）だけを人の目に回せる
- **Trade-offs**: 自動反映の具体的な実現機構（GitHub 標準 auto-merge か Mergify ルールか）は本 spec の discovery だけでは確定しておらず、実装タスクでの検証が要る（上記「既存 `master` の branch protection」参照）

## Risks & Mitigations
- 自動マージの具体的な実現機構が既存の Mergify 運用と衝突する可能性 — 実装タスクの最初に検証し、既存運用を変更しない形（ラベル条件の追加等）に倒す
- POEditor OSS プランの申請が承認されない可能性 — 承認されるまで本番運用（実際の同期起動）を進めない。requirements.md 要件7.2で明示済み
- upload のレート制限（20秒に1回）を超過すると同期が失敗する — 呼び出し間に待機を入れて直列実行する設計とする
- `sync_terms=1` はキー削除も行うため、リポジトリ側の一時的なファイル欠損や取得漏れがあると POEditor 側の翻訳を誤って削除しうる — push 対象ファイルの読み込みに失敗した場合は同期自体を中止する（部分実行しない）

## References
- [POEditor API Reference](https://poeditor.com/docs/api) — upload/export のパラメータ、レート制限、対応フォーマットの一次情報
