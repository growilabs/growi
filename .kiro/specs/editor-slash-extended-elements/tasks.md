# Implementation Plan

> **前提（着手ゲート）**: 本スペックの全タスクは、基盤 `editor-slash-command` の公開インタフェース（`SlashCommand` 型・`SlashInsertion` 型・コマンド集合の合流点）が**実装・凍結**されていることを前提とする。別ストーリーで並行着手する場合は、基盤側でこの3契約を先に確定させること（design.md「着手前提条件」参照）。

- [ ] 1. コア: 挿入ビルダー・コマンド定義・ロケール

- [ ] 1.1 (P) 拡張要素の挿入ビルダーを実装
  - drawio・plantuml・lsx の雛形（テキスト + `from` 相対カーソルオフセット）を生成する純粋関数を実装する
  - 雛形: drawio = 空の ```drawio フェンス（カーソルはフェンス内）、plantuml = `@startuml`/`@enduml` を含むフェンス（カーソルは中間の空行）、lsx = `$lsx()`（カーソルは括弧内）
  - 副作用を持たない（エディタへ dispatch しない）
  - 観測: 各ビルダーが期待する挿入テキストとカーソル位置を返す単体テストが green（jsdom + EditorState/EditorView）
  - _Requirements: 1.2, 1.3, 1.4, 2.2, 5.1_
  - _Boundary: extended-element-builders_

- [ ] 1.2 拡張要素コマンドの定義集合を宣言
  - drawio・plantuml・lsx を、id・ラベル/説明の i18n キー・絞り込みキーワード・対応ビルダーとともにデータ宣言する
  - 今回未選択の要素（math・mermaid・callout 等）は含めない
  - 観測: コマンド集合が公開され、3 種が定義されること・未選択要素を含まないこと・各コマンドが i18n キーとキーワードを持つことをテストで確認
  - _Requirements: 1.1, 1.5, 3.2, 4.1_
  - _Boundary: extended-element-commands_
  - _Depends: 1.1_

- [ ] 1.3 (P) 拡張要素コマンドのロケールキーを追加
  - `slash_command.drawio.*` / `plantuml.*` / `lsx.*`（ラベル・説明）を en_US / ja_JP のロケールに追加する
  - 観測: 両ロケールにキーが存在し、各コマンドのラベル/説明が表示言語で解決される（未対応言語は既定言語へフォールバック）
  - _Requirements: 4.1, 4.2_
  - _Boundary: locale files_

- [ ] 2. 統合: 基盤コマンド集合への合流

- [ ] 2.1 拡張コマンドを基盤の有効コマンド集合へ合流
  - 有効コマンド集合を `[...基本コマンド, ...拡張要素コマンド]` として合成し、基盤の補完ソース構築に渡す（基盤 core は拡張を import しない＝依存逆転なし）
  - 観測: エディタ起動時に `/drawio` `/plantuml` `/lsx` が基本コマンドと同一の補完メニューに現れ、絵文字補完（`:`）と同時に機能する
  - _Requirements: 3.1, 5.2_
  - _Depends: 1.1, 1.2_
  - _Boundary: コマンド集合合流点（基盤側）_

- [ ] 3. 検証

- [ ] 3.1 統合・スモーク検証
  - `/uml` で plantuml が絞り込まれること、選択時に `/query` が置換され単一トランザクションで挿入され undo 1 回で復元することを検証する
  - `/lsx` 挿入後に `$lsx()` が現在ページ配下一覧として正常描画されること、`/drawio`・`/plantuml` の雛形が描画機構で正しく表示されることを実アプリで確認する
  - 観測: 上記シナリオが統合テスト/手動スモークで再現し、`turbo run lint/test/build --filter @growi/app` 相当が green
  - _Requirements: 2.1, 2.3, 3.2, 3.3, 5.2_
  - _Depends: 2.1_
