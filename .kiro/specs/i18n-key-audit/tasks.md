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

- [ ] 1.3 (P) 検出コマンドの出力から件数を取り出す処理を作る
  - `i18next-cli status` / `status --unused` / `status <locale>` それぞれの実際の出力サンプルを fixture として、件数を取り出す純粋関数を実装する
  - 期待した形式に一致しない入力を渡した場合に例外を投げることを確認する単体テストを書く
  - 観測可能な完了条件: 正常系・0件系・パース不能系の3種類の fixture に対するテストがすべて green になる
  - _Requirements: 1.1, 2.1, 3.1_
  - _Boundary: Stdout Parser_

- [ ] 1.4 (P) 基準線の読み書き・比較ロジックを作る
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

## 3. Core: 存在しない31件のキー参照を修正する

- [ ] 3.1 (P) discovery で判明した31件の存在しないキー参照を、参照修正または新規キー追加で解消する
  - `FixPageGrantModal.tsx` の `fix_page_grant.modal.alert_message` を、実際の表示条件（グループ未選択時のみ表示）に一致する既存キー `fix_page_grant.modal.alert_message_select_group` への参照に修正する
  - 同ファイルの `Successfully updated` / `Failed to update` を、en_US を含む5言語すべてに新規キーとして追加する
  - `GuideRow.tsx` / `TextStyleTab.tsx` の `common:failed_to_copy` を、`editor_guide.textstyle.copy_done` と対になる新規キー `editor_guide.textstyle.copy_failed` として5言語に追加し、呼び出し文字列自体も新しいキー名に書き換える
  - 1.2 で確定させた残り28件についても、同じ手順（既存キーへの参照修正、または5言語同時の新規キー追加＋必要な call site 書き換え）で解消する
  - 観測可能な完了条件: `i18next-cli status` の既定言語チェックが、この31件を含めて0件を報告する
  - _Requirements: 1.1, 1.4_
  - _Boundary: Non-Existent Key Reference Fix_
  - _Depends: 1.2_

- [ ] 3.2 3.1 で新規追加したキーが全5言語で欠けていないことを検証する
  - 新規追加キー（`Successfully updated` / `Failed to update` / `editor_guide.textstyle.copy_failed` および残り28件のうち新規追加した分）が、5言語すべてで値を持ち空でないことを確認する専用テストを追加する
  - 観測可能な完了条件: このテストが green であることを、後続の基準線初回記録（8.1）の前提条件として運用できる状態にする
  - _Requirements: 1.4, 3.2_
  - _Boundary: Non-Existent Key Reference Fix_
  - _Depends: 3.1_

## 4. Core: props 経由の `t` を自前の `useTranslation` に書き換える（Group 1）

- [ ] 4.1 (P) `SecuritySetting` 配下7ファイルを、`t` を props で受け取る形から自前で束ねる形に書き換える
  - `CommentManageRightsSettings` / `PageAccessRightsSettings` / `PageDeleteRightsSettings` / `PageListDisplaySettings` / `SessionMaxAgeSettings` / `UserHomepageDeletionSettings` / `UserPageVisibilitySettings` の7ファイルで、親コンポーネント（`SecuritySetting/index.tsx`）が実際に束ねている namespace（`admin`）を確認した上で、各コンポーネントが自前で `useTranslation('admin')` を呼ぶように変更する
  - 書き換え前後で、各コンポーネントが表示する翻訳文言が一致することを確認する
  - 観測可能な完了条件: 7ファイルのいずれも `t` を props として受け取らず、`i18next-cli status` がこれらのファイル由来の誤検出を報告しない
  - _Requirements: 1.1, 1.5, 1.6_
  - _Boundary: Call-site Remediation (Group 1)_
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
  - `saml.ts`（および 1.2 で確認した同様のファイル）で誤検出の原因になっているキーを対象に、前置対象のキーが `translation` と `admin` の両方の namespace に重複して存在しないことを先に確認する
  - 重複が無いことを確認できたキーにのみ、namespace を前置する
  - 完全な動的キー（テンプレートリテラルの変数セグメント）は対象外とし、1.2 の `preservePatterns` でカバーする
  - 観測可能な完了条件: 書き換え前後で解決される翻訳文言が一致し、`i18next-cli status` がこれらのファイル由来の誤検出を報告しない
  - _Requirements: 1.1, 1.5, 1.6_
  - _Boundary: Call-site Remediation (Group 3)_
  - _Depends: 1.2_

## 7. Core: 管理画面の共有ラベルを `commons` namespace に複製する（Bug 2）

- [ ] 7.1 (P) 共有ラベル約20〜23件を `commons.json` に複製し、複製ペアの同期を検証するテストを追加する
  - `Created` / `Cancel` / `Close` / `Name` / `Email` / `Update` / `Description` / `User` / `Edit` / `UserGroup` / `Create` 等を、5言語すべての `translation.json` の値を変更せず `commons.json` に複製する
  - 複製した各キーが、5言語すべてで `translation.json` と `commons.json` の値が一致することを検証する専用テスト（`i18n-reconcile.spec.ts` と同種のパターン）を追加する
  - 観測可能な完了条件: 追加したテストが green になり、`translation.json` の diff が空である
  - _Requirements: 7.1_
  - _Boundary: Bug 2 Remediation_
  - _Depends: 1.2_

- [ ] 7.2 discovery で判明した管理画面43コンポーネントの call site を `commons:` 前置に変更する
  - 43コンポーネントの共有ラベル呼び出し（例: `t('Cancel')`）を `t('commons:Cancel')` に書き換える。管理画面外の call site は変更しない
  - 書き換え前後で管理画面の表示文言が一致することを確認する
  - 観測可能な完了条件: 本番相当のビルドで、管理画面がこれらのラベルを生キーではなく翻訳済み文言として表示する
  - _Requirements: 7.1, 7.2_
  - _Boundary: Bug 2 Remediation_
  - _Depends: 7.1_

## 8. Integration: 基準線を初めて記録する

- [ ] 8.1 全ての修正が完了した状態で基準線を初めて記録する
  - タスク3〜7がすべて完了し、3.2 の新規キー検証テストが green であることを確認した上で `pnpm run i18n:baseline:update` を実行する
  - `baseline.json` に記録された未使用キー件数・言語別欠損件数を確認し、コミットする
  - 観測可能な完了条件: `pnpm run lint:i18n` を通常実行し、既定言語の欠損参照が0件、未使用キー・言語別欠損が新しく記録した基準線以下で合格する
  - _Requirements: 1.4, 2.2, 3.2_
  - _Boundary: Baseline Store_
  - _Depends: 2.1, 3.1, 3.2, 4.1, 5.1, 6.1, 7.1, 7.2_

## 9. Validation: 既存テストの整理確認と全体の回帰確認

- [ ] 9.1 既存の手書きドリフトテスト2本が、変更無しで妥当なままであることを確認する
  - `i18n-reconcile.spec.ts`（8つの特定キーの存在・非空確認）と `g2g-error-keys-locale-drift.spec.ts`（`admin:g2g:*` の実在確認と `KEYS_WITH_DETAIL_MESSAGE` の整合性確認）の両方を、他タスクの変更後も無修正のまま実行し、green であることを確認する
  - 観測可能な完了条件: 2本のテストファイルに差分が無いこと、かつ両方が green であることを確認できる
  - _Requirements: 8.1, 8.2_
  - _Depends: 8.1_

- [ ] 9.2 存在しないキー参照修正・Call-site Remediation の書き換え全体について、表示文言が変わっていないことを最終確認する
  - タスク3・4・5・6で書き換えた全ファイルについて、書き換え前に記録した表示文言と、実装後の表示文言を比較する
  - 観測可能な完了条件: 比較したすべてのキーで前後の文言が一致する
  - _Requirements: 1.6_
  - _Depends: 3.1, 4.1, 5.1, 6.1_

- [ ] 9.3 リポジトリ全体の lint・テスト・ビルドが green であることを確認する
  - `turbo run lint --filter=@growi/app`、`turbo run test --filter=@growi/app`、`turbo run build --filter=@growi/app` を実行する
  - 観測可能な完了条件: 3コマンドすべてが green で終了する
  - _Requirements: 6.1, 6.2_
  - _Depends: 8.1, 9.1, 9.2_

## Implementation Notes

- 1.1: `i18next-cli` を design.md 記載の 1.69.0 ではなく、実装時点の最新安定版 1.71.0 で固定した（`^` 無し）。design.md の意図は「特定の1バージョンに固定してstdout形式の変更を防ぐこと」であり、数値そのものの一致は求めていないため。1.3 のパーサー fixture はこの実際に入っている 1.71.0 の出力形式を基準に作ること。
- 1.2: 実測の結果、design.md の前提と食い違う点が複数見つかった。詳細は `apps/app/tools/i18n-audit/task-1.2-findings.md` を参照。(1) Group 1（`t` を props 経由で受け取る書き方）は7ファイルではなく、`Admin/` 配下だけで19ファイル、`Admin/` 外を含めると23ファイルある。(2) 存在しないキー参照119件のうちGroup 1/2/3でカバーできるのは57件のみで、62件が担当タスク無し。(3) さらに15件（commonsのみ実在5件、`:` 二重4件、literal `.` 2件、複数形語尾違い4件）が31件リストにもGroup 1/2/3にもBug2リストにも入らない。うち `No users have liked this yet.`（`LikeButtons.tsx`）はja_JPで英語表示になる実在の不具合。(4) Bug 2の対象は「約20〜23件/約43コンポーネント」ではなく実測で20件/36コンポーネント。(5) Requirement 4.2（存在しないキー参照側とunused側の両方から除外）を満たす手段としてdesign.mdは`preservePatterns`しか書いていないが、これはunused側にしか効かない。存在しないキー参照側の除外には別の設定項目`status.ignoreKeys`が必要（i18next-cli 1.71.0の実仕様、`node_modules/i18next-cli/types/types.d.ts`で確認済み）。research.md 22行目「`preservePatterns`は`status`の欠損判定にも効く」は誤りと判明。ユーザー判断により、tasks 3以降に進む前にdesign.md/tasks.mdをこれらの実測に合わせて改訂する。
