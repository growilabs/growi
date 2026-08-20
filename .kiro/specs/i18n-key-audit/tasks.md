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

## 2. Core: 検出処理の組み立てと既存 CI への統合

- [ ] 2.1 (P) 3種の検出コマンドを実行し合否を決めるオーケストレーターを作り、既存の lint パイプラインに統合する
  - `status`（既定言語の欠損参照件数）、`status --unused`（未使用キー件数）、非既定言語ごとの `status <locale>`（言語別欠損件数）の3系統を実行し、Stdout Parser で件数化し、Baseline Store で合否判定する
  - `extract` / `sync` はどの実行経路からも一度も呼ばないことをコードレビューで確認する
  - `apps/app/package.json` の `scripts` に `"lint:i18n"`（通常実行）と `"i18n:baseline:update"`（`--update-baseline` 付き実行）を追加し、`lint:**` glob に `lint:i18n` が含まれることを確認する
  - この時点では `baseline.json` はまだ存在しない（8.1 で初めて作成される）。Baseline Store の規定により、通常実行の `lint:i18n` は基準線ファイルが読めないため起動時検証で失敗するのが正しい振る舞いである。この段階でのオーケストレーター自体の動作確認は、fixture の baseline.json を使った単体・結合テスト（Stdout Parser・Baseline Store の既存テストの延長）で行い、「実リポジトリに対する `lint:i18n` の合格」は 8.1 まで持ち越す
  - 観測可能な完了条件: fixture の baseline.json を使った結合テストで、3種のコマンドの実行結果に応じて正しい終了コードが返ることを確認できる。実リポジトリに対して `lint:i18n` を実行すると、baseline.json 未存在によるエラーで即座に失敗する（8.1 より前の時点ではこれが期待される状態）
  - _Requirements: 1.1, 1.2, 1.3, 5.1, 5.2, 6.1, 6.2_
  - _Boundary: Audit Orchestrator_
  - _Depends: 1.3, 1.4_

## 3. Core: 存在しない25件のキー参照を修正する

- [ ] 3.1 (P) どの namespace ファイルにも存在しない25件のキー参照を、参照修正または新規キー追加で解消する
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

- [ ] 3.2 3.1 で新規追加したキーが全5言語で欠けていないことを検証する
  - 新規追加キー（`Successfully updated` / `Failed to update` / `editor_guide.textstyle.copy_failed` および 3.1 で新規追加した残りの分）が、5言語すべてで値を持ち空でないことを確認する専用テストを追加する
  - 観測可能な完了条件: このテストが green であることを、後続の基準線初回記録（8.1）の前提条件として運用できる状態にする
  - _Requirements: 1.4, 3.2_
  - _Boundary: Non-Existent Key Reference Fix_
  - _Depends: 3.1_

- [ ] 3.3 (P) 実行時には解決できるのに CLI が解決できない5キーを `status.ignoreKeys` に宣言する
  - `i18next.config.ts` の `status.ignoreKeys` に、次の5キーを**ワイルドカードを使わず具体キーとして**追記する（1.2 で追記済みの6キーに続けて書く）
    - `GROWI.5.0_new_schema` — キー名に `.` を literal で含むため、CLI は階層としてしか解釈できない。実行時は解決する（i18next を起動して確認済み）
    - `page_page.notice.stale_one` / `page_page.notice.stale_other` / `toaster.remove_share_link_one` / `toaster.remove_share_link_other` — CLI は `t(key, { count })` に対して複数形サフィックス付きのキーの実在を求めるが、i18next 本体はサフィックス無しのキーで解決する
  - 追記した5キーが `status` の報告から消え、それ以外の報告件数が変わらないことを実行して確認する（ワイルドカードにして周辺の静的キーまで隠していないことの確認も兼ねる）
  - 観測可能な完了条件: `npx i18next-cli status en_US --hide-translated` の報告に、この5キーがどれも現れない
  - _Requirements: 1.1, 4.1, 4.2_
  - _Boundary: i18next.config.ts_
  - _Depends: 1.2_

## 4. Core: 宣言 namespace から追跡できないキー参照を書き換える（Group 1a / 1b / 4 / 5）

- [ ] 4.1 (P) `SecuritySetting` 配下7ファイルを、`t` を props で受け取る形から自前で束ねる形に書き換える（Group 1a）
  - `CommentManageRightsSettings` / `PageAccessRightsSettings` / `PageDeleteRightsSettings` / `PageListDisplaySettings` / `SessionMaxAgeSettings` / `UserHomepageDeletionSettings` / `UserPageVisibilitySettings` の7ファイルで、親コンポーネント（`SecuritySetting/index.tsx`）が実際に束ねている namespace（`admin`）を確認した上で、各コンポーネントが自前で `useTranslation('admin')` を呼ぶように変更する
  - 書き換え前後で、各コンポーネントが表示する翻訳文言が一致することを確認する
  - 観測可能な完了条件: 7ファイルのいずれも `t` を props として受け取らず、`i18next-cli status` がこれらのファイル由来の誤検出を報告しない
  - _Requirements: 1.1, 1.5, 1.6_
  - _Boundary: Call-site Remediation (Group 1a)_
  - _Depends: 1.2_

- [ ] 4.2 (P) `t` を props で受け取る管理画面12ファイルのキー文字列に `admin:` を前置する（Group 1b）
  - 対象は 1.2 の実測で確定した12ファイル: `Admin/LegacySlackIntegration/SlackConfiguration.jsx`、`Admin/ElasticsearchManagement/StatusTable.jsx`、`Admin/ImportData/GrowiArchiveSection.jsx`、`Admin/MarkdownSetting/XssForm.jsx`、`Admin/MarkdownSetting/LineBreakForm.jsx`、`Admin/Users/PasswordResetModal.jsx`、`Admin/Notification/UserTriggerNotification.jsx`、`Admin/Notification/GlobalNotificationList.jsx`、`Admin/Notification/NotificationDeleteModal.jsx`、`Admin/Security/DeleteAllShareLinksModal.jsx`、`Admin/Users/StatusActivateButton.jsx`、`Admin/Users/UserRemoveButton.jsx`（いずれも `src/client/components/` 配下）
  - この12ファイルが報告の出どころになっているキーは61件で、これが「分類 C の119件のうち Group 1a / 2 / 3 のどこからも参照されていない62件」の大部分に当たる（残り1件は 4.3 が担当する）
  - 4.1 と違い、**hook 化はせずキー文字列への `admin:` 前置で直す**。`StatusTable.jsx` は class component で hook を呼べないうえ、前置だけで検出も実行時の解決も成立するため（design.md の Group 1b を参照）
  - 書き換え前に、各ファイルへ `t` を渡している wrapper が `useTranslation('admin')` を呼んでいることを確認する（12ファイルすべて `admin` であることは 1.2 で確認済み）
  - **同じファイルを触る他タスクとの調整**: `Admin/Users/PasswordResetModal.jsx` は 3.1（`Send` / `Copied!` の修正）も対象にしており、7.1 の確認結果によっては 7.2（`commons:Done` 周辺）も対象にする。同一ファイルの競合を避けるため、このファイルについては 3.1 → 4.2 →（必要なら）7.2 の順で片方が完了してから次を実行し、並列に走らせない
  - 観測可能な完了条件: `i18next-cli status en_US --hide-translated` の報告から、この12ファイル由来の61件が消え、書き換え前後で各ファイルの表示文言が一致する
  - _Requirements: 1.1, 1.5, 1.6_
  - _Boundary: Call-site Remediation (Group 1b)_
  - _Depends: 1.2, 3.1_

- [ ] 4.3 (P) 宣言 namespace では解決できない6キーに `admin:` / `commons:` を前置する（Group 4）
  - `admin:` を前置する1キー: `security_settings.updated_general_security_setting`（`Me/AssociateModal.tsx:59`、`Me/DisassociateModal.tsx:45`）。この2ファイルは `useTranslation()` を引数なしで呼んでおり、キーは `admin.json` にしか無いため実行時にも生キーが表示されている。`/me` 配下のページには `admin` が配られている（`pages/me/[[...path]].page.tsx:170`）ことを確認してから前置する
  - `commons:` を前置する5キー（9ファイル）: `not_found_page.page_not_exist`（`RevisionComparer/RevisionComparer.tsx:79`、`Admin/NotFoundPage.tsx:7`）、`Show`（`Me/BasicInfoSettings.tsx:142`）、`Hide`（同:160）、`New`（`Me/AccessTokenSettings.tsx:152`、`PageAccessoriesModal/ShareLink/ShareLink.tsx:81`）、`toaster.create_failed`（`Hotkeys/Subscribers/EditPage.tsx:68`、`CreateTemplateModal/CreateTemplateModal.tsx:74`、`Navbar/PageEditorModeManager.tsx:68`、`client/services/use-toastr-on-error.tsx:16`）
  - **この6キーは前後の表示文言が変わる**（生キー → 翻訳済み文言）。9.2 の前後比較では例外として扱い、「生キーが翻訳済み文言に変わったこと」を確認する
  - 観測可能な完了条件: `i18next-cli status en_US --hide-translated` の報告からこの6キーが消え、各画面で生キーではなく選択言語の文言が表示される
  - _Requirements: 1.1, 1.5, 1.6, 7.1_
  - _Boundary: Call-site Remediation (Group 4)_
  - _Depends: 1.2_

- [ ] 4.4 (P) 区切り `:` を重ねて書いている4キーを `.` 区切りに直す（Group 5）
  - `Admin/G2GDataTransfer.tsx:110` の `t('admin:g2g:transfer_success')` を `t('admin:g2g.transfer_success')` に直す
  - `Admin/AdminHome/AdminHome.tsx:138,147,158` の `admin:admin_top:copy_prefilled_host_information:default` / `:done` / `admin:admin_top:submit_bug_report` を、2つ目以降の `:` を `.` にした形に直す
  - i18next 本体は最初の `:` の前を namespace とみなし残りを `.` で繋ぎ直すため、書き換え前後で解決先は同じである（1.2 で i18next を起動して確認済み）
  - `g2g-error-keys-locale-drift.spec.ts` はキー文字列を `server/service/g2g-transfer.ts` からのみ抽出しており、`G2GDataTransfer.tsx` の呼び出しは読んでいないため、この書き換えでは同 spec に差分が出ない。書き換え後に同 spec が green のままであることを確認する
  - 観測可能な完了条件: `i18next-cli status en_US --hide-translated` の報告からこの4キーが消え、書き換え前後で表示文言が一致し、`g2g-error-keys-locale-drift.spec.ts` が無修正で green である
  - _Requirements: 1.1, 1.5, 1.6_
  - _Boundary: Call-site Remediation (Group 5)_
  - _Depends: 1.2_

## 5. Core: 管理画面ページの title callback に namespace を明示する（Group 2）

- [ ] 5.1 (P) `createAdminPageLayout` の `title` callback を使う19ファイルのキー文字列に `admin:` を前置する
  - 1.2 で確定させた19ファイル（`pages/admin/` 直下およびサブディレクトリ配下を含む）の `title: (props, t) => t('xxx')` を `t('admin:xxx')` に書き換える
  - 固定文字列2件（`[...path].page.tsx` / `vault.page.tsx`）と `{ ns: 'commons' }` 明示済み2件（`app.page.tsx` / `data-transfer.page.tsx`）は対象外のままにする
  - 観測可能な完了条件: 19ファイルすべてで書き換え前後の表示文言が一致し、`i18next-cli status` がこれらのファイル由来の誤検出を報告しない
  - _Requirements: 1.1, 1.5, 1.6_
  - _Boundary: Call-site Remediation (Group 2)_
  - _Depends: 1.2_

## 6. Core: サーバー側の複数 namespace 解決に namespace を明示する（Group 3）

- [ ] 6.1 (P) `getTranslation({ ns: [...] })` で解決しているキーに namespace を前置する
  - 1.2 の実測で、`ns:` の配列を渡しているのは `saml.ts` 1ファイルだけであり、書き換えが必要な固定キーもその中の1つ（`saml.ts:220` の `security_settings.form_item_name.ABLCRule`）だけであることが確定している。同じキーは `Admin/Security/SamlSecuritySettingContents.tsx:685` からも参照されており報告に出ているので、そちらも同時に前置する
  - 前置対象のキーが `translation` と `admin` の両方の namespace に重複して存在しないことを先に確認し、重複が無いことを確認できたキーにのみ namespace を前置する
  - `input_validation.message.required` / `input_validation.message.error_message` は `translation.json` に実在し報告に出ていないので前置しない（フォールバック順を変えるリスクを取らない）
  - 完全な動的キー（`saml.ts:197` のテンプレートリテラル）は対象外とし、1.2 の `preservePatterns` / `status.ignoreKeys` でカバーする
  - 観測可能な完了条件: 書き換え前後で解決される翻訳文言が一致し、`i18next-cli status` がこれらのファイル由来の誤検出を報告しない
  - _Requirements: 1.1, 1.5, 1.6_
  - _Boundary: Call-site Remediation (Group 3)_
  - _Depends: 1.2_

## 7. Core: 管理画面の共有ラベルを `commons` namespace に複製する（Bug 2）

- [ ] 7.1 (P) 共有ラベル20件を `commons.json` に複製し、複製ペアの同期を検証するテストを追加する
  - 1.2 が確定させた共有ラベル23件（`task-1.2-findings.md` §2）のうち、`commons.json` に既に値がある3件（`Delete` / `toaster.remove_share_link` / `toaster.remove_share_link_success`）を除いた **20件** を、5言語すべての `translation.json` の値を変更せず `commons.json` に複製する
  - 複製した20件が、5言語すべてで `translation.json` と `commons.json` の値が一致することを検証する専用テスト（`i18n-reconcile.spec.ts` と同種のパターン）を追加する
  - 20件には `Confirm` / `Help` / `Password` / `Warning` / `add` が含まれていることを確認する。この5件は今は報告に出ていない（CLI が `translation` で解決できている）が、7.2 で `commons:` を前置した後は `commons.json` を見に行くため、複製から漏れると新しい報告が増えて 8.1 が永久に合格しなくなる
  - 1.2 の洗い出し手順（「管理画面のコードから `t('固定文字列')` として呼ばれ、その file が宣言した namespace では解決できず、`translation.json` には実在する」ものだけを残す）を再実行し、`Done`（`Admin/Users/PasswordResetModal.jsx:67` が `t('commons:Done')` として呼んでおり、`translation.json` にはあるが `commons.json` には無い）を複製対象に含めるべきかを確認する。含める場合は複製対象が21件になり、同期テストの対象も21件になる。あわせて `PasswordResetModal.jsx` は 1.2 の36ファイル一覧に入っていないため、7.2 の対象ファイルも1つ増える（design.md の Bug 2 Remediation「未確定の追加候補1件」）
  - 観測可能な完了条件: 追加したテストが green になり、`translation.json` の diff が空である
  - _Requirements: 7.1_
  - _Boundary: Bug 2 Remediation_
  - _Depends: 1.2_

- [ ] 7.2 管理画面36コンポーネントの call site を `commons:` 前置に変更する
  - 1.2 が確定させた36ファイル（`task-1.2-findings.md` §2 の一覧。ファイルごとに、そのファイルが持つ共有ラベルも表になっている）の共有ラベル呼び出し（例: `t('Cancel')`）を `t('commons:Cancel')` に書き換える。管理画面外の call site は変更しない
  - `status` の報告に現れるのは23件のうち18件だけだが、報告に出ていない5件（`Confirm` / `Help` / `Password` / `Warning` / `add`）も実行時には生キーになるため、**報告件数を見て対象を狭めない**
  - 書き換え前後で管理画面の表示文言が一致することを確認する
  - 7.1 の確認結果で `Done` を対象に含める場合、`Admin/Users/PasswordResetModal.jsx` が対象ファイルに加わる（37ファイルになる）。同ファイルは 4.2 も触るため、4.2 の完了後に書き換える
  - 観測可能な完了条件: 本番相当のビルドで、管理画面がこれらのラベルを生キーではなく翻訳済み文言として表示し、`i18next-cli status` の報告が 7.2 の前置によって増えていない
  - _Requirements: 7.1, 7.2_
  - _Boundary: Bug 2 Remediation_
  - _Depends: 7.1, 4.2_

## 8. Integration: 基準線を初めて記録する

- [ ] 8.1 全ての修正が完了した状態で基準線を初めて記録する
  - タスク3〜7がすべて完了し、3.2 の新規キー検証テストが green であることを確認した上で `pnpm run i18n:baseline:update` を実行する
  - `baseline.json` に記録された未使用キー件数・言語別欠損件数を確認し、コミットする
  - 観測可能な完了条件: `pnpm run lint:i18n` を通常実行し、既定言語の欠損参照が0件、未使用キー・言語別欠損が新しく記録した基準線以下で合格する
  - _Requirements: 1.4, 2.2, 3.2_
  - _Boundary: Baseline Store_
  - _Depends: 2.1, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 5.1, 6.1, 7.1, 7.2_

## 9. Validation: 既存テストの整理確認と全体の回帰確認

- [ ] 9.1 既存の手書きドリフトテスト2本が、変更無しで妥当なままであることを確認する
  - `i18n-reconcile.spec.ts`（8つの特定キーの存在・非空確認）と `g2g-error-keys-locale-drift.spec.ts`（`admin:g2g:*` の実在確認と `KEYS_WITH_DETAIL_MESSAGE` の整合性確認）の両方を、他タスクの変更後も無修正のまま実行し、green であることを確認する
  - 特に 4.4（クライアント側の `admin:g2g:transfer_success` を `.` 区切りに直す）の後で `g2g-error-keys-locale-drift.spec.ts` が無修正・green のままであることを確認する。同 spec がキーを抽出しているのは `server/service/g2g-transfer.ts` だけなので差分は出ない想定だが、この想定が正しいことを実行で確かめる
  - 観測可能な完了条件: 2本のテストファイルに差分が無いこと、かつ両方が green であることを確認できる
  - _Requirements: 8.1, 8.2_
  - _Depends: 8.1_

- [ ] 9.2 存在しないキー参照修正・Call-site Remediation の書き換え全体について、表示文言が変わっていないことを最終確認する
  - タスク3・4・5・6で書き換えた全ファイルについて、書き換え前に記録した表示文言と、実装後の表示文言を比較する
  - **前後一致を求めない例外7キー**: 4.3 の6キー（`security_settings.updated_general_security_setting` / `not_found_page.page_not_exist` / `Show` / `Hide` / `New` / `toaster.create_failed`）と、3.1 の `No users have liked this yet.`。これらは書き換え前の表示が不具合（生キー、または ja_JP で英語へフォールバック）なので、確認する内容は「一致」ではなく「選択言語の翻訳済み文言に変わったこと」である
  - 観測可能な完了条件: 例外7キーを除いたすべてのキーで前後の文言が一致し、例外7キーは翻訳済み文言に変わっている
  - _Requirements: 1.6_
  - _Depends: 3.1, 4.1, 4.2, 4.3, 4.4, 5.1, 6.1_

- [ ] 9.3 リポジトリ全体の lint・テスト・ビルドが green であることを確認する
  - `turbo run lint --filter=@growi/app`、`turbo run test --filter=@growi/app`、`turbo run build --filter=@growi/app` を実行する
  - 観測可能な完了条件: 3コマンドすべてが green で終了する
  - _Requirements: 6.1, 6.2_
  - _Depends: 8.1, 9.1, 9.2_

## Implementation Notes

- 1.1: `i18next-cli` を design.md 記載の 1.69.0 ではなく、実装時点の最新安定版 1.71.0 で固定した（`^` 無し）。design.md の意図は「特定の1バージョンに固定してstdout形式の変更を防ぐこと」であり、数値そのものの一致は求めていないため。1.3 のパーサー fixture はこの実際に入っている 1.71.0 の出力形式を基準に作ること。
- 1.2: 実測の結果、design.md の前提と食い違う点が複数見つかった。詳細は `apps/app/tools/i18n-audit/task-1.2-findings.md` を参照。(1) Group 1（`t` を props 経由で受け取る書き方）は7ファイルではなく、`Admin/` 配下だけで19ファイル、`Admin/` 外を含めると23ファイルある。(2) 存在しないキー参照119件のうちGroup 1/2/3でカバーできるのは57件のみで、62件が担当タスク無し。(3) さらに15件（commonsのみ実在5件、`:` 二重4件、literal `.` 2件、複数形語尾違い4件）が31件リストにもGroup 1/2/3にもBug2リストにも入らない。うち `No users have liked this yet.`（`LikeButtons.tsx`）はja_JPで英語表示になる実在の不具合。(4) Bug 2の対象は「約20〜23件/約43コンポーネント」ではなく実測で20件/36コンポーネント。(5) Requirement 4.2（存在しないキー参照側とunused側の両方から除外）を満たす手段としてdesign.mdは`preservePatterns`しか書いていないが、これはunused側にしか効かない。存在しないキー参照側の除外には別の設定項目`status.ignoreKeys`が必要（i18next-cli 1.71.0の実仕様、`node_modules/i18next-cli/types/types.d.ts`で確認済み）。research.md 22行目「`preservePatterns`は`status`の欠損判定にも効く」は誤りと判明。ユーザー判断により、tasks 3以降に進む前にdesign.md/tasks.mdをこれらの実測に合わせて改訂する。
- 1.4: `computeBaselineUpdate` は前後差分（before→after）を戻り値の `changes` として返すのみで、標準出力への印字は行わない。design.md の Baseline Store は Contracts: State（Service/Batch ではない）であり、印字は 2.1（Audit Orchestrator）の責務と判断した。**2.1 のレビュー時に、`--update-baseline` 実行で実際にこの delta が標準出力に印字されることを必ず確認すること**（design.md がこの要件を明記しているが、まだどのコードもこれを満たしていない）。
