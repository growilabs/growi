# Implementation Plan

> 後追い作成メモ: 本 tasks.md は design 承認後に直接実装した内容を、Kiro ワークフローの成果物として
> 追記録するために作成した。各タスクは実装済みコードとの照合（fresh evidence）を経てチェックを付ける。
> 対象: `apps/app` 内で完結（`@growi/editor` の公開面拡張なし）。

- [x] 1. 基盤: CodeMirror 依存の追加と分類
- [x] 1.1 `@uiw/react-codemirror` と言語拡張 3 種を apps/app へ追加
  - `@uiw/react-codemirror` / `@codemirror/lang-javascript` / `@codemirror/lang-css` / `@codemirror/lang-html` を `apps/app/package.json` に追加し `pnpm install`
  - production build 後に `.next/node_modules/` を確認し、externalize されるものを `dependencies` に分類（`.claude/rules/package-dependencies.md`）
  - Observable: 4 パッケージが apps/app から解決でき、build 成功、`check-next-symlinks.sh` が OK
  - _Requirements: 1.1, 1.2, 1.3_
  - _Boundary: apps/app/package.json_

- [x] 2. 中核: 汎用コードエディタ `AdminCodeEditor` の新設（test-first）
- [x] 2.1 言語別シンタックスハイライト（言語→拡張の data-driven マップ）
  - `Admin/Common/AdminCodeEditor.tsx` を新設。`language` prop から `LANGUAGE_EXTENSIONS` マップ経由で拡張を選択（分岐なし）。`value`/`onChange`/`onBlur`/`aria-label` の純粋契約。`AdminCustomizeContainer`/`react-hook-form` を import しない
  - 単体テスト: javascript/css/html それぞれで `value` が描画される、空 `value` でもエラーなし
  - Observable: `AdminCodeEditor.spec.tsx` が 3 言語の描画・空値ケースで pass
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 5.1_
  - _Boundary: AdminCodeEditor_
  - _Depends: 1.1_
- [x] 2.2 テーマ追従（`useNextThemes().isDarkMode` → light/dark）
  - `isDarkMode` に基づき CodeMirror の `theme` prop を `'dark'`/`'light'` に決定
  - 単体テスト: `useNextThemes` をモックし、`isDarkMode` 切替で `cm-theme-dark`/`cm-theme-light` が切り替わる
  - Observable: テーマクラス切替のテストが pass
  - _Requirements: 3.1, 3.2, 3.3_
  - _Boundary: AdminCodeEditor_
  - _Depends: 2.1_
- [x] 2.3 基本編集支援（行番号・括弧マッチ・括弧自動閉じ、補完は無効）
  - `basicSetup={{ autocompletion: false }}` で行番号・bracketMatching・closeBrackets を既定有効、補完のみ無効化
  - 単体テスト: 行番号ガター（`cm-lineNumbers`）が描画される
  - Observable: 行番号ガターのテストが pass。**制約**: 括弧マッチ/自動閉じ（2.2, 2.3）と補完抑制は CodeMirror の contentEditable 実入力に依存し、happy-dom では入力イベントが反映されないため単体テスト不可。実装（`basicSetup` 既定 + `autocompletion:false`）は CodeMirror 保証挙動で、実ブラウザ smoke で確認する（→ Outstanding）
  - _Requirements: 2.1, 2.2, 2.3_
  - _Boundary: AdminCodeEditor_
  - _Depends: 2.1_

- [x] 3. 統合: 3 つの `CustomizeXSetting` の入力欄置換（`register` → `Controller`）
- [x] 3.1 CustomizeScriptSetting（`language="javascript"`）
  - `useForm` から `control` を取得。`<textarea {...register}>` を `<Controller name="customizeScript">` + `<AdminCodeEditor language="javascript">` に置換。`reset` 初期同期・`onSubmit`→`change/updateCustomizeScript`・トースト・`AdminUpdateButtonRow` の `disabled`・サンプル折りたたみ表示は不変
  - Observable: textarea/register 残存なし、typecheck 通過、保存経路・サンプル表示の JSX が維持
  - _Requirements: 1.1, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.2, 5.3_
  - _Boundary: CustomizeScriptSetting_
  - _Depends: 2.1_
- [x] 3.2 CustomizeCssSetting（`language="css"`）
  - 同上（`name="customizeCss"`）。CSS 欄はサンプル表示なし・周辺 UI 維持
  - Observable: textarea/register 残存なし、typecheck 通過
  - _Requirements: 1.2, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.3_
  - _Boundary: CustomizeCssSetting_
  - _Depends: 2.1_
- [x] 3.3 CustomizeNoscriptSetting（`language="html"`）
  - 同上（`name="customizeNoscript"`）。サンプル折りたたみ表示・`dangerouslySetInnerHTML` の説明文は不変
  - Observable: textarea/register 残存なし、typecheck 通過、サンプル表示の JSX が維持
  - _Requirements: 1.3, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.2, 5.3_
  - _Boundary: CustomizeNoscriptSetting_
  - _Depends: 2.1_

- [x] 4. 検証: 品質ゲートと非退行確認
- [x] 4.1 lint / typecheck / test / build を通し、依存分類と非退行を確認
  - `lint:typecheck`、`biome check`（変更分）、component テスト、production build、`check-next-symlinks.sh` を実行
  - Observable: 全て green。build 後の `.next/node_modules/` で lang-* が externalize され `dependencies` に配置済み
  - _Requirements: 全 Req の非退行_
  - _Depends: 3.1, 3.2, 3.3_

## Implementation Notes
- 依存分類: `@codemirror/lang-*` は SSR 経路（admin ページ）で externalize されるため `dependencies` 必須。`@uiw/react-codemirror` は build 時にバンドルされ externalize されないが、ランタイム UI コンポーネントのため設計判断どおり `dependencies` に配置（安全側）。
- Non-Goal: コード補完・ドラッグリサイズ・lint 表示・サンプル表示の技術刷新は対象外。NoscriptSetting のサンプルが `PrismAsyncLight language="javascript"`（中身は HTML）のままなのは既存挙動の維持（スコープ外）。
- `AdminCodeEditor.spec.tsx` の検証済み観点（8 tests）: 3 言語の描画 / 空値 / ライト・ダークテーマクラス / 行番号ガター / 制御値の外部更新反映。

## Outstanding（実装は完了・自動テストが design の Testing Strategy に未達の項目）
design の Testing Strategy に列挙されたが、happy-dom の制約または未着手により**自動テストが存在しない**。ソース実装はいずれも完了・非退行（typecheck + build + textarea/register 残存なしで確認済み）。デプロイ前の担保として下記を推奨:
1. **編集時挙動（Req 1.4 / 2.2 / 2.3）**: onChange 発火・ハイライトの逐次反映・括弧マッチ/自動閉じ・補完抑制。happy-dom では CodeMirror の実キー入力が反映されず単体テスト不可 → 実ブラウザ smoke（`/admin/customize` を開いて 3 欄でタイピング）で確認。
2. **各 `CustomizeXSetting` の統合テスト（Req 4.1〜4.5, 5.2, 5.3）**: 初期値の Controller 反映 / submit で `change・updateCustomizeX` が編集後文字列で呼ばれる / 成功・失敗トースト / `retrieveError` 時のボタン無効化 / サンプル・見出し維持。unstated-next `AdminCustomizeContainer` のモックが必要。未作成（改修前も textarea でテスト無し＝新規カバレッジ）。追加する場合は task 3.x の再実装として起票。
