# Implementation Plan

- [ ] 1. 基盤: 型とコマンド定義

- [x] 1.1 コマンドと挿入内容を表す共通型の基盤を整備
  - スラッシュコマンドと、解決済みコマンド、挿入内容（`/query` を置換するテキスト + `from` 相対カーソルオフセット）を表す型を定義する
  - コマンドのアクションを判別共用体 `SlashCommandAction = SlashInsertAction { kind:'insert'; buildInsertion } | SlashRunAction { kind:'run'; run }` で定義し、`SlashCommand` は `action` を持つ。MVP の全コマンドは `insert`。`run`（副作用起動）は子スペック `editor-slash-extended-elements`（drawio/lsx モーダル）が用いる共有 seam
  - 挿入は絶対位置を持たず「テキスト + カーソルオフセット」だけで表現できることを型で保証する
  - 観測: 型がモジュールから公開され、後続のビルダー/ソースが参照できる。`insert`/`run` の両アクションが型で表現される
  - _Requirements: 5.1_
  - _Boundary: slash-command-types_

- [x] 1.2 ブロック要素の挿入内容を生成する純粋ビルダーを実装
  - 行頭マーカー（見出し H1–H3 / 箇条書き / 番号付き / タスク / 引用）、空コードブロック、2 列の空 Markdown テーブル（ヘッダ + 区切り + 1 ボディ行）の挿入テキストとカーソル位置を生成する
  - `from` が行頭か行の途中（先行する非空白テキストあり）かを判定し、行の途中なら要素種別に応じた区切りを前置して新しい行に挿入する（先行テキストを壊さない）。区切りは描画規則に従い、テーブル/コードブロックは空行（`\n\n`）、見出し/リスト/引用は単一改行（`\n`）
  - 副作用を持たない（エディタへ直接 dispatch しない）
  - 観測: 各ビルダーが期待する挿入テキストとカーソルオフセットを返し、行中発火時は要素種別に応じた区切りが前置されること（特にテーブルは空行で表として描画されること）を単体テストで確認（jsdom + EditorState/EditorView）
  - _Requirements: 3.3, 3.4, 3.6, 5.2, 5.3_
  - _Boundary: insertion-builders_

- [ ] 1.3 提供コマンド集合を単一ソースとして宣言
  - 見出し H1–H3 / 箇条書き / 番号付き / タスク / 引用 / コードブロック / テーブルを、ラベル・説明の i18n キー、絞り込みキーワード、対応する挿入ビルダーとともにデータとして宣言する
  - 拡張要素（drawio / math / lsx / テンプレート）は含めない
  - 観測: コマンド集合が公開され、9 種が定義されること・拡張要素が含まれないことをテストで確認
  - _Requirements: 5.1, 5.4_
  - _Boundary: slash-command-definitions_

- [ ] 2. コア: ラベル解決と補完ソース

- [ ] 2.1 (P) コマンドラベルの多言語解決とロケールキー整備
  - i18n キーを表示文字列（ラベル・説明）に解決する純粋関数を実装する
  - `en_US` / `ja_JP` のロケールに `slash_command.*` キーを追加し、未対応言語は既定言語へフォールバックする
  - 観測: 解決後に各コマンドへ label/description が付与され、未知キーで既定言語が返るテストが green
  - _Requirements: 1.3, 7.1, 7.2_
  - _Boundary: resolve-slash-commands, locale files_
  - _Depends: 1.3_

- [ ] 2.2 (P) スラッシュ補完ソース（トリガー・フィルタ・適用）を実装
  - `/` の直前が行頭（先頭空白のみ）または空白文字のときに発火し、空白以外の文字の直後（単語の途中、例 `foo/`）では発火しない
  - `/` 以降の入力でラベル/キーワードを大文字小文字を無視して絞り込み、一致なしではメニューを閉じ文書を変更しない。Escape / フォーカス喪失 / 空白入力でも文書を変更しない
  - 選択時は `action.kind` で分岐する。`insert` は `/query` を置換する単一 change を 1 トランザクションで発行しカーソルを続行入力位置へ置く（直後の undo 1 回で元に戻る）。`run` は `/query` 削除の単一 change を発行後に `action.run(view, from)` を呼ぶ（副作用＝モーダル起動等。基盤は run の中身を知らない）
  - 挿入は通常の `view.dispatch` トランザクションとして発行する（協調編集の同期経路と整合）
  - 観測: トリガー判定（行頭/空白直後で発火・単語途中で非発火）、絞り込み、`insert` の apply 後の文書・選択・undo、`run` の apply 後に `/query` のみ削除され `run` が呼ばれること、空白での非挿入を検証する単体テストが green
  - _Requirements: 1.1, 1.2, 1.4, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.4, 3.5, 4.1, 4.2, 4.3, 6.3_
  - _Boundary: slash-command-source_
  - _Depends: 1.1, 1.2_

- [ ] 3. 統合: 絵文字補完との統合と登録

- [ ] 3.1 (P) 絵文字補完のソース/レンダラを再エクスポート形に切り出し
  - 絵文字補完の補完ソースと描画オプションを個別に参照できる形で公開する（ロジックは変更しない）
  - 観測: 既存の絵文字補完の挙動が従来どおりで、補完ソースと描画オプションを個別に参照できる
  - _Requirements: 6.2_
  - _Boundary: emojiAutocompletionSettings_

- [ ] 3.2 スラッシュと絵文字を単一の補完設定に統合してエディタへ登録
  - 解決済みコマンドからスラッシュ補完ソースを構築し、絵文字のソース/描画オプションと合わせて 1 つの補完設定に統合して登録する
  - `/` をグローバルホットキーやキーマップにはバインドしない（エディタ入力中のみ発火）
  - 多重登録/破壊を防ぐ登録機構を採用する（ラベルは初期マウント時の言語で 1 回解決し、必要時のみ cleanup 付きで再構成）
  - 観測: エディタ起動時に `/` と `:` の両補完が独立に機能し、既存キーバインドとグローバル `/` 検索が従来どおり動作する
  - _Requirements: 6.1, 6.2, 6.4, 7.1_
  - _Depends: 2.1, 2.2, 3.1_
  - _Boundary: use-default-extensions_

- [ ] 4. 検証

- [ ] 4.1 統合スモークと回帰確認
  - 実アプリで `/` 入力 → 絞り込み → Enter で要素挿入（テーブル含む、カーソルが先頭セルに来る）を確認する
  - 行の途中（`あいうえお /table` 等、空白直後）で発火し、ブロック要素が新しい行に挿入され（テーブルは空行を確保して表として描画）先行テキストが壊れないことを確認する
  - Escape で `/` テキストが残りメニューが閉じること、`:` 絵文字補完が非回帰であること、協調編集中の挿入が同期されることを確認する
  - 観測: 上記シナリオが手動スモークで再現し、`turbo run lint/test/build --filter @growi/app` 相当が green
  - _Requirements: 1.1, 2.1, 3.2, 3.3, 3.6, 4.1, 6.2, 6.3_
  - _Depends: 3.2_

## Implementation Notes
- 1.2: insertion-builders decide line-start vs mid-line purely from **same-line** preceding non-whitespace text (Req 3.6 wording). The design's cross-line nuance (table on a fresh empty line directly below a non-empty paragraph → also needs a blank line) is intentionally NOT handled by the builders — the typical `/` trigger hits the mid-line path. Revisit in the 4.1 smoke if a paragraph-then-newline-then-`/table` case renders wrong.
