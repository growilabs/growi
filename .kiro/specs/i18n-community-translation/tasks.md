# Implementation Plan

## 1. Foundation: 同期の共有部品

- [x] 1.1 (P) namespaceとPOEditorプロジェクトIDの対応関係を宣言する
  - `admin` / `translation` / `commons` の3 namespaceそれぞれに対応するPOEditorプロジェクトIDと、対応するロケールファイルパスを解決する仕組みを宣言データとして用意する
  - 宣言された3 namespaceが、実際に存在する3つのロケールファイル名（`admin.json`/`translation.json`/`commons.json`）と一致することを検証するテストを書く
  - 宣言に `translation` namespaceが含まれることを確認し、`packages/editor`が依存する`toolbar.*`キーが同じ同期範囲に含まれることを明示する
  - 観測可能な完了状態: 宣言データを読み込むテストが、3件のプロジェクトID対応をエラーなく返す
  - _Requirements: 2.1, 6.1_
  - _Boundary: SyncConfig_

- [x] 1.2 (P) POEditor API v2 の呼び出しを薄いクライアントとして実装する
  - upload・export・languages/list の3操作を、成功時の戻り値とエラー種別（レート制限・not found・不正リクエスト・通信エラー）を区別する形で実装する
  - upload呼び出し1回ごとに20秒以上の間隔を空ける仕組みを組み込む
  - APIトークンは呼び出し元から注入された値を使い、環境変数を直接読まない
  - レート制限・not found・不正リクエストそれぞれのエラーレスポンスをモックし、対応するエラー種別が返ることを検証する単体テストを書く
  - 観測可能な完了状態: モックしたAPIレスポンスに対し、成功時は戻り値、失敗時は対応するエラー種別を返すテストが通る
  - _Requirements: 2.1, 3.1_
  - _Boundary: PoeditorClient_

- [x] 1.3 (P) 取り込み前後のキー集合を比較して変更の種類を判定する処理を実装する
  - 2つのJSON（取り込み前/後）のネストしたリーフキーパスを比較し、「変更なし」「訳文のみの変更」「構造変更（キーの追加・削除を含む）」のいずれかを返す純粋関数として実装する
  - 入出力のみに依存し、ファイル読み込みやAPI呼び出しを行わない
  - キー集合が同一で値のみ変わるケース、キー追加のケース、キー削除のケース、キーのリネーム（追加+削除として判定されるケース）、無変化のケースの5パターンを検証する単体テストを書く
  - 観測可能な完了状態: 上記5パターンそれぞれで期待した判定結果が返ることをテストが確認する
  - _Requirements: 3.1, 3.2_
  - _Boundary: DiffClassifier_

- [x] 1.4 (P) 実行時にPOEditorへ依存しないことを保証する継続的なテストを追加する
  - `apps/app/src/` 配下のソースコードにPOEditorのドメイン文字列やAPIエンドポイントへの参照が存在しないことを検証するテストを書く
  - 観測可能な完了状態: このテストが現在のリポジトリ状態に対して通過し、将来 `apps/app/src/` にPOEditor呼び出しが追加された場合は失敗するようになる
  - _Requirements: 4.1, 4.2_
  - _Boundary: no-runtime-dependency test_

## 2. Core: ソース言語のpush同期

- [x] 2. (P) en_US翻訳ファイルをnamespaceごとにPOEditorへpushするCLIを実装する
  - 宣言された3 namespace分のen_USファイルを読み込み、`sync_terms`を有効にした状態で順にPOEditorへアップロードする
  - いずれかのnamespaceファイルの読み込みに失敗した場合、他のnamespaceへのpushも行わずに処理全体を中止し、非ゼロ終了コードで終了する
  - 3件のアップロード呼び出しの間に必要な待機を入れる
  - あるnamespaceのファイルが読み込めないケースを模した統合テストを書き、他のnamespaceへのアップロードが実行されないことを確認する
  - 観測可能な完了状態: 3 namespace分のテスト用JSONを与えた統合テストが、POEditorクライアントへの呼び出しが3回・想定した間隔で行われたことを確認する
  - _Requirements: 2.1, 2.2, 2.3, 8.1_
  - _Depends: 1.1, 1.2_
  - _Boundary: PushSourceSync_

## 3. Core: 翻訳の取り込みと分岐

- [x] 3.1 (P) POEditorから翻訳をexportし、変更の種類ごとに集計する
  - 3 namespace × 4非ソース言語（最大12通り）それぞれについてexportし、変更判定処理にかけて結果を集める
  - 判定結果を「訳文のみの変更をまとめたグループ」と「構造変更をまとめたグループ」の最大2グループに分類する
  - 同一グループの中に異なる判定結果（訳文のみと構造変更）を混在させないことを検証する単体テストを書く
  - 観測可能な完了状態: 12通りの判定結果を混在させた入力を与えたテストが、訳文のみのグループと構造変更のグループを正しく分離して返す
  - _Requirements: 3.1, 3.2_
  - _Depends: 1.2, 1.3_
  - _Boundary: PullTranslationSync_

- [x] 3.2 訳文のみの変更を、既存のi18n CIゲート通過を条件に自動反映する
  - 「訳文のみの変更」グループをまとめた1本の変更提案（PR）を作成する。既に同じ差分に対する未マージの変更提案が残っている場合は、新しく作らずその変更提案を更新する（重複した変更提案を作らない）
  - 既存の`lint:i18n`を実行し、通過した場合のみ、変更提案の作成者とは別の承認ボットIDで承認レビューを送る
  - `lint:i18n`が失敗した場合は承認を送らず、失敗をワークフローの失敗として表面化する
  - `lint:i18n`が失敗するケースを模した統合テストを書き、承認レビューが送られないことを確認する
  - 同じ差分に対して2回実行しても、変更提案が2本に増えず、既存の1本が更新されることを確認する統合テストを書く
  - 観測可能な完了状態: `lint:i18n`合格を模したケースで承認レビュー送信が1回呼ばれ、失敗を模したケースで0回であること、および同じ差分の2回実行で変更提案が1本のまま保たれることをテストが確認する
  - _Requirements: 3.3, 3.4, 8.1_
  - _Depends: 3.1_
  - _Boundary: PullTranslationSync_

- [x] 3.3 構造変更を、人レビュー必須の変更提案として作成し、pull CLIのエントリポイントで束ねる
  - 「構造変更」グループをまとめた1本の変更提案（PR）を、承認ボットを関与させずに作成する。既に同じ差分に対する未マージの変更提案が残っている場合は、新しく作らずその変更提案を更新する（重複した変更提案を作らない）
  - 訳文のみのグループが空でも構造変更のグループが存在する場合は、構造変更側の変更提案だけが作られることを検証する統合テストを書く
  - `pull-translations.ts` に `main()` エントリポイント（`push-source.ts` の `main()` を手本にする）を追加し、3.1の`collectClassifications`・3.2の`applyTranslationOnlyChanges`・本タスクの構造変更PR作成を順に呼び出し、いずれかが失敗した場合に非ゼロ終了コードで終了する形にまとめる（3.2のレビューで「8.1の失敗表面化がこの層で未完結」「main()の置き場所が3タスクとも空白」と指摘された分を回収する）
  - 観測可能な完了状態: 構造変更のみを含む入力に対し、承認ボット呼び出しが一度も発生せず、レビュー必須の変更提案が1本作られることをテストが確認する。`main()`経由の失敗が非ゼロ終了コードになることも確認する
  - _Requirements: 3.2, 8.1_
  - _Depends: 3.1, 3.2_
  - _Boundary: PullTranslationSync_

## 4. 貢献者向けガイドと運用環境の準備

- [x] 4.1 (P) 貢献者向けガイドを作成する
  - GitHubアカウントなしでPOEditorプロジェクトに参加する方法、POEditor上で翻訳を投稿する方法、言語ごとの翻訳進捗（POEditor自体の画面）の見方を記載する
  - リポジトリのREADMEから、このガイドへのリンクを追加する
  - 観測可能な完了状態: ガイドを読んだ人が、GitHubの知識なしに参加から翻訳投稿までの手順を実行できる内容が揃っている
  - _Requirements: 1.3, 5.1, 5.2_

- [ ] 4.2 (P) メンテナー向け運用手順書を作成し、その手順を実行して実運用環境を準備する
  - [x] POEditor OSSプランの申請手順、namespaceごとに専用プロジェクトを作成する手順、各プロジェクトでpublic join pageを有効化する手順を記載する（`docs/i18n-community-translation-setup.md` として作成・レビュー承認済み）
  - [x] PR作成者とは別に承認レビューを送るための承認ボットアカウント（GitHub Appのインストール、または専用ボットアカウントの発行）を用意し、変更提案への承認レビューのみに限定した権限のトークンを発行する手順を記載する（同上ドキュメントに記載済み）
  - [x] OSSプランが承認されるまで本番運用（実際の同期起動）を進めないという条件を明記する（同上ドキュメント冒頭に明記済み）
  - [ ] 手順書に沿って、3プロジェクト（またはテスト用のPOEditorプロジェクト）と承認ボットアカウントを実際に用意する。これは後続タスク（5.1・5.2・6.1・6.2）が使うシークレット・テスト環境の元になる
  - 観測可能な完了状態: 手順書に記載された順序通りに作業すれば、プロジェクトと承認ボットアカウントが用意され、貢献者が参加可能な状態に至る
  - _Requirements: 1.1, 1.2, 7.1, 7.2_
  - _Blocked: 実際のPOEditor OSSプラン申請・3プロジェクト作成・承認ボットアカウント発行・GitHub Actionsシークレット登録は、GROWI組織のPOEditorアカウント・GitHub組織権限を持つ人間のメンテナーによる実行が必要（エージェントが代行・捏造できる範囲外）。`docs/i18n-community-translation-setup.md` の手順1〜5に沿って実行し、完了後に `apps/app/tools/i18n-sync/sync-config.ts` のプレースホルダーと `docs/i18n-community-translation.md` の参加リンクを更新すること。_

## 5. Integration: ワークフローの配線

- [x] 5.1 pushワークフローを配線する
  - `apps/app/public/static/locales/en_US/**` の変更をトリガーに、pushのCLIを実行するGitHub Actionsワークフローを追加する
  - 同一ブランチでの多重実行を防ぐ排他制御を設定する
  - POEditor APIトークンをシークレット経由で注入する
  - `apps/app/package.json` にpush用のCLIを呼び出すスクリプトを追加する
  - 観測可能な完了状態: en_USのテスト用ファイル変更をトリガーにワークフローが起動し、pushのCLIが実行されるまでの一連の設定が揃う
  - _Requirements: 2.1, 2.2, 2.3, 8.1_
  - _Depends: 2, 4.2_

- [x] 5.2 pullワークフローを配線し、GitHub操作の実アダプタを実装する
  - 3.2/3.3が注入インターフェースとしてのみ定義した `TranslationOnlyPrPublisher` / `ApprovalReviewer` / `StructuralPrPublisher`（3.3の構造変更PR用インターフェース）の実装を、`gh` CLIまたはGitHub REST APIへの実呼び出しとして作成する（3.2のレビューで「アダプタの実装がどのタスクにも属していない」と指摘された分を回収する）
  - `I18nLintGate` の実アダプタ（`pnpm run lint:i18n` を実行して合否を返す）も同様に作成する（3.2・3.3のレビューで2回続けて「このインターフェースを実装するタスクがどこにも無い」と指摘された分を回収する）
  - 定期実行と手動実行の両方をトリガーに、pullのCLIを実行するGitHub Actionsワークフローを追加する
  - 同一ブランチでの多重実行を防ぐ排他制御を設定する
  - POEditor APIトークンと、承認ボット専用のトークンをそれぞれ別のシークレットとして注入する
  - 承認ボット用トークンに付与する権限を、変更提案への承認レビューのみに限定する
  - `apps/app/package.json` にpull用のCLIを呼び出すスクリプトを追加する
  - 観測可能な完了状態: 手動実行トリガーでワークフローが起動し、pullのCLIが実行されるまでの一連の設定が揃う
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 8.1_
  - _Depends: 3.1, 3.2, 3.3, 4.2_

## 6. Validation: 実環境での動作確認と回帰確認

- [ ] 6.1 push経路を実際のPOEditorテストプロジェクトに対して確認する
  - en_USのテスト用変更（キー追加・キー削除・文言変更）を含むファイルを用意し、push経路を実行する
  - POEditor側のテストプロジェクトに、追加・削除・文言変更が反映されていることを確認する
  - 観測可能な完了状態: POEditorのテストプロジェクトを確認し、実行前後でキー構成と文言が意図通り変化している
  - _Requirements: 2.1, 2.2, 2.3_
  - _Depends: 5.1_
  - _Blocked: 4.2の実プロビジョニング（POEditorテストプロジェクト・`POEDITOR_API_TOKEN`シークレット）が人手待ちのため実行不可。`docs/i18n-community-translation-setup.md` の手順完了後、この手順を実行すること。_

- [ ] 6.2 pull経路を実際のPOEditorテストプロジェクトに対して確認する
  - テストプロジェクト側で訳文のみを変更したケースと、キー構成を変更したケースをそれぞれ用意し、pull経路を実行する
  - 訳文のみの変更ではCIゲート通過後に承認レビューが送られた変更提案が、構造変更ではレビュー必須の変更提案がそれぞれ作られることを確認する
  - 観測可能な完了状態: 2種類のテストケースそれぞれについて、意図した種類の変更提案が実際のリポジトリ上に作られている
  - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - _Depends: 5.2_
  - _Blocked: 4.2の実プロビジョニングに加え、`I18N_SYNC_PUBLISH_TOKEN`（5.2で新設、`docs/i18n-community-translation-setup.md`未記載）と`I18N_SYNC_APPROVAL_TOKEN`（承認ボット、別IDである必要あり）の実登録が人手待ちのため実行不可。_

- [x] 6.3 リポジトリ全体のlint・test・buildが green であることを確認する
  - 新規追加したツール・ワークフローが、既存の `turbo run lint` / `turbo run test` / `turbo run build`（`@growi/app`）に悪影響を与えていないことを確認する
  - 既存の i18n CI ゲート（`i18n-key-audit` で実装済み）が、本機能追加後も引き続き正しく合否判定を行うことを確認する
  - `poeditor-client.spec.ts`（タスク1.2）の20秒スロットルテストが実時間ベースで間欠的に失敗する（3.2のレビューで6回中2回の失敗を確認済み）ため、フェイクタイマー化するか許容誤差を広げて安定させる
  - 観測可能な完了状態: `turbo run lint --filter @growi/app` / `turbo run test --filter @growi/app` / `turbo run build --filter @growi/app` がすべて成功する（`--repeat` 等で複数回実行しても poeditor-client のスロットルテストが安定して通ることを含む）
  - _Requirements: 3.3, 3.4, 8.1_
  - _Depends: 5.1, 5.2_

## Implementation Notes

- (1.3) `DiffClassifier` は葉の値を厳密等価（`!==`）で比較している。現在のロケールJSONは葉が全て文字列なので問題ないが、将来どこかの namespace に配列やオブジェクトを値に持つキーが増えた場合、参照比較になり毎回`translation_only`と誤判定する。3.1（export集計）でPOEditorから取得したJSONを渡す際、葉が文字列以外になり得ないか一応確認すること。
- (2, レビューで発見) `poeditor-client.spec.ts`（タスク1.2、実時間ベースの20秒スロットルテスト）が、5回に1回程度 `expected 19999 to be greater than or equal to 20000` の1ミリ秒未満の誤差で間欠的に失敗する（flaky）。今回のタスクの差分が原因ではないが、別途 flaky test として起票し、実時間計測でなくフェイクタイマー等に置き換えることを検討すること。
- (2) アップロード失敗時は読み込み失敗時と対称に「即座に中断し以降のnamespaceへは何もしない」形に統一した。読み込み失敗・アップロード失敗のどちらも部分反映を作らない。
- (3.1) `collectClassifications` の戻り値は `{ ok: true, translationOnly, structural, skipped }` の形。`read_failed`/`export_failed` は全体中断（`{ ok: false, failures }`）、`invalid_json`（POEditor側の不正なexport）だけは該当1組み合わせを`skipped`に入れて除外し、残りは通常通り処理する（design.mdのError Handlingの例外規定通り）。3.2/3.3でこの関数を呼ぶ側は`skipped`の存在を意識すること（無視してよいが、黙って握りつぶさず何らかの形でログ等に残すのが望ましい）。
- (3.2) `applyTranslationOnlyChanges` は `TranslationOnlyPrPublisher`（書き込み・PR作成/更新）と `ApprovalReviewer`（承認レビューのみ、内容を書けるメソッドを持たない）を別インターフェースとして注入する形で実装した。両方とも実装（GitHub操作の実アダプタ）はこのタスクの範囲外とし、5.2に回収した（5.2のタスク文を更新済み）。`TranslationOnlyCombination` に `absoluteFilePath`/`content` を追加したが `StructuralCombination` には追加していない（型で「構造変更がtranslationOnly経路に混入できない」壁を作るため、意図的な非対称）。3.3で構造変更PRを作る際、同じフィールドが必要なら独自に追加すること（`TranslationOnlyCombination` と混同しないよう別名にする）。
- (3.2) `pull-translations.ts` にはまだ `main()` エントリポイントが無い（`push-source.ts` の `main()` が手本）。3.3で `collectClassifications` → `applyTranslationOnlyChanges` → 構造変更PR作成 → 非ゼロ終了コード、まで束ねること（3.3のタスク文を更新済み）。
- (3.2) ゲート（`lint:i18n`）はCLI側（`I18nLintGate`注入）で実行する設計にした。design.mdのPull Flow図は「PR上でci-app-lintが走ってから承認」だが、tasks.mdの文言（「既存のlint:i18nを実行し」）に従った。`.github/mergify.yml`の`queue_conditions`/`merge_conditions`は両方とも`check-success ~= ci-app-lint`を要求するため、CLI側ゲート通過後にボットが承認しても、PR上のCIが落ちればキューに乗らずマージされない（要件3.4は守られる）。ただしCLI側ゲートが作業ツリーを読むため、同一実行内で3.3が構造変更ファイルを書き出した後にゲートを回すと、無関係な理由でtranslation-onlyのlintが落ちうる（安全側だが`main()`の実行順序を制約する — 3.3で対応時に留意）。
- (3.3) `applyStructuralChanges` は承認ボット関連のパラメータを一切持たない（型として承認を渡す口が無い）。`StructuralCombination` には `filePath`/`exportedContent` を追加した（`TranslationOnlyCombination` の `absoluteFilePath`/`content` とはあえて別名にし、取り違えを型で防止）。`pull-translations.ts` に `main()` を実装し、`collectClassifications` → `applyTranslationOnlyChanges` → `applyStructuralChanges` の順で呼び、いずれかの失敗で非ゼロ終了コードにする。`collectClassifications` の `skipped`（invalid_json）は成功時も `console.error` で警告表示するようにした（終了コードは変えない）。`main()` は4種の協力者（`TranslationOnlyPrPublisher`/`ApprovalReviewer`/`StructuralPrPublisher`/`I18nLintGate`）のうち実装があるのは無し（すべて5.2で実装予定の「未実装」スタブ。呼ばれると分かりやすいエラーで落ちる）。変更が無い実行では一切呼ばれないため、"何もすることが無い" run は現状でも成功する。`I18nLintGate` の実アダプタもどのタスクにも属していなかったため、5.2のタスク文に追加した。
- (3.3) `main()` の成功ログ「Pull sync completed: no failures.」は、`skipped` が非空でも変わらず出る（レビューでFYI指摘。ブロッカーではないが、5.2以降でCLIのログ文言を見直す際は「一部スキップあり」の場合に文言を分けることを検討するとよい）。
- (4.2) `docs/i18n-community-translation-setup.md` を作成（レビュー承認済み）。文書作成の3項目は完了、「実際に用意する」の1項目のみ人手待ちで`_Blocked:_`にした。あわせて design.md 44行目（Boundary Commitments > Allowed Dependencies）の `.github/mergify.yml`「Automatic queue to merge」ルールの引用が `#review-requested = 0` の条件を省略していることがレビューで判明（実ファイルには存在する条件）。手順書側はdesign.mdの記述をそのまま踏襲しているだけで手順書固有の誤りではないが、5.2で実アダプタを実装する際はdesign.mdでなく`.github/mergify.yml`の実物を見て条件を漏らさないこと。
- (5.2) `readGitHubRunConfig`（`pull-translations.ts`）が使う秘密情報は `I18N_SYNC_PUBLISH_TOKEN` / `GITHUB_TOKEN` / `I18N_SYNC_APPROVAL_TOKEN` の3つで、うち `I18N_SYNC_PUBLISH_TOKEN` は design.md の Security Considerations にも `docs/i18n-community-translation-setup.md`（4.2で作成した手順書）にも載っていない3つ目のシークレットである（手順書は POEDITOR_API_TOKEN と I18N_SYNC_APPROVAL_TOKEN の2つしか登録手順を示していない）。実際に本番用シークレットを登録する6.2のタスクでは、この `I18N_SYNC_PUBLISH_TOKEN` も忘れず登録すること。design.md 側への反映は `kiro-spec-cleanup` 実行時に吸収する。なお、GitHub Actions は登録されていないシークレットを `env:` へ渡すと空文字列としてエクスポートする（未設定にはならない）ため、`I18N_SYNC_PUBLISH_TOKEN ?? GITHUB_TOKEN` のような `??` によるフォールバックは効かず、実運用のワークフロー（`I18N_SYNC_PUBLISH_TOKEN` 未登録・`GITHUB_TOKEN` のみ利用可能なケース）で毎回失敗する不具合がレビューで見つかった。`||` によるフォールバックに修正済み（本人による自己承認を防ぐ等値チェックは変更していない）。

なおこのフォールバックにより、`I18N_SYNC_PUBLISH_TOKEN` を登録せず `GITHUB_TOKEN` のみで運用した場合、ワークフローは失敗せず実行できてしまうが、既定の `GITHUB_TOKEN` が作成したPRイベントは他のワークフロー実行を起動しないため `ci-app-lint` が付かず、承認されてもマージキューに永遠に留まる（早期の分かりやすい失敗が、後段の分かりにくい失敗に置き換わる）。6.2で実際にシークレットを揃える際、`I18N_SYNC_PUBLISH_TOKEN` の登録漏れがないか特に確認すること。
- (6.3) `poeditor-client.spec.ts` の20秒スロットルテストを `vi.useFakeTimers()` で時計を凍結する形に書き換え、実時間ジッターによる間欠失敗を解消した（負荷をかけた状態で修正前は20回中4回失敗、修正後は20回中0回失敗を実測）。`turbo run lint/test/build --filter @growi/app` はすべて成功。ただしレビューで `turbo run test --filter @growi/app --force`（キャッシュ無視）を実行すると `src/features/growi-vault/__tests__/clone-e2e.integ.ts` が4件失敗することが分かった。今回の差分（`poeditor-client.spec.ts` 1ファイルのみ）とは無関係で、一時gitサーバーへの接続前提が整っていない環境依存の既知の失敗（本spec外、growi-vault機能側の話）。i18n-community-translation の完了判定には影響しない。
- (feature-level validate-impl, MANUAL_VERIFY_REQUIRED) `/kiro-validate-impl` を独立subagent（Opus）で実行。結論はGO/NO-GOではなくMANUAL_VERIFY_REQUIRED — 実装済みタスクは全て健全（承認ボット分離・PRの粒度不変条件・境界・依存方向とも問題なし）だが、4.2/6.1/6.2が人手待ちのままのため要件1.1/1.2/7.1/7.2が未充足、かつ2.x/3.x系もモック検証のみで実POEditor/実GitHub APIに対する検証が一度もない。検証で新たに1点判明: `I18N_SYNC_PUBLISH_TOKEN`未登録時のフォールバック（`||`）が警告を一切出さずGITHUB_TOKENへ切り替わっていたため、手順書通りに2つしか登録しないと「一見成功するが承認済みPRがキューに永遠に残る」という分かりにくい失敗になっていた。`readGitHubRunConfig`にフォールバック発生時の`console.error`警告を追加して修正済み（対応するテストも追加）。6.2で実シークレットを揃える前に、この警告が出ないこと（＝3つとも正しく登録されていること）を確認すること。
