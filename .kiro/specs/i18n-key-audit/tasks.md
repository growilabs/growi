# 実装計画

## 1. Foundation: ツール導入と、正しい対象一覧の確定

- [x] 1.1 `i18next-cli` を導入し、検出対象を宣言する設定を用意する
  - `apps/app/package.json` の devDependency に `i18next-cli`（バージョン固定、`^` 無し）を追加する
  - `apps/app/i18next.config.ts` を作成し、対象言語（en_US/ja_JP/zh_CN/fr_FR/ko_KR）、対象ソース（`src/**/*.{ts,tsx,js,jsx}`）、テストファイル等の除外パターンを宣言する
  - 観測可能な完了条件: `npx i18next-cli status` が設定エラー無く実行でき、既定言語の欠損参照件数が標準出力に表示される
  - _Requirements: 5.1_
  - _Boundary: i18next.config.ts_

- [x] 1.2 検出結果を、翻訳ファイルへの実在チェックで正しい分類に絞り込む
  - `i18next-cli status` の生の報告を、3つの namespace ファイル（translation/admin/commons）のどこにも存在しないキーだけに絞り込み、discovery で判明した31件の一覧（3つの具体例＋残り28件）を確定させる
  - Call-site Remediation の対象ファイル一覧を実際に検索して確定させる: Group 1（`t` を props 経由で受け取る7ファイル）、Group 2（`createAdminPageLayout` の `title` callback を使う23ファイルから、固定文字列2件・`{ ns: 'commons' }` 明示済み2件を除いた19ファイル、`pages/admin/` のサブディレクトリ配下5件を含む）、Group 3（`getTranslation({ ns: [...] })` を使うサーバー側ファイル、`saml.ts` 以外に同様の書き方をしている箇所が無いかも確認する）
  - 31件の一覧と、Bug 2 remediation が複製する共有ラベル約20〜23件の一覧が重複していないことを確認する（重複があれば、どちらのタスクが担当するかを明記する）。Group 1（`SecuritySetting` 配下7ファイル）と Bug 2 の共有ラベルの重複は無いことを確認済み（7ファイルのキーはいずれも `security_settings.*` 配下または grant 表示用の別名で、共有ラベルと重複しない）。Bug 2 が対象にする管理画面43コンポーネントの正確な一覧も、この時点で確定させる
  - 完全な動的キー参照（テンプレートリテラルの変数セグメント等、discovery で判明した約50件）を `extract.preservePatterns` に宣言する
  - 観測可能な完了条件: `i18next-cli status --unused` を実行しても、宣言した動的キーパターンが未使用として報告されない
  - _Requirements: 4.1, 4.2, 4.3_
  - _Boundary: i18next.config.ts_
  - _Depends: 1.1_

- [x] 1.3 (P) 検出コマンドの出力から件数を取り出す処理を作る
  - `i18next-cli status` / `status --unused` / `status <locale>` それぞれの実際の出力サンプルを fixture として、件数を取り出す純粋関数を実装する
  - 期待した形式に一致しない入力を渡した場合に例外を投げることを確認する単体テストを書く
  - 観測可能な完了条件: 正常系・0件系・パース不能系の3種類の fixture に対するテストがすべて green になる
  - _Requirements: 1.1, 2.1, 3.1_
  - _Boundary: Stdout Parser_

- [x] 1.4 (P) 基準線の読み書き・比較ロジックを作る
  - 未使用キー件数・言語別欠損件数を記録する `baseline.json` の読み込みと、「測定値 <= 基準線」の比較ロジックを実装する
  - `--update-baseline` 実行時、悪化する測定値は既定で拒否し、`--allow-regression` を明示した場合のみ許可する。基準線がまだ存在しない最初の実行だけはこのガードの対象外とする
  - 言語別欠損件数にまだ記録が無い言語は基準線0件として扱う（無条件合格にしない）ロジックを実装する
  - 観測可能な完了条件: 基準線以下・基準線超過・境界値・初回実行（ファイル無し）・未記録言語のそれぞれについて期待した合否が返る単体テストが green になる
  - _Requirements: 2.2, 2.3, 2.4, 2.5, 3.2, 3.3, 3.4, 3.5_
  - _Boundary: Baseline Store_

- [x] 1.5 `parseLocaleMissingCount` に、`X untranslated,` 節が無い実際の出力形式を対応させる
  - 2.1 のレビューで、実リポジトリの `ko_KR` に対する `npx i18next-cli status ko_KR` の実際の出力が `Summary: Found 228 incomplete translations for "ko_KR" — 228 absent.` であり、`X untranslated,` の節がまるごと無いことが判明した（`parseLocaleMissingCount` は現在この節を必須としている）。切り分けの結果、この節が消えるのは未翻訳件数（untranslated）がちょうど0件のときで、`ko_KR` 固有ではなく件数条件で発生する（詳細は `## Implementation Notes` の 2.1 の記録を参照）
  - `parseLocaleMissingCount` を、`X untranslated,` 節が無い場合はその値を0件として扱うように直す（`ja_JP` / `zh_CN` / `fr_FR` のように節がある場合の挙動は変えない）
  - 観測可能な完了条件: 実際の `ko_KR` の出力（`X untranslated,` 節なし）を fixture として追加したテストが green になり、既存のテスト（節ありの fixture）も green のまま
  - _Requirements: 1.1, 2.1, 3.1_
  - _Boundary: Stdout Parser_
  - _Depends: 1.3_

- [x] 1.6 `parseDefaultLanguageMissingCount` に、欠損が0件のとき「Primary language ... is missing」行そのものが出力されない実際の形式を対応させる
  - 8.1 の実行時に判明。7.3 完了により実リポジトリで初めて `en_US` の欠損が0件になったところ、`npx i18next-cli status`（既定言語チェック）の出力に "Primary language ... is missing N key(s)" 行がまるごと無いことが分かった（0件のときは行自体が省略される。1.5 で対応した `parseLocaleMissingCount` の「`X untranslated,` 節が省略される」と同種の、CLI の「0件なら該当行を出さない」という一貫した挙動）。実際の出力は、既定言語チェックが0件の場合、4つの非既定言語の進捗バーだけを表示し `✖ Error: Incomplete translations detected.`（非既定言語側の欠損が原因）で終わる
  - `parseDefaultLanguageMissingCount` を、この行が無い場合は0件として扱うように直す（行がある場合の既存の挙動は変えない）
  - 観測可能な完了条件: 実際の欠損0件時の出力（行なし）を fixture として追加したテストが green になり、既存のテスト（行ありの fixture）も green のまま
  - _Requirements: 1.1, 2.1, 3.1_
  - _Boundary: Stdout Parser_
  - _Depends: 1.3_

## 2. Core: 検出処理の組み立てと既存 CI への統合

- [x] 2.1 (P) 3種の検出コマンドを実行し合否を決めるオーケストレーターを作り、既存の lint パイプラインに統合する
  - `status`（既定言語の欠損参照件数）、`status --unused`（未使用キー件数）、非既定言語ごとの `status <locale>`（言語別欠損件数）の3系統を実行し、Stdout Parser で件数化し、Baseline Store で合否判定する
  - `extract` / `sync` はどの実行経路からも一度も呼ばないことをコードレビューで確認する
  - `apps/app/package.json` の `scripts` に `"lint:i18n"`（通常実行）と `"i18n:baseline:update"`（`--update-baseline` 付き実行）を追加し、`lint:**` glob に `lint:i18n` が含まれることを確認する
  - この時点では `baseline.json` はまだ存在しない（8.1 で初めて作成される）。Baseline Store の規定により、通常実行の `lint:i18n` は基準線ファイルが読めないため起動時検証で失敗するのが正しい振る舞いである。この段階でのオーケストレーター自体の動作確認は、fixture の baseline.json を使った単体・結合テスト（Stdout Parser・Baseline Store の既存テストの延長）で行い、「実リポジトリに対する `lint:i18n` の合格」は 8.1 まで持ち越す
  - 観測可能な完了条件: fixture の baseline.json を使った結合テストで、3種のコマンドの実行結果に応じて正しい終了コードが返ることを確認できる。実リポジトリに対して `lint:i18n` を実行すると、baseline.json 未存在によるエラーで即座に失敗する（8.1 より前の時点ではこれが期待される状態）
  - _Requirements: 1.1, 1.2, 1.3, 5.1, 5.2, 6.1, 6.2_
  - _Boundary: Audit Orchestrator_
  - _Depends: 1.3, 1.4_

## 3. Core: 存在しない25件のキー参照を修正する

- [x] 3.1 (P) どの namespace ファイルにも存在しない25件のキー参照を、参照修正または新規キー追加で解消する
  - 対象は 1.2 が確定させた24件（`task-1.2-findings.md` §1 の表、call site は26箇所）＋ 同 §5 の `LikeButtons.tsx` 1件の計25件。この表を対象一覧としてそのまま使う（再列挙は不要）
  - `FixPageGrantModal.tsx` の `fix_page_grant.modal.alert_message` を、実際の表示条件（グループ未選択時のみ表示）に一致する既存キー `fix_page_grant.modal.alert_message_select_group` への参照に修正する
  - 同ファイルの `Successfully updated` / `Failed to update` を、en_US を含む5言語すべてに新規キーとして追加する（`Failed to update` は `Admin/SlackIntegration/CustomBotWithProxySettings.jsx` からも参照されているので、キーの追加でそちらも同時に直る）
  - `GuideRow.tsx` / `TextStyleTab.tsx` の `common:failed_to_copy` を、`editor_guide.textstyle.copy_done` と対になる新規キー `editor_guide.textstyle.copy_failed` として5言語に追加し、呼び出し文字列自体も新しいキー名に書き換える
  - `LikeButtons.tsx:87` の `t('No users have liked this yet.')` を、末尾の `.` を外した `t('No users have liked this yet')` に直す。これは ja_JP などで英語が表示されていた実在の不具合の修正なので、**このキーだけは前後の表示文言が変わる**（英語→選択言語の翻訳）。9.2 の前後比較では例外として扱う
  - 残りの件についても、`task-1.2-findings.md` §1 の表の方針欄（参照修正 / 新規キー追加 / 判断要）に従って解消する。「判断要」の行は call site を読んで修正先を決める
  - 観測可能な完了条件: `i18next-cli status en_US --hide-translated` の報告から、この25件が消えている
  - _Requirements: 1.1, 1.4_
  - _Boundary: Non-Existent Key Reference Fix_
  - _Depends: 1.2_

- [x] 3.2 3.1 で新規追加したキーが全5言語で欠けていないことを検証する
  - 新規追加キー（`Successfully updated` / `Failed to update` / `editor_guide.textstyle.copy_failed` および 3.1 で新規追加した残りの分）が、5言語すべてで値を持ち空でないことを確認する専用テストを追加する
  - 観測可能な完了条件: このテストが green であることを、後続の基準線初回記録（8.1）の前提条件として運用できる状態にする
  - _Requirements: 1.4, 3.2_
  - _Boundary: Non-Existent Key Reference Fix_
  - _Depends: 3.1_

- [x] 3.3 (P) 実行時には解決できるのに CLI が解決できない5キーを `status.ignoreKeys` に宣言する
  - `i18next.config.ts` の `status.ignoreKeys` に、次の5キーを**ワイルドカードを使わず具体キーとして**追記する（1.2 で追記済みの6キーに続けて書く）
    - `GROWI.5.0_new_schema` — キー名に `.` を literal で含むため、CLI は階層としてしか解釈できない。実行時は解決する（i18next を起動して確認済み）
    - `page_page.notice.stale_one` / `page_page.notice.stale_other` / `toaster.remove_share_link_one` / `toaster.remove_share_link_other` — CLI は `t(key, { count })` に対して複数形サフィックス付きのキーの実在を求めるが、i18next 本体はサフィックス無しのキーで解決する
  - 追記した5キーが `status` の報告から消え、それ以外の報告件数が変わらないことを実行して確認する（ワイルドカードにして周辺の静的キーまで隠していないことの確認も兼ねる）
  - 観測可能な完了条件: `npx i18next-cli status en_US --hide-translated` の報告に、この5キーがどれも現れない
  - _Requirements: 1.1, 4.1, 4.2_
  - _Boundary: i18next.config.ts_
  - _Depends: 1.2_

## 4. Core: 宣言 namespace から追跡できないキー参照を書き換える（Group 1a / 1b / 4 / 5）

- [x] 4.1 (P) `SecuritySetting` 配下7ファイルを、`t` を props で受け取る形から自前で束ねる形に書き換える（Group 1a）
  - `CommentManageRightsSettings` / `PageAccessRightsSettings` / `PageDeleteRightsSettings` / `PageListDisplaySettings` / `SessionMaxAgeSettings` / `UserHomepageDeletionSettings` / `UserPageVisibilitySettings` の7ファイルで、親コンポーネント（`SecuritySetting/index.tsx`）が実際に束ねている namespace（`admin`）を確認した上で、各コンポーネントが自前で `useTranslation('admin')` を呼ぶように変更する
  - 書き換え前後で、各コンポーネントが表示する翻訳文言が一致することを確認する
  - 観測可能な完了条件: 7ファイルのいずれも `t` を props として受け取らず、`i18next-cli status` がこれらのファイル由来の誤検出を報告しない
  - _Requirements: 1.1, 1.5, 1.6_
  - _Boundary: Call-site Remediation (Group 1a)_
  - _Depends: 1.2_

- [x] 4.2 (P) `t` を props で受け取る管理画面12ファイルのキー文字列に `admin:` を前置する（Group 1b）
  - 対象は 1.2 の実測で確定した12ファイル: `Admin/LegacySlackIntegration/SlackConfiguration.jsx`、`Admin/ElasticsearchManagement/StatusTable.jsx`、`Admin/ImportData/GrowiArchiveSection.jsx`、`Admin/MarkdownSetting/XssForm.jsx`、`Admin/MarkdownSetting/LineBreakForm.jsx`、`Admin/Users/PasswordResetModal.jsx`、`Admin/Notification/UserTriggerNotification.jsx`、`Admin/Notification/GlobalNotificationList.jsx`、`Admin/Notification/NotificationDeleteModal.jsx`、`Admin/Security/DeleteAllShareLinksModal.jsx`、`Admin/Users/StatusActivateButton.jsx`、`Admin/Users/UserRemoveButton.jsx`（いずれも `src/client/components/` 配下）
  - この12ファイルが報告の出どころになっているキーは61件で、これが「分類 C の119件のうち Group 1a / 2 / 3 のどこからも参照されていない62件」の大部分に当たる（残り1件は 4.3 が担当する）
  - 4.1 と違い、**hook 化はせずキー文字列への `admin:` 前置で直す**。`StatusTable.jsx` は class component で hook を呼べないうえ、前置だけで検出も実行時の解決も成立するため（design.md の Group 1b を参照）
  - 書き換え前に、各ファイルへ `t` を渡している wrapper が `useTranslation('admin')` を呼んでいることを確認する（12ファイルすべて `admin` であることは 1.2 で確認済み）
  - **同じファイルを触る他タスクとの調整**: `Admin/Users/PasswordResetModal.jsx` は 3.1（`Send` / `Copied!` の修正）も対象にしており、7.1 の確認結果によっては 7.2（`commons:Done` 周辺）も対象にする。同一ファイルの競合を避けるため、このファイルについては 3.1 → 4.2 →（必要なら）7.2 の順で片方が完了してから次を実行し、並列に走らせない
  - **3.1 がすでに前置済みの2キー**: 3.1 の実装で、`PasswordResetModal.jsx` の `Copied!` と `GlobalNotificationList.jsx` の `Enable` は、いずれも新規キー追加だけでは props 経由の `t` の namespace 解決に引っかかり報告が消えなかったため、`t('admin:Copied!')` / `t('admin:Enable')` としてすでに `admin:` 前置済みである（3.1 のレビューで承認済み）。この2キーは重複して前置しない。ファイル内の他のキー（12ファイル分・61件のうちこの2件を除いた分）だけを本タスクの対象とする
  - 観測可能な完了条件: `i18next-cli status en_US --hide-translated` の報告から、この12ファイル由来の61件が消え、書き換え前後で各ファイルの表示文言が一致する
  - _Requirements: 1.1, 1.5, 1.6_
  - _Boundary: Call-site Remediation (Group 1b)_
  - _Depends: 1.2, 3.1_

- [x] 4.3 (P) 宣言 namespace では解決できない6キーに `admin:` / `commons:` を前置する（Group 4）
  - `admin:` を前置する1キー: `security_settings.updated_general_security_setting`（`Me/AssociateModal.tsx:59`、`Me/DisassociateModal.tsx:45`）。この2ファイルは `useTranslation()` を引数なしで呼んでおり、キーは `admin.json` にしか無いため実行時にも生キーが表示されている。`/me` 配下のページには `admin` が配られている（`pages/me/[[...path]].page.tsx:170`）ことを確認してから前置する
  - `commons:` を前置する5キー（9ファイル）: `not_found_page.page_not_exist`（`RevisionComparer/RevisionComparer.tsx:79`、`Admin/NotFoundPage.tsx:7`）、`Show`（`Me/BasicInfoSettings.tsx:142`）、`Hide`（同:160）、`New`（`Me/AccessTokenSettings.tsx:152`、`PageAccessoriesModal/ShareLink/ShareLink.tsx:81`）、`toaster.create_failed`（`Hotkeys/Subscribers/EditPage.tsx:68`、`CreateTemplateModal/CreateTemplateModal.tsx:74`、`Navbar/PageEditorModeManager.tsx:68`、`client/services/use-toastr-on-error.tsx:16`）
  - **この6キーは前後の表示文言が変わる**（生キー → 翻訳済み文言）。9.2 の前後比較では例外として扱い、「生キーが翻訳済み文言に変わったこと」を確認する
  - 観測可能な完了条件: `i18next-cli status en_US --hide-translated` の報告からこの6キーが消え、各画面で生キーではなく選択言語の文言が表示される
  - _Requirements: 1.1, 1.5, 1.6, 7.1_
  - _Boundary: Call-site Remediation (Group 4)_
  - _Depends: 1.2_

- [x] 4.4 (P) 区切り `:` を重ねて書いている4キーを `.` 区切りに直す（Group 5）
  - `Admin/G2GDataTransfer.tsx:110` の `t('admin:g2g:transfer_success')` を `t('admin:g2g.transfer_success')` に直す
  - `Admin/AdminHome/AdminHome.tsx:138,147,158` の `admin:admin_top:copy_prefilled_host_information:default` / `:done` / `admin:admin_top:submit_bug_report` を、2つ目以降の `:` を `.` にした形に直す
  - i18next 本体は最初の `:` の前を namespace とみなし残りを `.` で繋ぎ直すため、書き換え前後で解決先は同じである（1.2 で i18next を起動して確認済み）
  - `g2g-error-keys-locale-drift.spec.ts` はキー文字列を `server/service/g2g-transfer.ts` からのみ抽出しており、`G2GDataTransfer.tsx` の呼び出しは読んでいないため、この書き換えでは同 spec に差分が出ない。書き換え後に同 spec が green のままであることを確認する
  - 観測可能な完了条件: `i18next-cli status en_US --hide-translated` の報告からこの4キーが消え、書き換え前後で表示文言が一致し、`g2g-error-keys-locale-drift.spec.ts` が無修正で green である
  - _Requirements: 1.1, 1.5, 1.6_
  - _Boundary: Call-site Remediation (Group 5)_
  - _Depends: 1.2_

## 5. Core: 管理画面ページの title callback に namespace を明示する（Group 2）

- [x] 5.1 (P) `createAdminPageLayout` の `title` callback を使う19ファイルのキー文字列に `admin:` を前置する
  - 1.2 で確定させた19ファイル（`pages/admin/` 直下およびサブディレクトリ配下を含む）の `title: (props, t) => t('xxx')` を `t('admin:xxx')` に書き換える
  - 固定文字列2件（`[...path].page.tsx` / `vault.page.tsx`）と `{ ns: 'commons' }` 明示済み2件（`app.page.tsx` / `data-transfer.page.tsx`）は対象外のままにする
  - 観測可能な完了条件: 19ファイルすべてで書き換え前後の表示文言が一致し、`i18next-cli status` がこれらのファイル由来の誤検出を報告しない
  - _Requirements: 1.1, 1.5, 1.6_
  - _Boundary: Call-site Remediation (Group 2)_
  - _Depends: 1.2_

## 6. Core: サーバー側の複数 namespace 解決に namespace を明示する（Group 3）

- [x] 6.1 (P) `getTranslation({ ns: [...] })` で解決しているキーに namespace を前置する
  - 1.2 の実測で、`ns:` の配列を渡しているのは `saml.ts` 1ファイルだけであり、書き換えが必要な固定キーもその中の1つ（`saml.ts:220` の `security_settings.form_item_name.ABLCRule`）だけであることが確定している。同じキーは `Admin/Security/SamlSecuritySettingContents.tsx:685` からも参照されており報告に出ているので、そちらも同時に前置する
  - 前置対象のキーが `translation` と `admin` の両方の namespace に重複して存在しないことを先に確認し、重複が無いことを確認できたキーにのみ namespace を前置する
  - `input_validation.message.required` / `input_validation.message.error_message` は `translation.json` に実在し報告に出ていないので前置しない（フォールバック順を変えるリスクを取らない）
  - 完全な動的キー（`saml.ts:197` のテンプレートリテラル）は対象外とし、1.2 の `preservePatterns` / `status.ignoreKeys` でカバーする
  - 観測可能な完了条件: 書き換え前後で解決される翻訳文言が一致し、`i18next-cli status` がこれらのファイル由来の誤検出を報告しない
  - _Requirements: 1.1, 1.5, 1.6_
  - _Boundary: Call-site Remediation (Group 3)_
  - _Depends: 1.2_

## 7. Core: 管理画面の共有ラベルを `commons` namespace に複製する（Bug 2）

- [x] 7.1 (P) 共有ラベル20件を `commons.json` に複製し、複製ペアの同期を検証するテストを追加する
  - 1.2 が確定させた共有ラベル23件（`task-1.2-findings.md` §2）のうち、`commons.json` に既に値がある3件（`Delete` / `toaster.remove_share_link` / `toaster.remove_share_link_success`）を除いた **20件** を、5言語すべての `translation.json` の値を変更せず `commons.json` に複製する
  - 複製した20件が、5言語すべてで `translation.json` と `commons.json` の値が一致することを検証する専用テスト（`i18n-reconcile.spec.ts` と同種のパターン）を追加する
  - 20件には `Confirm` / `Help` / `Password` / `Warning` / `add` が含まれていることを確認する。この5件は今は報告に出ていない（CLI が `translation` で解決できている）が、7.2 で `commons:` を前置した後は `commons.json` を見に行くため、複製から漏れると新しい報告が増えて 8.1 が永久に合格しなくなる
  - 1.2 の洗い出し手順（「管理画面のコードから `t('固定文字列')` として呼ばれ、その file が宣言した namespace では解決できず、`translation.json` には実在する」ものだけを残す）を再実行し、`Done`（`Admin/Users/PasswordResetModal.jsx:67` が `t('commons:Done')` として呼んでおり、`translation.json` にはあるが `commons.json` には無い）を複製対象に含めるべきかを確認する。含める場合は複製対象が21件になり、同期テストの対象も21件になる。あわせて `PasswordResetModal.jsx` は 1.2 の36ファイル一覧に入っていないため、7.2 の対象ファイルも1つ増える（design.md の Bug 2 Remediation「未確定の追加候補1件」）
  - 観測可能な完了条件: 追加したテストが green になり、`translation.json` の diff が空である
  - _Requirements: 7.1_
  - _Boundary: Bug 2 Remediation_
  - _Depends: 1.2_

- [x] 7.2 管理画面36コンポーネントの call site を `commons:` 前置に変更する
  - 1.2 が確定させた36ファイル（`task-1.2-findings.md` §2 の一覧。ファイルごとに、そのファイルが持つ共有ラベルも表になっている）の共有ラベル呼び出し（例: `t('Cancel')`）を `t('commons:Cancel')` に書き換える。管理画面外の call site は変更しない
  - `status` の報告に現れるのは23件のうち18件だけだが、報告に出ていない5件（`Confirm` / `Help` / `Password` / `Warning` / `add`）も実行時には生キーになるため、**報告件数を見て対象を狭めない**
  - 書き換え前後で管理画面の表示文言が一致することを確認する
  - 7.1 の確認結果で `Done` を対象に含める場合、`Admin/Users/PasswordResetModal.jsx` が対象ファイルに加わる（37ファイルになる）。同ファイルは 4.2 も触るため、4.2 の完了後に書き換える
  - **前提条件（7.1 のレビューで判明・要人間判断）**: `Admin/UserGroup/UserGroupTable.tsx` の `t('Edit')` を、他の36ファイルと同様に機械的に `t('commons:Edit')` へ書き換えないこと。`commons:Edit` は `Navbar/PageEditorModeManager.tsx`（管理画面外、`View`/`Edit` の切り替えUI）がすでに実運用中で、fr_FR は意図的に `View: "Lecture"` / `Edit: "Écriture"`（閲覧／執筆の対）という訳語を使っている。`UserGroupTable.tsx` の編集ボタンを同じキーに前置すると、この対を崩すか、管理画面のボタンに「執筆」という不自然な訳語が出るかのどちらかになる。書き換える前に、別キーを新設する（例: `commons:table_action.edit` のような汎用アクション名）か、この1ファイルだけ前置を見送るかを人間が判断すること。同種の懸念が `Navbar/PageEditorModeManager.tsx:100` の `View`（`task-1.2-findings.md` §1 の8番、まだ「判断要」のまま未解決）にもある — このキーを将来 `commons.json` に複製する判断をする際も、同じ fr_FR の対を崩さないよう同時に検討すること
  - 観測可能な完了条件: 本番相当のビルドで、管理画面がこれらのラベルを生キーではなく翻訳済み文言として表示し、`i18next-cli status` の報告が 7.2 の前置によって増えていない
  - _Requirements: 7.1, 7.2_
  - _Boundary: Bug 2 Remediation_
  - _Depends: 7.1, 4.2_

- [x] 7.3 残り2件（`Edit` / `Update`）の生キー表示を解消する
  - **`Edit` の解決（ユーザー判断: 別キーを新設）**: `Admin/UserGroup/UserGroupTable.tsx` の編集ボタンのために、`commons.json` に新規キー（例: `table_action.edit`）を5言語すべてに追加する。値は既存の `Edit`（`translation.json`）の値をそのまま複製する。`UserGroupTable.tsx` の呼び出しをこの新規キーに前置する（`commons:Edit` へは前置しない）。`Navbar/PageEditorModeManager.tsx` の `commons:Edit`（fr_FR "Écriture"）は変更しない
  - **`Update` の解決**: `Admin/ImportData/GrowiArchive/ImportCollectionConfigurationModal.jsx` と `Admin/Notification/GlobalNotification.jsx` の `t('Update')` を `t('commons:Update')` に前置する（両ファイルとも `useTranslation('admin')` で、`commons:Update` は既に7.1で複製済み・7.2で他ファイルから参照済み）
  - **`Admin/Notification/GlobalNotificationList.jsx:199` の `Edit`**: 7.2 の対象36ファイルの一覧には無かったが同じ仕組みの生キー表示バグ。`t('commons:Edit')` に前置する（`UserGroupTable.tsx` とは別問題で、こちらは既存の `commons:Edit` をそのまま使ってよい — `PageEditorModeManager.tsx` との衝突は `UserGroupTable.tsx` 固有の懸念であり、このファイルの `Edit` ボタンには当たらない）
  - 前後で表示文言が一致することを確認する（新規キーは既存の `Edit` の値をそのまま複製するため一致する）
  - 観測可能な完了条件: `i18next-cli status en_US --hide-translated` の報告が0件になる
  - _Requirements: 1.1, 1.4, 7.1_
  - _Boundary: Bug 2 Remediation_
  - _Depends: 7.2_

## 8. Integration: 基準線を初めて記録する

- [x] 8.1 全ての修正が完了した状態で基準線を初めて記録する
  - タスク3〜7がすべて完了し、3.2 の新規キー検証テストが green であることを確認した上で `pnpm run i18n:baseline:update` を実行する
  - `baseline.json` に記録された未使用キー件数・言語別欠損件数を確認し、コミットする
  - 観測可能な完了条件: `pnpm run lint:i18n` を通常実行し、既定言語の欠損参照が0件、未使用キー・言語別欠損が新しく記録した基準線以下で合格する
  - _Requirements: 1.4, 2.2, 3.2_
  - _Boundary: Baseline Store_
  - _Depends: 1.5, 1.6, 2.1, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 5.1, 6.1, 7.1, 7.2, 7.3_

## 9. Validation: 既存テストの整理確認と全体の回帰確認

- [x] 9.1 既存の手書きドリフトテスト2本が、変更無しで妥当なままであることを確認する
  - `i18n-reconcile.spec.ts`（8つの特定キーの存在・非空確認）と `g2g-error-keys-locale-drift.spec.ts`（`admin:g2g:*` の実在確認と `KEYS_WITH_DETAIL_MESSAGE` の整合性確認）の両方を、他タスクの変更後も無修正のまま実行し、green であることを確認する
  - 特に 4.4（クライアント側の `admin:g2g:transfer_success` を `.` 区切りに直す）の後で `g2g-error-keys-locale-drift.spec.ts` が無修正・green のままであることを確認する。同 spec がキーを抽出しているのは `server/service/g2g-transfer.ts` だけなので差分は出ない想定だが、この想定が正しいことを実行で確かめる
  - 観測可能な完了条件: 2本のテストファイルに差分が無いこと、かつ両方が green であることを確認できる
  - _Requirements: 8.1, 8.2_
  - _Depends: 8.1_

- [x] 9.2 存在しないキー参照修正・Call-site Remediation の書き換え全体について、表示文言が変わっていないことを最終確認する
  - タスク3・4・5・6で書き換えた全ファイルについて、書き換え前に記録した表示文言と、実装後の表示文言を比較する
  - **前後一致を求めない例外**: 4.3 のうち実在の不具合4キー（`security_settings.updated_general_security_setting` / `Show` / `Hide` / `New`）と、3.1 の `No users have liked this yet.`。これらは書き換え前の表示が不具合（生キー、または ja_JP で英語へフォールバック）なので、確認する内容は「一致」ではなく「選択言語の翻訳済み文言に変わったこと」である。**4.3 の残り2キー（`not_found_page.page_not_exist` / `toaster.create_failed`）はこの例外に含めない**: 4.3 の実装時に確認した結果、これらは前置前から `useTranslation(['translation', 'commons'])` の配列指定または `useTranslation('commons')` の既定指定により正しく解決できており、生キー表示にはなっていなかった（検出の都合のみの前置）ため、通常どおり前後一致を確認する対象である
  - **3.1 の「新規キー追加」「参照修正」全般について**: 3.1 のレビュー（finding 10）で、書き換え前に存在しないキーを参照していた項目（`page_tree.move_blocked` / `move_failed`、`editor_guide.decoration.alert_block`、`common:failed_to_copy`、`Forbidden`、`Not available for read only user`、`Slack Member ID`、`something_went_wrong`、`fix_page_grant.modal.alert_message`、`Successfully updated` / `Failed to update`、`Copied!`、`Enable` 等）は、書き換え前が生キー表示だったため、これらも「一致」ではなく「生キー表示から翻訳済み文言に変わったこと」を確認する対象である。また `Browsing of this page is restricted`（→ `page_page.notice.restricted`）と `ExternalUserGroup`（→ "External User Group"）は、書き換えにより **en_US の表示文言自体が変わる**（前者は2箇所の呼び出しを1つの既存キーに統合したことによる意図的な変更、後者は camelCase の生キーから実際の文言への変更）
  - **前後一致の確認は言語ごとに行うこと（9.2 の実装で判明した記述の不足）**: `Select template` / `Page` / `Execute` / `View` / `Send` / `Clear` / `User Settings` は、当初「書き換え前から翻訳済みだったキー」として一致確認の対象に挙げていたが、これは en_US だけを見た記述だった。実際には言語ごとに事情が異なり、以下の言語では書き換え前は生キー表示で、書き換え後に初めて各言語の文言が表示される（生キー表示から翻訳済み文言に変わったことを確認する対象。有益な変化であり不具合ではない）: `Select template`（ja_JP/zh_CN/ko_KR/fr_FR の4言語すべて）、`Page`（fr_FR/ko_KR）、`Execute`（fr_FR/ko_KR）、`View`（ja_JP/zh_CN/ko_KR）、`Send`（fr_FR/ko_KR）、`Clear`（ja_JP/zh_CN/ko_KR/fr_FR の4言語すべて）、`User Settings`（ko_KR）。前後一致の確認は、上記以外の言語（主に en_US、および元々翻訳が存在していた言語）に限る
  - 観測可能な完了条件: 上記の例外を除いたすべてのキーで前後の文言が一致し、例外キーは翻訳済み文言（または意図した新しい文言）に変わっている
  - _Requirements: 1.6_
  - _Depends: 3.1, 4.1, 4.2, 4.3, 4.4, 5.1, 6.1_

- [x] 9.3 リポジトリ全体の lint・テスト・ビルドが green であることを確認する
  - `turbo run lint --filter=@growi/app`、`turbo run test --filter=@growi/app`、`turbo run build --filter=@growi/app` を実行する
  - 観測可能な完了条件: 3コマンドすべてが green で終了する
  - _Requirements: 6.1, 6.2_
  - _Depends: 8.1, 9.1, 9.2_

## Implementation Notes

- 1.1: `i18next-cli` を design.md 記載の 1.69.0 ではなく、実装時点の最新安定版 1.71.0 で固定した（`^` 無し）。design.md の意図は「特定の1バージョンに固定してstdout形式の変更を防ぐこと」であり、数値そのものの一致は求めていないため。1.3 のパーサー fixture はこの実際に入っている 1.71.0 の出力形式を基準に作ること。
- 1.2: 実測の結果、design.md の前提と食い違う点が複数見つかった。詳細は `apps/app/tools/i18n-audit/task-1.2-findings.md` を参照。(1) Group 1（`t` を props 経由で受け取る書き方）は7ファイルではなく、`Admin/` 配下だけで19ファイル、`Admin/` 外を含めると23ファイルある。(2) 存在しないキー参照119件のうちGroup 1/2/3でカバーできるのは57件のみで、62件が担当タスク無し。(3) さらに15件（commonsのみ実在5件、`:` 二重4件、literal `.` 2件、複数形語尾違い4件）が31件リストにもGroup 1/2/3にもBug2リストにも入らない。うち `No users have liked this yet.`（`LikeButtons.tsx`）はja_JPで英語表示になる実在の不具合。(4) Bug 2の対象は「約20〜23件/約43コンポーネント」ではなく実測で20件/36コンポーネント。(5) Requirement 4.2（存在しないキー参照側とunused側の両方から除外）を満たす手段としてdesign.mdは`preservePatterns`しか書いていないが、これはunused側にしか効かない。存在しないキー参照側の除外には別の設定項目`status.ignoreKeys`が必要（i18next-cli 1.71.0の実仕様、`node_modules/i18next-cli/types/types.d.ts`で確認済み）。research.md 22行目「`preservePatterns`は`status`の欠損判定にも効く」は誤りと判明。ユーザー判断により、tasks 3以降に進む前にdesign.md/tasks.mdをこれらの実測に合わせて改訂する。
- 1.4: `computeBaselineUpdate` は前後差分（before→after）を戻り値の `changes` として返すのみで、標準出力への印字は行わない。design.md の Baseline Store は Contracts: State（Service/Batch ではない）であり、印字は 2.1（Audit Orchestrator）の責務と判断した。**2.1 のレビュー時に、`--update-baseline` 実行で実際にこの delta が標準出力に印字されることを必ず確認すること**（design.md がこの要件を明記しているが、まだどのコードもこれを満たしていない）。
- 2.1: レビュー時に、実リポジトリに対して `npx i18next-cli status <locale>` を4つの非既定言語すべてで実行して確認したところ、`ko_KR` の実際の出力が `parseLocaleMissingCount`（1.3・Stdout Parser の担当、`tools/i18n-audit/parse-status-output.ts`）の前提と食い違うことが分かった。パーサーは `Summary: Found N incomplete translations for "<locale>" — X untranslated, N absent.` の形を要求するが、`ko_KR` の実際の出力は `Summary: Found 228 incomplete translations for "ko_KR" — 228 absent.` で、`X untranslated,` の節がまるごと無い。他の3言語（`ja_JP` / `zh_CN` / `fr_FR`）は今のところ `1 untranslated, ...` を含んでおり正常にパースできる。切り分けた結果、この節が消えるのは「未翻訳件数（untranslated）がちょうど0件のとき」で、`ko_KR` 固有の問題ではなく件数条件で起きる。つまり今後の翻訳追加・削除によって、どの言語でも untranslated が0件になった瞬間にこの欠落が新たに発生しうる。2.1（Audit Orchestrator）は `status <locale>` を呼ぶだけでパース自体はしないため、この節自体の修正は 1.3 の担当ファイル（`parse-status-output.ts`）を触ることになり、2.1 の Boundary 外である。**8.1（基準線の初回記録）は非既定言語すべてに対して `status <locale>` を実行して回るため、この修正が完了していないと `ko_KR` の実測でパーサーが例外を投げ、`pnpm run i18n:baseline:update` がそのまま失敗する。8.1 に進む前に、`parseLocaleMissingCount` を「`X untranslated,` 節が無い場合は 0 件として扱う」形に直す小さな修正タスクを起票し完了させること。** → 1.5 として起票・実装・レビュー承認・コミット済み（`0657b10998`）。
- 3.1: (1) タスク文の「`Failed to update` は `Admin/SlackIntegration/CustomBotWithProxySettings.jsx` からも参照されている」という記述は誤りだったことをレビューで確認した。同ファイル98行目は `logger.error('Failed to update', err)` というログ出力で、`t()` 呼び出しではない。実害は無い（`FixPageGrantModal.tsx` からの参照だけで新規キー追加は必要だった）ので、記述だけが不正確。(2) `page_tree.move_blocked` / `page_tree.move_failed` は、findings.md §1 の方針欄が「新規キー追加」としていたが、実装時に `pagetree.you_cannot_move_this_page_now` / `pagetree.something_went_wrong_with_moving_page` という、全5言語に既存の値を持つが本文からは一切参照されていない（`page_tree` → `pagetree` への過去のリネームで孤立した）キーが見つかったため、新規追加でなく参照修正で解消した（5言語分の翻訳が復元され、未使用キーも2件減る）。`/kiro-validate-impl` がこの逸脱を再度指摘しないよう記録する。
- 7.1: 複製作業で `zh_CN.Close`/`zh_CN.Done`/`fr_FR.Edit` の3件について、`commons.json` に本機能開始前から存在していた値（`translation.json` とは異なる値）を、いったん `translation.json` 側に合わせて上書きしてしまい、レビューで差し戻された。`zh_CN.Close`="关闭"/`zh_CN.Done`="完成" は commit `5b834dc268`（2023-06-26, soumaeda）、`fr_FR.Edit`="Écriture" は commit `00b8a691ec`（2026-02-19, Lanhild, "refactor: enhance french translations"）で、いずれも本 feature 着手前から `master` に存在する翻訳。上書きすると `zh_CN` は正しい中国語訳が英語プレースホルダーに劣化し、`fr_FR` は `View`/`Edit` を「閲覧」「執筆」の対として意図的に訳し分けている `Navbar/PageEditorModeManager.tsx` の表示が壊れる（いずれも管理画面外の、現在稼働中のUI）。3件とも元の値に復元済み。復元しても `status en_US --hide-translated` の件数（14件）は変わらないことを実測済み（この監査は en_US だけを見るため、他言語の値の食い違いは検出対象外）。同期テストは、この3ペアだけ `translation.json` との一致ではなく既知の意図した値へのピン留めに変更した（`KNOWN_INTENTIONAL_DIVERGENCES`）。7.2 に引き継ぐ前提条件は 7.2 のタスク文に追記済み。
- 7.2: 実装・レビューの過程で、`task-1.2-findings.md` §2 の36ファイル一覧に元々入っていなかった、同じ仕組み（`useTranslation('admin')` を props 経由で受け取り、共有ラベルを既定 namespace のまま参照）の生キー表示バグが追加で見つかった。いずれも本タスクの対象外（別ファイル一覧）なので今回は直していない。
  - `UserGroupTable.tsx` の `Edit`（本タスクの前提条件により意図的に未対応。人間判断待ち）と、`Admin/ImportData/GrowiArchive/ImportCollectionConfigurationModal.jsx` の `Update`、`Admin/Notification/GlobalNotification.jsx` の `Update`、`Admin/Notification/GlobalNotificationList.jsx` の `Edit` — この3ファイルは `i18next-cli status` の報告に出ており、`en_US --hide-translated` の残り2件（`Edit`/`Update`）の出どころ
  - `GlobalNotificationList.jsx:199` の `Delete`、`NotificationDeleteModal.jsx:39` の `Delete`、`DeleteAllShareLinksModal.jsx:32,35` の `Cancel`/`Delete`、`UserRemoveButton.jsx:43` の `Delete` — これらは4.2で対応した「`t` を props で受け取る」12ファイルの中にあるが、CLI の報告には出ない（props 経由の namespace を CLI が追跡できないため）。実行時には生キー表示になっている可能性が高い
  - いずれも Bug 2 と同じ原因・同じ直し方（`commons:` 前置）で解消できると見込まれるが、対象一覧の確定（1.2 相当の再調査）と実装は別タスクとして起票すること。
- 7.3: `Edit`/`Update` の解消により `i18next-cli status en_US --hide-translated` が初めて0件（要件1の目標）に到達した。実装時に、タスク文が前提としていた「`GlobalNotificationList.jsx` の `Edit` は `commons:Edit` を再利用してよい」という判断が誤りだったことが判明した。実際のUIを確認した結果、この `Edit` は行内ドロップダウンの「この項目を編集する」リンクで、`UserGroupTable.tsx` の編集ボタンと同じ「テーブル行の編集操作」という意味であり、`commons:Edit`（`PageEditorModeManager.tsx` の閲覧/執筆モード切り替えUI専用、fr_FR "Écriture"）とは意味が異なる。タスク文どおりに `commons:Edit` へ前置すると、fr_FR で新たに「Écriture（執筆）」という不自然な表示が生まれてしまう（レビューで独立に検証済み）。実装者はこの1点だけタスク文から離れ、同タスクで新設した `commons:table_action.edit`（`UserGroupTable.tsx` 用）を代わりに使うことで、fr_FR の新規不具合を避けつつ0件化を達成した。レビューでこの逸脱は妥当と判定済み。上記の3件（`GlobalNotificationList.jsx:199` の `Delete` 等、props 経由で CLI から見えない生キー表示バグ）は未解消のまま残っている。
- 1.6: 8.1 実行時に発覚。7.3 完了で `en_US` の欠損が初めて0件になったところ、`parseDefaultLanguageMissingCount` が対応する「行が無い＝0件」の判定を、レビューで2回差し戻しを受けて修正した。1回目の修正（無関係な `✅ Primary Language:` 行だけをアンカーにする）は、欠損行の文言が変わったり出力が途中で切れたりしても無条件に0件を返してしまう問題がレビューで発見された。2回目の修正（`/missing/i` という語のゆるい検出）も、"missing" という単語自体を避けた言い換えには効かないことがレビューで発見された。最終的には、欠損行が入る「場所」（非既定言語の進捗行の直後から、次の既知の区切りまでの区間）を切り出し、その区間が本当に空白だけかどうかを直接確認する構造的な判定に直した（語彙に依存しない）。「出力が欠損行の直前でちょうど途切れた場合」と「本当に0件の場合」は文字列だけでは原理的に区別できない残存ケースがあるが、これは Stdout Parser の境界（すでに取得済みの文字列を解釈するだけで、プロセスの終了自体は監督しない）の外にあるとレビューで判断済み。
- 6.1: タスク文は「`SamlSecuritySettingContents.tsx:685` からも参照されており報告に出ている」としていたが、実測（before/after の A/B）では `translation` namespace の欠損はちょうど1件で、その1件は `saml.ts` 由来だった。`.tsx` 側の参照は最初から報告に出ていなかった（`SamlSecuritySettingContents.tsx` 自体が `useTranslation('admin')` を呼んでおり、前置無しでも `admin.json` から解決できていたため）。件数には影響しないが、前置しても解決結果は一致する（レビューで実測確認済み）ため変更は維持した。
- 4.3: design.md/タスク文は Group 4 の6キーすべてを「実行時にも生キーが表示される実在の不具合」としていたが、実装時に i18next の実際の解決結果を確認した結果、実在の不具合は4キー（`security_settings.updated_general_security_setting` / `Show` / `Hide` / `New`、5ファイル）のみで、残り2キー（`not_found_page.page_not_exist` / `toaster.create_failed`、6ファイル）は前置前から `useTranslation(['translation', 'commons'])` の配列指定または `useTranslation('commons')` の既定指定により正しく解決できており、生キー表示にはなっていなかったことが判明した（レビューで実際に i18next を起動して独立検証済み）。前置自体は6キーすべてに必要（`i18next-cli` の検出のため）だが、9.2 の前後比較で「一致を求めない例外」に含めるのは実在の不具合4キーのみとした。design.md の該当箇所（Group 4 の説明、Testing Strategy）も合わせて訂正済み。
- 9.2: タスク文が「書き換え前から翻訳済みだったキー（前後一致の対象）」として挙げていた `Select template` / `Page` / `Execute` / `View` / `Send` / `Clear` / `User Settings` は、en_US だけを見た記述だったことが判明した。実際には言語ごとに事情が異なり、7キーのうちいくつかは特定の非英語言語では書き換え前は生キー表示で、書き換え後に初めてその言語の文言が表示される（有益な変化であり不具合ではない）。詳細な言語別の内訳はタスク文自体に追記済み。design.md の「合計7キー」という見出しの数字も、4.3 の実装で例外が6件から4件に減った際に更新されていなかった古い記述だったため、実際の列挙（5キー: Group4の4キー＋LikeButtons）に合わせて「合計5キー」に訂正した。
