# Research & Design Decisions

## Summary
- **Feature**: `i18n-community-translation`
- **Discovery Scope**: Extension（既存の翻訳ファイル・既存の i18n CI ゲートに統合する外部サービス連携）
- **Key Findings**:
  - POEditor の1プロジェクトは「フラットな用語リスト1本」であり、複数ファイル・複数namespaceを1プロジェクト内で構造的に分離する機能は無い。brief.md で未確認としていた論点はこれで解消した。ただし、その分離の実現方法については判断が一度変わっている: 当初は namespace（`admin`/`translation`/`commons`）ごとに別の POEditor プロジェクトを作る方式を採用したが、後の検証でこの方式は撤回した。**現在の方式は、単一の共有プロジェクトに対し、アップロードするJSON自体をnamespace名でラップする**（例: `{"commons": {...}}`）ことでキー衝突を避けるというものである。経緯は「単一プロジェクト方式への転換」（Research Log）を参照
  - POEditor API v2 は `type=i18next` を upload/export 双方でサポートしており、入れ子 JSON をそのまま扱える（フラット化は不要）。この入れ子保持は namespace ラップ方式の前提でもあり、実プロジェクトでの実測でも確認済み
  - upload エンドポイントには「20秒に1リクエスト」という明文化されたレート制限があり、逐次呼び出しはこの間隔を空ける必要がある
  - POEditor の GitHub 連携は存在せず、API 呼び出しを自作する前提（brief.md の判断と一致）
  - `master` の branch protection は classic Required Pull Request Reviews を有効化しておらず、Mergify アプリと merge queue に委ねている。「翻訳のみの変更は自動反映」は、既存の `.github/mergify.yml` にある「Automatic queue to merge」ルール（`#approved-reviews-by >= 1` 条件）にそのまま乗せて実現する。この条件を回避する新しい Mergify ルールを追加する案も検討したが、人レビューを経ずにマージできる経路を新設することになるため採用しない（詳細は下記「既存 `master` の branch protection / マージ経路」参照）。承認は「PR を作る identity とは別の identity」から出す設計（design.md）で満たす
  - POEditor は言語コードとして GROWI のロケールコード（`en_US`/`ja_JP`/`zh_CN`/`fr_FR`/`ko_KR`）をそのままでは受け付けない。`en_US` を渡すと `"Wrong language code"` エラーになる。正しくは `en-us`/`ja`/`zh-CN`/`fr`/`ko` へ変換する必要があり、これを行わない実装は push のたびに失敗する（実プロジェクトでの実測により判明。ただし `en_US` に対応する具体的なコードは実測時点では単なる `en` としていたが、PRレビューでの指摘を受け `en-us`（English (US)、POEditor公式の言語コード一覧に別掲）へ修正した。`en` のままだとPOEditor画面上でイギリス国旗アイコンが表示されるため。`en-us` 自体は実際のプロジェクトでまだ実行時検証していない — 単なる `en` は実測で受理されることを確認済みだが、`en-us` は公式ドキュメントの一覧に基づく変更であり、実プロビジョニング後の動作確認（tasks.md 6.1/6.2）で改めて確認すること）

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
- **Implications**: この時点では、namespace ごとに独立した POEditor プロジェクトを作る（`admin` / `translation` / `commons` の3プロジェクト）方針とした。`sync_terms=1` 付きの `terms_translations` アップロードを namespace ごとに直列実行し、呼び出し間隔を20秒以上空ける想定だった。**この方針は下記「単一プロジェクト方式への転換」で撤回している**

### 単一プロジェクト方式への転換：namespace衝突回避とタグ付けの両立
- **Context**: 3プロジェクト構成を実装に落とし込む前段階で、POEditor の OSS（無償）プラン承認がプロジェクト単位でのみ有効であること（ユーザー確認済み）が判明し、namespace が増えるたびに OSS 再申請が発生するという運用上の負担が見えた。単一プロジェクトに統合できないかを、キー衝突回避と翻訳者向けタグ付けの両立という観点から再検討した
- **Sources Consulted**: https://poeditor.com/docs/api （`terms/add`, `terms/update`, `projects/upload`, `projects/export` の各節）
- **Findings**:
  - `terms/add`/`terms/update` は term + context の組み合わせで用語を一意に識別し、同じ term 文字列でも context が異なれば別用語として共存できる。しかし実際に使う一括アップロードのエンドポイント `projects/upload` には、用語ごとに個別の context を指定する手段が無い。用語の数だけ個別API呼び出しが必要になり非現実的なため、この方式では namespace 分離を実現できない
  - i18next 形式はネストした JSON をそのまま扱える（上記「POEditor API v2 の契約」で確認済み）。この性質を使い、アップロードするJSON自体を `{"commons": {...}}` のように namespace 名でラップすれば、ラップした1階層が用語パスの一部になり、`commons.pageTitle` と `translation.pageTitle` は別の用語として区別される。これなら単一プロジェクトでも衝突が起きない
  - `projects/upload` の `tags` パラメータは、値が `{"all": "..."}` / `{"new": [...], "obsolete": [...], "overwritten_translations": [...]}` という**呼び出し単位のステータス分類**であり、アップロードしたファイル内の特定のキー範囲だけに別タグを付ける機能ではない。そのため、namespaceごとに翻訳者向けタグを分けて付けるには、全namespace統合アップロードとは別に、**namespaceごとに範囲を絞った追加のアップロード呼び出し**（後述の「2段階アップロード」参照）が必要になる
- **Implications**: namespace 分離の実現手段を「別プロジェクト」から「単一プロジェクト内でのJSON構造ラップ」に変更する。OSS プラン再申請が将来 namespace が増えても発生しなくなる副次効果もある

### `sync_terms=1` の削除挙動とアップロード呼び出しの分割可否
- **Context**: 単一プロジェクトでnamespaceごとに3回アップロードする素朴な実装に切り替えた場合、何が起きるかを検証した
- **Sources Consulted**: https://poeditor.com/docs/api （`projects/upload` の `sync_terms` パラメータ説明）
- **Findings**: `sync_terms=1` は「アップロードしたファイルの内容にプロジェクト全体を収束させる（ファイルに無いキーを削除する）」操作である。3プロジェクト構成では各プロジェクトが独立していたため問題にならなかったが、単一プロジェクトで namespace ごとに3回 `sync_terms=1` を呼ぶと、2回目以降の呼び出しが前の呼び出しで入れた別namespaceのキーを「今回のファイルに無いキー」とみなして削除してしまう
- **Implications**: 1回のpush実行につき、**全namespaceを1つのJSONにまとめた `sync_terms=1` 呼び出しを1回だけ**行う設計に変更する。namespaceごとのタグ付けは、この統合アップロードとは別に、`sync_terms` を無効にした（＝削除を発生させない）追加アップロードで行う。この2段階構成により、単一プロジェクトへの移行で pull 側のexport呼び出しも `3 namespace × 4 言語 = 12回` から `4回`（言語ごとに1回）へ減らせるため、push側でアップロード回数が1回から4回（統合1回＋タグ付け3回）に増えても、全体のAPI呼び出し回数は増えない

### 実プロジェクトでの実測検証（POEditor上の"GROWI"プロジェクト, id: 839626）
- **Context**: 上記2つの転換で前提としていた「namespaceラップの入れ子保持」と「namespaceごとの`sync_terms=1`が相互削除を起こすこと」は、いずれも実装前に確認が要る未検証の前提だった。使い捨てのテストアカウントではなく、既にOSS承認済みの実プロジェクトを使い、明らかにテスト用と分かるダミーキー（`_amend_probe.*`）だけをアップロード・削除する形で検証した
- **Sources Consulted**: POEditor API v2（実際のAPI呼び出し、`projects/upload`/`projects/export`/`languages/add`/`languages/list`/`terms/list`/`terms/delete`）
- **Findings**:
  - `{"_amend_probe": {"dummy_key": "..."}}` としてアップロードし `type=i18next` でexportしたところ、`_amend_probe` というトップレベルキーの下に入れ子構造のまま返ってきた。namespaceラップの入れ子保持は実証済み
  - `_amend_probe` が存在する状態で、別namespace `_amend_probe_2` だけを含むファイルを `sync_terms=1` でアップロードしたところ、レスポンスに `"deleted": 1` と出て `_amend_probe` が実際に削除された。namespaceごとに `sync_terms=1` を呼ぶと相互に削除し合うという懸念は、実際に起きる不具合であることが実証された
  - POEditor内部の用語モデルは、i18nextの入れ子構造から term（末端のキー）と context（親キーパス、`"_amend_probe_2"` のように引用符ごと文字列化された形）を自動的に導出していた（`terms/list`で確認）。ただしこれは内部表現の詳細であり、export（`type=i18next`）の入出力契約には影響しない
  - この検証の過程で、POEditorが言語コードとして `en_US` を受け付けず `"Wrong language code"` エラーになることを発見した。この場では代わりに単なる `en` が受理されることを実測で確認したが、後日のPRレビューで「`en` だとPOEditor画面上でイギリス国旗アイコンが表示されて紛らわしい」との指摘を受け、POEditor公式の言語コード一覧にある `en-us`（English (US)）に変更した（`ja`/`zh-CN`/`fr`/`ko` は変更なし）。`en-us` 自体は実プロジェクトでの実測はまだ行っていない
- **Implications**: namespaceラップの入れ子保持、および namespaceごとの `sync_terms=1` が相互削除を起こすことの2点は、どちらも確認済みとしてリスクから除去できる。言語コード変換（GROWIロケール→POEditor言語コードの対応表）は新たに必要な実装項目として追加する

### 既存 `master` の branch protection / マージ経路
- **Context**: 「翻訳のみの変更は自動反映」をどう実現するかを具体化するため確認
- **Sources Consulted**: `gh api repos/growilabs/growi/branches/master/protection`、`.github/mergify.yml`
- **Findings**: classic の Required Pull Request Reviews は無効。承認レビューの件数条件（`#approved-reviews-by >= 1`）は GitHub のブランチ保護ではなく `.github/mergify.yml` の `pull_request_rules`（「Automatic queue to merge」ルール）だけに書かれている。`queue_rules.default` 自体には承認条件は無く、CI チェック（`ci-app-lint` 等）だけが `queue_conditions`/`merge_conditions` として課されている
- **Implications**: 「`#approved-reviews-by >= 1` を課さない新しい `pull_request_rule` を追加すれば、承認ボットという別 identity を用意せずに済むのではないか」という代替案を検討した。`queue:` アクションを使う新ルールであれば `queue_rules.default` の CI ゲートは引き続き効くため、CI を迂回するわけではない。しかし、承認レビューという「人が確認した」という手続きそのものを不要にしてしまい、PR 作成に使う identity（1つの credential）が漏えいした場合に、それだけで人レビューを経ずにマージまで到達できてしまう。現状の「別 identity が承認レビューを送る」設計では、PR 作成用の credential が単独で漏れても、もう一つの identity による承認が無い限りマージには進めない。この一段構えを失うことは受け入れられないため、Mergify 設定は変更しない。承認は「PR を作る identity とは別の identity」から出す設計を維持し、この決定は下記「Decision: Mergify のルールは変更せず、承認は別 identity から出す」に記録する

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
| namespace 1個 = POEditor 1プロジェクト（当初採用 → 撤回） | `admin`/`translation`/`commons` それぞれに専用プロジェクト | 用語の衝突が起きない。既存の namespace 境界とそのまま対応し、CI ゲートの namespace 単位の検査と整合する | プロジェクトが3つに増え、プロビジョニング・API呼び出しが3倍になる。POEditor OSSプランの承認がプロジェクト単位でのみ有効なため、namespace が増えるたびにOSS再申請が発生する | brief.md の未確認事項を解消する当初の決定だったが、単一プロジェクト方式に置き換えた（下記参照） |
| 1プロジェクトに全namespaceを混在させ `context` で区別 | POEditor の `context` フィールドで namespace を模す | プロジェクトが1つで済む | `context` は本来「同一キー文字列の意味分岐」用途であり、namespace 全体の分離用途ではない。`commons.json` への複製キー（i18n-key-audit で導入済み）は同一キー文字列で別ファイルという構成そのものなので、1プロジェクトに混在させると衝突するリスクが高い | 不採用 |
| namespace を JSON構造でラップして単一プロジェクトに格納（現在の採用方式） | アップロード前に `{namespace: content}` でラップし、1回の統合アップロード（`sync_terms=1`）＋ namespaceごとの追加タグ付けアップロード（`sync_terms`無効）で運用 | POEditorの追加APIパラメータに依存しない。i18next形式のネスト対応だけで衝突を回避できる。OSSプラン再申請が発生しない。タグによる翻訳者向け絞り込みも両立できる | アップロード呼び出しが1(統合)+namespace数(タグ付け)回に増える(3namespaceなら4回、20秒間隔で約80秒)。ただしexport呼び出しが12回→4回に減るため全体では相殺される | 採用。実プロジェクトでの実測により前提を検証済み |
| term + context フィールドで衝突を回避 | `terms/add`/`terms/update` で個別に context を設定 | 用語ごとに意味的なcontextを持てる | 一括アップロード(`projects/upload`)にはcontextを個別指定する手段が無く、キーの数だけ個別API呼び出しが必要になり非現実的 | 不採用 |
| namespaceごとに個別アップロード(単一プロジェクトで`sync_terms=1`を毎回使用) | 3プロジェクト構成のロジックをそのまま単一プロジェクトに転用 | 実装差分が最小 | 2回目以降の呼び出しが前のnamespaceのキーを削除してしまう。実プロジェクトでの実測により実際に発生することを確認済み | 不採用（致命的な欠陥） |

## Design Decisions

### Decision: namespace ごとに独立した POEditor プロジェクトを作る（撤回済み — 「単一の POEditor プロジェクトに統合する」に置き換え）
- **Status**: この決定は下記「単一の POEditor プロジェクトに統合し、namespace をJSON構造でラップして衝突を回避する」に置き換えられた。当時の判断根拠として記録を残す
- **Context**: brief.md の未確認事項（1プロジェクトが1namespaceファイルに対応するのか）
- **Alternatives Considered**:
  1. namespace ごとに専用プロジェクト（3プロジェクト）
  2. 1プロジェクトに全namespaceを混在させ `context` フィールドで区別
- **Selected Approach**: 1
- **Rationale**: POEditor のプロジェクトはフラットな用語リストであり、`commons.json` への複製キーのような「同一キー文字列・別ファイル」の実態と構造的に相性が悪い。namespace 単位でプロジェクトを分ければ、衝突が起きようがない
- **Trade-offs**: プロジェクト数・API呼び出し回数が増える。ただしレート制限（20秒に1回）を踏まえても、3プロジェクト分の逐次呼び出しは数十秒で収まる規模であり許容範囲
- **Follow-up**: この方式は、POEditor OSSプランの承認がプロジェクト単位でのみ有効であること（namespace が増えるたびにOSS再申請が必要になる）が判明したことで再検討され、撤回された

### Decision: 単一の POEditor プロジェクトに統合し、namespace をJSON構造でラップして衝突を回避する
- **Context**: 単一プロジェクトでのキー衝突回避と、翻訳者向けタグ付けの両立
- **Alternatives Considered**: 上記 Architecture Pattern Evaluation の「term + context フィールドで衝突を回避」「namespaceごとに個別アップロード」を含む各案
- **Selected Approach**: アップロード前にJSONを `{namespace: content}` の形でラップし、単一の共有プロジェクトへ格納する
- **Rationale**: POEditorの追加APIやcontext個別指定に依存せず、既存の「i18next形式はネストしたJSONをそのまま扱える」という確認済みの仕様だけで衝突を回避できる。OSSプランの再申請が将来 namespace が増えても発生しなくなる
- **Trade-offs**: namespaceラップの入れ子保持は当初未検証の前提だったが、実プロジェクトでの実測により確認済み
- **Follow-up**: なし（検証完了）

### Decision: 統合アップロード（1回）とnamespace別タグ付けアップロード（複数回）の2段階でpushする
- **Context**: `sync_terms=1` の削除挙動（アップロードしたファイルに無いキーを削除する）が、単一プロジェクトでnamespaceごとに`sync_terms=1`を呼ぶと相互削除を引き起こす致命的な不具合につながることが判明したため
- **Alternatives Considered**: namespaceごとに毎回`sync_terms=1`を使う素朴な実装（Architecture Pattern Evaluation参照。相互削除の不具合を実測で確認したため不採用）
- **Selected Approach**: 1回のpush実行につき、全namespaceを1つのJSONにまとめた`sync_terms=1`呼び出しを1回だけ行い、その後にnamespaceごとの追加タグ付けアップロード（`sync_terms`を無効にし、削除を発生させない）を行う
- **Rationale**: `sync_terms`の削除挙動を1回の統合呼び出しに閉じ込めることで、致命的なデータ消失バグを防げる
- **Trade-offs**: アップロード呼び出しが1回（3プロジェクト構成の直列3回）から4回（統合1回＋タグ付け3回）に増え、pushにかかる時間が約60秒から約80秒に伸びる。ただしCIジョブの非同期実行であり許容範囲。一方でpull側のexport呼び出しは`3 namespace × 4 言語 = 12回`から`4回`（言語ごと）へ減るため、全体としてAPI呼び出し回数は増えない
- **Follow-up**: タグ付けアップロード（`sync_terms`無効）が他namespaceのキーを`tags`の`obsolete`スコープの対象にしないかは、実測では他namespaceの内容が空の状態でのテストに留まり未確認のまま残る。本番運用開始前の実環境確認で引き続き確認する（Risks & Mitigations参照）

### Decision: pull は言語ごとに1回の統合exportを行い、クライアント側でnamespaceに分割する
- **Context**: 単一プロジェクトになったことで、namespaceごとに個別exportする必要が無くなった
- **Selected Approach**: 言語ごとに1回exportを呼び、返ってきた統合JSONをnamespaceごとに分割してから既存の差分判定ロジックに渡す
- **Rationale**: exportにはPOEditor側の明文化されたレート制限が無く、呼び出し回数を減らせるなら減らす方が単純
- **Trade-offs**: 言語ごとの統合exportが不正な形式（invalid_json）だった場合、その言語に属する全namespaceの組み合わせがまとめてスキップ対象になる（namespace単位で独立してスキップされる3プロジェクト構成より粒度が粗くなる）。exportは読み取り専用でリポジトリを書き換えないため、この粒度の粗さは許容できるリスクと判断する

### Decision: 変更の種類（構造変更の有無）で自動反映と人レビューを分岐する
- **Context**: requirements.md 要件3（ユーザー確認済み: ハイブリッド方式を採用）
- **Selected Approach**: 取り込み前後で namespace×言語ファイルのキー集合を比較し、キー集合が完全一致すれば「訳文のみの変更」として CI ゲート通過を条件に自動反映、キー集合に差分があれば「構造変更」として人レビュー必須の変更提案にする
- **Rationale**: キー集合の一致/不一致は機械的に判定できる明確な基準であり、レビューが本当に必要な変更（想定外のキー追加・削除）だけを人の目に回せる
- **Trade-offs**: 自動反映は既存の `.github/mergify.yml`「Automatic queue to merge」ルールにそのまま乗せる（下記 Decision 参照）ため、追加の実現機構は不要

### Decision: Mergify のルールは変更せず、承認は別 identity から出す
- **Context**: 「翻訳のみの変更を自動反映する」ために `#approved-reviews-by >= 1` 条件をどう満たすか。「承認ボットという別 identity を用意する」設計に対し、「Mergify のルールを工夫して承認件数条件そのものを外す」という代替案が出た（ユーザーが別セッションでも検討）
- **Alternatives Considered**:
  1. 承認ボット（PR 作成 identity とは別の identity）が承認レビューを送り、既存の「Automatic queue to merge」ルールにそのまま乗せる
  2. `.github/mergify.yml` に、bot 作成者・特定ラベル・CI 成功を条件とし `#approved-reviews-by >= 1` を課さない新しい `pull_request_rule` を追加する（`queue:` アクションを使えば `queue_rules.default` の CI ゲート自体は維持できる）
- **Selected Approach**: 1
- **Rationale**: 案2は CI を迂回するわけではないが、「人が内容を確認した」という手続きを丸ごと無くしてしまう。案2を採ると、PR 作成に使う identity の credential が1つ漏れただけで、人レビューを経ずにマージまで到達できてしまう。案1では、PR 作成用の credential が漏れても、別 identity による承認が無い限りマージに進めない。この一段構えを失う変更は採用しない
- **Trade-offs**: 案1は「PR 作成 identity」と「承認 identity」という2つの identity を用意・運用する手間が要る（`docs/i18n-community-translation-setup.md` §4 参照）。ただしこの手間は、GitHub App の private key だけを長期保存し installation token は workflow 実行のたびに発行する設計にすることで、人が手作業で token を作り直す必要が無いところまで軽減できる
- **Follow-up**: `.github/mergify.yml` は変更しない。今後この trade-off が再検討される場合は、この Decision を起点に議論すること

### Decision: POEditor の未翻訳キーは export の空文字列で判定し、fallback言語には頼らない
- **Context**: task 6.2（pull経路の実環境確認）で、実プロジェクト（ja/zh/fr/ko がほぼ0%翻訳の状態）に対して実際に pull を実行したところ、既存の正しい訳文が軒並み English に置き換わる致命的な PR（#11925、マージせず close 済み）が生成された
- **Sources Consulted**: https://poeditor.com/kb/fallback-languages 、実プロジェクトでの実測（Fallback Language を「未設定」に変更した上での fr export）
- **Findings**:
  - 原因は POEditor プロジェクトの Fallback Language 設定。設定されていると、ある言語で未翻訳のキーは export 時にフォールバック言語（本件では English）の文言で埋められる
  - Fallback Language を「未設定（None）」にすると、未翻訳のキーは export 上で**キーごと消えるのではなく、値が空文字列 `""` になる**ことを実測で確認した（`{"admin": {"Page": "", ...}}` のような形。省略されるのではない点が重要）
  - `filters=translated`（POEditor API の export フィルタ。未翻訳の用語を export から除外する）を試したが、これは逆効果と判明した。未翻訳キーが export から丸ごと消えるため、`DiffClassifier.classify` がリポジトリ側の既存キーを「削除された」と誤判定し、より広範囲の削除を提案する構造変更PRになってしまう（一時的にコードへ入れたが検証後に取り消し済み）
- **Selected Approach**: `DiffClassifier.classify` で、export側の値が空文字列 `""` の leaf は「今回POEditorから得られる情報が無い（未翻訳）」として、追加・削除・変更のいずれにも数えず読み飛ばす。リポジトリ側に既存の値があればそのまま保持される。空文字列ではなく leaf 自体が export に存在しない場合（push の `sync_terms=1` によってPOEditor側のterm自体が本当に削除された場合）のみ、従来通り `removedKeys` として扱う
- **Rationale**: 「未翻訳（空文字列）」と「値が空であることが意図された変更」「キー自体の削除」を区別できる唯一の手がかりが、値が空文字列かどうかとPOEditor側にkeyが存在するかどうかの組み合わせだった。空文字列を「情報なし」として扱うことで、リポジトリ側の既存翻訳を誤って上書き・削除する経路を塞げる
- **Trade-offs**: 翻訳者が意図的に訳文を空文字列にしたい場合（UI文言を意図的に空にする等）は今の実装では区別できず、常に「未翻訳」として無視される。この用途は稀とみなし、今回は対応しない（将来必要になれば別の明示的なマーカーの検討が要る）
- **Follow-up**: POEditor プロジェクトの Fallback Language は必ず「未設定」で運用すること（`docs/i18n-community-translation-setup.md` §2.2 に明記済み）。加えて、POEditor が ja/zh/fr/ko の既存翻訳を1件も持っていない（push が en_US しかアップロードしないため）という別の未解決事項がある。既存翻訳を初回投入するまでは、翻訳者が参加してもPOEditor上は0%表示のままになる（`docs/i18n-community-translation-setup.md` §2.3 に記載済み。実装はタスク化して別途対応する）

## Risks & Mitigations
- POEditor OSS プランの申請が承認されない可能性 — 承認されるまで本番運用（実際の同期起動）を進めない。requirements.md 要件7.2で明示済み
- upload のレート制限（20秒に1回）を超過すると同期が失敗する — 呼び出し間に待機を入れて直列実行する設計とする
- `sync_terms=1` はキー削除も行うため、リポジトリ側の一時的なファイル欠損や取得漏れがあると POEditor 側の翻訳を誤って削除しうる — push 対象ファイルの読み込みに失敗した場合は同期自体を中止する（部分実行しない）
- 統合アップロード（`sync_terms=1`）とnamespace別タグ付けアップロードの間で失敗が起きた場合、プロジェクトの内容（統合アップロード分）は既に正しく反映済みだが、一部namespaceのタグ付けが未完了のまま終わる可能性がある — タグは翻訳者向け絞り込み表示にのみ影響し、キー内容の正しさには影響しない。ワークフロー再実行で回復できる（統合アップロードは冪等、タグ付けアップロードも`sync_terms`無効で非破壊的なため再実行安全）
- 言語ごとの統合exportが不正な形式だった場合、その言語の全namespaceがまとめてスキップされる（namespace単位の独立性が3プロジェクト構成より粗くなる） — export専用のリスクであり、リポジトリへの書き込みには影響しない
- タグ付けアップロード（`sync_terms`無効）が他namespaceのキーを`tags`の`obsolete`スコープの対象にしてしまわないかは、実プロジェクトでの実測では他namespaceの内容が存在しない状態でのテストに留まり、確認できていない — 本番運用開始前の実環境確認（複数namespaceが実データで共存する状態でのタグ付けアップロード）で必ず確認すること
- POEditor プロジェクトの Fallback Language 設定が誤って有効化されると、未翻訳キーの export値が別言語の文言で埋まり、`DiffClassifier`が「訳文が変更された」と誤判定して既存の正しい翻訳を上書きしうる（task 6.2の実環境確認で実際に発生し、生成されたPRはマージせずclose済み） — `DiffClassifier.classify`が空文字列を「情報なし」として無視する実装に修正済み（上記Decision参照）だが、Fallback Language自体は引き続き「未設定」運用が前提。プロジェクト設定が意図せず変わっていないか、定期的な実環境確認（tasks.md 6.x）で確認すること
- POEditorが ja/zh/fr/ko の既存翻訳を1件も持っていない（push が en_US しかアップロードしないため）状態が続くと、翻訳者が参加してもPOEditor上は0%表示のままになり、体験を損なう — 既存翻訳の初回投入をタスク化して対応する（`docs/i18n-community-translation-setup.md` §2.3）

## References
- [POEditor API Reference](https://poeditor.com/docs/api) — upload/export のパラメータ、レート制限、対応フォーマットの一次情報。`terms/add`/`terms/update`の用語一意性（term+context）と、`projects/upload`（一括アップロード）にはcontextを個別指定する手段が無いことも、この一次情報から確認した
